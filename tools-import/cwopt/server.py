"""Local web interface (spec §9): a JSON API, a server-sent event stream and static files.

Standard library only (``http.server``), bound to 127.0.0.1.  The frontend in
``web/`` talks to nothing but ``/api/...``, so it can move into corewar.dev
with a different backend (for example a Web Worker running the engine).
"""
from __future__ import annotations

import glob
import json
import mimetypes
import os
import queue
import re
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from .bench import list_red_files
from .cli import check_template
from .engine import DEFAULT_EXMARS, AssemblyError
from .fitness import ScoreCache, WorkerPool
from .hills import HillError, get_hill, load_hills
from .runs import ResumeMismatch, Run, RunError, list_runs
from .storage import DirStorage
from .template import TemplateError, parse_template

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
HERE = os.path.dirname(os.path.abspath(__file__))


class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


class RunManager:
    """Owns the shared worker pool and cache; runs execute in threads."""

    def __init__(self, runs_root: str, workers: Optional[int] = None, cache_path: Optional[str] = None):
        self.root = os.path.abspath(runs_root)
        os.makedirs(self.root, exist_ok=True)
        self.pool = WorkerPool(workers)
        self.cache = ScoreCache(cache_path)
        self.active: Dict[str, Run] = {}
        self.threads: Dict[str, threading.Thread] = {}
        self.subs: Dict[str, List[queue.Queue]] = {}
        self.lock = threading.Lock()

    # events -------------------------------------------------------------
    def subscribe(self, run_id: str) -> queue.Queue:
        q = queue.Queue(maxsize=1000)
        with self.lock:
            self.subs.setdefault(run_id, []).append(q)
        return q

    def unsubscribe(self, run_id: str, q: queue.Queue):
        with self.lock:
            if q in self.subs.get(run_id, []):
                self.subs[run_id].remove(q)

    def broadcast(self, run_id: str, ev: dict):
        with self.lock:
            subs = list(self.subs.get(run_id, []))
        for q in subs:
            try:
                q.put_nowait(ev)
            except queue.Full:
                pass

    # runs ---------------------------------------------------------------
    def run_dir(self, run_id: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", run_id) or run_id.startswith("."):
            raise ApiError(404, "no such run")
        d = os.path.join(self.root, run_id)
        if not os.path.exists(os.path.join(d, "run.json")):
            raise ApiError(404, "no such run")
        return d

    def _start(self, run: Run, accept_changes=False):
        def target():
            try:
                run.execute(accept_changes)
            except ResumeMismatch:
                pass
            except Exception as e:
                traceback.print_exc()
                self.broadcast(run.id, {"type": "state", "status": "failed", "error": str(e)})
            finally:
                with self.lock:
                    self.active.pop(run.id, None)
                    self.threads.pop(run.id, None)
        with self.lock:
            if run.id in self.active:
                raise ApiError(409, "run is already running")
            self.active[run.id] = run
            t = self.threads[run.id] = threading.Thread(target=target, daemon=True, name=f"run-{run.id}")
        t.start()

    def create(self, body: dict) -> dict:
        hill = get_hill(body.get("hill", ""))
        text = body.get("template") or ""
        if not text.strip():
            raise ApiError(400, "template is empty")
        bench = [p for p in _as_list(body.get("bench")) if p]
        if not bench:
            raise ApiError(400, "pick a benchmark directory")
        lim = body.get("limits") or {}
        opts = {"mode": body.get("mode", "static"), "fitness": body.get("fitness", "auto"),
                "rounds": _int(body.get("rounds")), "hill_size": _int(body.get("hill_size")),
                "lineage": _int(body.get("lineage")) or 1,
                "max_time": _float(lim.get("time")), "max_evals": _int(lim.get("evals")),
                "patience": _int(lim.get("patience")), "author": body.get("author") or None,
                "reference": body.get("reference") or None}
        name = body.get("template_name") or "template.red"
        tpath = body.get("template_path") or None
        run = Run.create(self.root, hill, tpath, bench, opts, self.pool, self.cache,
                         pin_paths=[p for p in _as_list(body.get("pin")) if p], seed=_int(body.get("seed")),
                         template_text=text, template_name=name, emit=None)
        run.emit = lambda ev, rid=run.id: self.broadcast(rid, ev)
        self._start(run)
        return {"id": run.id}

    def pause(self, run_id: str):
        self.run_dir(run_id)
        run = self.active.get(run_id)
        if run is None:
            # Possibly running in another process (CLI): use the control file.
            d = self.run_dir(run_id)
            with open(os.path.join(d, "control"), "w") as f:
                f.write("pause")
            return {"ok": True, "via": "control file"}
        run.request_pause()
        self.broadcast(run_id, {"type": "state", "status": "pausing"})
        return {"ok": True}

    def stop(self, run_id: str):
        d = self.run_dir(run_id)
        run = self.active.get(run_id)
        if run is None:
            st = DirStorage(d).read_json("status.json") or {}
            if st.get("status") in ("paused", "created"):
                # Finish a paused run: load it and stop at once so it writes its report.
                r = Run.open(d, self.pool, self.cache, emit=lambda ev: self.broadcast(run_id, ev))
                r.request_stop()
                self._start(r, accept_changes=True)
                return {"ok": True}
            with open(os.path.join(d, "control"), "w") as f:
                f.write("stop")
            return {"ok": True, "via": "control file"}
        run.request_stop()
        return {"ok": True}

    def resume(self, run_id: str, force: bool = False, limits: Optional[dict] = None):
        d = self.run_dir(run_id)
        if run_id in self.active:
            raise ApiError(409, "run is already running")
        run = Run.open(d, self.pool, self.cache, emit=lambda ev: self.broadcast(run_id, ev))
        if limits:
            o = run.config["options"]
            for k_api, k in (("time", "max_time"), ("evals", "max_evals"), ("patience", "patience")):
                if limits.get(k_api) not in (None, ""):
                    o[k] = float(limits[k_api]) if k == "max_time" else int(limits[k_api])
            run.store.write_json("run.json", run.config)
            st = run.store.read_json("state.json")
            if st and st.get("finished_reason"):
                st["finished_reason"] = None
                run.store.write_json("state.json", st)
        if not force and run.store.exists("state.json"):
            changes = run.check_inputs()
            if changes:
                raise ApiError(409, "run inputs changed", changes=changes)
        self._start(run, accept_changes=force)
        return {"ok": True}

    def shutdown(self):
        for run in list(self.active.values()):
            run.request_pause()
        for t in list(self.threads.values()):
            t.join(30)
        self.pool.close()
        self.cache.close()

    # views --------------------------------------------------------------
    def runs(self) -> List[dict]:
        out = list_runs(self.root)
        for r in out:
            live = self.active.get(r["id"])
            if live is not None:
                with live.lock:
                    r.update(live.summary(), status=live.status, speed=live.speed)
        return out

    def view(self, run_id: str) -> dict:
        d = self.run_dir(run_id)
        live = self.active.get(run_id)
        store = DirStorage(d)
        config = store.read_json("run.json")
        status = store.read_json("status.json") or {}
        if live is not None and live.state is not None:
            with live.lock:
                state = json.loads(json.dumps(live.state))
                state["search"] = live.search.state()
                if live.hillstate:
                    state["hill"] = live.hillstate.state()
                status = dict(status, status=live.status, speed=live.speed, **live.summary())
        else:
            state = store.read_json("state.json")
            for r in list_runs(self.root):
                if r["id"] == run_id:
                    status = dict(status, status=r.get("status"), stale=r.get("stale", False))
        hill = config["hill"]
        tpl = parse_template(store.read_text("template.red"), _constants(hill))
        out = {"id": run_id, "config": config, "status": status, "variables": []}
        if state:
            sch = state["search"]
            cur = sch.get("current") or {}
            best = state.get("best") or {}
            for k, v in enumerate(tpl.variables):
                out["variables"].append({
                    "name": v.name, "spec": v.spec, "size": v.size,
                    "current": v.values[cur["x"][k]] if cur.get("x") else None,
                    "best": v.values[best["x"][k]] if best.get("x") else None})
            out.update(trace=state.get("trace", []), best=best or None,
                       current={"score": cur.get("score"), "se": cur.get("se")},
                       phase=sch.get("phase"), evals=sch.get("steps"), restarts=sch.get("restarts"),
                       epoch=state.get("epoch"), invalid=state.get("invalid"),
                       pairings_run=state.get("pairings_run"), pairings_cached=state.get("pairings_cached"),
                       elapsed=state.get("elapsed"), finished_reason=state.get("finished_reason"),
                       validation=state.get("validation"))
            if state.get("hill"):
                from .hillmode import HillState
                hs = HillState.from_state(state["hill"])
                out["hill"] = {"size": hs.s["size"], "lineage": hs.s["lineage"],
                               "standings": hs.standings() if state.get("hill_ready") else [],
                               "archive": [{k: v for k, v in m.items() if k != "source"} for m in hs.s["archive"]]}
        log = store.read_lines("log.jsonl")
        out["events"] = [json.loads(l) for l in log if '"event": "best"' not in l][-200:]
        return out

    def best(self, run_id: str) -> dict:
        d = self.run_dir(run_id)
        store = DirStorage(d)
        config = store.read_json("run.json")
        live = self.active.get(run_id)
        if live is not None and live.state is not None:
            with live.lock:
                best = json.loads(json.dumps(live.state.get("best")))
        else:
            best = (store.read_json("state.json") or {}).get("best")
        if not best:
            raise ApiError(404, "no result yet")
        tpl = parse_template(store.read_text("template.red"), _constants(config["hill"]))
        return {"red": store.read_text("best.red"), "template": store.read_text("best.template.red"),
                "segments": tpl.render_segments(best["x"]), "score": best["score"], "se": best["se"],
                "values": best["values"], "per_opp": best["per_opp"], "evals": best["evals"],
                "filename": os.path.splitext(config.get("template_name") or "best")[0]}


def _constants(hill_dict: dict) -> dict:
    from .hills import hill_from_dict
    return hill_from_dict(hill_dict).constants()


def _as_list(v):
    if v is None:
        return []
    if isinstance(v, str):
        return [s.strip() for s in v.split("\n") if s.strip()]
    return list(v)


def _int(v):
    return None if v in (None, "") else int(v)


def _float(v):
    return None if v in (None, "") else float(v)


def bench_suggestions() -> List[dict]:
    """Directories with .red files under known places (exMARS checkout, ./bench)."""
    roots = [os.path.join(DEFAULT_EXMARS, "warriors"), os.path.abspath("bench"),
             os.path.join(HERE, "..", "examples")]
    out = []
    for root in roots:
        for d, _, files in os.walk(root):
            n = sum(f.lower().endswith(".red") for f in files)
            if n:
                out.append({"path": os.path.normpath(d), "count": n})
    return out[:200]


# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    manager: RunManager = None
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quiet
        pass

    def _send(self, status: int, body: bytes, ctype: str, extra: Optional[dict] = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, status=200):
        self._send(status, json.dumps(data).encode(), "application/json")

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise ApiError(413, "request too large")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            raise ApiError(400, "invalid JSON")

    def _check_origin(self):
        # Only the page served by this server may call mutating endpoints.
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if origin and urlparse(origin).netloc != host:
            raise ApiError(403, "cross-origin request refused")

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def _dispatch(self, method):
        url = urlparse(self.path)
        path = url.path
        try:
            if path.startswith("/api/"):
                if method == "POST":
                    self._check_origin()
                return self._api(method, path, parse_qs(url.query))
            if method != "GET":
                raise ApiError(405, "method not allowed")
            return self._static(path)
        except ApiError as e:
            self._json({"error": e.message, **e.extra}, e.status)
        except (HillError, RunError, TemplateError, AssemblyError, FileNotFoundError, ValueError) as e:
            self._json({"error": str(e)}, 400)
        except BrokenPipeError:
            pass
        except Exception as e:
            traceback.print_exc()
            self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def _static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(WEB, path.lstrip("/")))
        if not full.startswith(WEB) or not os.path.isfile(full):
            full = os.path.join(WEB, "index.html")   # client-side routes
        with open(full, "rb") as f:
            data = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, data, ctype)

    def _api(self, method, path, query):
        m = self.manager
        parts = path.strip("/").split("/")[1:]   # after "api"
        if parts == ["hills"] and method == "GET":
            return self._json([h.to_dict() for h in load_hills().values()])
        if parts == ["bench"] and method == "GET":
            p = (query.get("path") or [""])[0]
            if p:
                try:
                    files = list_red_files([p])
                except FileNotFoundError as e:
                    raise ApiError(404, str(e))
                return self._json({"path": p, "count": len(files), "files": [os.path.basename(f) for f in files][:500]})
            return self._json(bench_suggestions())
        if parts == ["check"] and method == "POST":
            b = self._body()
            hill = get_hill(b.get("hill", ""))
            return self._json(dict(check_template(hill, b.get("template", "")), hill=hill.to_dict()))
        if parts == ["runs"]:
            if method == "GET":
                return self._json(m.runs())
            return self._json(m.create(self._body()), 201)
        if len(parts) >= 2 and parts[0] == "runs":
            rid = parts[1]
            rest = parts[2:]
            if rest == [] and method == "GET":
                return self._json(m.view(rid))
            if rest == ["best"] and method == "GET":
                return self._json(m.best(rid))
            if rest == ["report"] and method == "GET":
                t = DirStorage(m.run_dir(rid)).read_text("report.md")
                if t is None:
                    raise ApiError(404, "no report yet (written when the run finishes)")
                return self._send(200, t.encode(), "text/markdown; charset=utf-8")
            if rest == ["events"] and method == "GET":
                return self._events(rid)
            if method == "POST" and rest == ["pause"]:
                return self._json(m.pause(rid))
            if method == "POST" and rest == ["resume"]:
                b = self._body()
                return self._json(m.resume(rid, bool(b.get("force")), b.get("limits")))
            if method == "POST" and rest == ["stop"]:
                return self._json(m.stop(rid))
        raise ApiError(404, "unknown endpoint")

    def _events(self, rid):
        self.manager.run_dir(rid)
        q = self.manager.subscribe(rid)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(b"retry: 2000\n\n")
            self.wfile.flush()
            while True:
                try:
                    ev = q.get(timeout=15)
                    data = f"event: {ev.get('type', 'message')}\ndata: {json.dumps(ev)}\n\n"
                except queue.Empty:
                    data = ": keepalive\n\n"
                self.wfile.write(data.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.manager.unsubscribe(rid, q)


def make_server(runs_root: str, port: int, workers=None, cache_path=None):
    manager = RunManager(runs_root, workers, cache_path)
    handler = type("BoundHandler", (Handler,), {"manager": manager})
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    httpd.daemon_threads = True
    return httpd, manager


def serve(runs_root: str, port: int, workers=None, cache_path=None, open_browser=True):
    httpd, manager = make_server(runs_root, port, workers, cache_path)
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"cwopt UI on {url} (runs in {manager.root}, {manager.pool.workers} workers); Ctrl-C to quit")
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\npausing running runs...")
    finally:
        httpd.server_close()
        manager.shutdown()

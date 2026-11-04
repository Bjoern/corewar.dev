"""Runs (spec §7, §8): one optimisation job, its directory, checkpoints, pause and resume.

A run advances in *steps*: the search proposes one candidate, it is evaluated in
full (or stopped by racing), and the search observes the result.  Pauses and
checkpoints happen only between steps, and the checkpoint holds everything a
step depends on, so a resumed run continues exactly like an uninterrupted one.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import math
import os
import random
import threading
import time
from typing import Callable, Dict, List, Optional

from . import __version__
from .bench import BenchWarrior, file_sha, load_bench, read_source
from .engine import AssemblyError, PairResult, Warrior, default_assembler, engine_version
from .fitness import Evaluator, Fitness, Schedule, ScoreCache, WorkerPool, aggregate, choose_mode
from .hillmode import HillState
from .hills import Hill, HillError, get_hill, hill_from_dict
from . import search as search_mod
from .search import Search
from .storage import DirStorage, Storage
from .template import Template, parse_template

FORMAT = 1
STATES = ("created", "running", "pausing", "paused", "finished", "failed")

DEFAULT_OPTIONS = {
    "mode": "static",          # static | hill
    "fitness": "auto",         # auto | exact | sampled
    "exact_limit": 2000,       # exact if 2 * positions <= this (and no p-space)
    "rounds": None,            # sampled: rounds per opponent (default: the hill's)
    "slices": 5,               # sampled: racing slices per opponent
    "z": 3.0,                  # racing threshold in standard errors
    "reseed_every": 10,        # sampled: new seeds after this many improvements
    "hill_size": None,         # hill mode: default the hill's size or the benchmark count
    "lineage": 1,              # hill mode: members from this run
    "max_time": None,          # seconds
    "max_evals": None,         # search steps
    "patience": None,          # stop after this many steps without a new best
    "checkpoint_every": 60.0,  # seconds
    "search": {},              # overrides for search.DEFAULTS
    "author": None,
    "reference": None,         # warrior file scored next to the best on held-out seeds
    "validate_rounds": 2000,   # sampled: rounds per opponent for the held-out check
}


def sha_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def now_iso() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def new_run_id(template_path: str) -> str:
    stem = os.path.splitext(os.path.basename(template_path))[0][:24] or "run"
    stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem)
    return f"{_dt.datetime.now():%Y%m%d-%H%M%S}-{stem}-{random.randrange(16 ** 4):04x}"


class RunError(Exception):
    pass


class ResumeMismatch(RunError):
    def __init__(self, changes: List[str]):
        self.changes = changes
        super().__init__("run inputs changed since the last checkpoint:\n  " + "\n  ".join(changes))


class Run:
    """Use ``Run.create`` or ``Run.open``; then ``execute()`` until paused/finished."""

    def __init__(self, storage: Storage, pool: WorkerPool, cache: ScoreCache,
                 emit: Optional[Callable[[dict], None]] = None):
        self.store = storage
        self.pool, self.cache = pool, cache
        self.emit = emit or (lambda ev: None)
        self.config: dict = storage.read_json("run.json")
        if not self.config:
            raise RunError("not a run directory (no run.json)")
        if self.config.get("format") != FORMAT:
            raise RunError(f"run format {self.config.get('format')} is not supported (expected {FORMAT})")
        self.id = self.config["id"]
        self._pause = threading.Event()
        self._stop = threading.Event()
        self.status = (storage.read_json("status.json") or {}).get("status", "created")
        self.state: Optional[dict] = None
        self._ready = False
        self.speed = 0.0
        self.lock = threading.RLock()   # guards self.state for readers on other threads

    # ------------------------------------------------------------------
    # Creation

    @classmethod
    def create(cls, runs_root: str, hill: Hill, template_path: str, bench_paths: List[str],
               options: dict, pool: WorkerPool, cache: ScoreCache, pin_paths: List[str] = (),
               seed: Optional[int] = None, template_text: Optional[str] = None,
               emit=None, run_id: Optional[str] = None, template_name: Optional[str] = None) -> "Run":
        """``template_text`` without a file (web UI): pass ``template_path=None`` and a name."""
        hill.check_runnable()
        opts = dict(DEFAULT_OPTIONS)
        opts.update({k: v for k, v in (options or {}).items() if v is not None})
        text = template_text if template_text is not None else read_source(template_path)
        template = parse_template(text, hill.constants())     # raises TemplateError
        bench, problems = load_bench(hill, bench_paths, pin_paths)
        if not bench:
            raise RunError("no benchmark warrior assembles: " + "; ".join(problems))
        uses_ps = template.uses_pspace() or any(b.warrior.uses_pspace for b in bench)
        mode = choose_mode(hill, uses_ps, opts["fitness"], opts["exact_limit"])
        if seed is None:
            seed = random.randrange(2 ** 31)
        name = template_name or (os.path.basename(template_path) if template_path else "template.red")
        run_id = run_id or new_run_id(name)
        storage = DirStorage(os.path.join(runs_root, run_id))
        config = {
            "format": FORMAT, "id": run_id, "created": now_iso(), "cwopt": __version__,
            "template_path": os.path.abspath(template_path) if template_path else None,
            "template_sha": sha_text(text), "template_name": name,
            "hill": hill.to_dict(), "hill_settings": hill.settings(),
            "bench_paths": [os.path.abspath(p) for p in bench_paths],
            "pin_paths": [os.path.abspath(p) for p in pin_paths],
            "bench": [b.meta() for b in bench], "bench_problems": problems,
            "engine": engine_version(hill.module, hill.module_path),
            "fitness_mode": mode, "seed": seed, "options": opts,
            "variables": [v.to_dict() for v in template.variables],
        }
        storage.write_text("template.red", text)
        if opts.get("reference"):
            storage.write_text("reference.red", read_source(opts["reference"]))
        storage.write_json("run.json", config)
        storage.write_json("status.json", {"status": "created", "updated": now_iso()})
        return cls(storage, pool, cache, emit)

    @classmethod
    def open(cls, run_dir: str, pool: WorkerPool, cache: ScoreCache, emit=None) -> "Run":
        return cls(DirStorage(run_dir), pool, cache, emit)

    # ------------------------------------------------------------------
    # Loading

    def check_inputs(self) -> List[str]:
        """Differences between the stored inputs and the files as they are now."""
        c = self.config
        changes = []
        tp = c.get("template_path")
        if tp:
            if not os.path.exists(tp):
                changes.append(f"template {tp} is missing (the stored copy will be used)")
            elif sha_text(read_source(tp)) != c["template_sha"]:
                changes.append(f"template {tp} changed")
        try:
            from .bench import list_red_files
            now = {f: file_sha(f) for f in list_red_files(c["bench_paths"] + c["pin_paths"])}
        except FileNotFoundError as e:
            now = {}
            changes.append(str(e))
        then = {b["path"]: b["sha"] for b in c["bench"]}
        for p, s in then.items():
            if p not in now:
                changes.append(f"benchmark {os.path.basename(p)} removed")
            elif now[p] != s:
                changes.append(f"benchmark {os.path.basename(p)} changed")
        skipped = {p.split(":")[0] for p in c.get("bench_problems", []) if "does not assemble" in p}
        for p in now:
            if p not in then and os.path.basename(p) not in skipped:
                changes.append(f"benchmark {os.path.basename(p)} added")
        try:
            preset = get_hill(c["hill"]["key"])
            if preset.settings() != c["hill_settings"]:
                changes.append(f"hill preset {preset.key} settings changed: {preset.summary()}")
        except HillError:
            pass
        hill = hill_from_dict(c["hill"])
        try:
            ev = engine_version(hill.module, hill.module_path)
            if ev != c["engine"]:
                changes.append(f"engine changed: {c['engine']} -> {ev}")
        except RuntimeError as e:
            changes.append(str(e))
        return changes

    def _load(self, accept_changes: bool = False):
        c = self.config
        changes = self.check_inputs() if self.store.exists("state.json") else []
        if changes and not accept_changes:
            raise ResumeMismatch(changes)
        hill = hill_from_dict(c["hill"])
        refresh = False
        if changes:
            # The user confirmed: take the inputs as they are now.
            try:
                preset = get_hill(hill.key)
                if preset.settings() != c["hill_settings"]:
                    hill = preset
            except HillError:
                pass
            hill.check_runnable()
            text = self.store.read_text("template.red")
            tp = c.get("template_path")
            if tp and os.path.exists(tp):
                new = read_source(tp)
                t_new = parse_template(new, hill.constants())
                t_old = parse_template(text, hill.constants())
                if [v.values for v in t_new.variables] != [v.values for v in t_old.variables]:
                    raise RunError("the template's variables or domains changed; start a new run instead")
                text = new
            bench, problems = load_bench(hill, c["bench_paths"], c["pin_paths"])
            c.update(template_sha=sha_text(text), hill=hill.to_dict(), hill_settings=hill.settings(),
                     bench=[b.meta() for b in bench], bench_problems=problems,
                     engine=engine_version(hill.module, hill.module_path))
            self.store.write_text("template.red", text)
            self.store.write_json("run.json", c)
            refresh = True
        else:
            text = self.store.read_text("template.red")
            bench, _ = self._load_stored_bench(hill)
        self.hill = hill
        self.template: Template = parse_template(text, hill.constants())
        self.bench: List[BenchWarrior] = bench
        self.opts = c["options"]
        self.mode = c["fitness_mode"]
        self.evaluator = Evaluator(hill, self.pool, self.cache, c["engine"])
        self.warriors: Dict[str, Warrior] = {b.warrior.hash: b.warrior for b in bench}
        self.names: Dict[str, str] = {b.warrior.hash: b.name for b in bench}

        st = self.store.read_json("state.json")
        if st is None:
            st = self._initial_state()
        elif st.get("format") != FORMAT:
            raise RunError(f"checkpoint format {st.get('format')} is not supported")
        self.state = st
        self.search = Search.from_state(st["search"])
        self.hillstate = HillState.from_state(st["hill"]) if st.get("hill") else None
        if self.hillstate:
            for m in self.hillstate.members + self.hillstate.s["archive"]:
                if m["hash"] not in self.warriors:
                    w = default_assembler().assemble(hill, m["source"])
                    self.warriors[w.hash] = w
                    self.names[w.hash] = m["name"]
        # Lines written to log.jsonl after the last checkpoint are written again.
        self.store.truncate_lines("log.jsonl", st["log_lines"])
        if refresh:
            self._on_benchmark_changed("inputs changed on resume")
        self._ready = True

    def _load_stored_bench(self, hill: Hill):
        c = self.config
        out = []
        for b in c["bench"]:
            src = read_source(b["path"])
            w = default_assembler().assemble(hill, src)
            out.append(BenchWarrior(b["name"], b["path"], b["sha"], src, w, b["pinned"]))
        return out, []

    def _initial_state(self) -> dict:
        c = self.config
        t = self.template
        search = Search([v.size for v in t.variables], t.start_indices(), c["seed"], self.opts["search"])
        hill_state = None
        if self.opts["mode"] == "hill":
            size = self.opts["hill_size"] or self.hill.hill_size or len(self.bench)
            members = [{"name": b.name, "source": b.source, "hash": b.warrior.hash, "pinned": b.pinned,
                        "origin": "bench", "path": b.path} for b in self.bench]
            hill_state = HillState(members, size, self.opts["lineage"]).state()
        return {"format": FORMAT, "search": search.state(), "hill": hill_state, "epoch": 0,
                "improvements": 0, "elapsed": 0.0, "pairings_run": 0, "pairings_cached": 0,
                "invalid": 0, "log_lines": 0, "best": None, "trace": [], "hill_ready": False,
                "finished_reason": None}

    # ------------------------------------------------------------------
    # Fitness

    def schedule(self) -> Schedule:
        if self.mode == "exact":
            return Schedule.exact()
        rounds = self.opts["rounds"] or self.hill.rounds
        return Schedule.sampled(self.hill, self.config["seed"], self.state["epoch"], rounds, self.opts["slices"])

    def hill_schedule(self) -> Schedule:
        if self.mode == "exact":
            return Schedule.exact()
        rounds = self.opts["rounds"] or self.hill.rounds
        return Schedule.sampled(self.hill, self.config["seed"], "hill", rounds, 1)

    def opponents(self) -> List[Warrior]:
        if self.hillstate:
            return [self.warriors[m["hash"]] for m in self.hillstate.benchmark_members()]
        return [b.warrior for b in self.bench]

    def opponent_names(self) -> List[str]:
        if self.hillstate:
            return [m["name"] for m in self.hillstate.benchmark_members()]
        return [b.name for b in self.bench]

    def _pair_fn(self, a: Warrior, bs: List[Warrior]) -> List[PairResult]:
        totals = [PairResult(0, 0, 0)] * len(bs)
        for unit in self.hill_schedule().units:
            totals = [t + r for t, r in zip(totals, self.evaluator.unit_results(a, bs, unit))]
        return totals

    def evaluate(self, proposal: dict):
        """Returns (Fitness or None, Warrior or None, source)."""
        src = self.template.render(proposal["x"])
        try:
            w = default_assembler().assemble(self.hill, src)
        except AssemblyError:
            return None, None, src
        race = None
        cur = self.search.current
        if self.mode == "sampled" and proposal["kind"] in ("sweep", "anneal") and cur and cur.get("slices"):
            race = Fitness(cur["score"], cur["se"], [], True, cur["slices"])
        fit = self.evaluator.evaluate(w, self.opponents(), self.schedule(), race, self.opts["z"])
        return fit, w, src

    # ------------------------------------------------------------------
    # Control

    def request_pause(self):
        self._pause.set()

    def request_stop(self):
        self._stop.set()

    def _control_file(self) -> Optional[str]:
        t = self.store.read_text("control")
        return t.strip() if t else None

    def _set_status(self, status: str, **extra):
        self.status = status
        info = {"status": status, "updated": now_iso(), "pid": os.getpid()}
        if self.state:
            info.update(self.summary())
        info.update(extra)
        self.store.write_json("status.json", info)
        self.emit({"type": "state", "status": status, **extra})

    def summary(self) -> dict:
        st = self.state or {}
        best = st.get("best") or {}
        sch = st.get("search", {})
        return {"best_score": best.get("score"), "best_se": best.get("se"),
                "evals": sch.get("steps", 0), "elapsed": st.get("elapsed", 0.0),
                "pairings_run": st.get("pairings_run", 0)}

    # ------------------------------------------------------------------
    # Checkpoint

    def checkpoint(self):
        st = self.state
        st["search"] = self.search.state()
        if self.hillstate:
            st["hill"] = self.hillstate.state()
            self.store.write_json("hill.json", {"standings": self.hillstate.standings(),
                                               "archive": [_strip(m) for m in self.hillstate.s["archive"]],
                                               "state": st["hill"]})
        self.store.write_json("state.json", st)
        info = {"status": self.status, "updated": now_iso(), "pid": os.getpid()}
        info.update(self.summary())
        self.store.write_json("status.json", info)

    def _log(self, entry: dict):
        entry = dict(entry, time=now_iso())
        self.store.append_line("log.jsonl", json.dumps(entry))
        self.state["log_lines"] += 1

    # ------------------------------------------------------------------
    # Main loop

    def execute(self, accept_changes: bool = False) -> str:
        """Run until paused, stopped, finished or failed. Returns the final status."""
        try:
            if not self._ready:
                self._load(accept_changes)
        except (RunError, HillError) as e:
            raise
        if self.state.get("finished_reason"):
            self._set_status("finished")
            return "finished"
        self.store.remove("control")
        self._pause.clear()
        self._set_status("running")
        self.emit({"type": "info", "message": self.hill.summary(), "mode": self.mode})
        seg_start = time.time()
        base_elapsed = self.state["elapsed"]
        last_ckpt = time.time()
        last_progress = 0.0
        speed_t, speed_n = time.time(), self.search.s["steps"]
        try:
            if self.hillstate and not self.state["hill_ready"]:
                self.emit({"type": "info", "message": f"hill mode: round robin of {len(self.hillstate.members)} members"})
                self.hillstate.fill_pairs(self.warriors, self._pair_fn)
                pushed = self.hillstate.trim()
                if pushed:
                    self._log({"event": "hill", "type": "hill", "result": "trimmed", "name": "initial hill",
                               "pushed": pushed, "step": 0})
                    self.emit({"type": "info", "message": f"hill trimmed to {self.hillstate.s['size']}: "
                                                          f"pushed off {len(pushed)} warriors"})
                self.state["hill_ready"] = True
                self.checkpoint()
            while True:
                self.state["elapsed"] = base_elapsed + time.time() - seg_start
                ctl = self._control_file()
                if ctl == "stop":
                    self._stop.set()
                if ctl == "pause":
                    self._pause.set()
                reason = self._limit_reached()
                if self._stop.is_set() and not reason:
                    reason = "stopped"
                if reason:
                    self.state["finished_reason"] = reason
                    self._finish()
                    return "finished"
                if self._pause.is_set():
                    self._set_status("pausing")
                    self.checkpoint()
                    self._set_status("paused")
                    return "paused"
                self.step()
                t = time.time()
                if t - speed_t >= 2.0:
                    self.speed = (self.search.s["steps"] - speed_n) / (t - speed_t)
                    speed_t, speed_n = t, self.search.s["steps"]
                if t - last_progress >= 1.0:
                    last_progress = t
                    self.emit(self.progress())
                if t - last_ckpt >= self.opts["checkpoint_every"]:
                    self.checkpoint()
                    last_ckpt = t
        except Exception as e:
            self.state["elapsed"] = base_elapsed + time.time() - seg_start
            self._set_status("failed", error=f"{type(e).__name__}: {e}")
            raise

    def progress(self) -> dict:
        s = self.search.s
        cur = s["current"] or {}
        best = self.state.get("best") or {}
        return {"type": "progress", "evals": s["steps"], "elapsed": self.state["elapsed"],
                "current": cur.get("score"), "best": best.get("score"), "best_se": best.get("se"),
                "phase": s["phase"], "speed": self.speed, "pairings_run": self.evaluator.pairings_run
                + self.state["pairings_run"], "restarts": s["restarts"]}

    def _limit_reached(self) -> Optional[str]:
        o, s = self.opts, self.search.s
        if o["max_evals"] is not None and s["steps"] >= o["max_evals"]:
            return "evaluation limit"
        if o["max_time"] is not None and self.state["elapsed"] >= o["max_time"]:
            return "time limit"
        if o["patience"] is not None and s["since_best"] >= o["patience"] and s["best"]:
            return f"no improvement in {o['patience']} steps"
        return None

    def step(self):
        """One proposal, evaluated and observed. The unit of determinism."""
        with self.lock:
            p = self.search.propose()
        fit, w, src = self.evaluate(p)
        with self.lock:
            self._observe(p, fit, w, src)

    def _observe(self, p, fit, w, src):
        if fit is None:
            self.state["invalid"] += 1
            random_start = any(v is None for v in self.search.s["start"])
            tries = self.search.s.get("init_tries", 0) + 1
            if p["kind"] == "init" and (not random_start or tries >= search_mod.MAX_INIT_TRIES):
                try:
                    default_assembler().assemble(self.hill, src)
                except AssemblyError as e:
                    raise RunError(("the start values do not assemble:\n" if not random_start else
                                    f"no valid warrior in {tries} random starts; last error:\n") + e.message +
                                   "\nvalues: " + json.dumps(self.template.values(p["x"])))
            events = self.search.observe(p, None)
        else:
            events = self.search.observe(p, fit.score, fit.se, fit.complete, fit.slices)
        self.state["pairings_run"] += self.evaluator.pairings_run
        self.state["pairings_cached"] += self.evaluator.pairings_cached
        self.evaluator.pairings_run = self.evaluator.pairings_cached = 0
        s = self.search.s
        if fit is not None and (s["steps"] % 25 == 0 or events):
            self._trace(fit.score)
        for ev in events:
            if ev["type"] == "best":
                self._on_best(p, fit, w, src)
            elif ev["type"] == "restart":
                self._log({"event": "restart", "evals": s["steps"], "score": ev["score"]})

    def _trace(self, score):
        s = self.search.s
        best = self.state["best"]
        tr = self.state["trace"]
        tr.append([s["steps"], round(score, 3), None if best is None else round(best["score"], 3),
                   None if best is None else round(best["se"], 3)])
        if len(tr) > 1000:
            self.state["trace"] = tr[::2]

    def _on_best(self, p: dict, fit: Fitness, w: Warrior, src: str):
        st = self.state
        names = self.opponent_names()
        st["best"] = {"x": p["x"], "values": self.template.values(p["x"]), "score": fit.score, "se": fit.se,
                      "hash": w.hash, "evals": self.search.s["steps"], "epoch": st["epoch"],
                      "per_opp": [[n] + r.to_list() for n, r in zip(names, fit.per_opp)]}
        st["improvements"] += 1
        self._write_best(p["x"], fit)
        self._log({"event": "best", "evals": self.search.s["steps"], "score": fit.score, "se": fit.se,
                   "values": st["best"]["values"], "pairings": st["pairings_run"]})
        self.emit({"type": "best", "score": fit.score, "se": fit.se, "values": st["best"]["values"],
                   "evals": self.search.s["steps"]})
        changed = False
        if self.hillstate:
            name = f"{os.path.splitext(self.config.get('template_name') or 'run')[0]}@{self.search.s['steps']}"
            self.warriors[w.hash] = w
            self.names[w.hash] = name
            ev = self.hillstate.challenge({"name": name, "source": src, "hash": w.hash,
                                           "values": st["best"]["values"]},
                                          self.warriors, self._pair_fn, self.search.s["steps"])
            self._log({"event": "hill", **ev})
            self.emit(ev)
            changed = ev.get("result") == "joined"
            if changed:
                self._on_benchmark_changed("hill changed")
        if (not changed and self.mode == "sampled" and self.opts["reseed_every"]
                and st["improvements"] % self.opts["reseed_every"] == 0):
            st["epoch"] += 1
            self._log({"event": "reseed", "epoch": st["epoch"], "evals": self.search.s["steps"]})
            self.search.invalidate()
        self.checkpoint()

    def _on_benchmark_changed(self, why: str):
        """The fitness landscape changed: rescore the incumbent and kept results."""
        self.search.invalidate()
        self.emit({"type": "info", "message": f"{why}: re-evaluating incumbent"})

    def _write_best(self, x, fit: Fitness):
        t = self.template
        self.store.write_text("best.template.red", t.write_back(x))
        self.store.write_text("best.red", self.render_submission(x, fit))

    def render_submission(self, x, fit: Optional[Fitness] = None) -> str:
        text = self.template.render(x)
        lines = text.splitlines()
        low = [l.strip().lower() for l in lines]
        has = lambda tag: any(l.startswith(";" + tag) for l in low)
        head = []
        if not has("name"):
            stem = os.path.splitext(self.config.get("template_name") or "warrior")[0]
            head.append(f";name {stem}")
        if not has("author"):
            head.append(f";author {self.opts.get('author') or 'anonymous'}")
        if fit is not None:
            mode = "exact" if self.mode == "exact" else f"±{fit.se:.2f}"
            head.append(f";strategy optimised with cwopt on {self.hill.key}: {fit.score:.2f} {mode} "
                        f"vs {len(self.opponents())} warriors")
        if not has("assert"):
            head.append(f";assert CORESIZE == {self.hill.coresize}")
        insert = 0
        while insert < len(low) and low[insert].startswith(";"):
            insert += 1
        if not any(l.startswith(";redcode") for l in low):
            insert = 0
        return "\n".join(lines[:insert] + head + lines[insert:]) + "\n"

    def validate(self) -> Optional[dict]:
        """Rescore the best (and the reference) on placement seeds the search never used.

        The search's best score is the maximum of many noisy evaluations and so reads
        high; this held-out score is the one to compare warriors by."""
        b = self.state.get("best")
        if not b:
            return None
        if self.mode == "exact":
            sch, rounds = Schedule.exact(), None
        else:
            rounds = self.opts.get("validate_rounds") or 2000
            sch = Schedule.sampled(self.hill, self.config["seed"], "holdout", rounds, 1)
        opps = self.opponents()
        out = {"rounds": rounds, "opponents": len(opps), "search_score": b["score"], "search_se": b["se"]}
        cands = [("best", self.template.render(b["x"]))]
        ref = self.store.read_text("reference.red")
        if ref is not None:
            cands.append(("reference", ref))
        for name, src in cands:
            try:
                w = default_assembler().assemble(self.hill, src)
            except AssemblyError as e:
                out[name] = {"error": e.message}
                continue
            fit = self.evaluator.evaluate(w, opps, sch)
            out[name] = {"score": fit.score, "se": fit.se, "name": w.name}
        self.state["validation"] = out
        return out

    def _finish(self):
        self.checkpoint()
        try:
            v = self.validate()
            if v:
                self._log({"event": "validation", **v})
                ref = v.get("reference", {})
                msg = (f"held-out check ({v['rounds'] or 'exact'} rounds): best {v['best'].get('score', 0):.3f}"
                       f" ± {v['best'].get('se', 0):.2f}")
                if "score" in ref:
                    msg += f", reference {ref['score']:.3f} ± {ref['se']:.2f}"
                self.emit({"type": "info", "message": msg})
        except Exception as e:
            self.emit({"type": "info", "message": f"held-out check failed: {e}"})
        try:
            self.store.write_text("report.md", self.report())
        except Exception as e:  # report failures must not lose the run
            self.emit({"type": "info", "message": f"report failed: {e}"})
        self._log({"event": "finished", "reason": self.state["finished_reason"],
                   "evals": self.search.s["steps"]})
        self.checkpoint()
        self._set_status("finished", reason=self.state["finished_reason"])

    # ------------------------------------------------------------------
    # Reporting

    def best_warrior(self) -> Optional[Warrior]:
        b = self.state.get("best") if self.state else None
        if not b:
            return None
        return default_assembler().assemble(self.hill, self.template.render(b["x"]))

    def report(self) -> str:
        st, c = self.state, self.config
        b = st["best"]
        out = [f"# cwopt run {self.id}", "",
               f"- Hill: {self.hill.summary()}",
               f"- Template: {c.get('template_path')}",
               f"- Benchmark: {len(self.bench)} warriors ({', '.join(c['bench_paths'])})",
               f"- Mode: {self.opts['mode']}, fitness {self.mode}"
               + ("" if self.mode == "exact" else f", {self.opts['rounds'] or self.hill.rounds} rounds"),
               f"- Seed: {c['seed']}, engine {c['engine']}",
               f"- Evaluations: {self.search.s['steps']}, pairings run {st['pairings_run']}, "
               f"cached {st['pairings_cached']}, invalid candidates {st['invalid']}",
               f"- Elapsed: {st['elapsed']:.0f} s; finished: {st.get('finished_reason')}", ""]
        if not b:
            return "\n".join(out + ["No result."]) + "\n"
        v = st.get("validation")
        if v:
            out += ["## Held-out check", "",
                    f"Scored on placement seeds the search never used"
                    + (f", {v['rounds']} rounds per opponent." if v["rounds"] else " (exact)."),
                    "The search score below is the best of many noisy evaluations and reads high.", "",
                    "| Warrior | Held-out score | Search score |", "|---|---|---|"]
            for key in ("best", "reference"):
                r = v.get(key)
                if not r:
                    continue
                cell = r["error"].splitlines()[0] if "error" in r else f"{r['score']:.3f} ± {r['se']:.2f}"
                srch = f"{v['search_score']:.3f} ± {v['search_se']:.2f}" if key == "best" else ""
                out.append(f"| {key} ({r.get('name', '')}) | {cell} | {srch} |")
            out.append("")
        out += [f"## Best: {b['score']:.3f}" + ("" if self.mode == "exact" else f" ± {b['se']:.3f}"), "",
                "| Variable | Value |", "|---|---|"]
        out += [f"| {k} | {v} |" for k, v in b["values"].items()]
        out += ["", "| Opponent | W | T | L | Score |", "|---|---|---|---|---|"]
        for n, w, t, l in sorted(b["per_opp"], key=lambda r: PairResult(*r[1:]).score):
            out.append(f"| {n} | {w} | {t} | {l} | {PairResult(w, t, l).score:.1f} |")
        out += ["", "```", self.render_submission(b["x"]).rstrip(), "```"]
        if self.hillstate:
            out += ["", "## Hill", "", "| Rank | Warrior | Score | Pinned | Origin |", "|---|---|---|---|---|"]
            for r in self.hillstate.standings():
                out.append(f"| {r['rank']} | {r['name']} | {r['score']:.2f} | {'yes' if r['pinned'] else ''} | {r['origin']} |")
            arch = self.hillstate.s["archive"]
            if arch:
                w = self.best_warrior()
                ws = [self.warriors[m["hash"]] for m in arch]
                res = self._pair_fn(w, ws)
                s, _ = aggregate(res)
                out += ["", f"## Archive ({len(arch)} pushed off): best scores {s:.2f} against them", "",
                        "| Warrior | Left at step | Best's score vs it |", "|---|---|---|"]
                for m, r in zip(arch, res):
                    out.append(f"| {m['name']} | {m.get('left_step')} | {r.score:.1f} |")
        return "\n".join(out) + "\n"


def _strip(m: dict) -> dict:
    return {k: v for k, v in m.items() if k != "source"}


# --------------------------------------------------------------------------

def list_runs(runs_root: str) -> List[dict]:
    out = []
    if not os.path.isdir(runs_root):
        return out
    for d in sorted(os.listdir(runs_root)):
        st = DirStorage(os.path.join(runs_root, d)) if os.path.exists(os.path.join(runs_root, d, "run.json")) else None
        if st is None:
            continue
        cfg = st.read_json("run.json") or {}
        status = st.read_json("status.json") or {}
        if status.get("status") in ("running", "pausing") and not _pid_alive(status.get("pid")):
            status["status"] = "paused"   # process gone: the last checkpoint is resumable
            status["stale"] = True
        out.append({"id": d, "path": os.path.join(runs_root, d), "hill": cfg.get("hill", {}).get("key"),
                    "template": cfg.get("template_name") or os.path.basename(cfg.get("template_path") or ""),
                    "mode": cfg.get("options", {}).get("mode"), "fitness": cfg.get("fitness_mode"),
                    "created": cfg.get("created"), **status})
    return out


def _pid_alive(pid) -> bool:
    if not pid:
        return False
    if pid == os.getpid():
        return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

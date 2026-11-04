"""Command line (spec §10). Every command uses the same core functions as the web API."""
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import sys
import time
from typing import List, Optional

from .bench import load_bench, read_source
from .engine import AssemblyError, PairResult, default_assembler
from .fitness import (DEFAULT_CACHE, Evaluator, Schedule, ScoreCache, WorkerPool, aggregate,
                      choose_mode)
from .hillmode import HillState
from .hills import HillError, get_hill, load_hills
from .runs import ResumeMismatch, Run, RunError, list_runs
from .template import TemplateError, parse_template


def parse_duration(s: Optional[str]) -> Optional[float]:
    if s is None:
        return None
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([smhd]?)\s*", s)
    if not m:
        raise argparse.ArgumentTypeError(f"bad duration {s!r} (examples: 90s, 30m, 2h)")
    return float(m.group(1)) * {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]


def _common(p):
    p.add_argument("--hills-file", help="extra hill presets (JSON)")
    p.add_argument("--cache", default=DEFAULT_CACHE, help="score cache (SQLite); 'none' disables it")
    p.add_argument("--workers", type=int, default=None, help="worker processes (default: CPU count; 0 = in-process)")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="cwopt", description="Core War constant optimizer")
    ap.add_argument("--runs", default="runs", help="directory holding run directories (default ./runs)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("run", help="start a new optimisation run")
    p.add_argument("--hill", required=True)
    p.add_argument("--template", required=True)
    p.add_argument("--bench", required=True, action="append", help="benchmark directory or file (repeatable)")
    p.add_argument("--mode", choices=["static", "hill"], default="static")
    p.add_argument("--fitness", choices=["auto", "exact", "sampled"], default="auto")
    p.add_argument("--rounds", type=int, help="sampled: rounds per opponent (default: the hill's)")
    p.add_argument("--slices", type=int, default=5, help="sampled: racing slices")
    p.add_argument("--hill-size", type=int)
    p.add_argument("--pin", action="append", default=[], help="hill mode: anchor directory or file (repeatable)")
    p.add_argument("--lineage", type=int, default=1)
    p.add_argument("--time", type=parse_duration, help="time limit, e.g. 30m, 2h")
    p.add_argument("--evals", type=int, help="evaluation limit")
    p.add_argument("--patience", type=int, help="stop after N evaluations without a new best")
    p.add_argument("--sweep-limit", type=int, default=160)
    p.add_argument("--seed", type=int)
    p.add_argument("--author")
    p.add_argument("--reference", help="warrior scored next to the best on held-out seeds at the end")
    p.add_argument("--validate-rounds", type=int, default=2000, help="sampled: rounds for the held-out check")
    _common(p)

    p = sub.add_parser("resume", help="continue a paused run")
    p.add_argument("run_dir")
    p.add_argument("--yes", action="store_true", help="accept changed inputs")
    p.add_argument("--time", type=parse_duration, help="new time limit (total)")
    p.add_argument("--evals", type=int, help="new evaluation limit (total)")
    _common(p)

    p = sub.add_parser("pause", help="ask a running run to pause")
    p.add_argument("run_dir")
    p = sub.add_parser("stop", help="ask a running run to stop (finish with a report)")
    p.add_argument("run_dir")
    sub.add_parser("list", help="runs and their states")
    sub.add_parser("hills", help="hill presets")

    p = sub.add_parser("score", help="score one warrior against a benchmark")
    p.add_argument("--hill", required=True)
    p.add_argument("warrior")
    p.add_argument("--bench", required=True, action="append")
    p.add_argument("--fitness", choices=["auto", "exact", "sampled"], default="auto")
    p.add_argument("--rounds", type=int)
    p.add_argument("--seed", type=int, default=1)
    _common(p)

    p = sub.add_parser("rr", help="round robin of a directory, hill-style table")
    p.add_argument("--hill", required=True)
    p.add_argument("bench", nargs="+")
    p.add_argument("--fitness", choices=["auto", "exact", "sampled"], default="auto")
    p.add_argument("--rounds", type=int)
    p.add_argument("--seed", type=int, default=1)
    _common(p)

    p = sub.add_parser("check", help="variables, domain sizes, search space, assembly of start values")
    p.add_argument("--hill", required=True)
    p.add_argument("template")
    p.add_argument("--hills-file")

    p = sub.add_parser("ui", help="start the local web interface")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-browser", action="store_true")
    _common(p)
    return ap


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return COMMANDS[args.cmd](args) or 0
    except (HillError, RunError, TemplateError, FileNotFoundError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except AssemblyError as e:
        print(f"error: does not assemble:\n{e.message}", file=sys.stderr)
        return 2


def _cache(args) -> ScoreCache:
    return ScoreCache(None if args.cache == "none" else args.cache)


# --------------------------------------------------------------------------

def _printer():
    last = [0.0]

    def emit(ev):
        t = ev["type"]
        if t == "best":
            se = f" ± {ev['se']:.2f}" if ev.get("se") else ""
            vals = " ".join(f"{k}={v}" for k, v in ev["values"].items())
            print(f"[{ev['evals']:>7}] best {ev['score']:.3f}{se}  {vals}", flush=True)
        elif t == "progress":
            if time.time() - last[0] >= 10:
                last[0] = time.time()
                cur = "-" if ev["current"] is None else f"{ev['current']:.2f}"
                print(f"[{ev['evals']:>7}] {ev['phase']:<6} current {cur}  {ev['speed']:.1f} evals/s  "
                      f"{ev['elapsed']:.0f}s", flush=True)
        elif t == "hill":
            pushed = f", pushed off {', '.join(ev['pushed'])}" if ev.get("pushed") else ""
            print(f"         hill: {ev['name']} {ev['result']} (rank {ev.get('rank')}){pushed}", flush=True)
        elif t in ("info",):
            print(f"         {ev['message']}", flush=True)
        elif t == "state":
            extra = f" ({ev['reason']})" if ev.get("reason") else ""
            extra += f": {ev['error']}" if ev.get("error") else ""
            print(f"         state: {ev['status']}{extra}", flush=True)
    return emit


def _execute(run: Run, accept_changes=False) -> int:
    """Run in the foreground. Ctrl-C/SIGTERM pause; a second Ctrl-C stops at once."""
    hits = [0]

    def on_signal(signum, frame):
        hits[0] += 1
        if hits[0] == 1:
            print("\npausing after the current evaluation (Ctrl-C again to stop now)...", flush=True)
            run.request_pause()
        else:
            print("\nstopped; the last checkpoint is kept", flush=True)
            os._exit(130)

    old_int = signal.signal(signal.SIGINT, on_signal)
    old_term = signal.signal(signal.SIGTERM, on_signal)
    try:
        status = run.execute(accept_changes)
    finally:
        signal.signal(signal.SIGINT, old_int)
        signal.signal(signal.SIGTERM, old_term)
    print(f"run {run.id}: {status}; directory {run.store.root}")
    b = run.state.get("best")
    if b:
        print(f"best {b['score']:.3f}" + (f" ± {b['se']:.3f}" if b["se"] else "") +
              f" -> {os.path.join(run.store.root, 'best.red')}")
    if status == "paused":
        print(f"resume with: cwopt resume {run.store.root}")
    return 0


def cmd_run(args):
    hill = get_hill(args.hill, args.hills_file)
    print(hill.summary())
    if hill.verified:
        print(f"  settings verified: {hill.verified}")
    opts = {"mode": args.mode, "fitness": args.fitness, "rounds": args.rounds, "slices": args.slices,
            "hill_size": args.hill_size, "lineage": args.lineage, "max_time": args.time,
            "max_evals": args.evals, "patience": args.patience, "author": args.author,
            "search": {"sweep_limit": args.sweep_limit},
            "reference": args.reference, "validate_rounds": args.validate_rounds}
    pool = WorkerPool(args.workers)
    try:
        run = Run.create(args.runs, hill, args.template, args.bench, opts, pool, _cache(args),
                         pin_paths=args.pin, seed=args.seed, emit=_printer())
        c = run.config
        for p in c["bench_problems"]:
            print(f"  warning: {p}")
        print(f"run {run.id}: {len(c['bench'])} benchmark warriors, {len(c['variables'])} variables, "
              f"fitness {c['fitness_mode']}, seed {c['seed']}, {pool.workers} workers")
        return _execute(run)
    finally:
        pool.close()


def cmd_resume(args):
    pool = WorkerPool(args.workers)
    try:
        run = Run.open(args.run_dir, pool, _cache(args), emit=_printer())
        if args.time is not None:
            run.config["options"]["max_time"] = args.time
        if args.evals is not None:
            run.config["options"]["max_evals"] = args.evals
        if args.time is not None or args.evals is not None:
            st = run.store.read_json("state.json")
            if st:
                st["finished_reason"] = None
                run.store.write_json("state.json", st)
            run.store.write_json("run.json", run.config)
        try:
            return _execute(run, accept_changes=args.yes)
        except ResumeMismatch as e:
            print(str(e), file=sys.stderr)
            print("rerun with --yes to resume anyway (the incumbent is re-evaluated)", file=sys.stderr)
            return 3
    finally:
        pool.close()


def _control(args, word):
    path = os.path.join(args.run_dir, "control")
    if not os.path.exists(os.path.join(args.run_dir, "run.json")):
        raise RunError(f"{args.run_dir} is not a run directory")
    with open(path, "w") as f:
        f.write(word)
    print(f"asked {args.run_dir} to {word}")


def cmd_pause(args):
    _control(args, "pause")


def cmd_stop(args):
    _control(args, "stop")


def cmd_list(args):
    runs = list_runs(args.runs)
    if not runs:
        print(f"no runs in {args.runs}")
    for r in runs:
        best = "-" if r.get("best_score") is None else f"{r['best_score']:.2f}"
        if r.get("best_se"):
            best += f"±{r['best_se']:.2f}"
        print(f"{r['id']:<44} {r.get('hill') or '?':<9} {r.get('status', '?'):<9} {best:>13} "
              f"{r.get('evals', 0):>8} evals {r.get('elapsed', 0):>7.0f}s")


def cmd_hills(args):
    for h in load_hills().values():
        print(h.summary())
        if h.verified:
            print(f"    verified: {h.verified}")
        for p in h.problems():
            print(f"    problem: {p}")


def _scorer(args, hill, uses_pspace):
    mode = choose_mode(hill, uses_pspace, args.fitness)
    if mode == "exact":
        sch = Schedule.exact()
    else:
        sch = Schedule.sampled(hill, args.seed, 0, args.rounds or hill.rounds, 1)
    return mode, sch


def cmd_score(args):
    hill = get_hill(args.hill, args.hills_file)
    hill.check_runnable()
    print(hill.summary())
    w = default_assembler().assemble(hill, read_source(args.warrior))
    bench, problems = load_bench(hill, args.bench)
    for p in problems:
        print(f"  warning: {p}")
    mode, sch = _scorer(args, hill, w.uses_pspace or any(b.warrior.uses_pspace for b in bench))
    pool = WorkerPool(args.workers)
    try:
        ev = Evaluator(hill, pool, _cache(args), _engine_version(hill))
        fit = ev.evaluate(w, [b.warrior for b in bench], sch)
    finally:
        pool.close()
    rows = sorted(zip(bench, fit.per_opp), key=lambda r: r[1].score)
    print(f"\n{'opponent':<32} {'W':>6} {'T':>6} {'L':>6} {'score':>7}")
    for b, r in rows:
        print(f"{b.name[:32]:<32} {r.wins:>6} {r.ties:>6} {r.losses:>6} {r.score:>7.1f}")
    se = "" if mode == "exact" else f" ± {fit.se:.2f}"
    print(f"\n{w.name}: {fit.score:.3f}{se} ({mode}{'' if mode == 'exact' else f', {sch.rounds} rounds'}, "
          f"{len(bench)} opponents)")


def _engine_version(hill):
    from .engine import engine_version
    return engine_version(hill.module, hill.module_path)


def cmd_rr(args):
    hill = get_hill(args.hill, args.hills_file)
    hill.check_runnable()
    print(hill.summary())
    bench, problems = load_bench(hill, args.bench)
    for p in problems:
        print(f"  warning: {p}")
    mode, sch = _scorer(args, hill, any(b.warrior.uses_pspace for b in bench))
    pool = WorkerPool(args.workers)
    try:
        ev = Evaluator(hill, pool, _cache(args), _engine_version(hill))

        def pair_fn(a, bs):
            tot = [PairResult(0, 0, 0)] * len(bs)
            for u in sch.units:
                tot = [t + r for t, r in zip(tot, ev.unit_results(a, bs, u))]
            return tot

        hs = HillState([{"name": b.name, "source": b.source, "hash": b.warrior.hash} for b in bench],
                       len(bench), 0)
        warriors = {b.warrior.hash: b.warrior for b in bench}
        hs.fill_pairs(warriors, pair_fn)
    finally:
        pool.close()
    print(f"\n{'rank':>4}  {'warrior':<32} {'score':>7}   ({mode})")
    for r in hs.standings():
        print(f"{r['rank']:>4}  {r['name'][:32]:<32} {r['score']:>7.2f}")


def cmd_check(args):
    hill = get_hill(args.hill, args.hills_file)
    print(hill.summary())
    for p in hill.problems():
        print(f"problem: {p}")
    res = check_template(hill, read_source(args.template))
    if res.get("error"):
        e = res["error"]
        print(f"template error at line {e['line']}, column {e['col']}: {e['message']}")
        return 1
    print(f"\n{'variable':<16} {'domain':<28} {'size':>6} {'start':>8}")
    for v in res["variables"]:
        print(f"{v['name']:<16} {v['spec']:<28} {v['size']:>6} {str(v['start'] if v['start'] is not None else 'random'):>8}")
    print(f"\nsearch space: {res['space']:.4g} combinations; fitness {res['fitness']}"
          + (", start values missing for some variables: first values used for this check"
             if res["random_start"] else ""))
    a = res["assembly"]
    if a["ok"]:
        print(f"start values assemble: {a['length']} instructions")
        for line in a["warnings"]:
            print(f"  {line}")
        print(a["listing"])
        return 0
    print("start values do not assemble:\n" + a["message"])
    return 1


def check_template(hill, text: str) -> dict:
    """Shared by ``cwopt check`` and ``POST /api/check``."""
    try:
        t = parse_template(text, hill.constants())
    except TemplateError as e:
        return {"error": e.to_dict()}
    idx = [v.start if v.start is not None else 0 for v in t.variables]
    src = t.render(idx)
    out = {"variables": [v.to_dict() for v in t.variables], "space": float(t.search_space()),
           "random_start": any(v.start is None for v in t.variables),
           "fitness": choose_mode(hill, t.uses_pspace()), "rendered": src,
           "markers": [{"line": v.line, "col": v.col, "end": v.end + 1, "name": v.name} for v in t.variables]}
    try:
        w = default_assembler().assemble(hill, src)
        out["assembly"] = {"ok": True, "length": len(w.insns), "listing": w.listing(hill.coresize),
                           "warnings": [l for l in w.warnings if not l.startswith(("Warning:", "Number of"))],
                           "uses_pspace": w.uses_pspace}
        if w.uses_pspace:
            out["fitness"] = choose_mode(hill, True)
    except AssemblyError as e:
        out["assembly"] = {"ok": False, "message": e.message, "values": t.values(idx)}
    return out


def cmd_ui(args):
    from .server import serve
    serve(args.runs, args.port, args.workers, None if args.cache == "none" else args.cache,
          open_browser=not args.no_browser)


COMMANDS = {"run": cmd_run, "resume": cmd_resume, "pause": cmd_pause, "stop": cmd_stop, "list": cmd_list,
            "hills": cmd_hills, "score": cmd_score, "rr": cmd_rr, "check": cmd_check, "ui": cmd_ui}

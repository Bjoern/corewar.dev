"""Engine acceptance test (spec §2): the engine layer against the exMARS CLI and pMARS.

    python3 tests/acceptance.py --exmars PATH/TO/exmars [--pmars-wasm ../exMARS/dist/wasm] [--rounds 1000]

For each preset, single rounds at fixed positions (``-r 1 -F p``) with both starting
orders, on published warriors, imps, p-space warriors and random junk. pMARS is the
WebAssembly build shipped in exMARS's dist/wasm (needs Node). Also checks that the
exact mode equals the sum of its single rounds and that equal ``fixed_position`` and
``rounds`` give equal results.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from cwopt.bench import list_red_files, read_source  # noqa: E402
from cwopt.engine import DEFAULT_EXMARS, AssemblyError, Engine, PairResult, default_assembler  # noqa: E402
from cwopt.hills import load_hills  # noqa: E402

W = os.path.join(DEFAULT_EXMARS, "warriors")
SOURCES = {
    "nano": [os.path.join(W, "benchmark", "nanobm07")],
    "tiny": [],
    "standard": [os.path.join(W, "94nop"), os.path.join(W, "pspace"), os.path.join(W, "benchmark", "94top50", "HILL32")],
    "94nop": [os.path.join(W, "94nop")],
    "lp": [os.path.join(W, "94nop")],
}
OPS = ["dat", "spl", "mov", "djn", "add", "jmz", "sub", "seq", "sne", "slt", "jmn", "jmp", "nop", "mul", "mod", "div"]
MODS = ["a", "b", "ab", "ba", "f", "x", "i"]
MODES = "#$@<>*{}"


def junk(rng, hill, pspace=False):
    n = rng.randint(1, hill.length)
    ops = OPS + (["ldp", "stp"] if pspace else [])
    lines = [";redcode-94", ";name junk", f";assert CORESIZE == {hill.coresize}"]
    for _ in range(n):
        f = lambda: rng.randint(-hill.coresize, hill.coresize)
        lines.append(f"{rng.choice(ops)}.{rng.choice(MODS)} {rng.choice(MODES)}{f()}, {rng.choice(MODES)}{f()}")
    lines.append(f"end {rng.randrange(n)}")
    return "\n".join(lines) + "\n"


IMPS = [";redcode-94\n;name imp\nmov.i 0, 1\nend\n",
        ";redcode-94\n;name imp spiral\n;assert CORESIZE % 3 != 0 || 1\nspl 1\nspl 1\nmov.i 0, 1\nend\n",
        ";redcode-94\n;name dwarf\nadd #4, 3\nmov 2, @2\njmp -2\ndat #0, #0\nend\n"]


def cli_rows(out: str):
    rows = [l.split() for l in out.strip().splitlines()[-2:]]
    (w1, t1), (w2, _t2) = [(int(r[0]), int(r[1])) for r in rows]
    return (w1, t1, w2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exmars", required=True)
    ap.add_argument("--pmars-wasm", default=os.path.join(DEFAULT_EXMARS, "dist", "wasm"))
    ap.add_argument("--pmars", help="native pMARS binary (server build); used instead of the WASM build")
    ap.add_argument("--rounds", type=int, default=1000, help="single rounds per preset")
    ap.add_argument("--hills", nargs="*", default=["nano", "tiny", "standard", "94nop", "lp"])
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    hills = load_hills()
    failures = 0
    tmp = tempfile.mkdtemp(prefix="cwopt-accept-")
    for key in args.hills:
        hill = hills[key]
        if hill.problems():
            print(f"skip {key}: {'; '.join(hill.problems())}")
            continue
        eng = Engine(hill)
        pool = []
        for f in list_red_files([d for d in SOURCES.get(key, []) if os.path.isdir(d)]):
            src = read_source(f)
            try:
                pool.append((os.path.basename(f), src, eng.assemble(src)))
            except AssemblyError:
                pass
        real = len(pool)
        for s in IMPS:
            pool.append(("imp", s, eng.assemble(s)))
        while len(pool) < real + 3 + 40:
            s = junk(rng, hill, pspace=bool(hill.pspace) and rng.random() < 0.3)
            try:
                pool.append(("junk", s, eng.assemble(s)))
            except AssemblyError:
                pass
        jobs = []
        for _ in range(args.rounds // 2):
            a, b = rng.choice(pool), rng.choice(pool)
            p = rng.randint(hill.distance, hill.coresize - hill.distance)
            jobs.append((a, b, p))
            jobs.append((b, a, (hill.coresize - p) % hill.coresize))
        common = ["-s", str(hill.coresize), "-c", str(hill.cycles), "-p", str(hill.processes),
                  "-l", str(hill.length), "-d", str(hill.distance), "-r", "1"]
        ours, cli = [], []
        for k, (a, b, p) in enumerate(jobs):
            r = eng.single(a[2], b[2], p)
            ours.append((r.wins, r.ties, r.losses))
            fa, fb = os.path.join(tmp, "a.red"), os.path.join(tmp, "b.red")
            open(fa, "w").write(a[1]); open(fb, "w").write(b[1])
            out = subprocess.run([args.exmars, "-b", "-k", *common, "-F", str(p), fa, fb],
                                 capture_output=True, text=True).stdout
            cli.append(cli_rows(out))
        if args.pmars:
            pm = []
            for a, b, p in jobs:
                fa, fb = os.path.join(tmp, "a.red"), os.path.join(tmp, "b.red")
                open(fa, "w").write(a[1]); open(fb, "w").write(b[1])
                r = subprocess.run([args.pmars, "-b", "-k", *common, "-F", str(p), fa, fb],
                                   capture_output=True, text=True)
                pm.append(r.stdout + ("\n#ERR " + r.stderr if len(r.stdout.strip().splitlines()) < 2 else ""))
        else:
            # pMARS: one Node process runs every job.
            job_file = os.path.join(tmp, "jobs.json")
            json.dump([{"args": ["-b", "-k", *common, "-F", str(p), "a.red", "b.red"], "a": a[1], "b": b[1]}
                       for a, b, p in jobs], open(job_file, "w"))
            script = (f"import('{os.path.join(os.path.abspath(args.pmars_wasm), 'client.mjs')}').then(async c => {{"
                      f"const jobs = JSON.parse(require('fs').readFileSync({json.dumps(job_file)}, 'utf8')); const out = [];"
                      "for (const j of jobs) { const r = await c.runCLI('pmars', j.args, {'a.red': j.a, 'b.red': j.b});"
                      " out.push(r.stdout + (r.stdout.trim().split('\\n').length < 2 ? '\\n#ERR ' + r.stderr : '')); } console.log(JSON.stringify(out)); })")
            pm = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
        pmars = []
        for (a, b, p), o in zip(jobs, pm):
            try:
                pmars.append(cli_rows(o.split("#ERR")[0]))
            except (ValueError, IndexError):
                pmars.append(("pMARS error", o.split("#ERR")[-1].strip()[-300:]))
                if "complexity limit" not in o:
                    print(f"  pMARS failed on {a[0]} vs {b[0]}: {pmars[-1][1]}")
        bad = skipped = 0
        for k, (a, b, p) in enumerate(jobs):
            if isinstance(pmars[k][0], str) and "complexity limit" in pmars[k][1]:
                skipped += 1        # this pMARS build's assembler limit, not a simulation difference
                if ours[k] != cli[k]:
                    bad += 1
                continue
            if not (ours[k] == cli[k] == pmars[k]):
                bad += 1
                if bad <= 5:
                    print(f"  MISMATCH {key} {a[0]} vs {b[0]} -F {p}: engine {ours[k]} cli {cli[k]} pmars {pmars[k]}")
        # exact = sum of single rounds; fixed_position reproducible
        a, b = pool[0][2], pool[-1][2]
        tot = PairResult(0, 0, 0)
        for p in eng.positions():
            tot = tot + eng.single(a, b, p) + eng.single(b, a, (hill.coresize - p) % hill.coresize).swapped()
        if hill.positions <= 2000 and eng.exact_pair(a, b) != tot:
            bad += 1
            print(f"  MISMATCH {key}: exact_pair != sum of single rounds")
        s1 = eng.sampled_pair(pool[1][2], pool[2][2], 1234, 20)
        s2 = eng.sampled_pair(pool[1][2], pool[2][2], 1234, 20)
        if s1 != s2:
            bad += 1
            print(f"  MISMATCH {key}: fixed_position not reproducible {s1} {s2}")
        kinds = f"{real} published, {len(IMPS)} imps/dwarfs, {len(pool) - real - len(IMPS)} junk"
        print(f"{'ok  ' if not bad else 'FAIL'} {key}: {len(jobs)} single rounds ({kinds}), "
              f"engine = exMARS CLI = pMARS{'' if not bad else f': {bad} mismatches'}"
              + (f"; {skipped} rounds checked against the CLI only (this pMARS build refused to assemble "
                 f"one of the pair: assembly complexity limit)" if skipped else ""))
        failures += bad
    default_assembler().close()
    print(f"{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

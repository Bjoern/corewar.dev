"""Runs: determinism, pause/resume (also after SIGKILL), hill mode, optimisation."""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from cwopt.engine import DEFAULT_EXMARS, PairResult  # noqa: E402
from cwopt.fitness import ScoreCache, WorkerPool  # noqa: E402
from cwopt.hillmode import HillState  # noqa: E402
from cwopt.hills import get_hill  # noqa: E402
from cwopt.runs import Run  # noqa: E402
from cwopt.search import Search  # noqa: E402

NANO_BENCH = os.path.join(DEFAULT_EXMARS, "warriors", "benchmark", "nanobm07")
TEMPLATE = os.path.join(ROOT, "examples", "alcoholism.red")

# A known nano warrior (Alcoholism Malt, from nanobm07) with its SPL step broken (38 -> 10).
BROKEN = """;redcode-nano
;name Alcoholism Malt
;assert CORESIZE == 80
mov.i  <   -35, $    13
spl.ab #   !(1..79):10, >   -23
mov.i  *    -8, {     0
mov.i  >   -35, {    -2
djn.x  $    -2, $    -3
end   0
"""

SMALL = """;redcode-nano
;name small
;assert CORESIZE == 80
a equ !(1..79):10
mov.i  <   !(-40..39):-35, $    13
spl.ab #   a, >   ![-23,-20,-17]
mov.i  *    -8, {     0
mov.i  >   -35, {    -2
djn.x  $    -2, $    -3
end   0
"""


def events(store):
    """Log entries without wall-clock fields and cache-dependent fight counts."""
    out = []
    for line in store.read_lines("log.jsonl"):
        e = json.loads(line)
        e.pop("time", None)
        e.pop("pairings", None)
        out.append(e)
    return out


class RunCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="cwopt-test-")
        self.tfile = os.path.join(self.tmp, "t.red")
        self.pools = []

    def tearDown(self):
        for p in self.pools:
            p.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def pool(self, n=0):
        p = WorkerPool(n)
        self.pools.append(p)
        return p

    def make(self, name, text, opts, workers=0, seed=7, bench=(NANO_BENCH,), pins=()):
        with open(self.tfile, "w") as f:
            f.write(text)
        return Run.create(os.path.join(self.tmp, "runs"), get_hill("nano"), self.tfile, list(bench), opts,
                          self.pool(workers), ScoreCache(None), pin_paths=list(pins), seed=seed, run_id=name)

    def run_with_pauses(self, name, text, opts, pause_at=(), workers=0, **kw):
        run = self.make(name, text, opts, workers, **kw)
        root = run.store.root
        pause_at = sorted(pause_at)
        statuses = []
        while True:
            def step(orig=run.step, r=run):
                orig()
                if pause_at and r.search.s["steps"] >= pause_at[0]:
                    pause_at.pop(0)
                    r.request_pause()
            run.step = step
            statuses.append(run.execute())
            if statuses[-1] == "finished":
                return run, statuses
            run = Run.open(root, self.pool(workers), ScoreCache(None))   # a fresh process would do this


class TestDeterminism(RunCase):
    def test_seeded_run_reproducible_with_one_and_several_workers(self):
        opts = {"max_evals": 300}
        a, _ = self.run_with_pauses("a", SMALL, opts)
        b, _ = self.run_with_pauses("b", SMALL, opts, workers=3)
        self.assertEqual(events(a.store), events(b.store))
        self.assertEqual(a.state["best"], b.state["best"])
        self.assertEqual(a.store.read_text("best.red"), b.store.read_text("best.red"))

    def test_pause_and_resume_gives_same_result_exact(self):
        opts = {"max_evals": 900, "search": {"restart_patience": 150}}
        a, _ = self.run_with_pauses("a", SMALL, opts)
        b, st = self.run_with_pauses("b", SMALL, opts, pause_at=[1, 37, 200, 201, 650])
        self.assertEqual(st.count("paused"), 5)
        self.assertEqual(events(a.store), events(b.store))
        self.assertEqual(a.search.state(), b.search.state())
        self.assertEqual(a.store.read_text("best.template.red"), b.store.read_text("best.template.red"))

    def test_pause_and_resume_gives_same_result_sampled_with_racing_and_reseeds(self):
        opts = {"max_evals": 250, "fitness": "sampled", "rounds": 40, "slices": 4, "reseed_every": 3}
        a, _ = self.run_with_pauses("a", SMALL, opts)
        b, _ = self.run_with_pauses("b", SMALL, opts, pause_at=[3, 50, 51, 120])
        ea = events(a.store)
        self.assertTrue(any(e["event"] == "reseed" for e in ea))
        self.assertEqual(ea, events(b.store))
        self.assertEqual(a.search.state(), b.search.state())

    def test_pause_and_resume_in_hill_mode(self):
        opts = {"max_evals": 200, "mode": "hill", "hill_size": 20, "lineage": 1}
        a, _ = self.run_with_pauses("a", SMALL, opts)
        b, _ = self.run_with_pauses("b", SMALL, opts, pause_at=[1, 2, 90])
        self.assertEqual(events(a.store), events(b.store))
        self.assertEqual(a.hillstate.state(), b.hillstate.state())

    def test_resume_after_kill(self):
        """SIGKILL the CLI at arbitrary moments; the result equals an uninterrupted run."""
        with open(self.tfile, "w") as f:
            f.write(SMALL)
        runs = os.path.join(self.tmp, "runs")
        base = [sys.executable, "-m", "cwopt", "--runs", runs]
        common = ["--hill", "nano", "--template", self.tfile, "--bench", NANO_BENCH, "--evals", "1500",
                  "--seed", "3", "--workers", "0", "--cache", "none"]
        subprocess.run(base + ["run"] + common, cwd=ROOT, check=True, capture_output=True)
        ref = os.path.join(runs, sorted(os.listdir(runs))[0])
        p = subprocess.Popen(base + ["run"] + common, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        p.send_signal(signal.SIGKILL)
        p.wait()
        killed = [d for d in os.listdir(runs) if os.path.join(runs, d) != ref][0]
        kdir = os.path.join(runs, killed)
        for delay in (0.7, 1.1):
            with open(os.path.join(kdir, "status.json")) as f:
                if json.load(f)["status"] == "finished":
                    break
            with open(os.path.join(kdir, "state.json")) as f:
                json.load(f)   # never half-written
            p = subprocess.Popen(base + ["resume", kdir, "--workers", "0", "--cache", "none"], cwd=ROOT,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(delay)
            p.send_signal(signal.SIGKILL)
            p.wait()
        subprocess.run(base + ["resume", kdir, "--workers", "0", "--cache", "none"], cwd=ROOT, check=True,
                       capture_output=True)
        a, b = Run.open(ref, self.pool(), ScoreCache(None)), Run.open(kdir, self.pool(), ScoreCache(None))
        self.assertEqual(events(a.store), events(b.store))
        self.assertEqual(a.store.read_text("best.red"), b.store.read_text("best.red"))
        self.assertFalse([f for f in os.listdir(kdir) if f.startswith(".")], "temporary checkpoint files left")


class TestOptimisation(RunCase):
    def test_broken_constant_is_recovered(self):
        run, _ = self.run_with_pauses("fix", BROKEN, {"max_evals": 200})
        best = run.state["best"]
        # The original value 38 scores 145.68 exact on nanobm07; the sweep must reach it or better.
        self.assertGreaterEqual(best["score"], 145.676 - 1e-6)
        first = events(run.store)[0]
        self.assertLess(first["score"], 120)

    def test_resume_refuses_changed_inputs(self):
        run, _ = self.run_with_pauses("chg", SMALL, {"max_evals": 50}, pause_at=[10])
        with open(self.tfile, "a") as f:
            f.write("; edited\n")
        from cwopt.runs import ResumeMismatch
        r = Run.open(run.store.root, self.pool(), ScoreCache(None))
        with self.assertRaises(ResumeMismatch) as e:
            r.execute()
        self.assertIn("changed", e.exception.changes[0])


class TestSearch(unittest.TestCase):
    def test_state_round_trip(self):
        s = Search([10, 200, 3], [None, 5, 1], seed=4)
        for k in range(50):
            p = s.propose()
            s.observe(p, float(sum(p["x"]) % 17))
        t = Search.from_state(s.state())
        for k in range(50):
            a, b = s.propose(), t.propose()
            self.assertEqual(a, b)
            s.observe(a, float(a["x"][0])); t.observe(b, float(b["x"][0]))
        self.assertEqual(s.state(), t.state())

    def test_sweep_finds_separable_optimum(self):
        target = [7, 2, 13]
        s = Search([20, 5, 30], [0, 0, 0], seed=1)
        for _ in range(200):
            p = s.propose()
            s.observe(p, -float(sum(abs(a - b) for a, b in zip(p["x"], target))))
        self.assertEqual(s.best["x"], target)


class TestHill(unittest.TestCase):
    """Push-off order against a hand-computed round robin."""

    def setUp(self):
        # Fake warriors identified by hash; pair results from a fixed table (wins for row vs column).
        self.table = {("A", "B"): 60, ("A", "C"): 50, ("A", "D"): 70, ("B", "C"): 55, ("B", "D"): 50,
                      ("C", "D"): 40, ("X", "A"): 80, ("X", "B"): 90, ("X", "C"): 30, ("X", "D"): 95,
                      ("Y", "A"): 85, ("Y", "B"): 95, ("Y", "C"): 35, ("Y", "D"): 99, ("Y", "X"): 60,
                      ("Z", "A"): 10, ("Z", "B"): 10, ("Z", "C"): 10, ("Z", "D"): 10, ("Z", "X"): 10, ("Z", "Y"): 10}

    def fn(self, a, bs):
        out = []
        for b in bs:
            if (a, b) in self.table:
                w = self.table[(a, b)]
                out.append(PairResult(w, 0, 100 - w))
            else:
                w = self.table[(b, a)]
                out.append(PairResult(100 - w, 0, w))
        return out

    def members(self, pinned=()):
        return [{"name": h, "source": "", "hash": h, "pinned": h in pinned} for h in "ABCD"]

    def scores(self, names):
        # hand-computed: mean of 3*wins% over opponents
        out = {}
        for a in names:
            v = [self.fn(a, [b])[0].score for b in names if b != a]
            out[a] = sum(v) / len(v)
        return out

    def test_push_off_lowest_unpinned(self):
        hs = HillState(self.members(), size=4, lineage=1)
        hs.fill_pairs({h: h for h in "ABCD"}, self.fn)
        sc = self.scores("ABCDX")
        expected_out = min("ABCD", key=lambda h: sc[h])
        ev = hs.challenge({"name": "X", "source": "", "hash": "X"}, {h: h for h in "ABCDX"}, self.fn, 1)
        self.assertEqual(ev["result"], "joined")
        self.assertEqual(ev["pushed"], [expected_out])
        self.assertEqual([r["name"] for r in hs.standings()],
                         sorted([h for h in "ABCDX" if h != expected_out], key=lambda h: -self.scores(
                             [x for x in "ABCDX" if x != expected_out])[h]))

    def test_anchor_stays(self):
        sc = self.scores("ABCDX")
        weakest = min("ABCD", key=lambda h: sc[h])
        hs = HillState(self.members(pinned=weakest), size=4, lineage=1)
        hs.fill_pairs({h: h for h in "ABCD"}, self.fn)
        ev = hs.challenge({"name": "X", "source": "", "hash": "X"}, {h: h for h in "ABCDX"}, self.fn, 1)
        self.assertNotIn(weakest, ev["pushed"])
        self.assertIn(weakest, [m["name"] for m in hs.members])
        self.assertEqual(ev["pushed"], [min([h for h in "ABCD" if h != weakest], key=lambda h: sc[h])])

    def test_lineage_cap(self):
        hs = HillState(self.members(), size=4, lineage=1)
        ws = {h: h for h in "ABCDXYZ"}
        hs.fill_pairs(ws, self.fn)
        hs.challenge({"name": "X", "source": "", "hash": "X"}, ws, self.fn, 1)
        ev = hs.challenge({"name": "Y", "source": "", "hash": "Y"}, ws, self.fn, 2)
        self.assertEqual(ev["result"], "joined")
        self.assertEqual(ev["pushed"], ["X"])          # replaces its own relative
        self.assertEqual(sum(m["origin"] == "run" for m in hs.members), 1)
        ev = hs.challenge({"name": "Z", "source": "", "hash": "Z"}, ws, self.fn, 3)
        self.assertTrue(ev["result"].startswith("rejected"))
        self.assertEqual([m["name"] for m in hs.s["archive"]][-1], "X")
        self.assertEqual(len(hs.members), 4)

    def test_benchmark_excludes_own_members(self):
        hs = HillState(self.members(), size=5, lineage=2)
        ws = {h: h for h in "ABCDX"}
        hs.fill_pairs(ws, self.fn)
        hs.challenge({"name": "X", "source": "", "hash": "X"}, ws, self.fn, 1)
        self.assertEqual(len(hs.members), 5)
        self.assertEqual([m["hash"] for m in hs.benchmark_members()], list("ABCD"))

    def test_initial_hill_trimmed_to_size(self):
        hs = HillState(self.members(pinned="D"), size=2, lineage=1)
        hs.fill_pairs({h: h for h in "ABCD"}, self.fn)
        sc = self.scores("ABCD")
        pushed = hs.trim()
        self.assertEqual(len(hs.members), 2)
        self.assertIn("D", [m["name"] for m in hs.members])          # anchor kept
        self.assertEqual(pushed[0], min("ABC", key=lambda h: sc[h]))
        self.assertEqual(len(hs.s["archive"]), 2)


if __name__ == "__main__":
    unittest.main()

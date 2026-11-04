"""Fitness (spec §4): exact and sampled schedules, the worker pool and the score cache.

A *unit* is one deterministic piece of benchmark work for one pairing:
``("exact",)`` (every position, both orders) or ``("sampled", seed, rounds)``.
Results are cached in SQLite by (both code hashes, hill, engine version, unit).
"""
from __future__ import annotations

import concurrent.futures as cf
import hashlib
import json
import math
import multiprocessing
import os
import sqlite3
import threading
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from .engine import Engine, PairResult, Warrior, exmars_path
from .hills import Hill

MAX_FIXED_POSITION = (2 ** 31 - 1 >> 1) + 1   # exMARS/pMARS -F upper limit
DEFAULT_CACHE = os.path.join(os.path.expanduser("~"), ".cwopt", "cache.sqlite")


def unit_id(unit: Sequence) -> str:
    return "exact" if unit[0] == "exact" else f"s{unit[1]}r{unit[2]}"


def hill_id(hill: Hill) -> str:
    return hashlib.sha256(json.dumps(hill.settings(), sort_keys=True).encode()).hexdigest()[:16]


def derive_seed(hill: Hill, *parts) -> int:
    """A -F placement seed derived deterministically from ``parts``."""
    h = int(hashlib.sha256(json.dumps(parts).encode()).hexdigest(), 16)
    return hill.distance + h % (MAX_FIXED_POSITION - hill.distance)


# --------------------------------------------------------------------------
# Schedules

@dataclass
class Schedule:
    """How one candidate is scored against one opponent: a list of units.

    Exact: a single unit. Sampled: ``slices`` units of ``rounds/slices`` rounds
    each with different seeds, so racing can stop after any slice."""
    mode: str
    units: List[tuple]

    @staticmethod
    def exact() -> "Schedule":
        return Schedule("exact", [("exact",)])

    @staticmethod
    def sampled(hill: Hill, base_seed, epoch: int, rounds: int, slices: int) -> "Schedule":
        per = max(2, rounds // slices)
        per += per % 2                       # even: balances the starting order
        return Schedule("sampled", [("sampled", derive_seed(hill, base_seed, epoch, k), per)
                                    for k in range(slices)])

    @property
    def rounds(self) -> Optional[int]:
        return None if self.mode == "exact" else sum(u[2] for u in self.units)

    def to_dict(self):
        return {"mode": self.mode, "units": [list(u) for u in self.units]}

    @staticmethod
    def from_dict(d) -> "Schedule":
        return Schedule(d["mode"], [tuple(u) for u in d["units"]])


def choose_mode(hill: Hill, uses_pspace: bool, requested: str = "auto", exact_limit: int = 2000) -> str:
    """Exact for small cores without p-space, otherwise sampled."""
    if requested in ("exact", "sampled"):
        return requested
    if uses_pspace:
        return "sampled"   # one-round fights would hide everything p-space does
    return "exact" if 2 * hill.positions <= exact_limit else "sampled"


# --------------------------------------------------------------------------
# Aggregation

@dataclass
class Fitness:
    score: float          # mean over opponents of (3W+T)/rounds*100
    se: float             # standard error of score (0 for exact)
    per_opp: List[PairResult]
    complete: bool = True  # False when racing stopped early
    slices: Optional[List[Tuple[float, float]]] = None  # per slice: (score, variance)

    def to_dict(self):
        return {"score": self.score, "se": self.se, "complete": self.complete,
                "slices": self.slices, "per_opp": [r.to_list() for r in self.per_opp]}

    @staticmethod
    def from_dict(d) -> "Fitness":
        return Fitness(d["score"], d["se"], [PairResult(*r) for r in d["per_opp"]], d["complete"],
                       [tuple(s) for s in d["slices"]] if d.get("slices") else None)


def aggregate(results: Sequence[PairResult]) -> Tuple[float, float]:
    """Mean score over opponents and the variance of that mean."""
    if not results:
        return 0.0, 0.0
    n = len(results)
    mean = var = 0.0
    for r in results:
        m = r.score
        if r.rounds:
            ex2 = (300.0 ** 2 * r.wins + 100.0 ** 2 * r.ties) / r.rounds
            var += max(0.0, ex2 - m * m) / r.rounds
        mean += m
    return mean / n, var / (n * n)


# --------------------------------------------------------------------------
# Cache

class ScoreCache:
    """SQLite pair-result cache shared by all runs (and an in-memory front)."""

    def __init__(self, path: Optional[str] = DEFAULT_CACHE):
        self.path = path
        self._lock = threading.Lock()
        self._mem: Dict[tuple, PairResult] = {}
        self.db = None
        if path:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            self.db = sqlite3.connect(path, check_same_thread=False, timeout=30)
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=NORMAL")
            self.db.execute("""CREATE TABLE IF NOT EXISTS pairs (
                a TEXT, b TEXT, hill TEXT, engine TEXT, unit TEXT, w INT, t INT, l INT,
                PRIMARY KEY (a, b, hill, engine, unit)) WITHOUT ROWID""")
            self.db.commit()

    def get_many(self, a: str, bs: Sequence[str], hill: str, engine: str, unit: str) -> Dict[str, PairResult]:
        out = {}
        missing = []
        for b in bs:
            r = self._mem.get((a, b, hill, engine, unit))
            if r is not None:
                out[b] = r
            else:
                missing.append(b)
        if missing and self.db is not None:
            with self._lock:
                want = set(missing)
                for chunk in _chunks(sorted(want), 500):
                    q = ("SELECT b, w, t, l FROM pairs WHERE a=? AND hill=? AND engine=? AND unit=? "
                         f"AND b IN ({','.join('?' * len(chunk))})")
                    for b, w, t, l in self.db.execute(q, (a, hill, engine, unit, *chunk)):
                        out[b] = r = PairResult(w, t, l)
                        self._mem[(a, b, hill, engine, unit)] = r
        return out

    def put_many(self, a: str, items: Dict[str, PairResult], hill: str, engine: str, unit: str):
        if len(self._mem) > 500000:
            self._mem.clear()
        for b, r in items.items():
            self._mem[(a, b, hill, engine, unit)] = r
        if self.db is not None and items:
            with self._lock:
                self.db.executemany("INSERT OR REPLACE INTO pairs VALUES (?,?,?,?,?,?,?,?)",
                                    [(a, b, hill, engine, unit, r.wins, r.ties, r.losses) for b, r in items.items()])
                self.db.commit()

    def close(self):
        if self.db is not None:
            with self._lock:
                self.db.close()
                self.db = None


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# --------------------------------------------------------------------------
# Worker pool

_worker_engines: Dict[tuple, Engine] = {}
_thread_engines = threading.local()


def _worker_init(path: str):
    import signal
    signal.signal(signal.SIGINT, signal.SIG_IGN)   # Ctrl-C is handled by the parent
    os.environ["CWOPT_EXMARS"] = path


def _engine_for(hill: Hill, store: dict) -> Engine:
    key = (hill.module, hill.module_path, hill.mars_args())
    e = store.get(key)
    if e is None or e.hill != hill:
        e = store[key] = Engine(hill)
    return e


def _task(hill: Hill, a: Warrior, opps: List[Warrior], unit: tuple) -> List[Tuple[int, int, int]]:
    e = _engine_for(hill, _worker_engines)
    return [tuple(e.run_unit(a, b, unit).to_list()) for b in opps]


class WorkerPool:
    """Process pool; ``workers=0`` evaluates in the calling thread (tests, debugging).

    ``fight()`` holds the GIL and a Mars object must stay on one thread, so
    parallelism uses processes, each holding one Engine per hill."""

    def __init__(self, workers: Optional[int] = None):
        self.workers = (os.cpu_count() or 1) if workers is None else workers
        self._ex = None
        if self.workers > 0:
            ctx = multiprocessing.get_context("spawn")
            self._ex = cf.ProcessPoolExecutor(self.workers, mp_context=ctx,
                                              initializer=_worker_init, initargs=(exmars_path(),))

    def run(self, hill: Hill, a: Warrior, opps: List[Warrior], unit: tuple) -> List[PairResult]:
        if not opps:
            return []
        if self._ex is None:
            store = getattr(_thread_engines, "store", None)
            if store is None:
                store = _thread_engines.store = {}
            e = _engine_for(hill, store)
            return [e.run_unit(a, b, unit) for b in opps]
        # Few large chunks for cheap units (exact nano), one task per pairing otherwise.
        n = len(opps)
        chunks = min(n, self.workers * (1 if unit[0] == "exact" and hill.positions < 200 else 4))
        size = math.ceil(n / chunks)
        futs = [self._ex.submit(_task, hill, a, opps[i:i + size], unit) for i in range(0, n, size)]
        out: List[PairResult] = []
        for f in futs:
            out.extend(PairResult(*r) for r in f.result())
        return out

    def close(self):
        if self._ex is not None:
            self._ex.shutdown(wait=False, cancel_futures=True)
            self._ex = None


# --------------------------------------------------------------------------
# Evaluator

class Evaluator:
    """Scores warriors against opponents with caching. Counts real fights done."""

    def __init__(self, hill: Hill, pool: WorkerPool, cache: ScoreCache, engine: str):
        self.hill, self.pool, self.cache, self.engine = hill, pool, cache, engine
        self.hid = hill_id(hill)
        self.pairings_run = 0
        self.pairings_cached = 0

    def unit_results(self, a: Warrior, opps: Sequence[Warrior], unit: tuple) -> List[PairResult]:
        uid = unit_id(unit)
        ah = a.hash
        hashes = [o.hash for o in opps]
        have = self.cache.get_many(ah, hashes, self.hid, self.engine, uid)
        todo, seen = [], set()
        for o, h in zip(opps, hashes):
            if h not in have and h not in seen:
                todo.append(o)
                seen.add(h)
        self.pairings_cached += len(opps) - len(todo)
        if todo:
            res = self.pool.run(self.hill, a, todo, unit)
            new = {o.hash: r for o, r in zip(todo, res)}
            self.cache.put_many(ah, new, self.hid, self.engine, uid)
            have.update(new)
            self.pairings_run += len(todo)
        return [have[h] for h in hashes]

    def evaluate(self, a: Warrior, opps: Sequence[Warrior], schedule: Schedule,
                 race_against: Optional[Fitness] = None, z: float = 3.0) -> Fitness:
        """Score ``a``. With ``race_against`` (sampled only), stop after a slice when
        ``a`` trails that fitness on the same slices by more than ``z`` standard errors."""
        totals = [PairResult(0, 0, 0)] * len(opps)
        slices = []
        for k, unit in enumerate(schedule.units):
            res = self.unit_results(a, opps, unit)
            totals = [t + r for t, r in zip(totals, res)]
            slices.append(aggregate(res))
            last = k == len(schedule.units) - 1
            if (not last and race_against is not None and race_against.slices
                    and len(race_against.slices) == len(schedule.units)):
                mine = _mean_slices(slices)
                theirs = _mean_slices(race_against.slices[:k + 1])
                se = math.sqrt(mine[1] + theirs[1])
                if mine[0] < theirs[0] - z * se:
                    s, v = aggregate(totals)
                    return Fitness(s, math.sqrt(v), totals, False, [list(x) for x in slices])
        s, v = aggregate(totals)
        return Fitness(s, 0.0 if schedule.mode == "exact" else math.sqrt(v), totals, True,
                       [list(x) for x in slices] if schedule.mode == "sampled" else None)


def _mean_slices(slices) -> Tuple[float, float]:
    n = len(slices)
    return sum(s[0] for s in slices) / n, sum(s[1] for s in slices) / (n * n)

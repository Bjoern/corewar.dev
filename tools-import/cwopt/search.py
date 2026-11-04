"""Search (spec §5): coordinate sweep, annealing and restarts over index vectors.

The search knows only the domain size of each variable; it never sees templates,
warriors or engines, so it can later drive an evolver's genome as well.

All state lives in ``self.s``, a JSON-serialisable dict (including the RNG state),
and changes only in ``propose`` and ``observe``.  A checkpoint is ``self.s``;
``Search.from_state`` continues exactly where it stopped.  A proposal that was not
observed before a pause is kept in ``s["pending"]`` and proposed again on resume.
"""
from __future__ import annotations

import copy
import math
import random
from typing import Dict, List, Optional, Sequence

DEFAULTS = {
    "sweep_limit": 160,       # variables with at most this many values are swept
    "anneal_scale": 150.0,    # acceptance exp(delta_score * scale / temp); Metcalf's 15000/100
    "multi_prob": 0.1,        # chance per other variable of a small nudge in the same step
    "delta": 20,              # largest small step (in domain indices), capped at size/4
    "restart_patience": 400,  # steps without a new best before restarting from a top result
    "keep_best": 5,           # results kept for restarts
    "restart_prob": 0.3,      # chance per variable of a random value on restart
    "max_sweep_passes": 50,
}


MAX_INIT_TRIES = 1000


def _rng_dump(r: random.Random):
    v, state, gauss = r.getstate()
    return [v, list(state), gauss]


def _rng_load(d) -> random.Random:
    r = random.Random()
    r.setstate((d[0], tuple(d[1]), d[2]))
    return r


class Search:
    def __init__(self, sizes: Sequence[int], start: Sequence[Optional[int]], seed: int,
                 options: Optional[dict] = None):
        opts = dict(DEFAULTS)
        opts.update(options or {})
        n = len(sizes)
        self.rng = random.Random(seed)
        sweep_vars = [i for i in range(n) if 1 < sizes[i] <= opts["sweep_limit"]]
        self.s = {
            "sizes": list(sizes),
            "start": [None if v is None else int(v) for v in start],
            "opts": opts,
            "phase": "sweep" if sweep_vars else "anneal",
            "current": None,        # {"x", "score", "se", "slices"}
            "best": [],             # top results, best first
            "pending": None,        # {"x", "kind"}
            "reeval": [],           # vectors to rescore after the benchmark or seeds changed
            "sweep": self._new_sweep(sweep_vars),
            "anneal": {"temp": 0, "i": 0},
            "steps": 0, "since_best": 0, "stall": 0, "restarts": 0, "accepts": 0,
            "rng": None,
        }

    @staticmethod
    def _new_sweep(vars_):
        return {"vars": vars_, "k": 0, "pos": 0, "pass": 0, "improved": False,
                "best_x": None, "best": None}

    @classmethod
    def from_state(cls, state: dict) -> "Search":
        self = cls.__new__(cls)
        self.s = copy.deepcopy(state)
        self.rng = _rng_load(state["rng"])
        return self

    def state(self) -> dict:
        self.s["rng"] = _rng_dump(self.rng)
        return copy.deepcopy(self.s)

    # ------------------------------------------------------------------
    @property
    def current(self) -> Optional[dict]:
        return self.s["current"]

    @property
    def best(self) -> Optional[dict]:
        return self.s["best"][0] if self.s["best"] else None

    def invalidate(self):
        """The fitness function changed: rescore current and the kept results first."""
        q = []
        for e in ([self.s["current"]] if self.s["current"] else []) + self.s["best"]:
            if e["x"] not in q:
                q.append(e["x"])
        self.s["reeval"] = q
        self.s["pending"] = None
        sw = self.s["sweep"]
        sw["best_x"], sw["best"] = None, None

    # ------------------------------------------------------------------
    def propose(self) -> dict:
        s = self.s
        if s["pending"] is not None:
            return s["pending"]
        if s["reeval"]:
            p = {"x": list(s["reeval"][0]), "kind": "reeval"}
        elif s["current"] is None:
            x = [v if v is not None else self.rng.randrange(n) for v, n in zip(s["start"], s["sizes"])]
            p = {"x": x, "kind": "init"}
        else:
            p = None
            if s["phase"] == "sweep":
                p = self._propose_sweep()
            if p is None:
                if s["stall"] >= s["opts"]["restart_patience"] and s["best"]:
                    p = self._propose_restart()
                else:
                    p = self._propose_anneal()
        s["pending"] = p
        return p

    def _propose_sweep(self) -> Optional[dict]:
        s, sw = self.s, self.s["sweep"]
        cur = s["current"]["x"]
        while True:
            if sw["k"] >= len(sw["vars"]):
                sw["pass"] += 1
                if sw["improved"] and sw["pass"] < s["opts"]["max_sweep_passes"]:
                    sw.update(k=0, pos=0, improved=False)
                    continue
                s["phase"] = "anneal"
                return None
            v = sw["vars"][sw["k"]]
            if sw["pos"] >= s["sizes"][v]:
                # Variable done: move to the best value found for it.
                if sw["best"] is not None and sw["best"]["score"] > s["current"]["score"]:
                    s["current"] = sw["best"]
                    cur = s["current"]["x"]
                    sw["improved"] = True
                    s["accepts"] += 1
                sw.update(k=sw["k"] + 1, pos=0, best=None, best_x=None)
                continue
            pos = sw["pos"]
            sw["pos"] += 1
            if pos == cur[v]:
                continue
            x = list(cur)
            x[v] = pos
            return {"x": x, "kind": "sweep"}

    def _step(self, size: int) -> int:
        d = max(1, min(self.s["opts"]["delta"], size // 4))
        k = 0
        while k == 0:
            k = self.rng.randint(-d, d)
        return k

    def _propose_anneal(self) -> dict:
        s = self.s
        sizes = s["sizes"]
        movable = [i for i, n in enumerate(sizes) if n > 1]
        x = list(s["current"]["x"])
        if not movable:
            return {"x": x, "kind": "anneal"}
        for j in movable:
            if self.rng.random() < s["opts"]["multi_prob"]:
                x[j] = (x[j] + self._step(sizes[j])) % sizes[j]
        a = s["anneal"]
        i = movable[a["i"] % len(movable)]
        a["i"] = (a["i"] + 1) % len(movable)
        if self.rng.random() < 0.5:
            x[i] = self.rng.randrange(sizes[i])
        else:
            x[i] = (x[i] + self._step(sizes[i])) % sizes[i]
        if x == s["current"]["x"]:
            x[i] = (x[i] + self._step(sizes[i])) % sizes[i]
        return {"x": x, "kind": "anneal"}

    def _propose_restart(self) -> dict:
        s = self.s
        base = self.rng.choice(s["best"])["x"]
        x = list(base)
        movable = [i for i, n in enumerate(s["sizes"]) if n > 1]
        for i in movable:
            if self.rng.random() < s["opts"]["restart_prob"]:
                x[i] = self.rng.randrange(s["sizes"][i])
        if movable and x == base:
            i = self.rng.choice(movable)
            x[i] = (x[i] + self._step(s["sizes"][i])) % s["sizes"][i]
        return {"x": x, "kind": "restart"}

    # ------------------------------------------------------------------
    def observe(self, proposal: dict, score: Optional[float], se: float = 0.0,
                complete: bool = True, slices=None) -> List[dict]:
        """Record the fitness of ``proposal`` (``score`` None: invalid candidate)."""
        s = self.s
        assert s["pending"] is not None and proposal["x"] == s["pending"]["x"], "observe() without propose()"
        s["pending"] = None
        s["steps"] += 1
        kind, x = proposal["kind"], proposal["x"]
        events: List[dict] = []
        entry = None if score is None else {"x": list(x), "score": score, "se": se, "slices": slices}

        if kind == "reeval":
            s["reeval"].pop(0)
            if entry is not None:
                if s["current"] and s["current"]["x"] == x:
                    s["current"] = entry
                for k, e in enumerate(s["best"]):
                    if e["x"] == x:
                        s["best"][k] = dict(entry)
                s["best"].sort(key=lambda e: -e["score"])
            return events

        if kind == "init" or kind == "restart":
            if entry is None:
                if kind == "init":
                    # Random start values may give an invalid warrior: draw again.
                    s["init_tries"] = s.get("init_tries", 0) + 1
                    if all(v is not None for v in s["start"]) or s["init_tries"] >= MAX_INIT_TRIES:
                        raise ValueError("the start values do not give a valid warrior")
                    return events
                s["stall"] = 0
                s["restarts"] += 1
                return events
            s["current"] = entry
            if kind == "restart":
                s["restarts"] += 1
                s["stall"] = 0
                sw_vars = s["sweep"]["vars"]
                s["sweep"] = self._new_sweep(sw_vars)
                s["phase"] = "sweep" if sw_vars else "anneal"
                s["anneal"]["temp"] = 0
                events.append({"type": "restart", "score": score})
        elif entry is None or not complete:
            if kind == "anneal":
                s["anneal"]["temp"] += 1
        elif kind == "sweep":
            sw = s["sweep"]
            ref = sw["best"]["score"] if sw["best"] is not None else s["current"]["score"]
            if score > ref:
                sw["best"] = entry
        elif kind == "anneal":
            a = s["anneal"]
            a["temp"] += 1
            delta = score - s["current"]["score"]
            if delta >= 0 or math.exp(delta * s["opts"]["anneal_scale"] / a["temp"]) > self.rng.random():
                s["current"] = entry
                a["temp"] = 0
                s["accepts"] += 1
                events.append({"type": "accept", "score": score})

        if entry is not None and complete and self._add_best(entry):
            s["since_best"] = 0
            s["stall"] = 0
            events.append({"type": "best", "score": score, "se": se, "x": list(x)})
        else:
            s["since_best"] += 1
            s["stall"] += 1
        return events

    def _add_best(self, entry: dict) -> bool:
        best = self.s["best"]
        top = best[0]["score"] if best else None
        for e in best:
            if e["x"] == entry["x"]:
                return False
        best.append(dict(entry))
        best.sort(key=lambda e: -e["score"])
        del best[self.s["opts"]["keep_best"]:]
        return top is None or entry["score"] > top

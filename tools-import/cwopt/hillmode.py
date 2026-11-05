"""Hill mode (spec §6): the benchmark behaves like a hill and warriors can be pushed off.

``HillState.s`` is a JSON-serialisable dict (members, pinned flags, pairwise
results, archive), written into the checkpoint and into ``hill.json``.
Members are kept as source text, which may later contain template markers.
"""
from __future__ import annotations

import copy
from typing import Callable, Dict, List, Optional, Sequence

from .engine import PairResult, Warrior

# Scores a against each of bs over the hill's schedule: PairResults from a's view.
PairFn = Callable[[Warrior, Sequence[Warrior]], List[PairResult]]


class HillState:
    def __init__(self, members: Sequence[dict], size: int, lineage: int):
        self.s = {"size": int(size), "lineage": int(lineage), "members": [], "pairs": {},
                  "archive": [], "next_id": 1, "challenges": 0}
        for m in members:
            self._add(dict(m))

    @classmethod
    def from_state(cls, state: dict) -> "HillState":
        self = cls.__new__(cls)
        self.s = copy.deepcopy(state)
        return self

    def state(self) -> dict:
        return copy.deepcopy(self.s)

    def _add(self, m: dict) -> dict:
        m.setdefault("pinned", False)
        m.setdefault("origin", "bench")
        m["id"] = self.s["next_id"]
        self.s["next_id"] += 1
        self.s["members"].append(m)
        return m

    @property
    def members(self) -> List[dict]:
        return self.s["members"]

    def benchmark_members(self) -> List[dict]:
        """Members a candidate is scored against: everything not from this run."""
        return [m for m in self.members if m["origin"] != "run"]

    # ------------------------------------------------------------------
    @staticmethod
    def _key(a: str, b: str) -> str:
        return f"{a}|{b}"

    def pair(self, a: str, b: str) -> Optional[PairResult]:
        r = self.s["pairs"].get(self._key(a, b))
        if r is not None:
            return PairResult(*r)
        r = self.s["pairs"].get(self._key(b, a))
        return None if r is None else PairResult(*r).swapped()

    def fill_pairs(self, warriors: Dict[str, Warrior], fn: PairFn, extra: Sequence[str] = ()):
        """Compute every missing pairing among members (and ``extra`` hashes)."""
        hashes = list(dict.fromkeys([m["hash"] for m in self.members] + list(extra)))
        dup = {h for h in hashes if sum(m["hash"] == h for m in self.members) > 1}
        for i, a in enumerate(hashes):
            todo = [b for b in hashes[i + 1:] if self.pair(a, b) is None]
            if a in dup and self.pair(a, a) is None:
                todo.append(a)
            if todo:
                for b, r in zip(todo, fn(warriors[a], [warriors[b] for b in todo])):
                    self.s["pairs"][self._key(a, b)] = r.to_list()

    def scores(self, hashes: Sequence[str]) -> Dict[str, float]:
        """Round robin: each warrior's mean score against all the others."""
        out = {}
        for i, a in enumerate(hashes):
            vals = [self.pair(a, b).score for j, b in enumerate(hashes) if j != i]
            out[a] = sum(vals) / len(vals) if vals else 0.0
        return out

    def standings(self) -> List[dict]:
        hashes = [m["hash"] for m in self.members]
        sc = self.scores(hashes)
        rows = [dict(m, score=sc[m["hash"]]) for m in self.members]
        rows.sort(key=lambda m: (-m["score"], m["id"]))
        for k, r in enumerate(rows, 1):
            r["rank"] = k
            r.pop("source", None)
        return rows

    def prune_pairs(self):
        keep = {m["hash"] for m in self.members}
        self.s["pairs"] = {k: v for k, v in self.s["pairs"].items()
                           if all(h in keep for h in k.split("|"))}

    def trim(self, step: int = 0) -> List[str]:
        """Push off the lowest-ranked unpinned members until the hill has its size."""
        pushed = []
        while len(self.members) > self.s["size"]:
            hashes = [m["hash"] for m in self.members]
            sc = self.scores(hashes)
            unpinned = [m for m in self.members if not m["pinned"]]
            if not unpinned:
                break
            low = min(unpinned, key=lambda m: (sc[m["hash"]], -m["id"]))
            rank = sorted(hashes, key=lambda h: -sc[h]).index(low["hash"]) + 1
            self.members.remove(low)
            self.s["archive"].append(dict(low, left_step=step, left_rank=rank, left_score=sc[low["hash"]]))
            pushed.append(low["name"])
        self.prune_pairs()
        return pushed

    # ------------------------------------------------------------------
    def challenge(self, cand: dict, warriors: Dict[str, Warrior], fn: PairFn, step: int) -> dict:
        """``cand`` = {"name", "source", "hash", "values"}. Returns an event dict."""
        self.s["challenges"] += 1
        h = cand["hash"]
        if any(m["hash"] == h for m in self.members):
            return {"type": "hill", "result": "duplicate", "name": cand["name"]}
        self.fill_pairs(warriors, fn, extra=[h])
        hashes = [m["hash"] for m in self.members] + [h]
        sc = self.scores(hashes)
        order = sorted(range(len(hashes)), key=lambda i: (-sc[hashes[i]], i))
        rank = order.index(len(hashes) - 1) + 1
        size, lineage = self.s["size"], self.s["lineage"]
        ev = {"type": "hill", "name": cand["name"], "rank": rank, "score": sc[h], "step": step,
              "pushed": []}
        if rank > size:
            ev["result"] = "rejected"
            self._drop_pairs_of(h)
            return ev
        relatives = [m for m in self.members if m["origin"] == "run"]
        pushed = []
        if lineage > 0 and len(relatives) >= lineage:
            weakest = max(relatives, key=lambda m: order.index(hashes.index(m["hash"])))
            if order.index(hashes.index(weakest["hash"])) + 1 < rank:
                ev["result"] = "rejected (weaker than own relative)"
                self._drop_pairs_of(h)
                return ev
            pushed.append(weakest)
        elif len(self.members) + 1 > size:
            unpinned = [m for m in self.members if not m["pinned"]]
            if not unpinned:
                ev["result"] = "rejected (all members pinned)"
                self._drop_pairs_of(h)
                return ev
            pushed.append(max(unpinned, key=lambda m: order.index(hashes.index(m["hash"]))))
        for m in pushed:
            self.members.remove(m)
            m = dict(m, left_step=step, left_rank=order.index(hashes.index(m["hash"])) + 1,
                     left_score=sc[m["hash"]])
            self.s["archive"].append(m)
            ev["pushed"].append(m["name"])
        self._add({"name": cand["name"], "source": cand["source"], "hash": h, "pinned": False,
                   "origin": "run", "joined_step": step, "values": cand.get("values")})
        self.prune_pairs()
        ev["result"] = "joined"
        return ev

    def _drop_pairs_of(self, h: str):
        self.s["pairs"] = {k: v for k, v in self.s["pairs"].items() if h not in k.split("|")}

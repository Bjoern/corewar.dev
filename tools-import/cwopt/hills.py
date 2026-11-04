"""Hill presets (``hills.json``) and the ``Hill`` settings object."""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
BUILTIN = os.path.join(HERE, "hills.json")
USER = os.path.join(os.path.expanduser("~"), ".cwopt", "hills.json")


class HillError(Exception):
    pass


@dataclass(frozen=True)
class Hill:
    key: str
    title: str
    coresize: int
    cycles: int
    processes: int
    length: int
    distance: int
    pspace: int          # P-space size; 0 = p-space warriors not allowed on this hill
    rounds: int
    hill_size: Optional[int] = None
    standard: str = "94"
    verified: str = ""
    module: str = "Mars"             # exMARS module, e.g. a hill-specialised build
    module_path: Optional[str] = None

    def mars_args(self):
        return (self.coresize, self.cycles, self.processes, self.length, self.distance)

    @property
    def positions(self) -> int:
        return self.coresize + 1 - 2 * self.distance

    def constants(self) -> Dict[str, int]:
        """Names usable in template expressions, as pMARS predefines them."""
        return {"CORESIZE": self.coresize, "MAXLENGTH": self.length, "MINDISTANCE": self.distance,
                "MAXPROCESSES": self.processes, "MAXCYCLES": self.cycles,
                "PSPACESIZE": self.engine_pspace}

    @property
    def engine_pspace(self) -> int:
        # exMARS fixes the P-space size at CORESIZE/16 (sim.c), like pMARS's default.
        return max(1, self.coresize // 16)

    def problems(self) -> List[str]:
        """Settings this exMARS build cannot simulate. Reported, never worked around."""
        out = []
        if self.standard != "94":
            out.append(f"hill {self.key}: the exMARS bindings have no ICWS '{self.standard} mode "
                       f"(pMARS -8); this preset cannot be run faithfully")
        if self.pspace not in (0, self.engine_pspace):
            out.append(f"hill {self.key}: P-space size {self.pspace} requested, but exMARS always uses "
                       f"CORESIZE/16 = {self.engine_pspace}")
        if 2 * self.distance > self.coresize:
            out.append(f"hill {self.key}: min distance {self.distance} too large for core {self.coresize}")
        if self.length > self.distance:
            out.append(f"hill {self.key}: max length {self.length} exceeds min distance {self.distance}")
        return out

    def check_runnable(self):
        p = self.problems()
        if p:
            raise HillError("; ".join(p))

    def summary(self) -> str:
        ps = f"p-space {self.engine_pspace}" if self.pspace else "no p-space warriors"
        return (f"{self.key}: core {self.coresize}, cycles {self.cycles}, processes {self.processes}, "
                f"length {self.length}, distance {self.distance}, {ps}, rounds {self.rounds}, "
                f"ICWS '{self.standard}" + ("" if self.module == "Mars" else f", engine module {self.module}"))

    def settings(self) -> dict:
        """The fields that change results; stored in run.json and compared on resume."""
        d = asdict(self)
        for k in ("title", "verified", "hill_size", "module_path"):
            d.pop(k)
        return d

    def to_dict(self) -> dict:
        d = asdict(self)
        d["positions"] = self.positions
        d["problems"] = self.problems()
        return d


def _load_file(path: str) -> Dict[str, dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if not k.startswith("_")}


def load_hills(extra: Optional[str] = None) -> Dict[str, Hill]:
    raw = _load_file(BUILTIN)
    for path in (USER, extra):
        if path and os.path.exists(path):
            raw.update(_load_file(path))
    hills = {}
    for key, v in raw.items():
        try:
            hills[key] = Hill(key=key, **v)
        except TypeError as e:
            raise HillError(f"hill preset {key!r}: {e}") from e
    return hills


def get_hill(key: str, extra: Optional[str] = None) -> Hill:
    hills = load_hills(extra)
    if key not in hills:
        raise HillError(f"unknown hill {key!r}; known: {', '.join(sorted(hills))}")
    return hills[key]


def hill_from_dict(d: dict) -> Hill:
    fields = {k: v for k, v in d.items() if k in Hill.__dataclass_fields__}
    fields.setdefault("title", d.get("key", "custom"))
    return Hill(**fields)

"""Benchmark directories: load ``.red`` files, assemble them, report and skip failures."""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from typing import List, Sequence, Tuple

from .engine import Assembler, AssemblyError, Warrior, default_assembler
from .hills import Hill


@dataclass
class BenchWarrior:
    name: str
    path: str
    sha: str
    source: str
    warrior: Warrior
    pinned: bool = False

    def meta(self) -> dict:
        return {"name": self.name, "path": self.path, "sha": self.sha, "pinned": self.pinned}


def read_source(path: str) -> str:
    with open(path, "rb") as f:
        data = f.read()
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def file_sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:16]


def list_red_files(paths: Sequence[str]) -> List[str]:
    out = []
    for p in paths:
        if os.path.isdir(p):
            out.extend(os.path.join(p, f) for f in sorted(os.listdir(p))
                       if f.lower().endswith(".red") and os.path.isfile(os.path.join(p, f)))
        elif os.path.isfile(p):
            out.append(p)
        else:
            raise FileNotFoundError(f"benchmark path not found: {p}")
    return [os.path.abspath(f) for f in out]


def load_bench(hill: Hill, paths: Sequence[str], pinned_paths: Sequence[str] = (),
               assembler: Assembler = None) -> Tuple[List[BenchWarrior], List[str]]:
    """Returns (warriors, problems). Pinned files are included even if not under ``paths``."""
    asm = assembler or default_assembler()
    pinned = set(list_red_files(pinned_paths)) if pinned_paths else set()
    files = list(dict.fromkeys(list_red_files(paths) + sorted(pinned)))
    out, problems = [], []
    for f in files:
        src = read_source(f)
        try:
            w = asm.assemble(hill, src)
        except AssemblyError as e:
            problems.append(f"{os.path.basename(f)}: does not assemble, skipped: "
                            f"{e.message.splitlines()[-1] if e.message else ''}")
            continue
        if w.uses_pspace and not hill.pspace:
            problems.append(f"{os.path.basename(f)}: uses p-space, which hill {hill.key} does not allow")
        out.append(BenchWarrior(os.path.basename(f), f, file_sha(f), src, w, f in pinned))
    return out, problems

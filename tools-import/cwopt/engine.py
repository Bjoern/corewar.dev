"""Engine layer: the only module that touches exMARS (``import Mars``).

Two parts:

* ``Assembler`` assembles Redcode in a long-lived child process.  The pMARS
  parser inside exMARS calls ``exit()`` after too many errors and prints its
  messages to stderr, so assembling untrusted text in-process could kill the
  optimizer or the web server.  The child captures stderr per request and is
  restarted if it dies.
* ``Engine`` runs fights for one hill.  It is used inside worker processes
  (see ``pool.py``); one ``Mars`` object per hill and process, never shared
  between threads.

Warriors cross process boundaries as ``Warrior`` tuples of plain integers,
so the rest of the code never sees exMARS objects.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import multiprocessing
import os
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from typing import Optional, Sequence, Tuple

from .hills import Hill

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_EXMARS = os.path.normpath(os.path.join(HERE, "..", "..", "exMARS"))

OPCODES = ["DAT", "SPL", "MOV", "DJN", "ADD", "JMZ", "SUB", "SEQ", "SNE", "SLT",
           "JMN", "JMP", "NOP", "MUL", "MOD", "DIV", "LDP", "STP"]
MODIFIERS = ["F", "A", "B", "AB", "BA", "X", "I"]
MODES = ["$", "#", "@", "<", ">", "*", "{", "}"]
PSPACE_OPCODES = {OPCODES.index("LDP"), OPCODES.index("STP")}


class AssemblyError(Exception):
    """The assembler rejected a source text; ``message`` holds its output."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class Warrior:
    """An assembled warrior: instructions as 6-int tuples (opcode, modifier,
    A-mode, A-value, B-mode, B-value), indices as in exMARS's ``Warrior.py``."""
    insns: Tuple[Tuple[int, int, int, int, int, int], ...]
    start: int
    pin: Optional[int] = None
    name: str = "Unknown"
    author: str = "Anonymous"
    warnings: Tuple[str, ...] = field(default=(), compare=False)

    @property
    def hash(self) -> str:
        return code_hash(self)

    @property
    def uses_pspace(self) -> bool:
        return any(i[0] in PSPACE_OPCODES for i in self.insns)

    def listing(self, coresize: int) -> str:
        lines = []
        for k, (op, mod, am, av, bm, bv) in enumerate(self.insns):
            av = av - coresize if av > coresize // 2 else av
            bv = bv - coresize if bv > coresize // 2 else bv
            mark = "START" if k == self.start else ""
            lines.append(f"{mark:<6s}{OPCODES[op]}.{MODIFIERS[mod]:<2s} {MODES[am]}{av:>6d}, {MODES[bm]}{bv:>6d}")
        return "\n".join(lines)


def code_hash(w: Warrior) -> str:
    """Hash of the assembled instructions, start offset and PIN (not the name)."""
    payload = json.dumps([w.insns, w.start, w.pin], separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


@dataclass(frozen=True)
class PairResult:
    """Result of one pairing from the first warrior's point of view."""
    wins: int
    ties: int
    losses: int

    @property
    def rounds(self) -> int:
        return self.wins + self.ties + self.losses

    @property
    def score(self) -> float:
        """(3W + T) / rounds * 100, i.e. 0..300."""
        return 100.0 * (3 * self.wins + self.ties) / self.rounds if self.rounds else 0.0

    def __add__(self, other: "PairResult") -> "PairResult":
        return PairResult(self.wins + other.wins, self.ties + other.ties, self.losses + other.losses)

    def swapped(self) -> "PairResult":
        return PairResult(self.losses, self.ties, self.wins)

    def to_list(self):
        return [self.wins, self.ties, self.losses]


# --------------------------------------------------------------------------
# Locating and importing exMARS

def exmars_path() -> str:
    return os.environ.get("CWOPT_EXMARS", DEFAULT_EXMARS)


def import_mars(module: str = "Mars", path: Optional[str] = None):
    path = path or exmars_path()
    if path not in sys.path:
        sys.path.insert(0, path)
    try:
        return importlib.import_module(module)
    except ImportError as e:
        raise RuntimeError(
            f"cannot import exMARS module {module!r} from {path} ({e}). Build the Python "
            f"extension in the exMARS checkout or set CWOPT_EXMARS to its directory.") from e


_version_cache = {}


def engine_version(module: str = "Mars", path: Optional[str] = None) -> str:
    """Identifies the simulator build: hash of the extension module file."""
    key = (module, path or exmars_path())
    if key not in _version_cache:
        mod = import_mars(module, path)
        with open(mod.__file__, "rb") as f:
            _version_cache[key] = f"{module}-{hashlib.sha256(f.read()).hexdigest()[:12]}"
    return _version_cache[key]


# --------------------------------------------------------------------------
# Assembly in a child process

def _assembler_main(conn, path: str, capture: str) -> None:  # runs in the child
    import ctypes
    import signal
    signal.signal(signal.SIGINT, signal.SIG_IGN)   # Ctrl-C is handled by the parent
    sys.path.insert(0, path)
    marses = {}
    libc = ctypes.CDLL(None)
    while True:
        try:
            req = conn.recv()
        except EOFError:
            return
        module, settings, source = req
        try:
            key = (module, settings)
            if key not in marses:
                marses[key] = importlib.import_module(module).Mars(2, *settings)
            m = marses[key]
            fd = os.open(capture, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            saved = os.dup(2)
            os.dup2(fd, 2)
            os.close(fd)
            try:
                w = m.parse_string(source)
                err = None
            except ValueError as e:
                w, err = None, str(e)
            finally:
                libc.fflush(None)
                os.dup2(saved, 2)
                os.close(saved)
            with open(capture, encoding="utf-8", errors="replace") as f:
                output = f.read()
            if w is None:
                conn.send(("error", output.strip() or err))
                continue
            insns = tuple(tuple(i.data) for i in w.instructions)
            conn.send(("ok", insns, w.startPos, w.pin, w.name, w.authorName, output.strip()))
        except Exception as e:  # report, keep serving
            conn.send(("error", f"{type(e).__name__}: {e}"))


class Assembler:
    """Assembles source text with exMARS's pMARS parser in a child process."""

    def __init__(self, path: Optional[str] = None):
        self.path = path or exmars_path()
        self._lock = threading.Lock()
        self._proc = None
        self._conn = None
        self._capture = os.path.join(tempfile.mkdtemp(prefix="cwopt-asm-"), "stderr.txt")
        self._cache = {}

    def _start(self):
        ctx = multiprocessing.get_context("spawn")
        parent, child = ctx.Pipe()
        self._proc = ctx.Process(target=_assembler_main, args=(child, self.path, self._capture), daemon=True)
        self._proc.start()
        child.close()
        self._conn = parent

    def close(self):
        with self._lock:
            if self._proc is not None:
                self._conn.close()
                self._proc.join(2)
                if self._proc.is_alive():
                    self._proc.kill()
                self._proc = None

    def assemble(self, hill: Hill, source: str) -> Warrior:
        settings = hill.mars_args()
        key = (hill.module, settings, source)
        hit = self._cache.get(key)
        if hit is not None:
            if isinstance(hit, AssemblyError):
                raise hit
            return hit
        if "\0" in source:
            raise AssemblyError("source contains a NUL character")
        with self._lock:
            if self._proc is None or not self._proc.is_alive():
                self._start()
            try:
                self._conn.send((hill.module, settings, source))
                reply = self._conn.recv()
            except (EOFError, OSError, BrokenPipeError):
                # The parser exited (too many errors). Its stderr is in the capture file.
                self._proc.join(2)
                self._proc = None
                try:
                    with open(self._capture, encoding="utf-8", errors="replace") as f:
                        reply = ("error", f.read().strip() or "assembler process died")
                except OSError:
                    reply = ("error", "assembler process died")
        if reply[0] == "error":
            result = AssemblyError(_clean_messages(reply[1]))
        else:
            _, insns, start, pin, name, author, output = reply
            if not insns:
                result = AssemblyError("warrior has no instructions")
            else:
                warnings = tuple(l for l in _clean_messages(output).splitlines() if l.strip())
                result = Warrior(insns, start, pin, name, author, warnings)
        if len(self._cache) > 20000:
            self._cache.clear()
        self._cache[key] = result
        if isinstance(result, AssemblyError):
            raise result
        return result


def _clean_messages(text: str) -> str:
    lines = [l.rstrip() for l in (text or "").splitlines()]
    return "\n".join(l for l in lines if l.strip())


_default_assembler = None
_default_lock = threading.Lock()


def default_assembler() -> Assembler:
    global _default_assembler
    with _default_lock:
        if _default_assembler is None:
            _default_assembler = Assembler()
        return _default_assembler


# --------------------------------------------------------------------------
# Fighting

class _MI:
    __slots__ = ("data",)

    def __init__(self, data):
        self.data = list(data)


class _MW:
    __slots__ = ("instructions", "startPos", "pin")

    def __init__(self, w: Warrior):
        self.instructions = [_MI(i) for i in w.insns]
        self.startPos = w.start
        self.pin = w.pin


class Engine:
    """Runs fights for one hill. Not thread-safe: one instance per thread/process."""

    def __init__(self, hill: Hill):
        self.hill = hill
        mod = import_mars(hill.module, hill.module_path)
        self.mars = mod.Mars(2, *hill.mars_args())
        assert self.mars.early_exit  # safe early exit is on by default and keeps results
        self._objs = {}

    # Assembly goes through the child-process assembler; see Assembler.
    def assemble(self, source: str) -> Warrior:
        return default_assembler().assemble(self.hill, source)

    @staticmethod
    def code_hash(w: Warrior) -> str:
        return code_hash(w)

    def _obj(self, w: Warrior):
        h = w.hash
        o = self._objs.get(h)
        if o is None:
            if len(self._objs) > 5000:
                self._objs.clear()
            o = self._objs[h] = _MW(w)
        return o

    def positions(self) -> range:
        """Legal offsets of warrior 2 relative to warrior 1."""
        h = self.hill
        return range(h.distance, h.coresize - h.distance + 1)

    def exact_pair(self, a: Warrior, b: Warrior) -> PairResult:
        """Every legal relative position, both starting orders, one round each."""
        m, c = self.mars, self.hill.coresize
        A, B = self._obj(a), self._obj(b)
        m.rounds = 1
        w = t = l = 0
        for p in self.positions():
            m.fixed_position = p           # a at 0 starts, b at p
            m.fight(A, B)
            w += m.wins(0, 1); t += m.wins(0, 2); l += m.losses(0)
            m.fixed_position = (c - p) % c  # b at 0 starts, a at c-p: same relative placement
            m.fight(B, A)
            w += m.wins(1, 1); t += m.wins(1, 2); l += m.losses(1)
        return PairResult(w, t, l)

    def sampled_pair(self, a: Warrior, b: Warrior, seed: int, rounds: int) -> PairResult:
        """``rounds`` rounds with placements seeded by ``seed`` (pMARS -F)."""
        m = self.mars
        m.rounds = rounds
        m.fixed_position = seed
        m.fight(self._obj(a), self._obj(b))
        return PairResult(m.wins(0, 1), m.wins(0, 2), m.losses(0))

    def single(self, a: Warrior, b: Warrior, position: int) -> PairResult:
        """One round, ``a`` at 0 starts, ``b`` at ``position`` (for tests)."""
        m = self.mars
        m.rounds = 1
        m.fixed_position = position
        m.fight(self._obj(a), self._obj(b))
        return PairResult(m.wins(0, 1), m.wins(0, 2), m.losses(0))

    def run_unit(self, a: Warrior, b: Warrior, unit: Sequence) -> PairResult:
        """``unit`` is ("exact",) or ("sampled", seed, rounds)."""
        if unit[0] == "exact":
            return self.exact_pair(a, b)
        return self.sampled_pair(a, b, unit[1], unit[2])

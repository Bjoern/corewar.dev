"""Template language (spec §1): Redcode with ``!`` markers for values to optimise.

    marker  := "!" [domain] {filter} [":" value]
    domain  := "(" expr ".." expr ["," expr] ")" | "[" token {"," token} "]"
    filter  := "?" ("coprime" | "odd" | "even")

Text after ``;`` is ignored and ``!=`` is pMARS's not-equal operator, never a marker.
A ``Template`` knows nothing about search: it maps an index vector (one index per
variable into its value list) to source text.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

FILTERS = ("coprime", "odd", "even")
OPCODE_TOKENS = {"dat", "spl", "mov", "djn", "add", "jmz", "sub", "seq", "sne", "slt", "jmn",
                 "jmp", "nop", "mul", "mod", "div", "ldp", "stp", "cmp"}
MODIFIER_TOKENS = {"a", "b", "ab", "ba", "f", "x", "i"}
MODE_CHARS = set("#$@<>*{}")
_EQU_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:?\s+equ\b", re.IGNORECASE)
_INT_RE = re.compile(r"[+-]?\d+")
_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


class TemplateError(Exception):
    def __init__(self, message: str, line: int = 0, col: int = 0):
        self.message, self.line, self.col = message, line, col
        super().__init__(f"line {line}, column {col}: {message}" if line else message)

    def to_dict(self):
        return {"message": self.message, "line": self.line, "col": self.col}


@dataclass
class Variable:
    name: str
    line: int                 # 1-based
    col: int                  # 1-based column of the "!"
    end: int                  # 0-based column after the marker text (exclusive)
    spec: str                 # marker text without the start value, e.g. "!(1..79)?coprime"
    values: List[str]         # rendered values in domain order
    numeric: bool
    start: Optional[int] = None   # index into values
    on_equ: bool = False
    _index: Dict[str, int] = field(default_factory=dict, repr=False)

    @property
    def size(self) -> int:
        return len(self.values)

    def index_of(self, value, coresize: int) -> Optional[int]:
        if not self._index:
            for i, v in enumerate(self.values):
                self._index[_norm_key(v, coresize, self.numeric)] = i
        return self._index.get(_norm_key(str(value), coresize, self.numeric))

    def to_dict(self):
        return {"name": self.name, "line": self.line, "col": self.col, "spec": self.spec,
                "size": self.size, "numeric": self.numeric,
                "start": None if self.start is None else self.values[self.start],
                "first": self.values[:5], "last": self.values[-3:] if self.size > 5 else []}


def _norm_key(v: str, coresize: int, numeric: bool) -> str:
    if _INT_RE.fullmatch(v.strip()):
        return f"#n{int(v) % coresize}"
    return v.strip().lower()


def signed(v: int, coresize: int) -> int:
    """Smallest absolute form: -floor(C/2) .. ceil(C/2)-1."""
    r = v % coresize
    half = coresize // 2
    return r - coresize if r >= coresize - half else r


# --------------------------------------------------------------------------
# Expressions: integers, + - * / % and parentheses, hill constants

class _Expr:
    def __init__(self, text: str, names: Dict[str, int], line: int, col: int):
        self.toks = re.findall(r"\d+|[A-Za-z_][A-Za-z0-9_]*|[-+*/%()]|\S", text)
        self.i, self.names, self.text, self.line, self.col = 0, names, text, line, col

    def err(self, msg):
        raise TemplateError(f"{msg} in expression {self.text.strip()!r}", self.line, self.col)

    def parse(self) -> int:
        if not self.toks:
            self.err("empty expression")
        v = self.add()
        if self.i != len(self.toks):
            self.err(f"unexpected {self.toks[self.i]!r}")
        return v

    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else None

    def add(self):
        v = self.mul()
        while self.peek() in ("+", "-"):
            op = self.toks[self.i]; self.i += 1
            r = self.mul()
            v = v + r if op == "+" else v - r
        return v

    def mul(self):
        v = self.unary()
        while self.peek() in ("*", "/", "%"):
            op = self.toks[self.i]; self.i += 1
            r = self.unary()
            if op == "*":
                v *= r
            else:
                if r == 0:
                    self.err("division by zero")
                q = abs(v) // abs(r) * (1 if (v >= 0) == (r >= 0) else -1)  # C semantics
                v = q if op == "/" else v - q * r
        return v

    def unary(self):
        t = self.peek()
        if t in ("-", "+"):
            self.i += 1
            v = self.unary()
            return -v if t == "-" else v
        if t == "(":
            self.i += 1
            v = self.add()
            if self.peek() != ")":
                self.err("missing ')'")
            self.i += 1
            return v
        if t is None:
            self.err("unexpected end")
        self.i += 1
        if t.isdigit():
            return int(t)
        if t.upper() in self.names:
            return self.names[t.upper()]
        self.err(f"unknown name {t!r}")


# --------------------------------------------------------------------------

@dataclass
class Template:
    text: str
    lines: List[str]
    variables: List[Variable]
    coresize: int

    def search_space(self) -> float:
        return math.prod(v.size for v in self.variables) if self.variables else 1

    def start_indices(self) -> List[Optional[int]]:
        return [v.start for v in self.variables]

    def _substitute(self, idx: Sequence[int], write_back: bool) -> str:
        if len(idx) != len(self.variables):
            raise ValueError("wrong number of values")
        by_line: Dict[int, List] = {}
        for var, i in zip(self.variables, idx):
            by_line.setdefault(var.line, []).append((var, i))
        out = []
        for n, line in enumerate(self.lines, 1):
            subs = by_line.get(n)
            if subs:
                for var, i in sorted(subs, key=lambda s: -s[0].col):
                    value = var.values[i]
                    if write_back:
                        rep = f"{var.spec}:{value}"
                    else:
                        rep = value
                        before = line[:var.col - 1].rstrip()
                        if value.startswith("-") and before and before[-1] in "+-*/%":
                            rep = f"({value})"
                    line = line[:var.col - 1] + rep + line[var.end:]
            out.append(line)
        return "".join(out)

    def render_segments(self, idx: Sequence[int]) -> List[dict]:
        """Rendered text split into plain runs and substituted values (for highlighting)."""
        by_line: Dict[int, List] = {}
        for var, i in zip(self.variables, idx):
            by_line.setdefault(var.line, []).append((var, i))
        segs: List[dict] = []
        buf = ""
        for n, line in enumerate(self.lines, 1):
            pos = 0
            for var, i in sorted(by_line.get(n, []), key=lambda s: s[0].col):
                buf += line[pos:var.col - 1]
                segs.append({"text": buf})
                buf = ""
                segs.append({"text": var.values[i], "var": var.name})
                pos = var.end
            buf += line[pos:]
        segs.append({"text": buf})
        return [s for s in segs if s["text"] or "var" in s]

    def render(self, idx: Sequence[int]) -> str:
        """Plain Redcode with every marker replaced by its value."""
        return self._substitute(idx, write_back=False)

    def write_back(self, idx: Sequence[int]) -> str:
        """The template again, every marker carrying ``:value`` as its start value."""
        return self._substitute(idx, write_back=True)

    def values(self, idx: Sequence[int]) -> Dict[str, str]:
        return {v.name: v.values[i] for v, i in zip(self.variables, idx)}

    def indices_from_values(self, values: Dict[str, str]) -> List[Optional[int]]:
        return [v.index_of(values[v.name], self.coresize) if v.name in values else None
                for v in self.variables]

    def uses_pspace(self) -> bool:
        """True if the template (or any opcode choice) contains LDP/STP."""
        code = "\n".join(l.split(";", 1)[0] for l in self.lines).lower()
        return bool(re.search(r"\b(ldp|stp)\b", code))


def parse_template(text: str, constants: Dict[str, int]) -> Template:
    coresize = constants["CORESIZE"]
    lines = text.splitlines(keepends=True)
    variables: List[Variable] = []
    names_seen: Dict[str, int] = {}
    for ln, raw in enumerate(lines, 1):
        code = raw.split(";", 1)[0]
        m = _EQU_RE.match(code)
        equ_label = m.group(1) if m else None
        k = 0
        shift = 0   # length of earlier start values on this line: names ignore them
        while True:
            k = code.find("!", k)
            if k < 0:
                break
            if k + 1 < len(code) and code[k + 1] == "=":
                k += 2
                continue
            var = _parse_marker(code, k, ln, constants)
            var.name = f"{ln}:{var.col - shift}"
            shift += var.end - k - len(var.spec)
            if equ_label:
                base = equ_label
                count = names_seen.get(base, 0) + 1
                names_seen[base] = count
                var.name = base if count == 1 else f"{base}#{count}"
                var.on_equ = True
            variables.append(var)
            k = var.end
    return Template(text, lines, variables, coresize)


def _parse_marker(code: str, k: int, ln: int, constants: Dict[str, int]) -> Variable:
    coresize = constants["CORESIZE"]
    col = k + 1
    i = k + 1
    n = len(code)

    def err(msg, at=None):
        raise TemplateError(msg, ln, (at if at is not None else i) + 1)

    numeric = True
    if i < n and code[i] == "(":
        close = _matching(code, i, "(", ")")
        if close < 0:
            err("missing ')' in marker", k)
        inner = code[i + 1:close]
        if ".." not in inner:
            err("range needs 'a..b'", i)
        lo_txt, rest = inner.split("..", 1)
        parts = _split_top(rest, ",")
        if len(parts) > 2:
            err("range takes at most a step: (a..b, s)", i)
        lo = _Expr(lo_txt, constants, ln, i + 2).parse()
        hi = _Expr(parts[0], constants, ln, i + 2).parse()
        step = _Expr(parts[1], constants, ln, i + 2).parse() if len(parts) == 2 else 1
        if step <= 0:
            err("step must be positive", i)
        if hi < lo:
            err(f"empty range {lo}..{hi}", i)
        if (hi - lo) // step + 1 > coresize:
            err(f"range {lo}..{hi} is wider than the core ({coresize})", i)
        raw_vals = [str(v) for v in range(lo, hi + 1, step)]
        i = close + 1
    elif i < n and code[i] == "[":
        close = code.find("]", i)
        if close < 0:
            err("missing ']' in marker", k)
        toks = [t.strip() for t in code[i + 1:close].split(",")]
        if not toks or any(not t for t in toks):
            err("empty token in list", i)
        for t in toks:
            if not (_INT_RE.fullmatch(t) or t in MODE_CHARS or t.lower() in OPCODE_TOKENS
                    or t.lower() in MODIFIER_TOKENS or _IDENT_RE.fullmatch(t)):
                err(f"bad token {t!r} in list", i)
        numeric = all(_INT_RE.fullmatch(t) for t in toks)
        raw_vals = toks
        i = close + 1
    else:
        lo = -(coresize // 2)
        raw_vals = [str(v) for v in range(lo, lo + coresize)]

    filters = []
    while i < n and code[i] == "?":
        m = _IDENT_RE.match(code, i + 1)
        if not m or m.group(0).lower() not in FILTERS:
            err("unknown filter; use ?coprime, ?odd or ?even")
        filters.append(m.group(0).lower())
        i = m.end()
    spec = code[k:i]

    start_txt = None
    if i < n and code[i] == ":":
        j = i + 1
        m = _INT_RE.match(code, j) or _IDENT_RE.match(code, j)
        if m:
            start_txt, i = m.group(0), m.end()
        elif j < n and code[j] in MODE_CHARS:
            start_txt, i = code[j], j + 1
        else:
            err("missing start value after ':'")

    # Render values: numbers signed in their smallest absolute form.
    values, seen = [], set()
    for v in raw_vals:
        if _INT_RE.fullmatch(v):
            iv = int(v)
            if filters:
                r = iv % coresize
                if "odd" in filters and iv % 2 == 0:
                    continue
                if "even" in filters and iv % 2 != 0:
                    continue
                if "coprime" in filters and math.gcd(r, coresize) != 1:
                    continue
            key = iv % coresize
            if key in seen:
                raise TemplateError(f"values {v} and another value are equal mod CORESIZE "
                                    f"({coresize})", ln, col)
            seen.add(key)
            values.append(str(signed(iv, coresize)))
        else:
            if filters:
                raise TemplateError("filters apply to numbers only", ln, col)
            if v.lower() in seen:
                raise TemplateError(f"duplicate token {v!r}", ln, col)
            seen.add(v.lower())
            values.append(v)
    if not values:
        raise TemplateError("no values left after filtering", ln, col)

    var = Variable(name=f"{ln}:{col}", line=ln, col=col, end=i, spec=spec, values=values, numeric=numeric)
    if start_txt is not None:
        idx = var.index_of(start_txt, coresize)
        if idx is None:
            raise TemplateError(f"start value {start_txt} is not in the domain", ln, col)
        var.start = idx
    return var


def _matching(s: str, i: int, open_c: str, close_c: str) -> int:
    depth = 0
    for j in range(i, len(s)):
        if s[j] == open_c:
            depth += 1
        elif s[j] == close_c:
            depth -= 1
            if depth == 0:
                return j
    return -1


def _split_top(s: str, sep: str) -> List[str]:
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts

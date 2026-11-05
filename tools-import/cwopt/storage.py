"""Storage for one run, passed into the core as an interface (spec §13), so a
browser build can keep runs in IndexedDB or a downloadable file instead."""
from __future__ import annotations

import json
import os
import tempfile
from typing import List, Optional


class Storage:
    """Interface. Names are flat file names such as ``state.json``."""

    def read_text(self, name: str) -> Optional[str]: ...
    def write_text(self, name: str, text: str) -> None: ...   # must be atomic
    def append_line(self, name: str, line: str) -> None: ...
    def truncate_lines(self, name: str, count: int) -> None: ...
    def exists(self, name: str) -> bool: ...
    def remove(self, name: str) -> None: ...

    def read_json(self, name: str):
        t = self.read_text(name)
        return None if t is None else json.loads(t)

    def write_json(self, name: str, data) -> None:
        self.write_text(name, json.dumps(data, indent=1, sort_keys=False))

    def read_lines(self, name: str) -> List[str]:
        t = self.read_text(name)
        return [] if not t else [l for l in t.splitlines() if l.strip()]


class DirStorage(Storage):
    def __init__(self, root: str):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def path(self, name: str) -> str:
        return os.path.join(self.root, name)

    def read_text(self, name):
        try:
            with open(self.path(name), encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return None

    def write_text(self, name, text):
        """Temporary file in the same directory, flush, fsync, rename over the target."""
        fd, tmp = tempfile.mkstemp(prefix=f".{name}.", dir=self.root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(text)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path(name))
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def append_line(self, name, line):
        with open(self.path(name), "a", encoding="utf-8") as f:
            f.write(line.rstrip("\n") + "\n")
            f.flush()

    def truncate_lines(self, name, count):
        lines = self.read_lines(name)
        if len(lines) > count:
            self.write_text(name, "".join(l + "\n" for l in lines[:count]))

    def exists(self, name):
        return os.path.exists(self.path(name))

    def remove(self, name):
        try:
            os.unlink(self.path(name))
        except FileNotFoundError:
            pass


class MemoryStorage(Storage):
    def __init__(self):
        self.files = {}

    def read_text(self, name):
        return self.files.get(name)

    def write_text(self, name, text):
        self.files[name] = text

    def append_line(self, name, line):
        self.files[name] = self.files.get(name, "") + line.rstrip("\n") + "\n"

    def truncate_lines(self, name, count):
        lines = self.read_lines(name)[:count]
        self.files[name] = "".join(l + "\n" for l in lines)

    def exists(self, name):
        return name in self.files

    def remove(self, name):
        self.files.pop(name, None)

"""Package descriptor-based benchmark collections without changing their sources."""
from pathlib import Path
import json

def catalog(root):
    folder = root / "warrior_public"
    result = []
    if not folder.exists():
        return result
    for path in sorted(folder.rglob("*.benchmark.json")):
        descriptor = json.loads(path.read_text(encoding="utf-8-sig"))
        if descriptor.get("version") != 1 or not isinstance(descriptor.get("name"), str):
            raise ValueError(f"Invalid descriptor: {path}")
        paths = descriptor.get("warriors")
        if not isinstance(paths, list) or not 1 <= len(paths) <= 500 or len(set(paths)) != len(paths):
            raise ValueError(f"Invalid warrior list: {path}")
        files = {}
        for name in paths:
            if not isinstance(name, str) or not name or "\\" in name or ":" in name or any(p in ("", ".", "..") for p in name.split("/")):
                raise ValueError(f"Invalid warrior path in {path}: {name}")
            source = (path.parent / name).resolve()
            if not source.is_relative_to(path.parent.resolve()):
                raise ValueError(f"Warrior outside suite: {source}")
            if source.stat().st_size > 65536:
                raise ValueError(f"Warrior exceeds 64 KiB: {source}")
            raw = source.read_bytes()
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("cp1252")
            files[name] = text
        result.append({"id": "public-"+path.relative_to(folder).as_posix(), "descriptor": descriptor, "files": files})
    return result

"""Package descriptor-based benchmark collections without changing their sources."""
from pathlib import Path
import json

def catalog(root):
    folder = root / "warriors_public"
    result = []
    if not folder.exists():
        return result
    for path in sorted(folder.rglob("*.benchmark.json")):
        descriptor = json.loads(path.read_text(encoding="utf-8-sig"))
        if descriptor.get("version") != 1 or not isinstance(descriptor.get("name"), str):
            raise ValueError(f"Invalid descriptor: {path}")
        # "listed": false keeps a suite in the repository (e.g. a full hill that a top-N suite
        # is derived from) without offering it in the app.
        if descriptor.get("listed", True) is False:
            continue
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
        entry = {"id": "public-"+path.relative_to(folder).as_posix(), "descriptor": descriptor, "files": files}
        # Optional precomputed hill scores (docs/hill-scores.mjs validates them in the app).
        scores = descriptor.get("scores")
        if scores is not None:
            if not isinstance(scores, str) or not scores.endswith(".json") or "\\" in scores or ":" in scores or any(p in ("", ".", "..") for p in scores.split("/")):
                raise ValueError(f"Invalid scores path in {path}: {scores}")
            entry["scores"] = json.loads((path.parent / scores).read_text(encoding="utf-8-sig"))
        result.append(entry)
    # Standard '94 suites first, then '88, then small-core/other formats.
    # Preserve the existing order within each group.
    def group(entry):
        parameters = entry["descriptor"].get("parameters", {})
        if parameters.get("rules88", False):
            return 1
        return 0 if parameters.get("coreSize", 8000) == 8000 else 2

    return sorted(result, key=group)

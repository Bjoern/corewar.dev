"""Build the warrior library index from Koenigstuhl snapshots in koenigstuhl/<hill>/.

Each hill directory holds the unpacked archive (HILL32/*.red) and the saved ranking pages:
<hill>_recursive.html, <hill>_battle_royal.html and optionally <hill>_top50.html.
"""
from pathlib import Path
import html
import re

# One ranking row: "   1 <a href=".../HILL32/arvon.red">Arvon</a>   Stefan Kammann   161.444 (94)"
ROW = re.compile(r'^\s*(\d+)\s+<a href="([^"]+)">(.*?)</a>\s*(.*?)\s+(-?\d+(?:\.\d+)?)\s+\(([^)]*)\)\s*$')
RANKINGS = {"recursive": "rec", "battle_royal": "br", "top50": "top50"}
# Header comments worth searching. Strategy lines are kept in order; the others keep their first value.
HEADER = re.compile(r"^\s*;\s*(name|author|strategy|assert|redcode[\w-]*)\b[ \t:]*(.*)$", re.IGNORECASE)

# Match settings of each hill as published on https://asdflkj.net/COREWAR/koenigstuhl.html (pMARS options),
# used for benchmarks built from the library. Odd mixes special rule sets; its options are the page's default.
OPTIONS = {
    "88": "-8 -r 1000",
    "94nop": "-r 1000",
    "pspace": "-r 1000",
    "icws64": "-r 1000 -8 -s 8192 -p 64",
    "icws": "-r 1000 -8 -s 8192 -p 8000 -c 100000",
    "lp": "-r 1000 -p 8 -l 200 -d 200",
    "x": "-r 1000 -s 55440 -c 500000 -p 10000 -l 200 -d 200",
    "tiny": "-P -s 800 -c 8000 -l 20 -d 20 -p 800",
    "nano": "-P -s 80 -c 800 -l 5 -d 5 -p 80",
    "odd": "-r 100 -l 800 -d 800",
}
# Hills that only accept warriors without P-space instructions.
NO_PSPACE = {"94nop"}


def parameters(hill):
    """Benchmark parameters (see docs/benchmarks.mjs) for a hill's pMARS options, or None if unknown."""
    if hill not in OPTIONS:
        return None
    values = {"coreSize": 8000, "cycles": 80000, "tasks": 8000, "maxLength": 100, "distance": 0}
    flags = {"-s": "coreSize", "-c": "cycles", "-p": "tasks", "-l": "maxLength", "-d": "distance", "-r": "rounds"}
    words = OPTIONS[hill].split()
    result = {"rules88": "-8" in words, "noPspace": hill in NO_PSPACE, "permutate": "-P" in words}
    for flag, value in zip(words, words[1:]):
        if flag in flags:
            values[flags[flag]] = int(value)
    values["distance"] = values["distance"] or values["maxLength"]
    if result["permutate"]:
        # -P plays every starting position once: two warriors, each first in turn.
        values["rounds"] = 2 * (values["coreSize"] - 2 * values["distance"] + 1)
    return {**values, **result}


def read_text(path):
    data = path.read_bytes()
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def rankings(page):
    """Map warrior file name to (rank, score, url, name, author) for one saved ranking page."""
    rows = {}
    for line in read_text(page).splitlines():
        m = ROW.match(line)
        if m:
            url = m[2]
            rows[url.rsplit("/", 1)[-1]] = (int(m[1]), float(m[5]), url, html.unescape(m[3]).strip(), html.unescape(m[4]).strip())
    if not rows:
        raise SystemExit("No ranking rows found in " + str(page))
    return rows


def header(source):
    fields = {"strategy": []}
    for line in source.splitlines():
        m = HEADER.match(line)
        if not m:
            continue
        key, value = m[1].lower(), m[2].strip()
        if key == "strategy":
            fields["strategy"].append(value)
        elif key.startswith("redcode"):
            fields.setdefault("redcode", line.strip().lstrip(";").strip())
        else:
            fields.setdefault(key, value)
    return fields


def hill(directory):
    """Return the index entry for one hill and the warrior files to publish with it."""
    name = directory.name
    archive = directory / "HILL32"
    if not archive.is_dir():
        raise SystemExit("Missing warrior archive " + str(archive))
    ranks = {}
    for page, key in RANKINGS.items():
        path = directory / f"{name}_{page}.html"
        if path.exists():
            ranks[key] = rankings(path)
    if "rec" not in ranks:
        raise SystemExit("Missing recursive ranking page for hill " + name)
    files = sorted(p for p in archive.iterdir() if p.is_file() and p.suffix.lower() == ".red")
    warriors = []
    for path in files:
        fields = header(read_text(path))
        listed = ranks["rec"].get(path.name)
        # The file's own header wins; the ranking page fills in a missing name or author.
        entry = {"file": path.name,
                 "name": fields.get("name") or (listed and listed[3]) or path.stem,
                 "author": fields.get("author") or (listed and listed[4]) or ""}
        if fields["strategy"]:
            entry["strategy"] = "\n".join(fields["strategy"]).strip()
        for key, table in ranks.items():
            if path.name in table:
                entry[key] = list(table[path.name][:2])
        warriors.append(entry)
    missing = [f for f in ranks["rec"] if not (archive / f).is_file()]
    if missing:
        raise SystemExit(f"Hill {name}: ranked warriors missing from HILL32: {', '.join(missing[:5])}")
    warriors.sort(key=lambda w: (w.get("rec", [10**9])[0], w["name"].lower()))
    # Koenigstuhl serves each warrior next to the others; keep that folder to link to the originals.
    folders = {row[2].rsplit("/", 1)[0] for row in ranks["rec"].values()}
    # SNAPSHOT holds the download date (YYYY-MM-DD); the ranking pages themselves carry none.
    stamp = directory / "SNAPSHOT"
    updated = stamp.read_text(encoding="utf-8").strip() if stamp.exists() else ""
    if updated and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", updated):
        raise SystemExit(f"Hill {name}: SNAPSHOT must hold a date like 2026-11-04, not {updated!r}")
    meta = {"id": name, "label": name, "count": len(warriors), "rankings": sorted(ranks), "updated": updated,
            "origin": folders.pop() + "/" if len(folders) == 1 else ""}
    if name in OPTIONS:
        meta["options"] = OPTIONS[name]
        meta["parameters"] = parameters(name)
    return meta, warriors, files


def library(root):
    base = root / "koenigstuhl"
    if not base.is_dir():
        return []
    return [hill(d) for d in sorted(base.iterdir()) if d.is_dir()]

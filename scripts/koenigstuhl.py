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
    meta = {"id": name, "label": name, "count": len(warriors), "rankings": sorted(ranks),
            "origin": folders.pop() + "/" if len(folders) == 1 else ""}
    return meta, warriors, files


def library(root):
    base = root / "koenigstuhl"
    if not base.is_dir():
        return []
    return [hill(d) for d in sorted(base.iterdir()) if d.is_dir()]

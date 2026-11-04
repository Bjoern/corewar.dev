"""Download every Koenigstuhl hill into koenigstuhl/<hill>/ for the warrior library.

Reads the Koenigstuhl index page, then for each hill fetches the ranking pages and the
warriors and writes the layout scripts/koenigstuhl.py expects:

    koenigstuhl/<hill>/HILL32/*.red
    koenigstuhl/<hill>/<hill>_recursive.html     (hill32_rec.html, or the flat hill32.html)
    koenigstuhl/<hill>/<hill>_battle_royal.html  (hill32_iter.html, when listed)
    koenigstuhl/<hill>/<hill>_top50.html         (TOP50/hill32.html, when listed)
    koenigstuhl/<hill>/SNAPSHOT                  (download date, YYYY-MM-DD)
    koenigstuhl/<hill>/RENAMED                   (renamed warriors, when any)

A hill already on disk only downloads the warriors its new ranking lists that it lacks;
new hills, many new warriors, or --full download the hill's archive instead, which also
picks up edited warriors and drops removed ones. A hill's folder is replaced only after
all of its downloads succeeded; failed hills keep their previous snapshot and make the
script exit non-zero.

Koenigstuhl's server tells apart names that differ only by case (Odd has Salamander.red
and salamander.red); macOS and Windows checkouts cannot. The later name in sort order is
stored as e.g. salamander~2.red, and RENAMED lists "<stored name><TAB><original name>"
per line so scripts/koenigstuhl.py can still match rankings and link to the original.
Standard library only.

Usage: python scripts/fetch_koenigstuhl.py [--full] [--only HILL ...] [--dest DIR]
"""
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import argparse
import datetime
import io
import re
import shutil
import sys
import tarfile
import tempfile
import time

INDEX = "https://asdflkj.net/COREWAR/koenigstuhl.html"
# Folder names that differ from the server directory; 94/ is the '94 no-Pspace hill.
NAMES = {"94": "94nop"}
HREF = re.compile(r'(href\s*=\s*")([^"]*)(")', re.IGNORECASE)
AGENT = "corewar.dev-koenigstuhl-snapshot"
# Above this many new warriors, one archive download beats fetching them one by one.
ARCHIVE_ABOVE = 25
RENAMED = "RENAMED"


class Names:
    """Stored file names for one hill's warriors, distinct even where case is ignored."""

    def __init__(self):
        self.stored = {}  # original name -> stored name
        self.taken = set()  # stored names, lowercased

    def place(self, original):
        if original in self.stored:
            return self.stored[original]
        path = PurePosixPath(original)
        name, n = original, 2
        while name.lower() in self.taken:
            name, n = f"{path.stem}~{n}{path.suffix}", n + 1
        self.taken.add(name.lower())
        self.stored[original] = name
        return name

    def renamed(self):
        return {stored: original for original, stored in self.stored.items() if stored != original}


def read_renamed(directory):
    """Map stored name to original name from a hill's RENAMED file."""
    path = directory / RENAMED
    if not path.exists():
        return {}
    pairs = (line.split("\t") for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    return {stored: original for stored, original in pairs}


def write_renamed(directory, names):
    renamed = names.renamed()
    if renamed:
        lines = "".join(f"{stored}\t{original}\n" for stored, original in sorted(renamed.items()))
        (directory / RENAMED).write_text(lines, encoding="utf-8")


def fetch(url, attempts=3):
    for attempt in range(attempts):
        try:
            with urlopen(Request(url, headers={"User-Agent": AGENT}), timeout=60) as response:
                return response.read()
        except OSError as error:
            if isinstance(error, HTTPError) and error.code < 500:
                raise  # missing or forbidden: retrying will not help
            if attempt == attempts - 1:
                raise RuntimeError(f"{url}: {error}") from error
            time.sleep(2 ** attempt * 2)


def hills(index_html):
    """Map server directory (e.g. "94") to {"archive", "rec", "br", "top50"} URLs."""
    found = {}
    top50 = {}
    base = urljoin(INDEX, ".")
    for href in HREF.findall(index_html):
        url = urljoin(INDEX, href[1])
        if not url.startswith(base):
            continue
        parts = PurePosixPath(url[len(base):]).parts
        # TOP-50 hills live one level deeper: <hill>/TOP50/hill32.html
        if len(parts) == 3 and parts[1:] == ("TOP50", "hill32.html"):
            top50[parts[0]] = url
            continue
        if len(parts) != 2:
            continue
        hill = found.setdefault(parts[0], {})
        path = PurePosixPath(parts[1])
        if path.name.endswith(".tar.gz"):
            hill["archive"] = url
        elif path.name == "hill32_rec.html":
            hill["rec"] = url
        elif path.name == "hill32_iter.html":
            hill["br"] = url
        elif path.name == "hill32.html":
            # Hills without a recursive ranking (Odd) publish only flat scores.
            hill.setdefault("flat", url)
    result = {}
    for directory, hill in found.items():
        if "archive" not in hill:
            continue
        rec = hill.get("rec") or hill.get("flat")
        if not rec:
            continue
        entry = {"archive": hill["archive"], "rec": rec}
        if "br" in hill:
            entry["br"] = hill["br"]
        if directory in top50:
            entry["top50"] = top50[directory]
        result[directory] = entry
    return result


def page(url):
    """Return the ranking page as saved by a browser: absolute links, source URL noted on top."""
    text = fetch(url).decode("latin-1")  # byte-preserving; the pages are windows-1252
    text = HREF.sub(lambda m: m[1] + urljoin(url, m[2]) + m[3], text)
    return f"<!-- saved from url=({len(url):04d}){url} -->\n{text}".encode("latin-1")


def unpack(data, target, names):
    """Extract the warrior files flat into target, skipping macOS ._ metadata.

    Archives hold one folder of warriors, usually HILL32/ (ICWS64 uses HILL/).
    """
    found = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            parts = PurePosixPath(member.name).parts
            if not member.isfile() or len(parts) != 2 or not parts[0].upper().startswith("HILL"):
                continue
            name = parts[1]
            if name.startswith(".") or "/" in name or "\\" in name:
                continue
            found[name] = archive.extractfile(member).read()
    if not found:
        raise RuntimeError("archive holds no HILL*/ warrior files")
    for name in sorted(found):
        (target / names.place(name)).write_bytes(found[name])
    return len(found)


def download(name, urls, dest, today, full=False):
    """Refresh one hill; return (warrior count, how its warriors were updated)."""
    target = dest / name
    staging = Path(tempfile.mkdtemp(prefix=f".{name}-", dir=dest))
    try:
        hill = staging / "HILL32"
        hill.mkdir()
        ranked = {}
        for key, suffix in (("rec", "recursive"), ("br", "battle_royal"), ("top50", "top50")):
            if key in urls:
                saved = page(urls[key])
                (staging / f"{name}_{suffix}.html").write_bytes(saved)
                if key == "rec":
                    for m in HREF.findall(saved.decode("latin-1")):
                        if m[1].lower().endswith(".red"):
                            ranked.setdefault(PurePosixPath(m[1]).name, m[1])
        if not ranked:
            raise RuntimeError("no warriors on the ranking page")
        previous = target / "HILL32"
        renamed = read_renamed(target)
        # Original name -> file in the previous snapshot.
        have = {renamed.get(p.name, p.name): p for p in previous.iterdir() if p.is_file()} if previous.is_dir() else {}
        names = Names()
        new = [file for file in ranked if file not in have]
        # The rankings list every warrior, so a known hill only needs its new warriors. The archive
        # is used for new hills, many new warriors, or --full (which also picks up edited warriors).
        if full or not have or len(new) > ARCHIVE_ABOVE:
            how = "archive"
            try:
                unpack(fetch(urls["archive"]), hill, names)
            except HTTPError as error:
                if error.code != 404:
                    raise
                # A broken archive link (Pspace) still leaves every ranked warrior downloadable.
                how = "archive missing"
        else:
            how = "incremental"
            for file in sorted(have):
                shutil.copy2(have[file], hill / names.place(file))
            dropped = sorted(set(have) - set(ranked))
            if dropped:
                print(f"{name}: no longer ranked, kept until the next --full run: {', '.join(dropped)}")
        # Archives occasionally lag behind the rankings; fetch ranked warriors still missing one by one.
        fetched = []
        for file, url in ranked.items():
            if file not in names.stored:
                (hill / names.place(file)).write_bytes(fetch(url))
                fetched.append(file)
        if fetched:
            shown = ", ".join(fetched[:10]) + (f" and {len(fetched) - 10} more" if len(fetched) > 10 else "")
            how += f", fetched {len(fetched)} separately: {shown}"
        write_renamed(staging, names)
        (staging / "SNAPSHOT").write_text(today + "\n", encoding="utf-8")
        old = dest / f".{name}-old"
        if old.exists():
            shutil.rmtree(old)
        if target.exists():
            target.rename(old)
        staging.rename(target)
        shutil.rmtree(old, ignore_errors=True)
        return sum(1 for _ in (target / "HILL32").iterdir()), how
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--only", nargs="*", help="hill folder names to update (default: all)")
    parser.add_argument("--full", action="store_true",
                        help="download every hill's archive instead of only new warriors")
    parser.add_argument("--dest", type=Path, default=Path(__file__).resolve().parent.parent / "koenigstuhl")
    args = parser.parse_args()
    args.dest.mkdir(parents=True, exist_ok=True)
    found = hills(fetch(INDEX).decode("latin-1"))
    if not found:
        raise SystemExit("No hills found on " + INDEX)
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    failed = []
    for directory, urls in sorted(found.items()):
        name = NAMES.get(directory, directory.lower())
        if args.only and name not in args.only:
            continue
        try:
            count, how = download(name, urls, args.dest, today, args.full)
            print(f"{name}: {count} warriors ({how}), pages: {', '.join(k for k in ('rec', 'br', 'top50') if k in urls)}")
        except Exception as error:  # keep the previous snapshot of this hill
            failed.append(name)
            print(f"{name}: FAILED, kept previous snapshot ({error})", file=sys.stderr)
    if failed:
        raise SystemExit("Failed hills: " + ", ".join(failed))


if __name__ == "__main__":
    main()

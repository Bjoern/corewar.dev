"""Download every Koenigstuhl hill into koenigstuhl/<hill>/ for the warrior library.

Reads the Koenigstuhl index page, then for each hill fetches the warrior archive and the
ranking pages and writes the layout scripts/koenigstuhl.py expects:

    koenigstuhl/<hill>/HILL32/*.red
    koenigstuhl/<hill>/<hill>_recursive.html     (hill32_rec.html, or the flat hill32.html)
    koenigstuhl/<hill>/<hill>_battle_royal.html  (hill32_iter.html, when listed)
    koenigstuhl/<hill>/<hill>_top50.html         (TOP50/hill32.html, when listed)
    koenigstuhl/<hill>/SNAPSHOT                  (download date, YYYY-MM-DD)

A hill's folder is replaced only after all of its downloads succeeded; failed hills keep
their previous snapshot and make the script exit non-zero. Standard library only.

Usage: python scripts/fetch_koenigstuhl.py [--only HILL ...] [--dest DIR]
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


def unpack(data, target):
    """Extract the warrior files flat into target, skipping macOS ._ metadata.

    Archives hold one folder of warriors, usually HILL32/ (ICWS64 uses HILL/).
    """
    count = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            parts = PurePosixPath(member.name).parts
            if not member.isfile() or len(parts) != 2 or not parts[0].upper().startswith("HILL"):
                continue
            name = parts[1]
            if name.startswith(".") or "/" in name or "\\" in name:
                continue
            (target / name).write_bytes(archive.extractfile(member).read())
            count += 1
    if not count:
        raise RuntimeError("archive holds no HILL*/ warrior files")
    return count


def download(name, urls, dest, today):
    staging = Path(tempfile.mkdtemp(prefix=f".{name}-", dir=dest))
    try:
        (staging / "HILL32").mkdir()
        try:
            count = unpack(fetch(urls["archive"]), staging / "HILL32")
        except HTTPError as error:
            if error.code != 404:
                raise
            # A broken archive link (Pspace) still leaves every ranked warrior downloadable.
            print(f"{name}: archive not found, fetching ranked warriors one by one")
            count = 0
        ranked = []
        for key, suffix in (("rec", "recursive"), ("br", "battle_royal"), ("top50", "top50")):
            if key in urls:
                saved = page(urls[key])
                (staging / f"{name}_{suffix}.html").write_bytes(saved)
                if key == "rec":
                    ranked = [m[1] for m in HREF.findall(saved.decode("latin-1")) if m[1].lower().endswith(".red")]
        # Archives occasionally lag behind the rankings; fetch ranked warriors they lack one by one.
        extra = 0
        for url in ranked:
            file = staging / "HILL32" / PurePosixPath(url).name
            if not file.exists():
                file.write_bytes(fetch(url))
                extra += 1
        if extra:
            print(f"{name}: fetched {extra} ranked warriors missing from the archive separately")
        count += extra
        if not count:
            raise RuntimeError("no warriors downloaded")
        (staging / "SNAPSHOT").write_text(today + "\n", encoding="utf-8")
        target = dest / name
        old = dest / f".{name}-old"
        if old.exists():
            shutil.rmtree(old)
        if target.exists():
            target.rename(old)
        staging.rename(target)
        shutil.rmtree(old, ignore_errors=True)
        return count
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--only", nargs="*", help="hill folder names to update (default: all)")
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
            count = download(name, urls, args.dest, today)
            print(f"{name}: {count} warriors, pages: {', '.join(k for k in ('rec', 'br', 'top50') if k in urls)}")
        except Exception as error:  # keep the previous snapshot of this hill
            failed.append(name)
            print(f"{name}: FAILED, kept previous snapshot ({error})", file=sys.stderr)
    if failed:
        raise SystemExit("Failed hills: " + ", ".join(failed))


if __name__ == "__main__":
    main()

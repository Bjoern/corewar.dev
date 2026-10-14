"""Build the static app using the committed, pinned engine. No Emscripten needed."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import zipfile
from benchmark_catalog import catalog
from option_presets import write_presets

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "docs"
OUT = ROOT / "_site"
lock = json.loads((ROOT / "engine-lock.json").read_text(encoding="utf-8"))
for name, expected in lock["files"].items():
    if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
        raise SystemExit("Pinned engine file changed: " + name)
# Only this fixed generated directory is replaced; source files are never rewritten.
if OUT.is_symlink() or OUT.resolve() != ROOT.resolve() / "_site":
    raise SystemExit("Unexpected output directory: " + str(OUT))
if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir()
for path in WEB.iterdir():
    if path.is_file() and (path.name.startswith(("test-", "build-")) or path.name in {"README.md", "editor-source.mjs"}):
        continue
    if path.is_dir():
        if path.name in {"dist", "config"}:
            shutil.copytree(path, OUT / path.name)
    elif path.is_file():
        shutil.copy2(path, OUT / path.name)
shutil.copy2(ROOT / "engine-lock.json", OUT / "engine-lock.json")
(OUT / "benchmark-catalog.mjs").write_text("// Generated from warriors_public descriptors.\nexport const benchmarkCatalog = " + json.dumps(catalog(ROOT), ensure_ascii=True) + ";\n", encoding="utf-8")
write_presets(WEB / "config", OUT / "presets.mjs")
text_paths = sorted(OUT.glob("*.mjs")) + [OUT / "index.html", OUT / "style.css", OUT / "favicon.svg"]
normalized = {p: re.sub(r"\?v=[A-Za-z0-9_-]+", "", p.read_text(encoding="utf-8")) for p in text_paths}
digest = hashlib.sha256()
for p, text in normalized.items():
    digest.update(p.name.encode())
    digest.update(text.encode())
for p in sorted((OUT / "dist").iterdir()):
    digest.update(p.name.encode())
    digest.update(p.read_bytes())
version = digest.hexdigest()[:16]
for p, text in normalized.items():
    if p.suffix == ".mjs":
        text = re.sub(r"(['\"])(\./[^'\"]+\.mjs)(['\"])", lambda m: m[1]+m[2]+"?v="+version+m[3], text)
    elif p.name == "index.html":
        for asset in ("style.css", "app.mjs", "favicon.svg"):
            text = text.replace(asset+'"', asset+'?v='+version+'"')
    p.write_text(text, encoding="utf-8", newline="\n")
# Include the app build inputs alongside the separate unchanged engine source archive.
with zipfile.ZipFile(OUT / "app-source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    paths = [ROOT / n for n in ("COPYING", "AUTHORS", "README.md", "BENCHMARKS.md", "package.json", "package-lock.json", "engine-lock.json", ".gitignore", ".gitattributes")]
    paths += sorted((ROOT / "scripts").glob("*.py"))
    paths += sorted((ROOT / ".github/workflows").glob("*.yml"))
    paths += sorted(p for p in WEB.rglob("*") if p.is_file() and "test-output" not in p.parts)
    paths += sorted(p for p in (ROOT / "warriors_public").rglob("*") if p.is_file())
    for p in paths:
        info = zipfile.ZipInfo(p.relative_to(ROOT).as_posix(), (1980,1,1,0,0,0))
        archive.writestr(info, p.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
print("Built _site, app release", version, "engine", lock["commit"])

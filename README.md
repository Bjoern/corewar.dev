# corewar.dev

Browser interface for pMARS: warrior editing and selection, graphical battles,
and the native debugger, with a separate tournament and benchmark workspace.

## Engine boundary

The original engine and bundled warrior sources remain in pmars_experiments.
`engine-lock.json` records the exact upstream commit and SHA-256 hashes of the
committed Wasm runtime, generated demo collection, and corresponding-source archive.
`docs/engine.mjs` and `docs/settings.mjs` are the app's adapter to that engine.
No engine checkout, Emscripten, backend, or runtime request to another site is needed.

## Build and preview

Run `python scripts/build.py`, then `python -m http.server 8766 --bind 127.0.0.1 --directory _site`.
Open http://127.0.0.1:8766/ . The build verifies engine hashes, versions the runtime
assets together, and emits `_site/` without modifying source files.
The editor bundle is committed. To rebuild it after editor changes, run
`npm ci` and `npm run build:editor` before the Python build.

## Tests

Run `node docs/test-engine.mjs` and `node docs/test-native-cdb.mjs`.
Browser tests use Playwright; install it with `npm install --no-save playwright@1.62.1`
and `npx playwright install chromium`. With the preview server running, set
`PMARS_URL=http://127.0.0.1:8766/`, then run the `docs/test-*.mjs` browser suites.
`PLAYWRIGHT_MODULE` optionally selects an existing installation; `BROWSER_CHANNEL`
optionally selects an installed browser. `test-options.mjs` requires a native pMARS
executable argument; native-engine parity remains an upstream responsibility.

## Deployment and domain transfer

CI builds and checks the static site on pushes and pull requests.
The Pages workflow deploys `_site/` automatically on pushes to `master`.
It can also be run manually from the Actions tab.
No CNAME is shipped and no domain settings are changed by these files.
Before dispatching, enable GitHub Actions as the Pages publishing source and test
at the repository's GitHub Pages URL. Keep the existing corewar.dev deployment
on pmars_experiments until this version is accepted. Then transfer the custom
domain in GitHub Pages settings; inspect existing DNS before changing it.
An optional pmars.corewar.dev site is documentation/downloads only, not a dependency.

## Updating pMARS

Build and test the chosen upstream engine revision first. Copy its generated
`docs/dist/pmars.mjs`, `docs/dist/pmars.wasm`, `docs/demo-warriors.mjs`, and
`docs/pmars-source.zip` here; update the commit and hashes in `engine-lock.json`.
Review any API changes against the JS adapter and rerun app tests before committing.
Do not update these files automatically to an unpinned latest revision.

## Source and license

Preserved GPL-2.0-or-later notices are in COPYING and the upstream sources.
The site provides the pinned engine source archive and an app source archive
containing the build inputs. CodeMirror dependencies have separate notices in
`docs/dist/editor-LICENSES.txt`.

## Tournaments and benchmarks

The shared roster checkboxes choose entrants. Match settings are shared, but each
run snapshots its sources and configuration; later edits cannot alter that run.
Opening the tournament tab pauses a running graphical battle.

- Round robin runs each unordered pair, optionally including self fights.
- Melee runs all selected warriors in one core.
- Challenge runs a selected challenger against each other entrant.
- Benchmark runs selected candidates against a suite. Identical-source self fights
  are excluded unless enabled. Rankings show candidates only.

Bundled examples are provided as a sample suite, not a classic benchmark.
Save session suite copies selected sources and current match settings into a named
opponent list; then select candidates. These lists last for the page session only.
Public benchmark collections can be packaged from `warriors_public/` using
[benchmark descriptors](BENCHMARKS.md). A separate benchmark importer accepts a
descriptor and its warriors without adding them to the emulator roster.
Persistent libraries and king-of-the-hill admission rules are not implemented yet.

The worker count defaults to half the browser-reported logical processor count,
with a minimum of one. A queue feeds persistent workers; each matchup gets a fresh
engine and keeps all rounds together, preserving P-space and RNG continuity.
The seed and stable job number determine starting positions, independent of worker
count or completion order. Tournament rounds and seed override the shared rounds
and positioning options. Assemble-only is rejected. Permutation is supported for every two-warrior matchup,
including two-entrant Melee; larger Melees are rejected when it is enabled.
The displayed full-pass count is 2 * (core size - 2 * minimum separation + 1).
Fewer rounds sample without repetition; additional rounds begin another pass.

Workers suppress visualization/debug tracing and report only completed matchups.
Progress, normalized rankings, and charts update in batches at most ten times per
second while results arrive. Charts retain the last 300 samples. Pause stops new
jobs and finishes active matchups; Cancel terminates workers and retains completed
results. JSON export includes sources, settings, seeds, results, and run status.
Engine API comparisons and serial/parallel browser comparisons cover the execution
boundary. New tournament tests: `node docs/test-tournament-plan.mjs` and
`node docs/test-tournaments.mjs` (the latter needs the preview and Playwright).

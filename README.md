# corewar.dev

Browser interface for pMARS: warrior editing and selection, graphical battles,
and the native debugger, with a separate tournament and benchmark workspace.

## Engine boundary

The engine is pMARS AI (<https://github.com/pmars-org/pmars-ai>), which also holds the bundled warrior sources.
`engine-lock.json` records the exact upstream commit and SHA-256 hashes of the
committed Wasm runtime, generated demo collection, and corresponding-source archive.
`docs/engine.mjs` and `docs/settings.mjs` are the app's adapter to that engine.

Headless matches of 2 to 36 warriors in Tournaments and Tools run on exMARS
(<https://github.com/Bjoern/exMARS>) when it gives the
same result as pMARS: ICWS '94, the default P-space size, a numeric or no placement seed, a
score formula in W and S (scored from exMARS's survivor counts by `docs/score-formula.mjs`,
a port of pMARS's evaluator), and a permutation only when it covers every position without
P-space.
Its fighter stays loaded in each worker, so warriors are assembled once. `exmars-lock.json`
pins its commit and the hashes of `docs/dist/exmars/`; `docs/exmars.mjs` decides which
engine runs a match, and both pages say which one ran. `docs/test-exmars.mjs` checks that
exMARS and pMARS agree. The Battle tab, the debugger and everything else use pMARS.

No engine checkout, Emscripten, backend, or runtime request to another site is needed.

## Build and preview

Run `python scripts/build.py`, then `python -m http.server 8766 --bind 127.0.0.1 --directory _site`.
Open http://127.0.0.1:8766/ . The build verifies engine hashes, versions the runtime
assets together, and emits `_site/` without modifying source files.
The benchmark catalog ships as a small index (`_site/benchmark-catalog.mjs`) plus one
file per suite in `_site/benchmarks/`, named by content hash. The app loads a suite when
it is selected and prefetches the rest once the page is idle, unless the browser asks to save data.
The editor bundle is committed. To rebuild it after editor changes, run
`npm ci` and `npm run build:editor` before the Python build.

## Warrior evolver

Tools → Warrior evolver (`#tools/evolver`) breeds whole warriors, not just constants.
`docs/evolver-genome.mjs` holds the genome (exMARS's instruction tuples) and the operators: opcode, modifier,
mode and field mutations, insert/delete/duplicate/swap, and crossover, all keeping warriors valid for the settings.
`docs/evolver-run.mjs` runs the search, scored by the constant optimizer's `Evaluator` (3 per win, 1 per tie;
exact on nano). The population itself is `docs/population.mjs`, shared with the constant optimizer's genetic algorithm:
it sees genomes only through operators (random, mutate, crossover, key, distance) and its methodology is configurable
(steady state or generational breeding, crowding or clearing, mean or latest scores over seed sets, racing), with the
evolver defaulting to generational clearing and the optimizer to genetic2.rb's steady-state crowding. `docs/evolver-worker.mjs` runs it in a Web Worker that hands matches to a pool of
`optimizer-worker.mjs` workers. Presets (nano, tiny, standard '94, LP, custom) and their benchmarks from
`warriors_public/` are in `docs/evolver-presets.mjs`; the benchmark list also offers every fitting suite of the Tournaments
tab's Benchmark mode (imported or session-made ones too), and under "Other hills" the '94 suites of other settings: picking one
switches to its preset, or to Custom with its values (asking before it replaces custom settings). A warrior length below the
hill's (`warriorLength`, see `genomeRules`) caps the evolved warriors while the matches keep the hill's length and distance,
for example 20-instruction warriors against the LP hill. With Self fight (`selfFight` in the `Evaluator` options, also in the
constant optimizer), each candidate also fights a copy of itself as one more opponent, as Koenigstuhl scores it. `markovModel`/`markovGenome` in `docs/evolver-genome.mjs` learn
an order-2 Markov chain of instruction shapes from the opponents and draw the first population and immigrants from it.
Survivors are chosen with clearing (`niche` radius on the genome distance, `nicheSize` warriors per niche), so
near-copies of the leader give way to the best of other kinds.
An optional held-out share of the opponents (`splitHoldOut` in `docs/evolver-run.mjs`, picked by the run's seed) never
counts for selection; the best warrior is scored on it as well, to show overfitting to the benchmark.
`node docs/test-evolver.mjs` checks validity, niching, the chain, and that a nano run improves;
`node docs/test-population.mjs` checks the shared population search on its own.

## Trials

`docs/trials.html` is a standalone puzzle game built on the engine; the design is in `TRIALS.md`.
Its stages are data in `docs/trials-stages.mjs`, and `node docs/test-trials.mjs` checks that each one is solvable.

## Warrior library

The Library tab searches published warriors from Koenigstuhl snapshots in `koenigstuhl/<hill>/`.
Each hill folder holds the unpacked archive (`HILL32/*.red`) and the saved ranking pages
`<hill>_recursive.html` (required), `<hill>_battle_royal.html` and `<hill>_top50.html` (optional).
An optional `SNAPSHOT` file holds the download date (`2026-11-04`), shown as the library's last update.
Koenigstuhl can serve warriors whose names differ only by case (Odd's `Salamander.red` and `salamander.red`),
which macOS and Windows checkouts cannot hold; the fetch stores the later one as `salamander~2.red`
and lists it in the hill's `RENAMED` file, so rankings and Koenigstuhl links still use the original name.
`python scripts/fetch_koenigstuhl.py` downloads every hill listed on the Koenigstuhl page into this layout
(`--only 94nop tiny` limits it to some hills); a hill's folder is replaced only when its download succeeded.
It always refreshes the ranking pages, but for a hill already on disk fetches only the warriors that are new
in its ranking; `--full` downloads the archives instead, picking up edited warriors and dropping removed ones.
Ranked warriors missing from a hill's archive are fetched one by one, and the Odd hill, which has
only flat scores, uses them as its recursive ranking. A weekly workflow runs the script (with `--full` in
the first week of each month), commits the result and deploys the site. Every run commits at least the new
`SNAPSHOT` dates, so the Library shows when the hills were last checked and GitHub keeps the schedule enabled.
Snapshots with new warriors or rankings are tagged `koenigstuhl-YYYY-MM-DD`;
`git diff koenigstuhl-2026-11-09 koenigstuhl-2026-11-16 -- koenigstuhl/94nop` shows a week's changes.
`scripts/koenigstuhl.py` reads the `;name`, `;author` and `;strategy` headers and the rankings;
the build writes one search index per hill to `_site/library/`, named by content hash,
and copies the warrior files beside it so the app fetches a source only when it is opened or added.
A second file per hill holds all its sources; it loads only when "Search full source" is switched on.
With no hill chosen the Library searches every hill; a first visit and Reset search 94nop, whose index is about
60 KB compressed against about 300 KB for all hills. Warriors can be selected across searches and then added,
downloaded as a .zip, or turned into a benchmark suite with a hill's Koenigstuhl match settings
(`OPTIONS` in `scripts/koenigstuhl.py`, shipped in the catalog as benchmark parameters).

## Match presets

The dropdown is generated during the build from `docs/config/*.opt`.
Add or edit an option file and rebuild; identical option sets share one entry.
`scripts/option_presets.py` supplies optional friendly labels, with the filename
as the fallback. Unsupported options fail the build instead of being ignored.
The generated `_site/presets.mjs` and linked option files ship with the site.
The app keeps its own option-file copies and needs no pMARS checkout to build.
Tiny LP includes the corrected hill settings: 800 cells, 8 processes, 8,000
cycles, length/separation/P-space of 50, and 250 rounds.

## Tests

Run `node docs/test-engine.mjs` and `node docs/test-native-cdb.mjs`.
Browser tests use Playwright; install it with `npm install --no-save playwright@1.62.1`
and `npx playwright install chromium`. With the preview server running, set
`PMARS_URL=http://127.0.0.1:8766/`, then run the `docs/test-*.mjs` browser suites.
`PLAYWRIGHT_MODULE` optionally selects an existing installation; `BROWSER_CHANNEL`
optionally selects an installed browser. `test-options.mjs` requires a native pMARS
executable argument; native-engine parity remains an upstream responsibility.

## Deployment

The site is served at <https://corewar.dev> by GitHub Pages from this repository.
CI builds and checks the static site on pushes and pull requests.
The Pages workflow deploys `_site/` automatically on pushes to `master`.
It can also be run manually from the Actions tab.
The custom domain is set in the repository's Pages settings; no CNAME file is
shipped and these files change no domain or DNS settings.
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

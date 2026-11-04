# Constant optimizers for the Tools tab (handoff)

This folder holds copies of the warrior constant optimizers from the `corewar_evolver`
project (origin `https://dev.blinker.net/bjoern/corewar_optimizer.git`, copied on
2026-11-04). They are here as reference material for porting an optimizer into
corewar.dev's **Tools** tab (`docs/app.mjs`, mode `toolsTab`, currently hidden).
Nothing in this folder is built, deployed or tested by corewar.dev:
`scripts/build.py` only ships `docs/` and `warriors_public/`, and CI does not run it.

## 1. Purpose

A constant optimizer takes a hand-written Redcode warrior, lets the author mark the
numbers (and optionally opcodes, modifiers and modes) that should be tuned, and
searches for the values that score best against a benchmark of opponents. It does not
invent code. The author keeps the strategy and the optimizer tunes step sizes, bomb
offsets, decoy distances and similar values that are tedious to tune by hand.

Typical session: open a warrior, mark the constants, pick a hill and a benchmark,
start, watch the score climb, stop, copy the best warrior and the template with the
values filled in.

## 2. What is in this folder

| Path | What it is | Origin | Licence |
|---|---|---|---|
| `metcalf/annealing5.rb` | Simulated Annealing Core War Optimizer v0.5 | John Metcalf, <https://corewar.co.uk/metcalf/annealing5.rb> | no licence stated; permission from John Metcalf (see §9) |
| `metcalf/genetic2.rb` | Steady-State Genetic Algorithm Core War Optimizer v0.2 | John Metcalf, <https://corewar.co.uk/metcalf/genetic2.rb> | no licence stated; permission from John Metcalf (see §9) |
| `cwopt/` | **cwopt**: template language, exact and sampled fitness, score cache, sweep + annealing + restarts, hill mode, pause/resume, CLI, local web UI | written by Claude (Anthropic) for Bjoern in corewar_evolver, Oct 2026; the annealing step and its temperature scale are adapted from `annealing5.rb` | none yet, owner's to choose |
| `OPTIMIZER_SPEC.md` | the implementation brief cwopt was built from | written for the owner, Oct 2026 | as cwopt |
| `scripts/ga.py` | generational GA over cwopt templates (uses cwopt for fitness) | Claude for Bjoern, Oct 2026 | as cwopt |
| `scripts/genetic2.rb` | port of Metcalf's `genetic2.rb` to the exMARS Ruby binding and cwopt templates; algorithm unchanged | Claude for Bjoern, Nov 2026, derived from `metcalf/genetic2.rb` | derivative of Metcalf's code, covered by his permission |
| `scripts/export_template.py` | prints a cwopt template as JSON so non-Python optimizers can use it | Claude for Bjoern, Nov 2026 | as cwopt |
| `scripts/engine-overhead.mjs` | Node timing of per-match startup vs per-round cost, site pMARS Wasm vs exMARS Wasm (§11) | Claude for Bjoern, Nov 2026 | GPL-2.0-or-later |
| `tests/test_template.py`, `tests/test_runs.py`, `tests/acceptance.py` | cwopt tests: template parser, run/resume determinism, engine vs pMARS acceptance | as cwopt | as cwopt |
| `examples/alcoholism.red` | nano template made from Dave Hillis's *Alcoholism Malt* | warrior by Dave Hillis, markers added for the cwopt example | published hill warrior |
| `examples/splitty6b_top_tmpl.red` | '94 paper template used in the comparisons below | Bjoern's warrior | Bjoern's |

The two Metcalf files are byte-identical to the copies on corewar.co.uk (checked on
2026-11-04).

The other files are copied unchanged, so their imports and paths expect the
corewar_evolver layout. `scripts/ga.py` imports `cwopt` from `..`, which works here as
well. They need the exMARS engine (§6) to run.

## 3. How constants are found and changed

### Metcalf's scripts
- Input is `template.txt`. It is split on `!`. Each `!` becomes a value `0..CORESIZE-1`
  and each `!%n` becomes a value `0..n-1` (the `%n` is consumed). `CORESIZE` is a
  constant in the script (8000).
- A candidate is an array of integers, one per marker. The warrior is the template
  pieces zipped with the values (`template.zip(state).flatten.join`).
- There are no names, ranges with a lower bound, value lists, filters, or start values.
  Comments are not special, so a `!` in a `;name` line or `!=` in `;assert` becomes a
  marker. Results are logged as raw arrays in `opt.log`.

### cwopt templates (used by cwopt, `ga.py` and the `genetic2.rb` port)
Full grammar in `OPTIMIZER_SPEC.md` §1 and `cwopt/template.py`. Summary:

| Marker | Values |
|---|---|
| `!` | whole core, signed: `-C/2 .. C/2-1` |
| `!(a..b)`, `!(a..b, s)` | inclusive range, optional step |
| `![x, y, z]` | listed tokens: numbers, opcodes, modifiers, addressing modes |
| `?coprime`, `?odd`, `?even` | filters |
| `:v` | start value, also the write-back form |

- Expressions in ranges may use `CORESIZE MAXLENGTH MINDISTANCE MAXPROCESSES MAXCYCLES PSPACESIZE`.
- Text after `;` is ignored and `!=` is never a marker.
- A marker on an `EQU` line is named after the label (`step equ !(1..79)?coprime:37`).
  Other markers are named `line:column`. Shared and derived values come for free
  through the label (`step*2`).
- A marker right after an operator renders negative values in parentheses.
- Every variable is a list of rendered values. A candidate is a vector of **indices**
  into those lists, so the search only knows domain sizes and never sees Redcode
  (`cwopt/search.py`).
- Output: `best.red` (rendered, with `;name ;author ;strategy ;assert` added if missing)
  and `best.template.red` (the template with every start value set to the best value,
  ready to rerun or narrow).

Recommendation for the port: use the cwopt template language. It is a superset of
Metcalf's idea, it is safe with comments and `;assert`, and the write-back form makes
"continue from the best" a normal edit in the editor.

## 4. How candidates are scored

Common to all four: each candidate warrior fights each benchmark warrior one at a time
(2-warrior battles). A round scores 3 for a win, 1 for a tie and 0 for a loss. Scores
are shown as `(3W + T) / rounds × 100`, averaged over opponents (0–300; 100 = all ties).
Opponents are all `*.red` files of a benchmark folder.

| | Metcalf `annealing5.rb` / `genetic2.rb` | `scripts/genetic2.rb` (port) | cwopt | `scripts/ga.py` |
|---|---|---|---|---|
| Engine | `./exmars` CLI per pair, one Ruby thread per opponent, candidate written to `cand_xxxx.rc` | exMARS Ruby binding in forked workers | exMARS Python extension in a process pool; assembly in a child process | via cwopt |
| Settings | hard-coded: exMARS default '94 (core 8000), `-r 250` | `Mars.standard(2)`, 250 rounds | hill preset (`cwopt/hills.json`: nano, tiny, standard, 94nop, lp; '88 listed but refused) | hill preset |
| Placements | `-F 7293`: the **same fixed position series for every candidate, all run long** | same as Metcalf | **exact** (every legal position, both starting orders, 1 round each) for small cores without p-space, otherwise **sampled**: 250 rounds as 5 slices of 50 with derived seeds | sampled; one fresh seed per generation, shared by the whole generation |
| Noise handling | none | none | common random numbers (all candidates on the same seeds), racing (stop after a slice if > 3 SE behind the current), reseed after every 10 improvements and re-score the incumbent, held-out check at the end on 2000 unseen rounds per opponent | per-genome running mean across generations; a genome is trusted for "best" only after ≥ 2 seeds |
| Cache | in-memory hash of value arrays | in-memory, saved in `state.json` | SQLite, keyed by assembled-code hash of both warriors + hill + engine + unit, shared by all runs | cwopt's cache |
| Invalid candidates | whatever exmars prints | score −1 | rejected, counted, never scored | ignored |

The exact/sampled choice: exact if `2 × positions ≤ 2000` and no LDP/STP in the template
or benchmark. Positions are `MINDISTANCE .. C − MINDISTANCE`, so nano (71 positions,
142 fights per opponent) and tiny (761, 1522) are exact. Exact scores have no noise, so
they need no racing, reseeding or held-out check.

**Engine equivalence.** `tests/acceptance.py` showed on 2026-10-24 that the exMARS
engine, the exMARS CLI and native pMARS 0.9.6 (built from pmars_experiments at
`9778ddc`) agree in every round. That covered 1000 single rounds each on nano, tiny,
standard, 94nop and lp, with both starting orders and published, imp, p-space and
junk warriors. The pMARS WebAssembly build in exMARS (`dist/wasm`) agreed too. corewar.dev's pMARS Wasm engine
should therefore give the same scores as cwopt. Exact mode (b at `p` with a starting, then a at `C − p` with b starting) is checked in
`tests/acceptance.py` against the sum of the same single rounds.

## 5. Algorithms and good defaults

### 5.1 Metcalf, simulated annealing (`annealing5.rb`)
- Visit variables round robin. Each step copies the current state, nudges every other
  variable by `rand(-20..20)` with probability 0.1, and changes the visited variable:
  half the time a uniform random value, otherwise ±20.
- Accept if better. If worse, accept with probability
  `exp(Δscore% × 150 / t)`, written as `exp(Δenergy × 15000 / n / R / t)`, where `t`
  counts steps since the last acceptance and is reset to 0 on acceptance. So the
  "temperature" rises the longer the search is stuck. This is not a cooling schedule.
- Restarts from the highest line in `opt.log`. Runs forever and writes `best_xxxx.rc`.
- Defaults in the script: 250 rounds, ±20 creep, 10% multi-nudge, scale 15000.

### 5.2 Metcalf, steady-state GA (`genetic2.rb`)
- Fill with random candidates until the population has 10. After that, a new random
  immigrant with probability `IPROB`.
- Otherwise parent x is the best of `TOURX` random members and parent y is the best of
  `TOURY` (so y is a random member). Crossover is one of four, chosen uniformly:
  uniform, single point, BLX-α (per gene with probability `BPROB`, α = 0.3, mod bound),
  or none (copy x).
- Then creep mutation (±`CREEP` with probability `CPROB` per gene), then random reset
  (probability `RPROB` per gene).
- Duplicates of a member are discarded. The child is inserted. When the population
  exceeds `POPSIZE`, deterministic crowding removes the member most similar to the child
  (Hamming distance, then lower score) among those scoring lower than the child. If none
  scores lower, the child itself is removed.
- Defaults (good as they are): `POPSIZE 50, TOURX 3, TOURY 1, IPROB 0.05, BPROB 0.5,
  RPROB 0.08, CPROB 0.10, CREEP 20`, 250 rounds.
- The port (`scripts/genetic2.rb`) keeps all of this. It evaluates one child per worker
  in parallel, uses index genes, and saves resumable state every 5 minutes.

### 5.3 cwopt (`cwopt/search.py`, `cwopt/runs.py`)
1. **Coordinate sweep** over every variable with ≤ `sweep_limit` values. Try every value
   with the others held, keep the best, move on, and repeat passes until one brings no
   gain. With exact fitness this is deterministic and cheap.
2. **Annealing** for the rest, Metcalf's move set and acceptance rule on index vectors.
   `delta` is capped at `size/4` for small domains.
3. **Restart** after `restart_patience` steps without a new best. Restart from one of the
   `keep_best` best results with each variable randomised with probability
   `restart_prob`, then sweep again.

All search state, including the RNG, is one JSON dict, so pause/resume continues exactly
and seeded runs give the same result in-process and with 3 workers (tested).

Defaults (`search.DEFAULTS`, `runs.DEFAULT_OPTIONS`):

| Option | Default | |
|---|---|---|
| `sweep_limit` | 160 | sweep domains up to this size |
| `anneal_scale` | 150 | Metcalf's 15000/100 on the 0–300 score scale |
| `multi_prob` | 0.1 | per other variable, small nudge in the same step |
| `delta` | 20 | largest small step, in indices |
| `restart_patience` | 400 | steps without a new best |
| `keep_best` / `restart_prob` | 5 / 0.3 | |
| `rounds` | hill's (250) | sampled rounds per opponent |
| `slices` / `z` | 5 / 3.0 | racing |
| `reseed_every` | 10 | improvements between new seeds |
| `validate_rounds` | 2000 | held-out check |
| `exact_limit` | 2000 | fights per opponent for exact mode |

**Hill mode** (`cwopt/hillmode.py`, spec §6) is also implemented. The benchmark acts as a
hill. A new best challenges it and can push members off. Pinned anchors stay. A lineage
cap (default 1) keeps run members from filling the hill, and an archive of pushed-off
warriors is kept.

### 5.4 `scripts/ga.py` (generational GA on cwopt)
Population 40, 6 elites. Children: 45% uniform crossover + mutation, 45% mutation only,
10% random. Tournament of 3 on the running mean. Mutation touches each gene with
probability `1.5 / genes` (at least one). Domains over 100 values creep with probability
0.7 by ±(1 + Exp(mean 15)); otherwise the gene gets a random value. One fresh seed per
generation. `--seed-template` seeds the population from earlier bests, which is how it
was used best: to polish a cwopt result.

### 5.5 What the runs showed (splitty, standard '94, 8 cores)
These are not controlled same-budget comparisons. Templates and benchmarks differ
between runs, so read them as indications.
- cwopt, 30–45 min runs on `ssr5bm`: the search score reads 4–9 points above the
  held-out score (for example 120.4 search vs 111.7 held-out). The held-out check is
  essential for honest numbers.
- `ga.py` seeded with a cwopt best on `top20mix` gave the project's best warrior
  (`splitty_best_top`, about 103–104 on fresh seeds vs 101.8 held-out for the cwopt best it
started from).
- The `genetic2.rb` port on `top20mix`, 46 min: 104.8 on the fixed `-F 7293` series, but
  98.7 on fresh seeds. That is about 4.5 points of overfitting to one placement series,
  and below the 103.8 of `splitty_best_top`. The GA itself searched well (population
  median 101 after 2500 evaluations) and found an untested new step pair.
- Speed with cwopt: nano exact about 290 evaluations/s on 8 workers (50 opponents);
  standard sampled about 6.6 evaluations/s (20–29 opponents × 250 rounds, with racing).
- Steps that are co-tuned with other constants are rarely moved by any of the
  optimizers.

## 6. Language and dependencies

| | Language | Needs |
|---|---|---|
| Metcalf scripts | Ruby (stdlib) | `./exmars` binary and the benchmark `*.red` files in the working directory, `template.txt` |
| `scripts/genetic2.rb` | Ruby | exMARS Ruby binding (`require 'Mars'`) **with `Mars#parse_string`, which was added locally in exMARS `rubyinterface.c` and is not committed upstream**; `python3` + cwopt for `export_template.py`; `fork`; macOS `sysctl` for the CPU count |
| cwopt, `ga.py`, `export_template.py` | Python ≥ 3.9, stdlib only (SQLite, `http.server`, multiprocessing) | exMARS fork with Python extension, <https://github.com/Bjoern/exMARS> (`Mars.*.so`, `Warrior.py`), found via `CWOPT_EXMARS` or `../exMARS` |
| `cwopt/web/` | vanilla JS + CSS, no build | talks only to cwopt's JSON API and server-sent events (`cwopt/server.py`) |

## 7. Porting notes for corewar.dev

- **Route.** Port the core to JS modules next to `docs/`: template parser, search,
  fitness aggregation, cache, and the run loop and checkpoints. Run fights in Web Workers
  on the existing pMARS Wasm engine. cwopt was written for this. The search knows only
  domain sizes, storage is an interface (`cwopt/storage.py`), the engine is one module
  (`cwopt/engine.py`), and the UI uses only the API. Pyodide plus a Python build of
  exMARS would be the other route, but it would add a second engine to the site.
- **Engine.** Use exMARS with a persistent Wasm API for the optimizer's battles and keep
  the site's pMARS for the Battle tab. See §11.
- **Assembly.** Compile each candidate once per worker and cache the bank by a hash of
  its assembled code. Different values often give identical code, for example fields
  nothing reads.
- **Cache and checkpoints.** IndexedDB instead of SQLite and the run directory. The
  checkpoint is cwopt's `state.json` (versioned, `"format": 1`) and can also be offered
  as a download.
- **Benchmarks.** Reuse the existing benchmark catalog and the Library's "turn into a
  benchmark suite", with each hill's match settings. Hill presets map onto
  `docs/config/*.opt`.
- **UI.** cwopt's screens (spec §9 and `cwopt/web/`): new run (template editor with live
  check of variables, domain sizes, search space and assembly), run view (score over
  time with SE band, best warrior with tuned values highlighted, variables table,
  per-opponent W/T/L), runs list with pause/resume/stop. The shared editor can highlight
  markers.
- **Tests to port first.** `tests/test_template.py` (parser, round trip). The determinism
  and resume cases in `tests/test_runs.py`. The exact-mode check from
  `tests/acceptance.py`.

## 8. Known limitations

- Metcalf's scripts score every candidate on one fixed placement series (`-F 7293`). The
  best value overfits that series, by about 4.5 points in the splitty run. They have no
  stop condition, no hill settings beyond core size, no checks for invalid code, and use
  one OS thread and one exmars process per opponent and candidate. Templates break on
  `!` in comments and `!=`.
- The `genetic2.rb` port inherits the fixed series on purpose (algorithm unchanged).
  It depends on an uncommitted exMARS binding change and on macOS `sysctl`.
- cwopt: the search score of the best is biased upward (best of many noisy samples).
  Compare warriors by the held-out score. The round counts and hill sizes of standard,
  94nop and 88 are not verified (koth.org was unreachable). '88 is not supported by the
  exMARS bindings. P-space size is fixed at CORESIZE/16. The pMARS parser in exMARS can
  `exit()`, hence the assembler child process. Nano throughput is limited by handing out
  candidates one at a time. Hill-specialised exMARS builds were not tried. Run
  directories hold absolute paths and resume only on the machine that started them.
- `ga.py`: no checkpoints or resume. A generation's seed is shared, but genomes
  evaluated in different generations are compared on different seeds (running means
  even this out only slowly). No held-out check.
- None of the optimizers changes code structure. Constants only.
- No controlled comparison of the algorithms at equal budget has been run yet (§5.5).

## 9. Licences

- **John Metcalf's scripts** carry no licence statement, and corewar.co.uk states none
  for code. John Metcalf has given the owner permission to use them (reported by the
  owner, 2026-11-04). That covers the copies here, the `genetic2.rb` port and cwopt's
  annealing step and scale. It is worth getting the permission in writing (an email or
  a licence line in the scripts) and recording here which licence corewar.dev may ship
  derived code under, since the site is GPL-2.0-or-later. Credit him in the Tools tab
  and in the source.
- **cwopt, `ga.py`, `export_template.py`, the port's new code and the spec** were written
  for the owner and have no licence file. Pick one before merging. GPL-2.0-or-later
  matches the rest of corewar.dev.
- **Example warriors** belong to their authors (Dave Hillis; Bjoern).

## 10. Recommendation: one optimizer, two search methods

Offering the scripts as separate tools would expose their differences in **scoring**,
which matter more than the search method: a fixed position series overfits, while
seeded slices with a held-out check give honest scores. One optimizer with a shared
core and a choice of method is better for users and less code.

**Shared core (from cwopt):** template language (so every method can tune opcodes,
modifiers and modes as well as numbers), exact/sampled fitness, common seeds, racing,
reseeding, code-hash cache, held-out check, pause/resume, hill mode.

**Method "Simulated annealing" (default).** cwopt's search (§5.3), which is Metcalf's
annealing (move set and acceptance rule of `annealing5.rb`) with two optional additions:

| Setting | Default | Pure Metcalf annealing |
|---|---|---|
| Sweep small domains first | on (`sweep_limit` 160) | off (`sweep_limit` 0) |
| Restart from a top result when stuck | on (`restart_patience` 400) | off (patience = ∞) |

With both off, the search is `annealing5.rb`'s algorithm on cwopt's scoring. Show both
as checkboxes. The sweep is what makes nano and tiny fast and deterministic, and the
restarts help when values only pay off together. For a "Classic Metcalf" preset, add a
fixed-series scoring option (`-F 7293` for every candidate) to reproduce old results;
do not make it the default.

**Method "Genetic algorithm".** Start from `ga.py` (§5.4), which already fits cwopt's
scoring: one shared seed per generation, a running mean per genome, a genome trusted
only after ≥ 2 seeds, seeding from earlier bests and the editor's current values. Its
mutation also suits token genes (opcodes, modifiers, modes): domains of 100 values or
fewer get a random value, not a numeric creep. Add from Metcalf's `genetic2.rb` (§5.2):
- deterministic crowding (the child replaces the most similar weaker member), which kept
  the population diverse in the splitty run;
- BLX-α crossover, for numeric genes only (on a token list the index order means
  nothing), and single-point crossover beside uniform;
- about 5% random immigrants;
- asymmetric tournaments (best of 3 and a random member);
- from cwopt: checkpoints, pause/resume and the held-out check, which `ga.py` lacks.

Defaults to start from: population 40–50, elites 6, tournament 3/1, immigrants 0.05,
gene mutation 1.5 / genes, creep for domains > 100 with 70% probability and
±(1 + Exp(mean 15)), BLX rate 0.5 with α 0.3.

Before fixing the defaults, run both methods on the same template, benchmark and time
budget, a few seeds each, and compare held-out scores (§5.5).

## 11. Engine: exMARS with a persistent Wasm API

### Measurements
`scripts/engine-overhead.mjs` (Node 22, Apple M1, 2026-11-04) times a whole match, 1 round
and many rounds, on corewar.dev's pMARS (`docs/engine.mjs`, a fresh instance per match as
in `docs/tournament-worker.mjs`) and on exMARS's `dist/wasm` (`runMatch`, at exMARS
`ecbff45`, also a fresh runtime per match). Pairs: nano `ALCOHOLI.RED` vs `8C094799.RED`
(nanobm07), standard `Carmilla_3.red` vs `arvon.red` (top20mix). Two runs agreed to within
about 0.3 µs per nano round and 5% per standard round.

| | 1-round match (mostly startup) | each extra round |
|---|---|---|
| site pMARS, nano | 2.3–2.4 ms | 4.1–4.2 µs |
| exMARS, nano | 1.7–1.8 ms | 0.8–1.1 µs |
| site pMARS, standard | 2.9–3.0 ms | 1.6–1.7 ms |
| exMARS, standard | 2.0–2.2 ms | 0.39 ms |

Consequences:
- **Small hills.** Exact scoring is 142 one-round matches per opponent on nano, so with
  a fresh engine per match one candidate against 50 opponents costs about 17 s per
  worker, almost all of it startup. The battles themselves take about 10 ms. Native
  cwopt does about 290 candidates/s on 8 workers. An engine that stays loaded is
  required here.
- **Standard.** A 250-round match takes 100–400 ms, so 2 ms of startup is under 1%. The
  simulator's speed is what matters: exMARS was 4.1× faster on this pair. The exMARS
  benchmark (`exMARS/dist/wasm/BENCHMARK-2026-10-23.md`, whole suites, Node) shows
  about 2.2× over pMARS.
- These are single pairs in Node on one machine. Repeat in the target browsers before
  committing to numbers.

### Why exMARS
- **Same results.** cwopt's acceptance test (§4) found exMARS = pMARS round for round on
  nano, tiny, standard, 94nop and lp.
- **Built for reuse.** It allocates its core once. The Python binding (`python_mars.c`)
  is already the API needed: `parse_string`, settable `rounds` and `fixed_position`, and
  `fight()` that starts a fresh match each call (P-space kept across its rounds only).
- **Licence.** The simulator (`sim.c`, from exhaust by M Joonas Pihlaja) is public domain.
  The parser in `pmars.c` is GPL-2.0-or-later. Both fit corewar.dev.

### Change to make (in exMARS's Wasm build, not in pMARS)
1. **Persistent API**, one instance per Web Worker, alongside the existing CLI-backed
   `exmars.mjs`:
   - `configure(coreSize, cycles, processes, maxLength, minDistance)`
   - `load(instructions, start, pin) → handle`, with instructions as the 6-int tuples
     of `cwopt/engine.py` / `Warrior.py`
   - `fight(a, b, rounds, position) → {wins, ties, losses}`, as the Python binding's
     `fight()`
   - `unload(handle)`
2. **Assembly in a separate instance.** The pMARS parser can `exit()` after too many
   errors, which would kill a persistent instance. Assemble each candidate once in a
   throwaway instance (about 2 ms) that returns the instruction list and diagnostics,
   then load it into the fight instance. cwopt does the same with a child process.
   Keying the cache by a hash of the assembled code also avoids re-assembling
   duplicates.
3. **Tests.** Port the exact-mode check and the round-for-round comparison of
   `tests/acceptance.py` to Node against the native exMARS or pMARS CLI. Add a test that
   repeated `fight()` calls on one instance give the same results as fresh instances,
   including P-space warriors, and a throughput test (nano exact, standard 250 rounds).
4. **Site integration.** Ship the exMARS Wasm with its own lock entry, like
   `engine-lock.json` for pMARS, and keep pMARS for the Battle tab and the debugger.
   Leave `engine-lock.json` and pmars_experiments unchanged.

### Limits of exMARS
No '88 mode, no permutation option, P-space size fixed at CORESIZE/16, 3/1/0 scoring
only. The Tools tab offers only hills within these limits, the same as cwopt today
(`cwopt/hills.json`). The Tournaments tab could later route its headless matches to
exMARS for speed, but that is a separate decision because of these missing features.

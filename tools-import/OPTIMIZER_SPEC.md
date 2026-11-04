# Core War constant optimizer: implementation brief

Brief for building a tool that tunes the constants (and optionally opcodes, modifiers and addressing modes) of a hand-written Redcode warrior against a benchmark, for any hill: nano, tiny, standard '94, LP and others. It has a command line and a local web interface, and a run can be paused and resumed later.

This is the first step towards a full evolver. Build the parts so they can be reused by it (see §12), but do not build the evolver now.

Background to read first:
- John Metcalf's simulated annealing optimizer `annealing5.rb` (the owner can supply it). It reads `template.txt`, replaces each `!` with `0..CORESIZE-1` and each `!%n` with `0..n-1`, benchmarks with exMARS against all `*.red` files and anneals. This tool generalises that idea.
- The owner's exMARS fork with Python bindings: https://github.com/Bjoern/exMARS (the owner may also provide a local checkout). Read `README-python.md`, `python_mars.c` and `tests/python_bindings/run.py` before writing the engine layer.

---

## 0. Settled decisions, and what to confirm with the owner

Settled:
- **Language:** Python for the optimizer, the command line and the web server.
- **Battle engine:** the owner's exMARS Python extension (`import Mars`). Do not write another simulator.
- **Interface:** a local web UI served by the Python process (§9), with corewar.dev in mind as a later home (§12).
- **Pause and resume** is a core requirement (§8), not an add-on.

Confirm with the owner before writing code:
1. **Round counts and unconfirmed settings per hill** (§3).
2. **Web stack.** Suggested: a small async server (for example Starlette or FastAPI with uvicorn) and a frontend in plain TypeScript or vanilla JS without a heavy framework, so it can later move into corewar.dev. If the owner prefers another stack, use that.
3. **Where the tool lives:** a new repository, or a folder inside an existing one.

---

## 1. Template language

A template is a normal Redcode file in which **markers** stand for values to optimise. A marker starts with `!`.

| Marker | Values |
|---|---|
| `!` | the whole core, signed: `-floor(C/2) .. ceil(C/2)-1` (on C=80: `-40..39`) |
| `!(a..b)` | integers a to b, **inclusive** |
| `!(a..b, s)` | a, a+s, a+2s, … up to b |
| `![x, y, z]` | the listed tokens: numbers, opcodes (`mov`), modifiers (`i`), addressing modes (`#`, `{`) |
| `…?coprime`, `?odd`, `?even` | filter on the values above. `coprime` means gcd(value mod C, C) = 1 |
| `…:v` | start value. Also the form in which results are written back |

Grammar (whitespace allowed inside brackets and parentheses):

```
marker  := "!" [domain] {filter} [":" value]
domain  := "(" expr ".." expr ["," expr] ")" | "[" token {"," token} "]"
filter  := "?" ("coprime" | "odd" | "even")
expr    := integer arithmetic (+ - * / % and parentheses) over integers and the names
           CORESIZE, MAXLENGTH, MINDISTANCE, MAXPROCESSES, MAXCYCLES, PSPACESIZE
```

Rules:

- Values are substituted as text, so a marker can sit anywhere a token can: `spl.![a,b,f] ![#,$]!(1..10), ![<,{]gap`.
- Numbers are written signed and in the smallest absolute form (`-3`, not `77`). Values are distinct mod CORESIZE, so a range wider than the core is an error.
- **Ignore everything after `;`** on a line, so `;name Wow!` is safe.
- **`!=` is pMARS's not-equal operator**, used in `;assert`, `if` and `for`. Never treat `!` followed by `=` as a marker. This is also why start values use `:`.
- A start value must belong to the domain after filtering. If there is no start value, start at a random value.
- Shared and derived values need no extra syntax: put the marker in an `EQU` line (`step equ !(1..79)?coprime`) and use the label. The assembler evaluates expressions like `step*2`. If a marker is on an `EQU` line, use the label as the variable's display name; otherwise use `line:column`.
- Parse errors report line and column. After substitution, assemble with `Mars.parse_string` and report assembler errors together with the substituted values.

Example (syntax only, not a tuned warrior):

```
;redcode-nano
;name Example
;assert CORESIZE==80
step  equ !(1..79)?coprime:37
gap   equ !(-10..10)

      spl   #0,          ![<,{]gap
loop  mov.![i,f]  bomb,  @ptr
ptr   add   #step,       ptr
      ![jmp,djn]  loop,  !
bomb  dat   0,           0
```

**Output.** The best result is written back **as a template** with every marker given its start value (`!(1..79)?coprime:43`), so the output can be rerun, narrowed by hand or resumed. A second file holds the plain rendered warrior, ready to submit.

---

## 2. Engine layer (wrapping exMARS)

Put all exMARS access behind one small module, so the rest of the code never touches `Mars` directly and the engine could later be swapped (for example for a WebAssembly build in the browser, §12).

```python
class Engine:
    def __init__(self, hill): ...                      # Mars.Mars(2, core, cycles, processes, length, distance)
    def assemble(self, source: str) -> Warrior         # Mars.parse_string; raises AssemblyError with the message
    def code_hash(self, warrior) -> str                # hash of the assembled instructions + start offset
    def exact_pair(self, a, b) -> PairResult           # every position, both starting orders (§4)
    def sampled_pair(self, a, b, seed, rounds) -> PairResult   # seeded placements (§4)
```

Facts about the bindings that matter (verify each against the code and tests before relying on it):

- `Mars.Mars(warriors, coresize, cycles, max_processes, max_length, min_distance)`; `Mars.standard(2)` and `Mars.tiny(2)` exist as shortcuts.
- `parse_string(source)` assembles in memory with the pMARS parser. Check how assembly errors are reported (exception or return value) and wrap that.
- `rounds` and `fixed_position` are writable. `fixed_position` behaves like pMARS `-F`: it places warrior 2 at that address **for round 1** and seeds the placements of later rounds, so every `fight()` with the same value repeats the same placements. 0 means random. Its legal range is limited to legal positions.
- Warrior 1 sits at address 0 and starts round 1. The starting order rotates after each round.
- Each `fight()` is a fresh match. P-space persists across the rounds of one call.
- Results come from `scores()`, `wins(i, survivor_count)`, `losses(i)` and `results_str()`. Read `python_mars.c` to map them to wins, ties and losses per warrior.
- Safe early exit is on by default and does not change results. Leave it on.
- **`fight()` holds the GIL, and one `Mars` object must not be used from several threads.** Parallelism therefore uses **processes**: a pool of worker processes, each with its own `Mars` per hill, created once in the worker's initializer. Warriors are sent to workers as source text (or as their instruction lists) and assembled there once, with a per-worker cache keyed by code hash. On Windows, workers start with `spawn`, so worker functions must be importable top-level functions.
- The fork has optional builds specialised for fixed hill settings (`hill_config.h`). Treat them as a later speed option: the engine layer should accept a module name per hill so a nano-specialised build can be dropped in.

**Acceptance test (before anything else).** For each preset in §3, compare the engine layer with the exMARS CLI and with pMARS (`pmars -r 1 -F <pos>`, files swapped for the other starting order) on a few thousand single rounds. Include published hill warriors, imps, p-space warriors and random junk. Every result must match. Also check that two calls with the same `fixed_position` and `rounds` give identical results.

---

## 3. Hills

Hills are presets in a config file (TOML or JSON). Users can add their own.

| Preset | Core | Cycles | Processes | Length | Min distance | P-space | Instruction set |
|---|---|---|---|---|---|---|---|
| nano | 80 | 800 | 80 | 5 | 5 | verify | '94 |
| tiny | 800 | 8000 | 800 | 20 | 20 | verify | '94 |
| standard ('94 draft) | 8000 | 80000 | 8000 | 100 | 100 | 500 | '94 |
| 94nop | 8000 | 80000 | 8000 | 100 | 100 | none | '94 |
| lp | 8000 | 80000 | 8 | 200 | 200 | verify | '94 |
| 88 | 8000 | 80000 | 8000 | 100 | 100 | none | '88 |

Values marked "verify", the LP numbers, the tiny length and distance, and every hill's round count must be checked against the hill's published rules (koth.org, SAL, corewar.info) before use. Check how the bindings handle the '88 instruction set and p-space size; if a preset needs something the bindings cannot do, report it instead of working around it. Show the active settings at the start of every run and in the UI.

Scoring per pair: win 3, tie 1, loss 0. Report a warrior's score as `(3·W + T) / rounds × 100`, averaged over its opponents.

---

## 4. Fitness

Two modes, picked automatically per run:

**Exact** (small cores without p-space). The legal offsets are `MINDISTANCE .. C − MINDISTANCE` (nano: 71 positions, tiny: 761, standard: 7801). For each offset p, run `fight(candidate, opponent)` with `rounds = 1, fixed_position = p` (candidate starts), and `fight(opponent, candidate)` with `rounds = 1, fixed_position = (C − p) mod C` (opponent starts, same relative placement). Verify this mapping in a test. If `positions × 2 × opponents` fits the evaluation budget, the score is exact, with no noise. This is the default for nano.

**Sampled** (large cores, or p-space). Run R rounds per opponent in one `fight()` with a chosen `fixed_position` as the placement seed.

- **Common random numbers:** all candidates compared with each other use the same seeds, so differences come from the warrior, not from luck. Split R into slices with different seeds so racing (below) can stop early.
- **Reseed periodically** (for example every N accepted improvements) and re-evaluate the incumbent on the new seeds, so the search does not overfit one set of placements. Never use a single fixed position for the whole run.
- **Racing:** evaluate a new candidate on the first slices. Stop early when it is behind the incumbent by more than z standard errors (z ≈ 3). Only promising candidates get the full count.
- Report scores with their standard error.

**Cache** results in SQLite, keyed by (code hash of both warriors, hill, engine version, mode, seed or schedule id). Different template values often assemble to identical code, for example a field nothing reads, so caching on assembled code avoids re-evaluating them. The cache survives pauses and is shared between runs.

---

## 5. Search

- **Coordinate sweep** for variables with small domains (≤ `sweep_limit`, default 160). Try every value of one variable while holding the others, keep the best, move to the next variable, and repeat until a full pass brings no improvement. With exact fitness this is deterministic and cheap: a nano variable costs at most 80 evaluations per pass.
- **Annealing / local search** for large domains (standard core, 8000 values), in the style of Metcalf's script: change one variable per step (half the time a random value, otherwise a small ±delta mod C), and sometimes nudge several variables at once. Accept worse candidates with a temperature schedule that does not depend on benchmark size or round count.
- **Random restarts** from the best few results, to find combinations that only pay off when several variables change together.
- Stop on a time limit, an evaluation limit, or "no improvement in K steps", whichever comes first.
- **Every search strategy keeps all of its state in one serialisable object** (current values, position in the sweep, temperature, step counters, best results, RNG state). No state lives in local variables of long-running loops or generators. This is what makes pause and resume (§8) exact.
- Every accepted improvement is appended to a JSON-lines log: time, score, standard error, values, number of evaluations.

---

## 6. Benchmark modes

### Static (default)
A directory of `.red` files. Each must assemble under the hill settings; report and skip any that do not.

### Hill mode
The benchmark behaves like a hill, and warriors can be pushed off.

- **Hill size H** (default: the real hill's size, or the number of benchmark files).
- **Anchors:** benchmark warriors marked as pinned are never pushed off. They stop the hill from drifting away from the real hill.
- **Ranking:** a full round robin. Each member's score is its average against all other members. Store the pairwise results, so a newcomer only costs one new row.
- **Challenge:** when a candidate's fitness beats the incumbent of the run, it challenges the hill. It is scored against all members, and every member's score is recomputed with it included. If it ranks within H, it joins and the lowest-ranked unpinned member is pushed off.
- **Lineage cap:** at most L members (default 1) may come from the current run. A new run member replaces its own weaker relative instead of pushing someone else. Without this cap the hill fills with near-copies and the optimizer ends up tuning against itself.
- **Candidate fitness excludes the run's own hill members.**
- **The fitness landscape changes when the hill changes.** After every change, re-evaluate the incumbent and anything the search compares against.
- **Archive** every pushed-off warrior and report the final result against the archive as well as the hill. A warrior that wins against the current hill but loses to everything that was pushed off has found a rock-paper-scissors niche, not a better warrior.

---

## 7. Runs

A **run** is one optimization job with its own directory:

```
runs/<run-id>/
  run.json          # settings: template path + hash, hill, benchmark paths + hashes, mode, search options, seed
  state.json        # checkpoint (§8)
  log.jsonl         # accepted improvements and hill events
  best.template.red # current best, as a template with start values
  best.red          # current best, rendered, with ;name ;author ;strategy ;assert
  hill.json         # hill mode: members, pinned flags, pairwise results, archive
  report.md         # written when the run finishes
```

The SQLite score cache lives outside the run directories, so all runs share it.

---

## 8. Pause and resume

- **States:** `running`, `pausing`, `paused`, `finished`, `failed`. Any number of runs can exist; how many run at once is limited by the worker pool.
- **Checkpoint** = the complete state needed to continue exactly: the search object (§5) including RNG state, the incumbent and best results, evaluation counters, elapsed run time, the current seeds and schedules (§4), and the hill state (§6). The score cache is already persistent.
- **When to checkpoint:** on pause, every N seconds while running (default 60), after every accepted improvement, and on Ctrl-C or SIGTERM. Handle a second Ctrl-C as an immediate stop that still keeps the last checkpoint.
- **Write checkpoints atomically:** write to a temporary file in the same directory, flush, then rename over `state.json`. A crash must never leave a half-written checkpoint.
- **Pausing** stops handing out new evaluations, lets the ones in flight finish (or discards them; they are recomputed or found in the cache after resume), writes the checkpoint and frees the workers.
- **Resuming** reads `run.json` and `state.json` and checks that the template, benchmark files, hill settings and engine version still match their stored hashes. If something changed, show what changed and refuse to resume unless the user confirms. A changed benchmark then means re-evaluating the incumbent.
- **Version the checkpoint format** (`"format": 1`) so later versions can read or reject old checkpoints clearly.
- A run continued after a pause must produce the same results as an uninterrupted run with the same seed. Test this (§11).

---

## 9. Web interface

The Python process serves a local web UI (default `http://127.0.0.1:<port>`, bound to localhost only). The UI is a client of a small JSON API, and the command line uses the same core functions, so everything the UI can do can also be scripted.

**API sketch:** `GET /api/hills`, `POST /api/check` (template → variables, domain sizes, assembly result), `GET/POST /api/runs`, `GET /api/runs/{id}`, `POST /api/runs/{id}/pause`, `POST /api/runs/{id}/resume`, `POST /api/runs/{id}/stop`, `GET /api/runs/{id}/events` (server-sent events: progress, improvements, hill changes, state changes), `GET /api/runs/{id}/best`.

**Screens:**

1. **Runs list:** each run with hill, template name, state, best score ± standard error, evaluations, elapsed time, and Pause / Resume / Stop buttons.
2. **New run:** pick the hill preset, edit or upload the template (the editor highlights markers and shows the result of `check` live: variables, domain sizes, total search space, assembly errors), pick the benchmark directory, the mode (static or hill) and the limits.
3. **Run view:**
   - Header: state, Pause / Resume / Stop, evaluations per second, elapsed time.
   - Score over time (best and current), with standard error bands in sampled mode.
   - The current best warrior as rendered Redcode, with the optimised values highlighted, and buttons to copy or download `best.red` and the template.
   - A variables table: name, domain, current value, best value.
   - A per-opponent table for the best warrior (W / T / L and score), sortable, to show where it wins and loses.
   - In hill mode: the hill standings with pinned members marked, and a list of push-offs and the archive.

**Look:** reuse corewar.dev's visual tokens (colours, fonts, radii) from the layout brief in the same project, so the screens fit into corewar.dev's planned **Tools** tab later. Keep the frontend's dependency on the server limited to the JSON API and the event stream.

---

## 10. Command line

```
cwopt run    --hill nano --template stone.red --bench bench/nano/ [--mode static|hill]
             [--hill-size 20] [--pin bench/nano/anchors/] [--lineage 1]
             [--time 2h] [--evals N] [--workers 8] [--seed 1]
cwopt resume runs/<run-id>
cwopt pause  runs/<run-id>                                   # asks a running run to pause (also: Ctrl-C)
cwopt list                                                   # runs and their states
cwopt score  --hill nano warrior.red --bench bench/nano/     # one warrior, per-opponent table
cwopt rr     --hill nano bench/nano/                         # round robin of a directory, hill-style table
cwopt check  --hill nano template.red                        # variables, domain sizes, search space, assembly of start values
cwopt ui     [--port 8765]                                   # start the web interface
```

---

## 11. Tests

- Engine layer vs exMARS CLI and pMARS (§2) for every preset, including the exact-mode position mapping and the reproducibility of `fixed_position`.
- Template parser: every marker form, filters, start values, expressions with hill constants, `;` comments containing `!`, `!=` in `;assert` and `for`, errors with line and column, and a round trip (parse → write back → parse gives the same variables).
- Exact fitness equals the result of running every position through pMARS for a few warrior pairs on nano.
- A seeded run is reproducible, with 1 worker and with several.
- **Pause and resume:** a run paused and resumed (several times, including after killing the process between checkpoints) ends with the same results as an uninterrupted run with the same seed. A corrupted or partial `state.json` is never produced.
- Hill mode: anchors stay, the lineage cap holds, and the push-off order matches a hand-computed round robin.
- A known nano warrior with one constant deliberately broken: the optimizer finds the original value or a better one.
- API: every endpoint, and the event stream delivers progress and state changes.

---

## 12. Suggested order of work

1. Confirm the open points in §0.
2. Engine layer and its acceptance tests (§2).
3. Template parser, renderer and `cwopt check`.
4. `cwopt score` and `cwopt rr`: exact and sampled fitness, worker pool, SQLite cache.
5. `cwopt run` in static mode: coordinate sweep, then annealing, run directory, log, output template.
6. Checkpoints, pause and resume (§8), with their tests. Do this before hill mode, so hill state is designed to be checkpointed from the start.
7. Hill mode (§6).
8. Web API and UI (§9).
9. Speed: profile, tune the worker count, try a hill-specialised exMARS build for nano. Report evaluations per second for nano and standard.

---

## 13. Later (do not build now, but keep the design open for it)

- **Running in corewar.dev.** Two routes, to be decided later: (a) run this Python code in the browser with Pyodide and the exMARS C extension compiled for it, or (b) port the core (template, fitness, search, hill) to TypeScript and compile the exMARS C engine to WebAssembly. Either way the engine runs in Web Workers, and checkpoints go to browser storage or a downloadable file. To keep both routes open: keep the core free of server and file-system details (pass storage in as an interface), keep the engine behind the §2 interface, and keep the UI talking only to the JSON API and event stream.
- **Optimising the benchmark warriors too.** Hill members may themselves be templates. A later version lets the optimizer occasionally tune a member's constants against the rest of the hill, a form of co-evolution. Anchors and the archive (§6) keep this from drifting. Keep members stored as source that may contain markers.
- **Evolver.** The same engine, fitness, cache, hill, checkpoint and UI code, plus a genome of whole instructions. The bindings accept warriors as instruction lists (`Warrior.py`), so an evolver can skip the parser. Planned representation: fields that point inside the warrior are stored symbolically as "instruction j plus k" and rendered to relative offsets at output, so moving, inserting or crossing over instructions keeps internal references intact. Fields that are plain numbers (steps, counters, distant targets) stay constants. Keep the search code independent of the template module so it can work on genomes as well.

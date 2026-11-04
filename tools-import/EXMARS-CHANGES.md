# exMARS changes for corewar.dev's optimizer (handoff)

For a session working on **https://github.com/Bjoern/exMARS** (checked at `ecbff45`,
"Add optional WebAssembly tournament builds and benchmarks"). It says what to add to
exMARS's WebAssembly build so the corewar.dev Tools tab (constant optimizer) can run
its fights on exMARS instead of pMARS. Work only in exMARS. corewar.dev will vendor
the result in a separate change.

Background, with the measurements: corewar.dev `tools-import/HANDOFF.md` §11.

## 1. Why the current Wasm build is not enough

`wasm/client.mjs` `runMatch()` starts a **fresh Emscripten runtime per match**, writes
the sources to MEMFS, runs the CLI and parses stdout. That is right for the
tournament runner, but the optimizer's costs are dominated by startup:

| (Node 22, M1) | 1-round match (mostly startup) | each extra round |
|---|---|---|
| exMARS `runMatch`, nano | 1.7–1.8 ms | 0.8–1.1 µs |
| exMARS `runMatch`, standard | 2.0–2.2 ms | 0.39 ms |

- **Nano exact scoring** is every legal relative position in both starting orders,
  one round each: 2·(80 − 2·5 + 1) = 142 rounds per opponent. With a runtime per
  round, as cwopt's exact loop does, that costs about 17 s per candidate against 50
  opponents. The fighting itself is about 10 ms. Native cwopt does about 290
  candidates/s on 8 workers.
- **Standard sampled scoring** (250 rounds) is dominated by the simulator, and exMARS
  is already 2–4× faster there than corewar.dev's pMARS. Re-assembling each opponent
  for every match still wastes time.

So the optimizer needs an engine instance that **stays loaded**, with warriors
**assembled once** and fought many times. That is what `python_mars.c` already
offers natively (`parse_string`, settable `rounds`/`fixed_position`, and
`fight()`, which starts a fresh match on each call).

## 2. What to add

Add this alongside the existing modules and leave the existing ones as they are:
`exmars.mjs`, `reference-exmars.mjs`, `pmars.mjs`, `client.mjs`, `worker.mjs` and the
benchmark modules. Don't change the simulator's semantics in `sim.c`, `sim_loop.inc`
or `pspace.c`.

### 2.1 C layer: `wasm/fighter.c` (new)

A thin C API over `mars_t`, modelled on `python_mars.c` (`Mars_init`, `Mars_fight`)
but with no Python. It is built into its own module, `fighter.mjs` + `fighter.wasm`.
Suggested exports (prefix `ex_`, all returning `int` status, 0 = ok):

| Export | Does |
|---|---|
| `ex_configure(coreSize, cycles, processes, maxLength, minDistance)` | Allocates the `mars_t` and buffers once, as `Mars_init` with 2 warriors does. Reuse `sim_fixed_settings_error()`. Can be called again with other settings, which frees and reallocates. Clears all loaded warriors. |
| `ex_load(const int32_t *insns, int count, int start, int hasPin, int pin) → handle` | Stores a warrior: `count` instructions of 6 ints each (see §2.3). Validates `count ≤ maxLength`, `0 ≤ start < count`, and opcode/modifier/mode ranges. Returns a handle ≥ 0, or < 0 on error. |
| `ex_unload(handle)` | Frees the slot. |
| `ex_fight(a, b, rounds, fixedPosition, int32_t out[3])` | One match, exactly as `Mars_fight`: copy both warriors into `mars->warriors[0..1]` (setting `fl_START`), `check_sanity`, `clear_results`, seed from `fixedPosition` (0 = random) the same way, **reset P-space the same way** (`pspacesOrigin` restore, `sim_reset_pspaces`, `save_pspaces`, `amalgamate_pspaces`), then the round loop with `compute_positions`, `load_warriors`, `set_starting_order` and `sim_mw`. Writes the wins, ties and losses of warrior `a`. |
| `ex_fight_exact(a, b, int32_t out[3])` | Every relative position `p` in `minDistance..coreSize−minDistance`, one round each in both starting orders, summed. This is cwopt's `exact_pair()` (corewar.dev `tools-import/cwopt/engine.py` ~line 326), moved into C so there is no JS↔Wasm crossing per round. Total rounds = 2·(coreSize − 2·minDistance + 1). |
| `ex_set_early_exit(on)` | As the Python `early_exit` attribute. Default on (the "safe early ties"). |
| `ex_error() → const char*` | The last error message (`mars->errmsg` or the fighter's own). |

Rules:
- **Nothing may call `exit()` or `panic()`** on this path. If `sim_mw` returns < 0,
  return an error code and keep the message. If anything in the code this path uses
  can still exit, guard it, or keep that code out of `fighter.c`.
- Handles live in a growable table inside the instance, so the optimizer can keep
  about 100 opponents and about 1000 cached candidates loaded. Store instructions in
  the 6-int form and convert to `insn_t` when they are copied into a fight.
- Placements: `fixedPosition` has the **same meaning as the CLI's `-F` and the Python
  `fixed_position`**. A given (seed, rounds) must give pMARS's placements and
  starting orders, round for round. corewar.dev's sampled scoring uses `-F` seeds for
  common random numbers and checks the results against pMARS.

### 2.2 Assembler: separate, throwaway instance

The parser in `pmars.c` can `exit()` (`LOGICERROR`, `MEMORYERROR`, more than
`ERRMAX` errors, `panic`), and that would kill a persistent instance. So assemble
in **a fresh instance per call**, as `client.mjs` does now, and return data instead
of a file:

- A C export `ex_assemble(const char *source, coreSize, cycles, processes, maxLength, minDistance)`
  in the assembler module. It calls `assemble_warrior_from_string()` with a `mars_t`
  configured for the hill, so `CORESIZE`, `MAXLENGTH` and the other predefined
  constants and `;assert` evaluate correctly. It writes the 6-int instructions,
  `start`, the PIN (if any), `;name`/`;author`, and the warnings and errors text into
  a result buffer.
- In JS, catch Emscripten's `ExitStatus`, turn it into
  `{ok:false, errors, warnings}`, and throw the instance away.
- About 2 ms per assembly is fine. The optimizer assembles each distinct candidate
  once and caches it by a hash of the assembled code.

It can be a new module (`assembler.mjs`), or one more export on `exmars.mjs` if
that is cleaner. The fighter module must not include the parser's exit paths.

### 2.3 Instruction encoding

Use the same 6-int tuples as the Python binding: `(opcode, modifier, a_mode, a_value,
b_mode, b_value)`, with the binding's numbering (`Warrior.py`, `insn.h`, the `OP()`
macro) and values reduced with `MODS(x, coreSize)` on load. corewar.dev treats them
as opaque: they come out of `assemble()` and go into `load()`. Document the
numbering in `wasm/README.md` all the same, so a listing can be shown later.

### 2.4 JS wrapper: `wasm/fighter-client.mjs` (new)

```js
import {assemble, createFighter} from './fighter-client.mjs';

const hill = {coreSize: 80, cycles: 800, processes: 80, maxLength: 5, minDistance: 5};
const w = await assemble(source, hill);
// -> {ok: true, instructions: [[op, mod, am, a, bm, b], ...], start, pin|null, name, author, warnings: []}
//  | {ok: false, errors: '...', warnings: '...'}

const f = await createFighter(hill);   // one per Web Worker, kept for the whole run
const h = f.load(w);                     // handle; throws on invalid input
f.fight(h, h2, {rounds: 250, position: 1234});  // -> {wins, ties, losses}
f.exact(h, h2);                          // -> {wins, ties, losses, rounds}
f.unload(h);
f.configure(otherHill);                  // drops all handles
f.dispose();
```

- Validate inputs the way `runMatch` does: integers, `maxLength ≤ minDistance`,
  `2·minDistance ≤ coreSize`, source ≤ 64 KiB, and `position` 0 or within
  `minDistance..coreSize−minDistance`.
- Use typed-array views on `HEAPU8`/`HEAP32` and a `malloc`'d scratch buffer, not
  MEMFS or stdout parsing.
- Build flags for the fighter: like `build()` in `wasm/build.py`, but with
  `-sEXIT_RUNTIME=0`, no `FORCE_FILESYSTEM`, and `-sEXPORTED_FUNCTIONS` for the `ex_*`
  functions plus `_malloc`/`_free`, with `-sEXPORTED_RUNTIME_METHODS` for the heap
  views. Keep `MODULARIZE`, `EXPORT_ES6` and `ENVIRONMENT=web,worker,node`. Keep
  `ALLOW_MEMORY_GROWTH` and re-read the heap views after any call that may grow
  memory.
- Optional: extend `wasm/worker.mjs` with `method: 'fighter'` messages, for the
  smoke page only. corewar.dev will drive the fighter from its own worker
  (`docs/optimizer-worker.mjs`).

### 2.5 Build and packaging

- Add the new modules to `wasm/build.py`. Record them in `manifest.json` with
  source and artifact hashes, and include their sources in `dist/wasm/sources/` as
  for the others. The GPL parser obligations apply to the assembler module.
- `dist/` is gitignored, but corewar.dev vendors **built** engine files with SHA-256
  pins (see corewar.dev `engine-lock.json`, which pins `docs/dist/pmars.mjs`,
  `pmars.wasm` and a source zip from `Bjoern/pmars_experiments`). Commit the files
  corewar.dev should take in a tracked folder, for example `wasm/release/`:
  `fighter.mjs`, `fighter.wasm`, `fighter-client.mjs`, the assembler module and its
  `.wasm`, `manifest.json`, and a source zip. Say in the commit message which commit
  and which files to pin.
- Emscripten 4.0.23 is the tested version (`wasm/README.md`). If the session has no
  emsdk, install that version and say so in the commit or PR.

## 3. Tests (add to `make wasm-test`)

New `wasm/test-fighter.mjs`, run in Node against `dist/wasm`:

1. **Same results as the CLI.** On the `warriors/benchmark` corpora for nano, tiny,
   standard, 94nop and lp, run random pairs and several `-F` seeds and round counts
   both ways: `fighter.fight` against `runMatch` (`exmars`) and against `pmars`.
   Results must match exactly.
2. **Exact equals the sum of single rounds,** and equals pMARS's permutation mode
   (`pmars` CLI with `-P` and `-r 2·(coreSize−2·minDistance+1)`) in total wins, ties
   and losses, on nano and tiny.
3. **Reuse.** 1000 mixed `fight`/`exact` calls on one instance give the same results
   as a fresh instance per call. Include P-space and PIN warriors
   (`tests/pmars_compat/pin_reader.red`, `pin_writer.red`, `immediate_b_stp.red`),
   so P-space stays within a match and resets between matches. Also run calls after
   a failed `load`, after `unload`, and after `configure` with other settings.
4. **Assembler.** `assemble()` gives the same tuples, start and PIN as the Python
   binding's `parse_string` on the corpora. A source with more than `ERRMAX` errors
   and other broken input returns `{ok:false}`, and later calls still work.
   `;assert CORESIZE==80` passes on nano and fails on standard.
5. **Throughput** (prints, doesn't assert): one candidate exact against 50 nano
   opponents (`warriors/benchmark/nanobm07`), and one candidate against 20 standard
   opponents at 250 rounds. Report ms per candidate next to the `runMatch` numbers
   in §1. Expect nano exact to be on the order of 10–20 ms per candidate, not
   seconds.
6. Update `wasm/browser-smoke.html` to run `assemble` + `fight` + `exact` inside a
   module Worker. Run it in Chromium if the session has one.

Also keep the existing `make wasm-test` passing.

## 4. Limits (keep as they are; corewar.dev falls back to pMARS)

Out of scope: '88 mode, a free permutation toggle (`exact` covers the optimizer's
use), custom P-space size (exMARS uses CORESIZE/16), score formulas other than
3/1/0, and more than two warriors. corewar.dev will use the fighter only for hills
within these limits and keep pMARS for the rest, for the Battle tab and for the
debugger. Document the limits in `wasm/README.md` and don't silently accept
settings that need them. The fighter takes only the five settings above, so that
is easy.

## 5. Done means

- `fighter.c`, `fighter-client.mjs`, the assembler entry point, the build changes and
  `test-fighter.mjs` committed on a branch of `Bjoern/exMARS`, with `make wasm` and
  `make wasm-test` passing.
- The release files (§2.5) committed, with their hashes listed in the commit message
  or PR.
- `wasm/README.md` gets a "Persistent fighter" section with the API in §2.4, the
  encoding, the limits and the throughput numbers.
- A short note back for corewar.dev: the exMARS commit, the files to vendor, and
  anything that differs from this plan.

## 6. For reference: how corewar.dev will use it (not part of the exMARS work)

- `docs/optimizer-fitness.mjs` `runMatch(job)` currently builds a pMARS `Engine` per
  job (`job = {config, a, b, rounds, position}`, or `permutate: true` for exact).
  Each optimizer worker will instead keep one fighter per hill. It will assemble
  each new source once, keep a cache of handles keyed by the source and by a hash
  of the assembled code, and call `fight`/`exact`.
- Settings map as in `wasm/README.md`: `tasks` → `processes`, `distance || maxLength`
  → `minDistance`, a numeric `fixedPosition` → `position`.
- The files go to `docs/dist/exmars/` with their own lock file (`exmars-lock.json`),
  checked by `scripts/build.py` like `engine-lock.json`. pMARS and
  `engine-lock.json` stay unchanged.

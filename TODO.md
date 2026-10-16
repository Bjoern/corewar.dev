# Future improvements

## Reuse engine instances between matches

Today every match (each tournament matchup, each emulator load) gets a brand-new
Wasm instance. `docs/engine.mjs` compiles `pmars.wasm` once per page or worker
and only instantiates per match, so the remaining per-match cost is instance
creation plus `web_configure`. The fresh instance stands in for a reset,
because pMARS has none: it was a one-process-per-match CLI, `web_configure`
refuses a second call, and match state is spread across C globals (options,
core/task queues, assembler tables, P-space, warrior structs, cdb macros) plus
Emscripten's JS-side MEMFS (`/warrior-N.red`).

Measure first: time instantiation vs. battle duration in a 100-matchup
tournament. Only pursue the options below if instantiation is a meaningful share.

- **Memory snapshot/restore.** Snapshot linear memory right after
  instantiation and copy it back before each match. This catches every C global
  without an audit. It also needs the stack-pointer global restored and the
  MEMFS warrior files cleared, and assumes memory never grows (or handles growth).
- **Native `web_reset()`.** Audit all pMARS globals and reset them explicitly,
  then clear the `configured`/`started`/`loaded[]` flags in `src/webapi.c`
  (pmars_experiments). Fastest in principle, but a missed global silently leaks
  state (P-space, scores, RNG) between matchups. Needs a test that runs the
  same matchup on a reused and a fresh instance and compares results.
- **Share one compiled module across workers.** Compile on the main thread and
  `postMessage` the `WebAssembly.Module` to tournament workers instead of each
  worker fetching/compiling once.

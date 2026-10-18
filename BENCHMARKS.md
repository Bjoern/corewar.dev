# Benchmark descriptors

Put public collections under `warriors_public/`, preserving their subdirectories.
Each selectable suite has a file ending in `.benchmark.json` in its directory:

```json
{
  "version": 1,
  "name": "My Nano Benchmark",
  "parameters": {
    "coreSize": 80,
    "cycles": 800,
    "tasks": 80,
    "maxLength": 5,
    "distance": 5,
    "rounds": 100
  },
  "warriors": ["first.red", "second.red"]
}
```

Warrior paths are relative to the descriptor and cannot escape its directory.
List files explicitly to preserve suite membership and ordering. Keep source
attribution and collection README files alongside them. The build packages only
suites with descriptors; it does not guess rules from folder names.

Parameters: `coreSize`, `cycles`, `tasks`, `maxLength`, `distance`, `pspace`,
`rules88`, `noPspace`, `permutate`, `formula`, and `rounds`. Omitted settings use pMARS defaults;
omitted rounds defaults to 100. Descriptors can also retain descriptive metadata
such as `description`, `sourceUrl`, and `retrievedAt`. `"listed": false` keeps a
suite in the repository without offering it in the app, for example a full hill
that a smaller suite is derived from.

Selecting a suite (or applying an edited descriptor) sets its default rounds.
The editable Rounds per matchup field overrides that default for the next run.
All other suite parameters replace the shared match settings for benchmark runs.
While Benchmark mode is selected, the match settings bar is dimmed, and a note
states the settings the suite actually uses, such as ICWS ’88 for the '88 hill.
The tournament seed still controls placement.

## Push-off rankings

Set Ranking to a push-off variant (see `PUSHOFF.md`) to place each selected
warrior within the suite's hill. Each candidate is added to the hill on its
own, fights every hill warrior once plus its self fight, and the push-off then
ranks it among all of them. Candidates do not fight each other here; a
Round robin with push-off ranking covers that.

The hill warriors' results against each other come, in this order, from:

1. a scores file shipped with the suite: `"scores": "hill-scores.json"` in the
   descriptor, next to it;
2. this browser's cache, keyed by the warrior sources, the match settings that
   decide results (not rounds, seed or score formula) and the engine build;
3. otherwise the run also fights every hill pair once, self fights included,
   and caches the result.

Scores are stored per round (KOTH percent × 10 000), so hill scores from, say,
1000 rounds combine correctly with candidate fights at 100. More hill rounds
only reduce noise. Hill fights have their own *Hill rounds per pair*: by
default 1000 on cores above 1000 cells, and every starting position on smaller
cores (Nano: 142 rounds per pair, Tiny: 1522). *All starting positions* can
also be ticked for large cores; a warning shows when the hill would need more
than 5 million rounds (the '94 hill would need 27.6 million). Neither rounds
nor permutation invalidate stored scores. Tick *Recompute hill scores* to
refresh them. Push-off benchmark fights place warriors by a key derived from
the pair and the seed, so the same pair starts from the same positions in
every run.

### Shipping hill scores with a suite

Hill scores belong next to the suite's descriptor, as `hill-scores.json`,
referenced by `"scores": "hill-scores.json"` in the descriptor. Generate them
with the app's own engine and planner:

```
node scripts/precompute-hill.mjs warriors_public/94top50
node scripts/precompute-hill.mjs warriors_public/94top50 --all-positions --yes
```

Options: `--rounds N`, `--all-positions`, `--workers N` (default: all
processors), `--seed S` (default `hill-1`). Runs over 20 million rounds need
`--yes`. The script writes the file, adds the `scores` field (keeping the
descriptor's line endings) and records rounds, permutation, seed, date and
engine. Rebuild with `python scripts/build.py`. A 59-warrior Koenigstuhl
hill at 1000 rounds takes about 4 minutes on a 20-thread machine.

`--exmars <exmars-fast.exe or bundle folder>` runs an exMARS executable
instead, about three times faster (78 seconds for the '94 hill). Given a bundle
folder, it picks the `standard` build for core 8000 / 8000 processes and
`generic` otherwise. exMARS places warriors exactly like pMARS for the same
numeric `-F`. Builds before the pMARS compatibility fixes of 2026-10-18
misassembled some expressions (Bipolar, Twister), handled immediate B operands
and PIN differently in P-space battles, and overflowed ADD/SUB on cores above
32768. With the fixes, exMARS matched pMARS in every pair on the '94nop, '88,
P-space and LP Koenigstuhl hills. The script first runs three two-round probe
battles that only fixed builds pass, and refuses older builds such as the
bundle in `resources/`. `--verify N` additionally reruns N random pairs on the
built-in engine and saves nothing if any differ.
exMARS has no permutation option, so `--all-positions` needs the built-in
engine, and no '88 assembly mode (warriors are assembled with '94 defaults,
which reproduce '88 behaviour). The shipped '94nop and '88 scores came from the
old build, which matched pMARS on those hills in every cell; the P-space and LP
scores came from the built-in engine.

### Placement seeds

Tournament and benchmark jobs pass pMARS a numeric `-F` derived from a text
key (seed, matchup or warrior pair). That way the same `-F` reproduces a run
in pMARS, KOTH scripts and exMARS, which all use the Park–Miller generator for
numeric seeds. pMARS also accepts text for `-F` and turns it into an RC5 key.
Up to 0.9.6-dev its rotate macros (`ROL`/`ROR` in `pos.c`) shifted by `y`
instead of `32 - y`, so text keys gave clustered placements: often only a few
hundred distinct offsets in 1000 rounds, with similar keys colliding. The
pinned engine (pmars_experiments `b074237`) has the fix, so text values typed
into the Battle settings are safe too. The derived value is never the minimum separation itself:
that is seed 0, which exMARS never advances.

In the app, *Download hill scores (.json)* under Suite details saves the scores
of the last push-off benchmark run in the same format. Scores whose parameters
or warrior list no longer match the descriptor are reported and ignored.

## Session imports

In Benchmark mode choose Import benchmark and select exactly one JSON descriptor
and its warrior files together. Import folder supports nested paths. The suite
appears in the dropdown without changing the emulator roster. Expand Suite details
to inspect opponents or edit the descriptor; changes are local to this session.
Download descriptor saves edited metadata; retain the warrior sources separately.
An import with missing, duplicate, or unsafe paths is rejected without replacing
existing suites. Up to 500 opponents, 64 KiB per source, are supported.

Self fights includes a warrior against itself in round robin/Challenge. In
Benchmark mode it includes opponents whose source text exactly matches the
candidate; unchecked skips those entries. It does not use warrior names as an
identity test. Melee ignores this option because all entrants already share a core.

## Supplied catalog (2026-10-18)

The catalog lists 13 suites with 604 runnable opponent entries. Original files,
readmes, and historical runner scripts are preserved under `warriors_public/`.
Koenigstuhl archive membership follows the supplied files, not an inferred top-50
ranking: 59 '88 opponents, 59 '94nop opponents, and 53 P-space
opponents. Numb is included with the corrected pinned assembler. The 2026-10-18
snapshots add the low-process hill (149 warriors, `lp.opt`: 8 processes, length
200; unlisted, the app offers its top 50 by average score in the hill scores, in
`lp_koenigstuhl/top50.benchmark.json`, with scores taken from the full matrix) and the experimental X hill (214 warriors, `94x.opt`: core 55440, 500000
cycles, 10000 processes, length 200); both allow P-space.
Hill scores ship for the '94nop, '88, P-space and LP Koenigstuhl suites and
Franz's Tiny. The X hill has none yet (23 million rounds at up to 500000
cycles); until then a push-off benchmark against it fights the hill pairs in
the browser.
Franz's Tiny contains 10 of the 20 warriors described by its README and is labeled
partial. Nano 2007 uses permutation mode with a 142-round default, covering every
legal relative placement and both first-warrior choices. Round overrides can
request a partial pass or additional passes.
Historical `-F` positions are replaced by the tournament seed for all suites.

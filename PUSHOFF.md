# Push-off rankings (spec)

Implementation brief for push-off tournaments and benchmarks in corewar.dev.
It is based on the reference scripts in `resources/`:

| file             | what it does                                                                 |
|------------------|------------------------------------------------------------------------------|
| `scheduler2.rb`  | John Metcalf's scheduler: all-vs-all battles with self fights, written in the Koenigstuhl format |
| `koenformat.txt` | the Koenigstuhl `hill32.dat` / `hill32.scores` format                        |
| `pushoff.rb`     | sequential push-off                                                          |
| `diversity.rb`   | diversity push-off (Achille Astolfi, *A Numeric Approach to Diversity Hills*) |

The November Corewar Tournament announced a third variant:

> This year's tournament winners will be determined by a variant of iterative
> diversity push-off. First the entrants are added to the top-x warriors of the
> Koenigstuhl hill. Then each warrior is scored by the product of its average
> score and the lowest SD-score between the warrior's individual scores and the
> individual scores of other warriors. Final rankings will be based on each
> entry's position in the iterative push-off.

That variant uses the SD-score from Ismael, *Journal of Big Data* 12:58 (2025),
doi:10.1186/s40537-025-01091-z, Eq. 6–7:
`SD(x, y) = Σₖ|xₖ − yₖ| / Σₖ σₖ`, where σₖ is the population standard deviation
(dividing by m) of attribute k.

## 1. Score matrix (Koenigstuhl format)

`hill32.dat` is text. The first line is the number of warriors n. Then come n
blocks of 4 lines each: name, author, file name, and hill format (`88`, `94` or
`P-space`).

`hill32.scores` holds n×n little-endian int32 values in row-major order.
Entry `[row][col]` is **the column warrior's score against the row warrior**.

Scale: `scheduler2.rb` stores `(3·wins + ties) · 1 000 000 / rounds` with
integer division. That is the usual KOTH percentage score (0–300) × 10 000, as
`koenformat.txt` says. A stored value of 1 500 000 means 150.000.

Both scripts transpose the matrix after reading it. That gives
`v[i][j]` = warrior i's score against warrior j, so row `v[i]` is warrior i's
score vector. The rest of this spec uses `v`.

How `scheduler2.rb` fills the matrix:

- It battles every unordered pair once, **including self fights**
  (`war2` starts at `war1`). One battle fills both `v[i][j]` and `v[j][i]`.
- It uses `-r 1000` rounds and `-F 7293`, which puts warrior 2 at a fixed
  position.
- It writes the values unsigned (`L<`) while the push-off scripts read them
  signed (`l`). The two agree because scores are never negative.

## 2. The push-off loop (shared by all variants)

```
P = all warriors
while |P| > 1:
    compute a criterion c(i) for every i ∈ P, using only rows and columns in P
    remove the warrior with the lowest c (ties: see each variant)
    log (|P| before removal, displayed values, warrior)
the last warrior left is ranked 1
```

Ranking is the reverse of removal order. A warrior's position is the size of
`P` at the moment it was removed: the first removed is n-th, the last left is
1st. Removing a warrior deletes its row **and** its column. Everyone else's
average and distances are then recomputed without it. No battles are re-run.

## 3. Variants

### 3a. Sequential push-off (`pushoff.rb`)

- `c(i) = Σ_{j∈P} v[i][j]`. **The self-fight score `v[i][i]` is included.**
- Displayed score: `c(i) / 1e4 / (|P| − 1)`, formatted `%3.3f`.
- Ties: the lowest index wins the removal (`each_with_index.min`), meaning the
  lowest current position in `P`, which follows the original order.

### 3b. Diversity push-off (`diversity.rb`, Astolfi)

- Before the loop, set the diagonal to 0 (`v[i][i] = 0`).
- Let `w = |P| − 1`.
- `avg(i) = Σⱼ v[i][j] / w / 1e4`. The diagonal is 0, so this is the mean over
  real opponents, in percent.
- `dist(i) = sqrt( min_{j≠i} Σ_{k∈P} (v[i][k] − v[j][k])² / w ) / 3e6`.
  The sum runs over **all** k in P, k = i and k = j included. Those entries
  compare a zeroed self score with a real score. Keep this to match the script.
- `c(i) = dist(i) · avg(i)`.
- Displayed: `c`, `dist`, `avg`, each formatted `%7.3f`.
- Ties: Ruby compares the arrays `[c, dist, avg]` element by element, then
  the index.

### 3c. SD-score diversity (the November tournament)

This is 3b with the distance replaced by the SD-score:

- Zero the diagonal and set `w` as in 3b.
- `σₖ` = population std. dev. of column k: `v[r][k]` over all r ∈ P,
  zeroed diagonal entry included.
- `sd(i) = min_{j≠i} Σ_{k∈P} |v[i][k] − v[j][k]| / Σ_{k∈P} σₖ`. This is unitless.
- `c(i) = sd(i) · avg(i)`, with avg as in 3b. Display and ties as in 3b.

**Important:** within one step, `Σσₖ` is the same for every pair. So the
nearest neighbour and the removal order are **exactly those of "avg × nearest
Manhattan (L1) distance"**, and the σ convention only changes the displayed
numbers. Implement the SD-score as written so the displayed values match
the organisers', and add a test asserting the L1 equivalence.

### Open questions for the organisers (keep each as an option)

1. Is the distance over all k, as in `diversity.rb`, or only over common
   opponents k ∉ {i, j}? Unlike the σ convention, this choice **can** change
   the ranking. It matters most for clones. Over all columns, two identical
   warriors that tie each other at 100 are still apart, because each one's
   zeroed self score lines up with the other's 100. So a clone pair is not
   necessarily pushed off first. Over common opponents their distance is 0.
   `docs/test-pushoff.mjs` has an example.
2. Is σₖ computed with or without the zeroed diagonal entry? This only
   affects displayed values.
3. "Top-x": which ranking defines the top x? The supplied suites are not in
   hill-rank order (`BENCHMARKS.md`).
4. Rounds and placement: is it 1000 rounds with `-F 7293`, like the scheduler?

## 4. corewar.dev features

**Status (2026-10-18):**
- 4a is done: `docs/pushoff.mjs` and `docs/test-pushoff.mjs`. Its output
  matches the Ruby scripts line for line on the fixture and on a real exported
  tournament.
- 4b is done: the Ranking choice on round robin, the push-off table and
  removal log, and the Export score matrix (.zip) button.
- 4c is done in a simpler form. Benchmarks offer the push-off rankings.
  Hill scores come from a shipped `hill-scores.json` (JSON rather than the
  binary Koenigstuhl files), the browser cache, or the run itself. Pair-keyed
  placement is used for these runs. Hill fights have their own rounds (default
  1000, or every starting position on cores up to 1000 cells), and
  `scripts/precompute-hill.mjs` generates the shipped file. See `BENCHMARKS.md`.
- The UI has no option yet for `distanceOver: 'common'`; the module supports it.
- 4d (entrants fighting each other plus the hill, ranked together) remains.
  Benchmark push-off ranks each candidate against the hill separately.

### 4a. Push-off module (pure)

`docs/pushoff.mjs`:

- `pushoff({warriors, v, variant, options})` returns
  `{ranking, steps: [{size, removed, values}]}`.
- Variants: `'average'` (today's single sort), `'sequential'`, `'diversity'`,
  `'sd-diversity'`.
- Options: `distanceOver: 'all' | 'common'` and `sigmaIncludesDiagonal`, for
  the open questions above.
- `readKoenigstuhl(datText, scoresBytes)` and
  `writeKoenigstuhl({warriors, v})`, for the format in §1. Validate that the
  count line matches the number of blocks and that the byte length is 4·n².

### 4b. Tournaments

Round robin gains a **Ranking** choice: Average (default), Sequential push-off,
Diversity push-off, or SD-score diversity.

- The push-off rankings need the full matrix. Sequential needs self fights, so
  selecting it turns Self fights on (or warns).
- Results show the final table: position, name, the variant's columns, and
  each warrior's nearest neighbour for the diversity variants. They also show
  an expandable removal log that mirrors the scripts' output lines.
- **Export results** writes `hill32.dat` and `hill32.scores`. Use the
  scheduler's scale and integer division. Use the hill format `94`, `88` or
  `P-space` derived from the settings. Name, author and file come from the
  warrior.

### 4c. Benchmarks with precomputed hill scores

A benchmark suite can ship the hill's score matrix, so only the candidates
battle:

```json
{
  "version": 1,
  "name": "Koenigstuhl ’94nop top 50",
  "parameters": { "...": "as today", "rounds": 1000 },
  "warriors": ["HILL32/a.red", "..."],
  "scores": {
    "dat": "hill32.dat",
    "matrix": "hill32.scores",
    "selfFights": true,
    "placement": "seed:<seed>" ,
    "engine": "<pmars build id from engine-lock.json>",
    "createdAt": "2026-10-18"
  },
  "pushoff": { "variant": "sd-diversity", "top": 50 }
}
```

- `.dat` entries match `warriors` by file name, in order. Reject the suite if
  any file is missing, duplicated, or if the matrix size is not n².
- **Run, for each candidate separately:** candidate vs every hill warrior in
  the first `top` warriors, plus its self fight, with the suite's parameters
  and rounds. One battle gives both `v[c][h]` and `v[h][c]`. Then build the
  (top+1)² matrix from the stored hill block plus the new row and column, and
  run the push-off. The report gives the candidate's position, its removal
  step, its nearest neighbour, and the full ranking.
  - Candidates are **not** battled against each other in benchmark mode.
    Push-off mode with entrants in a tournament covers that.
- Workload drops from about (top+1)²/2 matchups to top+1 per candidate.
- **Trust the matrix only for the parameters it was made with.**
  - If the user edits the suite parameters or rounds, or the engine differs,
    show "precomputed scores don't match these settings". Offer to recompute
    the hill matrix in the app, which is a full round robin with self fights,
    or to run anyway, labelled as such.
  - Placement: the app replaces historical `-F` positions with the tournament
    seed (`BENCHMARKS.md`). So hill matrices should be generated **by
    corewar.dev itself**, with a recorded seed, rather than imported from
    `-F 7293` runs.
  - Add a "Build score matrix" action on a suite. It runs the round robin and
    downloads `hill32.dat`, `hill32.scores` and the updated descriptor for
    checking in.
  - Today's placement key is `tournament:${seed}:${jobIndex}`
    (`docs/tournament-plan.mjs`), which depends on the job's position in the
    run. For a stored hill block to be reproducible and comparable, key
    placement by the pair instead, e.g. `pair:${seed}:${hash(srcA)}:${hash(srcB)}`.
    Then the same two warriors get the same positions in any run.
  - Externally computed Koenigstuhl files can still be imported. Mark them
    with `"placement": "pmars -F 7293"`.
- Also extend `docs/benchmarks.mjs` (`benchmarkParameters`), the import
  validation, `scripts/benchmark_catalog.py` (so the build packages the score
  files), and `BENCHMARKS.md`.

### 4d. Tournament mode "Hill push-off"

This is how the November rules are run: entrants plus the first x warriors of
a suite, everything against everything. When the suite has a matching matrix,
reuse its hill block and battle only entrant–hill pairs, entrant–entrant pairs
and entrant self fights. Rank with the suite's variant. Show both overall
positions and the order among entrants.

## 5. Golden test

Fixture: `resources/fixture5/hill32.dat` and `hill32.scores`. These are 5
warriors, A–E. `v[i][j]` in points per round, diagonal = self fight:

|   | A   | B   | C   | D   | E   |
|---|-----|-----|-----|-----|-----|
| A | 1.4 | 2.0 | 1.0 | 1.5 | 2.2 |
| B | 0.5 | 1.3 | 1.0 | 1.5 | 2.1 |
| C | 1.8 | 1.6 | 1.0 | 0.4 | 0.9 |
| D | 1.2 | 1.0 | 2.4 | 1.2 | 1.3 |
| E | 0.6 | 0.7 | 1.9 | 1.4 | 1.1 |

Expected output lines. The sequential and diversity columns were confirmed on
2026-10-18 by running the Ruby originals (Ruby 3.4.11) on the fixture. They
match `resources/fixture5/port.py` exactly. The sd-diversity column comes from
that port only, since no Ruby original exists, by swapping the distance in the
confirmed diversity code.

On Windows, the scripts' `File.read` opens `.scores` in text mode, which
corrupts it (0x1A ends the read early, CR/LF pairs are converted). Run them
with `File.read` redirected to `File.binread` for `.scores` files.

```
sequential          diversity                          sd-diversity
5  142.500  C       5   39.975    0.348  115.000  E    5   92.246    0.724  127.500  B
4  126.667  E       4   39.675    0.397  100.000  B    4  130.109    1.259  103.333  C
3  165.000  B       3   60.528    0.550  110.000  C    3  139.575    1.396  100.000  E
2  240.000  D       2   76.837    0.640  120.000  D    2  240.000    2.000  120.000  D
1  A                1  A                               1  A
```

The three variants remove warriors in three different orders, so this fixture
also catches swapped variants. Further tests:

- the L1 equivalence for sd-diversity;
- two identical warriors: one is removed first under both diversity variants;
- Koenigstuhl read/write round trip, including transposition;
- deterministic tie-breaks;
- the benchmark matrix assembly (hill block + candidate row and column)
  equals a full round robin when the hill matrix was built with the same seed.

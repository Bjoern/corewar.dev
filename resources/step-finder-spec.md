# Spec: Step finder tool for corewar.dev

## Goal

Add a tool to corewar.dev that helps warrior authors pick a bombing/scanning step size. For a given core size, it should rank candidate steps by how quickly they find opponents of the sizes the author cares about, and explain *why* a step is good or bad. Ranking by one opaque "optima score" is not enough.

Use the existing stack and conventions of the corewar.dev repo (framework, styling, test runner). Put the math in a pure, UI-free module so it can be unit-tested and reused.

## Background

A bomber or scanner visits `0, s, 2s, 3s, … (mod N)`, where `s` is the step and `N` is the core size (8000 on the standard hill).

- **mod** = `gcd(s, N)`. The full run has `N / mod` hits and ends with evenly spaced hits every `mod` cells. The mod sets the final guarantee: a warrior of length ≥ mod is always hit by the end of the run.
- Steps `s` and `N − s` give mirror-image patterns. Only consider `1 ≤ s ≤ N/2`, but let the user pick the sign.
- **Three-gap theorem:** after any number of hits, the gaps between hits take at most three distinct sizes. Gap structure follows the continued fraction (Euclid's algorithm) of `s / N`.

What matters in practice (from discussion with the author):
- Real warrior bodies are small (often 5–8 instructions, usually < 15). Only the boot code is longer.
- During boot (the first few dozen cycles), any reasonable step gives roughly the same hit chance. Avoid degenerate steps (e.g. 1001 for N = 8000, which lays bombs 8 apart for hundreds of hits).
- Steps differ most in **how fast the empty gaps drop below small sizes (20, 15, 10)**. That decides how quickly a small body is guaranteed to be hit.

## Algorithms to implement

All functions take `(step, coresize)` and return plain data.

### 1. Gap sequence (the author's existing algorithm, port from Python)

This is a signed nearest-remainder Euclid. Each term is the step at which the previous gap size gets filled.

```
seq = [s]; dir = 1; M = N
while M % s != 0:
    f = M // s
    next = ((f + 1) * s) % M
    dir = dir * (-1 if next > s - next else 1)
    old = s
    s = min(next, s - next)
    seq.append(dir * s)
    M = old
return seq
```

Use integer modulo for the loop test. The original Python used `M / s != M // s`.

Also show the **ratio between consecutive terms** (|a_i| / |a_{i+1}|). Ratios around 2–3 are cheap. A large ratio (> ~4) means a long, slow phase and should be highlighted as a warning. The last term's absolute value equals the mod.

### 2. Find-x profile (main ranking metric)

`findx(s, N, x)` = the number of hits (the first hit at 0 counts as hit 1) until **no run of ≥ x consecutive unbombed cells remains**. After that point, any warrior of length ≥ x has been hit.

- Lower bound: `ceil(N / x)` hits, roughly. With mod `m`, spacing can never go below `m`, so `findx` for `x ≤ m` is only reached at the end of the run, or never.
- Return `null` when x is never reached.

**Efficient implementation (needed to scan every step in the browser):**
Don't insert into a sorted array, which is O(N²) per step. Run it in reverse instead:
1. Generate all `K = N / mod` hit positions in order.
2. Build a circular doubly linked list of them in **sorted position order**.
3. Remove hits in **reverse hit order**. Each removal merges two gaps, so the max gap never decreases going backwards. Track it in O(1).
4. Record the max empty run after each prefix length `n`. Then `findx(x)` = the smallest `n` whose max empty run is < x.

This is O(N) per step and about 6.4·10⁷ operations for all steps with N = 8000. Run it in a **Web Worker** with progress reporting so the UI doesn't freeze.

### 3. Classic optima score (Nándor), for reference

Score = the sum, over hits in order, of the distance from each new hit to the closest *earlier* hit. Higher is better. The same reverse-removal pass gives this for free: when removing hit p, its list neighbours are its nearest earlier hits.

### 4. Euclid step count (Andy Pierce / Fibonacci idea), for reference

```
euclid(s, N) = s == 0 ? 0 : 1 + euclid(N % s, s)
```

Higher means more Fibonacci-like (golden-ratio) gap splitting.

## UI

**Inputs**
- Core size (default 8000)
- Mod filter: any, or a specific value (e.g. 4, 5, 8)
- Step range (default 1..N/2)
- Target sizes x for find-x (default `100, 20, 15, 10`, editable)
- Ranking: by a chosen single x, or by a weighted sum of `findx / lowerBound` across the targets, with user-editable weights
- Optional: exclude steps whose gap sequence contains a ratio above a threshold

**Results table** (sortable, top 50 by default)
step · mod · find-x for each target (also shown as % above the lower bound) · classic score · Euclid count · gap sequence (shortened)

**Step detail view** (click a row, or type a step)
- Full gap sequence with ratios, large ratios highlighted
- Chart: max empty run (log y) against number of hits, with the ideal `N/n` curve for comparison and markers at each target x
- Optional strip of the core showing hits after n bombs (slider for n)
- A redcode snippet line, e.g. `step equ 3364`

**Explanatory blurb**
A short "how to read this" section: mod = final guarantee; find-x = how many bombs before an x-long warrior is certainly hit; a step only needs to be decent early, and should be judged mainly on small x.

## Test vectors (N = 8000, checked with a Python reference)

Gap sequences:
| step | sequence |
|---|---|
| 3039 | 3039, 1117, 312, 131, -50, -19, -7, -2, -1 |
| 3359 | 3359, -1282, -487, -179, -50, -21, 8, 3, 1 |
| 3364 | 3364, -1272, -452, -84, 32, 12, 4 |
| 3094 | 3094, 1282, -530, 222, -86, -36, 14, 6, -2 |
| 2365 | 2365, -905, -350, -145, 60, -25, 10, 5 |
| 1001 | 1001, 8, -1 |
| 2667 | 2667, 1 |

Find-x (hits until max empty run < x):
| step | x=400 | 200 | 100 | 50 | 20 |
|---|---|---|---|---|---|
| 3039 | 29 | 50 | 129 | 179 | 487 |
| 3359 | 31 | 50 | 131 | 181 | 805 |
| 3364 | 31 | 69 | 107 | 283 | 478 |
| 3094 | 31 | 75 | 106 | 181 | 649 |
| 2365 | 27 | 71 | 115 | 274 | 663 |
| 1001 | 615 | 815 | 911 | 959 | 991 |
| 2667 | 6803 | 7403 | 7703 | 7853 | 7943 |

Best mod-5 steps (N = 8000), as a sanity check for the ranking:
- find-100: 395 → 81 hits (1735, 2795 → 83)
- find-20: 1995 → 401 (2005 → 403, 3335 → 403)
- find-15: 3635 → 537, 1145 → 538
- find-10: 3995 → 801 (1335 → 803, 1715 → 807)
- Every mod-5 step reaches spacing 5 only at the full 1600 hits.

Write unit tests for the gap sequence, findx (both the fast reverse version and a naive version on small cores such as N = 100, compared against each other), and the classic score.

## Out of scope for v1
- Optimizing several steps at once (as Stefan Strack's Mopt does)
- Scanner-specific patterns (two locations per scan, e.g. CMP/SEQ with an offset)
- Simulating actual warriors

## References
- Core War: Optima Numbers — https://corewar.co.uk/optima.htm
- Steven Morrell, *Mathematical Models for Step Sizes* — https://asdflkj.net/COREWAR/DOCS/cwmath.txt

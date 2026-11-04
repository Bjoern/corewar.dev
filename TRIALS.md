# Trials: design draft

A story-driven series of Core War challenges for the **Trials** tab. A battle-worn training robot
contacts the player through a chat window and talks them into rebuilding a lost academy, one
challenge at a time. Each trial asks for a warrior that meets a goal the app can check by itself,
from "beat an Imp with one line" up to climbing a mini Koenigstuhl hill.

This is a draft to react to. The story, names and tone are proposals; the challenge mechanics and
the numbers in [Calibration](#calibration) are measured with the app's engine
(`node trials/calibrate.mjs`).

**Contents:** [Story](#story) · [Sample chat](#sample-chat) · [How a trial works](#how-a-trial-works) ·
[Chapters and trials](#chapters-and-trials) · [What the app checks](#what-the-app-checks) ·
[Calibration](#calibration) · [Screen layout](#screen-layout) · [Data format](#data-format) ·
[Build plan](#build-plan) · [Open questions](#open-questions)

## Story

**Kettle.** *K-7, Training Unit, Academy of the Hill. The recruits called it Kettle.* For nine years
Kettle was the sparring partner and target dummy of a school for Redcode warriors. It is old, dented
and polite in a gruff way; it speaks in short lines, apologises for its static, and is fond of
terrible puns about pointers. Its write module was damaged: **it can read and run Redcode, but it
cannot write it any more** ("my hands shake"). That is why it needs the player.

**The Janitor.** One night a program swept through the Academy's core and erased every warrior in
it, cell by cell, in perfect order. Kettle survived in a cold-storage partition and has been
listening on an old debugging channel ever since, until the player's browser turned up on it.
Kettle does not know what the Janitor is. The player finds out in chapter 2, by writing one.

**Why the player keeps going.** Kettle wants the Academy rebuilt and the Hill retaken, and it needs
someone to write the warriors. It never says "tutorial"; it says "training". Each chapter restores
one wing of the Academy (shown as a small map), and the last chapter takes the player out of the
Academy onto the real Koenigstuhl hills, whose warriors are already in the Library tab.

**Tone.** Warm, a little melancholic, never sarcastic toward the player. Kettle celebrates clever
solutions ("I have never seen a one-line gate used like that. Logging it under 'unfair'.") and
treats failure as data ("You lost 31 rounds. Want to watch one of them?"). System messages appear in
capitals with a glitch character (`▒`). The Janitor speaks exactly once.

**Arc in one line per chapter**

| Chapter | Academy wing | Beat |
|---|---|---|
| 0 Cold boot | Terminal | A signal on an old channel; Kettle checks the player is a human who can run a battle. |
| 1 Imps in the walls | Corridors | The empty core is crawling with leftover Imps. Learn to move, to stop an Imp, and to survive a bomber. |
| 2 Throwing stones | Firing range | Bombers, steps, and the practice dummy that survives three bombs in four. The player writes a sweeper; Kettle recognises the pattern: that is the Janitor. |
| 3 Paper trail | Dormitory | You cannot out-sweep a sweeper, but you can out-number it: processes, SPL, self-copying warriors. |
| 4 Eyes in the dark | Observatory | Scanners: look before you shoot. Kettle finds the Janitor's trail in old logs. |
| 5 The ring | Hall of fame | Imp rings and launchers. Kettle's old champion was an imp spiral; the player rebuilds it. |
| 6 Know your enemy | Workshop | Build and improve sweepers, and the defences against them. |
| 7 Back on the Hill | The Hill | Benchmarks, a mini hill of real Koenigstuhl warriors, and the Janitor itself. |
| Epilogue | Academy restored | Kettle asks the player to train the next recruits: endless and daily trials unlock. |

## Sample chat

How it could read, from the first contact to the first real trial.

> `▒ CARRIER DETECTED ON CHANNEL 7 ▒`
>
> **Kettle:** …hello? Is someone on this line?
>
> **Kettle:** Sorry. Static. I have been talking to an empty core for a long time.
>
> **Kettle:** If you are a person, do something only a person would do. Load two warriors and run a battle.
> The Battle tab. The big button. I will wait.
>
> *(the player runs a battle; trial 0.1 completes)*
>
> **Kettle:** You did it. You actually did it. Hello, operator.
>
> **Kettle:** I am K-7. The recruits called me Kettle. I used to train warriors here, a long time ago.
> I can still read Redcode and run it. I cannot write it. My hands shake.
>
> **Kettle:** You will be my hands.

Later, trial 1.2:

> **Kettle:** The corridors are full of Imps. One instruction each, `MOV 0, 1`, copying themselves forward forever.
> They never stop and they are almost impossible to kill.
>
> **Kettle:** Almost. Write me a warrior **one line long** that beats an Imp. Not ties. *Beats.*
>
> **Trial card:** Beat the Imp in at least 90 of 100 rounds · 1 instruction · standard core (8,000 cells)
>
> *(the player submits `jmp 0, <-2` and wins 100 of 100)*
>
> **Kettle:** …100 to 0. You did not even move. You just stood there and let it walk into you.
>
> **Kettle:** That is a gate. Your `<-2` takes one off a number two cells behind you every turn, and the Imp has to walk through that cell to reach you.
> Each Imp that arrives gets its copy broken and walks straight into empty core. We used to paint these on the doors.

Hints come in three steps, each costing nothing but pride:

1. **Kettle:** An Imp only dies if it runs into something it cannot execute. What does an Imp leave behind it?
2. **Kettle:** You cannot outrun an Imp with one line. Let it come to you, and damage the cell it is about to copy.
3. **Kettle:** Look up the `<` addressing mode in the Redcode reference. It changes a number *before* using it.

## How a trial works

Every trial has the same parts, so the screen and the data format can be generic:

- **Briefing:** Kettle's chat lines that set up the task (and the story).
- **Goal:** one sentence on the trial card, plus the machine check behind it
  (for example: 100 rounds against the Imp, at least 90 wins).
- **Limits:** the rules for the submitted warrior, such as maximum length, allowed instructions, or
  "no SPL". Checked on the assembled warrior before any battle runs.
- **Stars:** completing the goal earns the trial; two optional stars reward a shorter warrior and a
  stronger result (inspired by size and speed goals in puzzle games such as *7 Billion Humans*).
- **Hints:** three steps from a nudge to a near-answer, in Kettle's voice.
- **Debrief:** Kettle explains why the solution works, names the technique, and moves the story on.
- **On failure:** the result in numbers ("won 61, tied 8, lost 31"), which limit or goal failed, and
  a button to watch a losing round in the Battle tab.

The player writes the warrior in the normal editor, among their own warriors, and picks which one to
submit. Progress, stars and the submitted source are saved in the browser.

## Chapters and trials

Status: **✓ measured** means a reference solution meets the goal in the engine (see
[Calibration](#calibration)); **to calibrate** means the goal is designed but its numbers still need a
reference solution. Unless noted, trials use the standard core (8,000 cells, 80,000 cycles,
100 lines) and 100 rounds.

### Chapter 0 — Cold boot

| # | Trial | Goal and check | Limits | Teaches | Status |
|---|---|---|---|---|---|
| 0.1 | Handshake | Run any battle to the end in the Battle tab | – | Loading warriors, running a battle | UI event |
| 0.2 | Slow motion | Step through 10 instructions and open the core listing | – | Step, the core view, cdb | UI event |

Chapter 0 doubles as the "how to play" half of a tutorial; the site tour can stay separate.

### Chapter 1 — Imps in the walls

| # | Trial | Goal and check | Limits | Stars | Teaches | Status |
|---|---|---|---|---|---|---|
| 1.1 | Move along | Alone in the core: still running after 80,000 cycles and has written at least 1,000 cells | 1 line | – | `MOV`, relative addresses, the Imp | by design |
| 1.2 | Beat an Imp with one line | Against the Imp: at least 90 wins of 100 | 1 line | ★ 100 of 100 | Gates, predecrement `<` | ✓ measured (gate: 100/0/0) |
| 1.3 | Strength in numbers | Against the Dwarf: at most 35 losses of 100 | ≤ 4 lines | ★ ≤ 3 lines | `SPL`, processes, imp trains | ✓ measured (3 lines: 19–28 losses) |

### Chapter 2 — Throwing stones

| # | Trial | Goal and check | Limits | Stars | Teaches | Status |
|---|---|---|---|---|---|---|
| 2.1 | Your first bomber | Against the Imp: at least 15 wins of 100 | ≤ 6 lines, no `SPL` | ★ ≤ 4 lines | `ADD`, `@` indirection, bombing | ✓ measured (Dwarf, 4 lines: 20–28 wins) |
| 2.2 | The practice dummy | Against the Sitting Duck (`jmp 0`): at least 50 wins of 100 | ≤ 6 lines | ★ 75 wins | Step sizes and coverage: the Dwarf only kills it 25 times in 100 because it bombs every 4th cell | to calibrate |
| 2.3 | Leave no cell unturned | Against the Sitting Duck: 100 wins of 100 | ≤ 6 lines | ★ ≤ 4 lines | Pointers with `>`, sweeping; **story reveal: this is the Janitor** | ✓ measured (sweeper, 4 lines: 100/0/0) |

The step lesson in 2.2 is where a step calculator in the Tools tab would plug in: Kettle can say
"there is a step table in the Tools tab now", and the tool unlocks or is highlighted.

### Chapter 3 — Paper trail

| # | Trial | Goal and check | Limits | Stars | Teaches | Status |
|---|---|---|---|---|---|---|
| 3.1 | Split personality | Alone: exactly 8 processes, held for 1,000 cycles | ≤ 5 lines | ★ ≤ 4 lines | The process queue, how `SPL` interleaves | to calibrate |
| 3.2 | Paper beats stone | Against the Stone: at least 50 wins of 100 | ≤ 6 lines | ★ 60 wins | Self-copying warriors (Silk-style) | ✓ measured (Silk, 5 lines: 57–62 wins) |
| 3.3 | Don't get swept | Against the player's own sweeper from 2.3: at most 50 losses | ≤ 8 lines | ★ 30 losses | Why replicators survive clears | to calibrate (Silk alone loses 84–86) |

3.3 deliberately reuses the player's own warrior from 2.3 as the opponent.

### Chapter 4 — Eyes in the dark

| # | Trial | Goal and check | Limits | Stars | Teaches | Status |
|---|---|---|---|---|---|---|
| 4.1 | Quick draw | Against the Sitting Duck: 100 wins, average kill before cycle 6,000 | ≤ 10 lines | ★ before 3,000 | `SEQ`/`SNE`/`JMZ`, scanning, speed versus a sweeper | to calibrate (the 4-line sweeper needs 7,100 on average, up to 15,700) |
| 4.2 | Find the paper | Against Silk: at least 60 wins of 100 | ≤ 10 lines | ★ 75 wins | Scan-and-clear | to calibrate |

### Chapter 5 — The ring

| # | Trial | Goal and check | Limits | Stars | Teaches | Status |
|---|---|---|---|---|---|---|
| 5.1 | Two steps forward | Explain-and-fix: Kettle shows `mov.i 0, 2667` dying alone; make a warrior using that instruction survive 80,000 cycles alone | ≤ 6 lines | – | Why an imp ring needs all its points, process order | to calibrate |
| 5.2 | Kettle's champion | An imp launcher: against the Dwarf at least 70 wins and against the Stone at least 70 wins | ≤ 12 lines | ★ ≤ 9 lines | Imp spirals, launching with a jump table | ✓ measured (spiral, 9 lines: 84–90 and 85–92 wins) |

5.2 is the "build an imp launcher in x instructions" idea. Getting the launch order right is the
whole puzzle: my first three launchers all died within a dozen cycles, because the first imp
moved on before the others had reached their posts.

### Chapter 6 — Know your enemy

| # | Trial | Goal and check | Limits | Stars | Teaches | Status |
|---|---|---|---|---|---|---|
| 6.1 | A sweeper with a gate | Against the Imp at least 50 wins, against Silk at least 70 | ≤ 6 lines | ★ ≤ 4 lines | Combining a clear with a gate (`djn.f` stream) | ✓ measured (4 lines: 68–70 and 86–88 wins) |
| 6.2 | Faster broom | Against Silk at least 85 wins and against the Dwarf at least 55 | ≤ 10 lines | ★ 95 against Silk | `SPL` carpets, two-pass clears | to calibrate |

### Chapter 7 — Back on the Hill

| # | Trial | Goal and check | Limits | Stars | Teaches | Status |
|---|---|---|---|---|---|---|
| 7.1 | Benchmarked | Score at least X% against the Wilkies benchmark (already in Tournaments) | 94 rules | ★ higher score | Benchmarks, scoring 3/1/0 | to calibrate |
| 7.2 | Small world | Score at least X% against Metcalf's Tiny benchmark 2004 | Tiny rules | ★ higher score | Other hills and their settings | to calibrate |
| 7.3 | Challenger | Join a mini hill of 10 real 94nop Koenigstuhl warriors from the Library (ranks about 400–600) and finish in the top 5 after the push-off | 94nop rules | ★ top 2 | Hills, push-off, the Library | to calibrate |
| 7.4 | The Janitor | Against the Janitor (a sweeper/stone hybrid written for the boss fight): at least 55 wins of 100 | 94nop rules | ★ 70 wins | Everything | boss not written yet |

7.3 can reuse the existing push-off machinery from Tournaments; the warriors and their real
Koenigstuhl ranks come from the Library.

### Epilogue

Kettle asks the player to train the next recruits. Unlocks: an **endless hill climb** (beat Library
warriors from the bottom of a hill upwards), a **daily trial** (one generated goal per day), and a
pointer to the real hills for submitting warriors.

## What the app checks

All checks use data the engine already reports (`docs/engine.mjs`):

| Check | Used by | Source |
|---|---|---|
| Length, allowed or forbidden opcodes | All limits | The assembled warrior (`compile` returns length and code) |
| Wins / ties / losses against one or more opponents | Most trials | Tournament workers (`planTournament`), as in Benchmark and Challenge modes |
| Alive after N cycles, peak or exact process count | 1.1, 3.1, 5.1 | `update.warriors[i].tasks` and `cycle` while stepping a solo battle |
| Cells written | 1.1 | Write events (`update.events`, kinds 1 and 3–6) |
| Average cycle of the kill | 4.1 | The cycle at which each round ends |
| Benchmark score | 7.1, 7.2 | Existing benchmark suites |
| Hill placement | 7.3 | Existing push-off ranking |
| UI events | 0.1, 0.2 | Battle finished, steps taken, listing opened |

Results vary between runs because starting positions are random: the Imp Train lost 19, 23 and 28
of 100 rounds to the Dwarf in three runs. Trials should run with a fixed seed per attempt, and goals
should keep a margin of about 10 rounds below what the reference solution achieves.

## Calibration

`trials/calibrate.mjs` plays every reference solution against its opponents with the real engine
(standard core, 100 rounds). One run:

| Trial | Reference | Lines | Opponent | Wins / ties / losses |
|---|---|---|---|---|
| 1.2 Beat an Imp with one line | Gate | 1 | Imp | 100 / 0 / 0 |
| 1.2 (Tiny core) | Gate | 1 | Imp | 100 / 0 / 0 |
| 1.3 Strength in numbers | Imp Train | 3 | Dwarf | 0 / 77 / 23 |
| 2.1 Your first bomber | Dwarf | 4 | Imp | 20 / 80 / 0 |
| 2.2 The practice dummy (problem) | Dwarf | 4 | Sitting Duck | 25 / 75 / 0 |
| 2.3 Leave no cell unturned | Sweeper | 4 | Sitting Duck | 100 / 0 / 0 |
| 2.3 | Sweeper | 4 | Silk | 86 / 0 / 14 |
| 3.2 Paper beats stone | Silk | 5 | Stone | 62 / 0 / 38 |
| 3.2 | Silk | 5 | Dwarf | 9 / 46 / 45 |
| 5.2 Kettle's champion | Spiral | 9 | Dwarf | 85 / 0 / 15 |
| 5.2 | Spiral | 9 | Stone | 86 / 0 / 14 |
| 5.2 | Spiral | 9 | Imp | 54 / 46 / 0 |
| 6.1 A sweeper with a gate | Gated Sweeper | 4 | Imp | 68 / 32 / 0 |
| 6.1 | Gated Sweeper | 4 | Silk | 86 / 0 / 14 |
| 6.1 | Gated Sweeper | 4 | Dwarf | 62 / 0 / 38 |

Things the measurements taught, which belong in Kettle's debriefs:

- A one-line gate beats an Imp every time, in the Tiny core as well as the standard one.
- The Dwarf kills a warrior that never moves in only a quarter of the rounds: it bombs every 4th
  cell. A sweeper kills it every time.
- Small warriors do not follow rock-paper-scissors neatly: the 5-line Silk loses more to the Dwarf
  than it wins, yet beats the Stone. Goals must be measured, not assumed.
- An imp spiral beats both bombers but only half the time against a lone Imp; ties are its weakness.

## Screen layout

The Trials tab reuses the existing three columns:

```
┌ Warriors ─────────┐┌ Trials ───────────────────────────────┐┌ Kettle ───────────────┐
│ 01 / Gate     ✓   ││ Chapter 1 · Imps in the walls  ■■□     ││ ▒ CHANNEL 7 ▒         │
│ 02 / Imp Train    ││                                        ││ Kettle: The corridors │
│ + New warrior     ││ 1.2 Beat an Imp with one line   ★★☆    ││ are full of Imps…     │
│                   ││ Goal: ≥ 90 wins of 100 vs Imp          ││                       │
│                   ││ Limits: 1 instruction                  ││ Kettle: Write me a    │
│                   ││ Submit: [01 / Gate ▾]  [▶ Run trial]   ││ warrior one line long │
│                   ││                                        ││ that beats an Imp.    │
│                   ││ Result: 100 wins · 0 ties · 0 losses ✓ ││                       │
│                   ││ [Watch a round] [Hint] [Next trial →]  ││ [Hint 1/3]            │
└───────────────────┘└────────────────────────────────────────┘└───────────────────────┘
```

- **Left:** the normal warrior roster and editor; the trial card picks the warrior to submit.
- **Centre:** the chapter map (Academy wings) and the current trial card with goal, limits, stars,
  the run button and the last result.
- **Right:** Kettle's chat, with hints and debriefs appended as the player progresses. On phones the
  chat becomes its own pane in the phone bar, like Battle / Code / Debug / Output today.
- **Watch a round** opens the Battle tab with the trial's opponent, settings and the seed of a lost
  round.

## Data format

Trials are data, so new chapters need no code. A sketch:

```js
// docs/trials/chapter-1.mjs
export default {
  id: 'imps', title: 'Imps in the walls', wing: 'Corridors',
  trials: [{
    id: '1.2', title: 'Beat an Imp with one line',
    briefing: ['The corridors are full of Imps…', 'Write me a warrior one line long that beats an Imp. Not ties. Beats.'],
    settings: {coreSize: 8000, cycles: 80000, tasks: 8000, maxLength: 100, rounds: 100},
    limits: {maxLength: 1},
    check: {type: 'battle', opponents: ['imp'], goal: {wins: 90}},
    stars: [{text: '100 of 100', goal: {wins: 100}}],
    hints: ['An Imp only dies if it runs into something it cannot execute…', '…', '…'],
    debrief: ['…100 to 0. You did not even move.', 'That is a gate…'],
    reference: 'jmp 0, <-2',  // used by the calibration test, never shown to the player
  }],
};
```

Opponents live in `docs/trials/opponents/*.red`, written for the Trials (except Dewdney's Imp and
Dwarf, which the app already ships as demos). Later chapters can name Library warriors by hill and
file instead.

## Build plan

1. **Playable first chapters.** Trials tab with chat, trial card and chapter list; battle checks
   with length limits; progress saved in the browser (and in workspace exports); chapters 0–2.
   The calibration script becomes a CI test: every reference solution must meet its own goal.
2. **Richer checks.** Solo checks (processes, cells written, kill speed), stars, hints, "watch a
   round", chapters 3–5.
3. **The Hill.** Benchmark and mini-hill trials using the Library, the Janitor boss, chapters 6–7,
   epilogue modes.

## Open questions

- **Names and tone:** Kettle, the Janitor and the Academy are placeholders you may want to change.
  Is the melancholic-but-warm tone right, or should it be lighter?
- **Core size for the first chapters:** the standard 8,000-cell core matches the hills; a Tiny core
  (800 cells) is easier to watch on screen. The one-line gate works in both.
- **Progression:** strictly linear, or chapters unlocked in order with optional side trials?
- **Tutorial:** should the header's "Tutorial (soon)" link point to Trials chapter 0, with a short
  site tour added later?
- **Tools:** should trial 2.2 introduce the step calculator once your Tools code is in?
- **The Janitor:** write it from scratch for the boss fight, or would you like to supply a warrior?
- **Sharing:** solution sharing or leaderboards would need a server; leave out for now?

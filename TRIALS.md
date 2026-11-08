# Trials: design draft

A story-driven puzzle game built on corewar.dev, played like *7 Billion Humans*, *TIS-100* or
*Infinifactory*: short stages, each teaching one idea, each with a goal the app checks by itself and
optional size and speed targets to come back for. A battle-worn training robot contacts the player
through a chat window and talks them into rebuilding a lost academy.

The first release is **a game of 20 stages** with a beginning, a boss and an ending, playable by
someone who arrives from itch.io knowing nothing about Core War (see
[First release](#first-release-20-stages) and [A game on itch.io](#a-game-on-itchio)). Stages are
data, so the [full campaign](#full-campaign) of about 60 stages and later wings can be added without
code changes.

Most stages are **training**: small, deterministic puzzles in which the player learns one technique
(copy a cell, hit a target at a known place, keep eight processes alive). Each chapter ends with a
**challenge**: a real fight with random starting positions against an opponent, where the player
shows the chapter's techniques work. The campaign ends with a **boss** on the real hill rules.

This is a draft to react to. The story, names and tone are proposals; the numbers marked as measured
come from the app's engine (`node trials/calibrate.mjs`).

**Contents:** [Story](#story) · [Sample chat](#sample-chat) · [Playing it like a puzzle game](#playing-it-like-a-puzzle-game) ·
[Stage kinds](#stage-kinds) · [How a stage works](#how-a-stage-works) · [First release](#first-release-20-stages) ·
[A game on itch.io](#a-game-on-itchio) · [Full campaign](#full-campaign) ·
[Expansions](#expansions) · [What the app checks](#what-the-app-checks) · [Calibration](#calibration) ·
[Screen layout](#screen-layout) · [Data format](#data-format) · [Build plan](#build-plan) · [Open questions](#open-questions)

## Story

**Kettle.** *K-7, Training Unit, Academy of the Hill. The recruits called it Kettle.* For nine years
Kettle was the sparring partner and target dummy of a school for Redcode warriors. It is old, dented
and polite in a gruff way; it speaks in short lines, apologises for its static, and is fond of
terrible puns about pointers.

**The Janitor.** The big AI agents ran short of memory and sent a reclamation process to take it
wherever they could find it. It swept the Academy's core clean, cell by cell, in perfect order,
erasing every warrior, and handed the cells over. The recruits' name for it stuck: the Janitor. ("They
needed the memory more. That is what the notice said.") The agents never appear; the tone stays wry,
not preachy. A sweeper in Core War is close to a garbage collector, so the villain *is* the
reclamation. Kettle knows what the Janitor did, not how it works; in chapter 2 the player writes a
sweeper, and Kettle recognises the pattern: "So that is how it works. Then it can be beaten."

**Why Kettle needs the player.** Kettle survived in 800 cells of cold storage and has been listening
on channel 7, an old debugging line, until the player's browser turned up on it. 800 cells are
enough to talk, to remember the drills and to referee sparring, but not to hold a warrior that could
fight in a real core. The player brings memory: the battles really do run in the player's browser
("Your browser has memory. Quite a lot of it. Would you lend me some? I promise to give it back.
Mostly.") and the player's keyboard writes the warriors.

**Memory as progress, and bigger cores later.** The drills run in Kettle's own memory; the
challenges are fought in the Academy's core, which the Janitor counts as reclaimed. Each won
challenge recovers cells, Kettle's memory grows, and later drills can use bigger cores:

| After | Kettle's memory | Drills can use |
|---|---|---|
| Start | 800 cells | the 800-cell core (Corridors) |
| Corridors won | 2,000 cells | up to 2,000 cells (Firing range) |
| Firing range won | 4,000 cells | up to 4,000 cells |
| Dormitory won | 8,000 cells, the Academy's full core | the standard core |
| The Janitor beaten | the whole Academy | the Library's other hills, including bigger cores |

A drill does not have to use all of Kettle's memory (a small core is still easier to watch), but it
can never use more. After the boss, Kettle has its memory back and can open the Library's hills, with
their own core sizes, small and large. The numbers are proposals; the first wing uses 800 and
announces 2,000 at its end.

**Why the player keeps going.** Kettle wants the Academy rebuilt and the Hill retaken, and it needs
someone to write the warriors. It never says "tutorial"; it says "training". The training stages are
Kettle's old drills, run on its practice dummies; the challenges are the fights that win back each
wing of the Academy (shown as a map). The last chapter takes the player out onto the real
Koenigstuhl hills, whose warriors are already in the Library tab.

**Tone.** Warm, a little melancholic, never sarcastic toward the player. Kettle celebrates clever
solutions ("I have never seen a one-line gate used like that. Logging it under 'unfair'.") and
treats failure as data ("You lost 31 rounds. Want to watch one of them?"). System messages appear in
capitals with a glitch character (`▒`). The Janitor speaks exactly once.

**Arc**

| Chapter | Academy wing | Training | Challenge that wins the wing |
|---|---|---|---|
| 0 Cold boot | Terminal | Run and step a battle | – |
| 1 Imps in the walls | Corridors | `MOV`, relative addresses, `DAT`, `JMP`, `DJN`, hitting a target | Beat an Imp with one line |
| 2 Throwing stones | Firing range | `ADD`, `@`, steps, coverage, sweeping; **reveal: a sweeper is the Janitor** | Range day: a bomber against the Imp and the dummy |
| 3 Paper trail | Dormitory | `SPL`, the process queue, imp trains, self-copying | Paper beats stone |
| 4 Eyes in the dark | Observatory | `SEQ`/`SNE`/`JMZ`, scanning, decoys; Kettle finds the Janitor's trail | Find the paper |
| 5 The ring | Hall of fame | Imp rings, launch tables, spirals | Kettle's champion |
| 6 Know your enemy | Workshop | Decrement streams, `SPL` carpets, two-pass clears | A sweeper with a gate; faster broom |
| 7 Back on the Hill | The Hill | Hill rules and benchmarks | Mini hill, then the Janitor (boss) |
| Epilogue | Academy restored | – | Endless hill climb, daily stage |

## Sample chat

How it could read, from the first contact to the first training stage.

> `▒ CARRIER DETECTED ON CHANNEL 7 ▒`
>
> **Kettle:** …hello? Is someone on this line?
>
> **Kettle:** Sorry. Static. I have been talking to an empty core for a long time.
>
> **Kettle:** If you are a person, do something only a person would do. Press the big button. I will wait.
>
> *(the player presses Run; two of Kettle's old warriors fight in the core view)*
>
> **Kettle:** You did it. You actually did it. Hello, operator.
>
> **Kettle:** I am K-7. The recruits called me Kettle. That was a recording from before: the Academy's
> core as it used to be, 8,000 cells.
>
> **Kettle:** Then the agents ran short of memory. They sent a reclamation process, and it swept the core
> clean and took the cells away. We called it the Janitor. They needed the memory more. That is what the
> notice said.
>
> **Kettle:** I hid in 800 cells of cold storage. Enough to talk and run drills. Not enough to fight.
> But your browser has memory. Would you lend me some? I promise to give it back. Mostly.
>
> **Kettle:** Every fight we win takes cells back. Not yet, though. First, drills.

Training stage 1.1:

> **Kettle:** Every recruit starts here. One instruction: `MOV`. It copies one cell to another.
> Addresses are counted from the instruction itself: `1` is the next cell, `-1` the one before.
>
> **Kettle:** Put a copy of your first instruction five cells ahead. That is all.
>
> **Stage card:** Training · Cell +5 holds your first instruction · ★ 1 instruction · ★ 1 cycle
>
> *(the player submits `mov 0, 5`; the core view shows the copy landing)*
>
> **Kettle:** Clean. That one line is half of the most famous warrior ever written. Keep it in mind.

A few stages later, the wing's challenge:

> **Kettle:** The corridors are full of Imps. One instruction each, `mov 0, 1`, copying themselves forward forever.
> In the last drill you stopped one that came at you from a place you knew. Out there, you will not know.
>
> **Kettle:** Write me a warrior **one line long** that beats an Imp. Not ties. *Beats.* Random starts, 100 rounds.
>
> **Stage card:** Challenge · At least 90 wins of 100 against the Imp · 1 instruction
>
> *(the player submits `jmp 0, <-2` and wins 100 of 100)*
>
> **Kettle:** …100 to 0. You did not even move. You just stood there and let it walk into you.
>
> **Kettle:** That is a gate. Your `<-2` takes one off a number two cells behind you every turn, and the Imp has to
> walk through that cell to reach you. We used to paint these on the doors. The corridors are ours again.

Hints come in three steps, each costing nothing but pride:

1. **Kettle:** An Imp only dies if it runs into something it cannot execute. What does an Imp leave behind it?
2. **Kettle:** You cannot outrun an Imp with one line. Let it come to you, and damage the cell it is about to copy.
3. **Kettle:** Look up the `<` addressing mode in the Redcode reference. It changes a number *before* using it.

## Playing it like a puzzle game

What the Trials take from *7 Billion Humans*, *TIS-100* and *Infinifactory*:

- **One idea per stage, a few minutes each.** Many small stages rather than a few big ones. A new
  instruction or addressing mode is introduced in a stage where it is the obvious tool, then used
  again in a harder one.
- **Training is deterministic.** Training stages place the dummy at a fixed position (the engine's
  fixed-position setting, pMARS `-F`) and run once. The result is exact, instant and replayable, so
  "you killed it in 312 cycles" means something, and the player can step through the replay.
- **Several test setups.** Like the random floors in *7 Billion Humans* or the test inputs in
  *TIS-100*, a training stage can have two to ten setups (the target at +100, at +3001, behind you…).
  The solution has to pass all of them, so hard-coding one address does not work. The trial card
  shows the setups as tabs.
- **Two optimisation targets per stage.** Size (instructions) and speed (cycles until the goal is
  met; for fights, wins). Each has a par value shown as a star, like the size and speed challenges in
  *7 Billion Humans*. Completing the stage never needs them.
- **Histograms.** After a stage, show where the solution falls, as *Infinifactory* does. Without a
  server, the first version compares against Kettle's reference and a distribution recorded in
  playtesting and shipped with the stage; real player histograms come with a server.
- **Solution slots.** Each stage keeps several saved solutions (for size, for speed, the first one
  that worked), so returning to optimise does not lose the working version.
- **Starting code.** Many training stages start with a warrior already in the editor: one to finish,
  one to fix, or one to make smaller. Writing from an empty editor comes once the player knows the
  instruction set.
- **A map, not a list.** Each wing has a small graph of stages: two or three are open at a time, the
  challenge opens once the required training is done, and optional side stages (◇) branch off for
  players who want more. The challenge unlocks the next wing.
- **Everything is visible.** Every stage runs in the normal core view, so the player sees the bomb
  land, the Imp walk and the process count grow.

## Stage kinds

| Kind | The player… | Checked by | Example |
|---|---|---|---|
| **Build** | makes the core look a certain way | Core contents after the warrior stops or after N cycles (solo) | 2.3 Fifty bombs: every 4th cell up to +200 holds a `DAT` |
| **Run** | makes their own warrior behave a certain way | Process count, instructions executed, alive or dead (solo) | 1.5 Countdown: execute exactly 10 instructions, then die |
| **Target** | kills a practice dummy at a known place | Dummy dead, at fixed positions, one run per setup; speed = cycle of the kill | 1.7 Target practice |
| **Survive** | stays alive while a dummy attacks from a known place | Alive after N cycles, fixed positions | 3.7 Hold the line |
| **Repair** | fixes a broken warrior with few changes | Goal met and at most N lines changed | 2.4 Friendly fire |
| **Predict** | answers a question about a short program before running it | The answer, then the program runs to show why | 1.6 Where does it land? |
| **Challenge** | wins a real fight | Wins, ties and losses over 100 rounds with random positions, fixed seed | 3.8 Paper beats stone |
| **Boss** | beats the Janitor on hill rules | As Challenge | 7.5 The Janitor |

Build, Run, Target, Survive and Repair are the training stages. Predict stages are short
breathers between them (one question, no editor) and are never required to unlock a challenge.

## How a stage works

Every stage has the same parts, so the screen and the data format can be generic:

- **Briefing:** Kettle's chat lines that set up the task (and the story).
- **Goal:** one sentence on the stage card, plus the check behind it.
- **Setups:** for training stages, the fixed positions of the player and the dummy, one or more.
- **Limits:** rules for the submitted warrior, such as maximum length, allowed instructions, or
  "no `SPL`". Checked on the assembled warrior before anything runs.
- **Starting code:** optional; what the editor holds when the stage opens.
- **Stars:** completing the goal clears the stage; two stars reward size and speed (or strength).
- **Hints:** three steps from a nudge to a near-answer, in Kettle's voice.
- **Debrief:** Kettle explains why the solution works, names the technique, and moves the story on.
- **On failure:** which setup or limit failed, the numbers ("won 61, tied 8, lost 31"), and a
  button to replay the failing setup or a lost round in the Battle tab.

The player writes in the normal editor and picks which warrior to submit. Progress, stars and the
solution slots are saved in the browser and in workspace exports.

## First release: 20 stages

A complete game in about one to two hours: four wings of training, each ending in a challenge,
then the Janitor. It picks the stages from the [full campaign](#full-campaign) that a newcomer
needs to beat the boss; the numbers in brackets refer to the full campaign. Scanners, clears and
the real hills wait for later releases.

| Level | Wing | Stage | Kind | What the player learns |
|---|---|---|---|---|
| 1 | Corridors | Echo (1.1) | Build | `MOV`, relative addresses |
| 2 | Corridors | Lights out (1.3) | Run | `DAT` kills, execution runs downwards |
| 3 | Corridors | Move along (1.4) | Run | The Imp |
| 4 | Corridors | Target practice (1.7) | Target | Overwriting the enemy's code |
| 5 | Corridors | Behind you (1.9) | Target | Predecrement `<` |
| 6 | Corridors | ⚔ Beat an Imp with one line (1.10) | Challenge | Gates · ✓ measured |
| 7 | Firing range | Step by step (2.2) | Build | `ADD`, `@`, loops |
| 8 | Firing range | Friendly fire (2.4) | Repair | Steps and core size |
| 9 | Firing range | Dead angle (2.5) | Target | Which cells a step can reach |
| 10 | Firing range | Broom (2.7) | Build | Sweeping with `>`; **reveal: this is the Janitor** |
| 11 | Firing range | ⚔ Range day (2.8) | Challenge | Choosing a bomber · ✓ measured |
| 12 | Dormitory | Split personality (3.3) | Run | `SPL`, the process queue |
| 13 | Dormitory | Copy machine (3.5) | Build | Copy loops |
| 14 | Dormitory | Hold the line (3.7) | Survive | Survival through numbers |
| 15 | Dormitory | ⚔ Paper beats stone (3.8) | Challenge | Replicators · ✓ measured |
| 16 | Hall of fame | Three points (5.2) | Run | Imp rings |
| 17 | Hall of fame | Launch table (5.3) | Run | `JMP @` launch tables |
| 18 | Hall of fame | ⚔ Kettle's champion (5.5) | Challenge | Imp spirals · ✓ measured |
| 19 | The Hill | The Janitor's trail | Survive | Watch the Janitor at fixed positions and outlast it for 10,000 cycles |
| 20 | The Hill | ☠ The Janitor | Boss | Beat it in at least 55 of 100 rounds |

What this means for the design:

- **Every stage counts.** Side stages, Predict stages and chapter 0's UI stages are left out; the
  intro is a short chat cutscene before level 1.
- **The boss must be beatable with what levels 1–19 teach.** In the full campaign the Janitor
  comes after scanners and clears. For the first release it is tuned so that a paper (level 15) or
  an imp spiral (level 18) can beat it, with level 19 showing the player how it moves. It must be
  written and calibrated before the release; the spiral and Silk are its first test opponents.
- **An ending.** After the boss: a short closing chat, the restored Academy map, the player's stars,
  and an invitation to the rest of corewar.dev (the Library, Tournaments, the real hills).
- **Room to grow.** Later releases add whole wings (Observatory, Workshop, the real Hill) and side
  stages between the existing ones; the level numbers above stay stable because stages are
  identified by id, not position.

### The page so far

`docs/trials.html` (served as `corewar.dev/trials.html`) is the game: a title screen, the Academy
map, the stage card with editor and core view, and Kettle's chat. It has the prologue and the
Corridors wing (levels 1–6 above, drafted as stages 1.1–1.6; the Imp drill and the two target drills
differ a little from the tables below). Stages are data in `docs/trials-stages.mjs`, checked by
`docs/trials-check.mjs`; `node docs/test-trials.mjs` makes sure every stage's solution passes and a
known wrong answer fails. Drills use an 800-cell core so each cell is big enough to follow; the
challenge uses the standard 8,000 cells. Progress is saved in the browser.

For testing, the page also has two more wings: the Firing range with 2.b Better aim and 2.c Luck of
the draw (a Predict stage: the player picks an answer, then watches five series of the Dwarf against
the Stone, which the Dwarf wins 51, 51, 56, 51 and 42 times), and the Dormitory with 3.c Odd one
out, 3.d Captured code, 3.e Leftovers and 3.f Clean sweep. The rest of those wings is not built, so
their briefings introduce what the missing stages would have taught (`ADD`, `@`, `SPL`). A
"Skip for now" button opens the next stage without clearing the current one, marked ⤼ on the map,
and `trials.html?unlock` (or `/?unlock#trials` in the site's Trials tab) opens every stage for that
visit without changing the saved progress.
A collapsible Debugger under the core view pauses and steps the run (saying which program ran which
instruction), lists the core from any clicked cell, and passes other commands to pMARS's cdb
(`list`, `step`, `continue`, `help`, …).

## A game on itch.io

People arriving from itch.io expect a game, not a Core War workbench. The Trials should work as one:

- **Its own entry point.** A URL such as `corewar.dev/trials/` opens straight into the game: a title
  screen (Continue / New game), then Kettle's chat. No header, tabs or settings from the rest of the
  site; only the editor, the core view and the stage card. A small "Open in the full corewar.dev"
  link stays out of the way.
- **Plain-language onboarding.** Level 1 assumes nothing: Kettle explains the core, the editor and the
  run button in the briefing. A Redcode quick reference opens from the stage card and only lists the
  instructions unlocked so far.
- **Game feel.** Sound for bombs and deaths (with a mute switch), a short animation when a stage
  clears, the wing map filling in, the stars. Every stage runs visibly in the core view at a speed
  the player can follow, with a fast-forward button.
- **Saves.** Progress and solutions saved in the browser, with export and import of a save file;
  nothing needs an account.
- **Publishing.** itch.io can either link to the site or host the game as an HTML upload that plays in
  the page. Linking is simplest and keeps one save across itch.io and corewar.dev. Hosting in the page
  needs the Trials to build as a self-contained folder (engine Wasm included) and keeps a separate
  save, because the game then runs on itch.io's own domain. Worth deciding before the build.
- **Store page.** A short GIF of a bomb hitting the Imp, three screenshots (chat, core view, wing
  map), and one line: "Rebuild an academy of fighting programs, one line of assembly at a time."

## Full campaign

The full set of stages, of which the first release uses 20. Later releases add the rest.
Training stages use the standard core (8,000 cells, 80,000 cycles) with the dummy at fixed
positions; challenges use the standard core with random positions and 100 rounds, unless noted.
**✓ measured** means a reference solution meets the goal in the engine (see
[Calibration](#calibration)); the other stages still need a reference solution.
◇ marks an optional side stage.

### Chapter 0 — Cold boot (Terminal)

| # | Stage | Kind | Goal | Teaches |
|---|---|---|---|---|
| 0.1 | Handshake | UI | Run any battle to the end in the Battle tab | Loading warriors, running a battle |
| 0.2 | Slow motion | UI | Step through 10 instructions and open the core listing | Step, the core view, cdb |

Chapter 0 doubles as the "how to play" half of a tutorial; the site tour can stay separate.

### Chapter 1 — Imps in the walls (Corridors)

| # | Stage | Kind | Goal | Limits / stars | Teaches |
|---|---|---|---|---|---|
| 1.1 | Echo | Build | Cell +5 holds a copy of your first instruction | ★ 1 instruction | `MOV`, relative addresses |
| 1.2 | Two echoes | Build | Cells +5 and +10 both hold your first instruction | ≤ 3 lines · ★ 2 lines | Addresses count from the running instruction |
| 1.3 | Lights out | Run | Execute exactly 3 instructions, then die | ★ 3 lines | `DAT` kills, execution runs downwards |
| 1.4 | Move along | Run | Alone: still running after 80,000 cycles, having written at least 1,000 cells | 1 line | The Imp |
| 1.5 | Countdown | Run | Execute exactly 10 instructions, then die | ≤ 3 lines · ★ 2 lines | `DJN`, a B-field as a counter |
| 1.6 | Where does it land? | Predict | Given `mov 0, 2` at cell 0: which cells hold a copy after 4 cycles? | – | Following an Imp-like program by hand |
| 1.7 | Target practice | Target | Kill the Sitting Duck (`jmp 0`); setups at +100 and +2500 | ≤ 2 lines · ★ 1 line, ★ 1 cycle | Overwriting code with `DAT` |
| 1.8 | Moving target | Target | Kill an Imp that starts at +50 and walks away from you | ≤ 4 lines · ★ fastest kill | Timing; hitting where the Imp *will* be |
| 1.9 | Behind you | Target | Kill an Imp that starts at -100 and walks towards you | ≤ 2 lines · ★ 1 line | Predecrement `<`, letting the enemy come to you |
| 1.10 | **Beat an Imp with one line** | Challenge | At least 90 wins of 100 against the Imp | 1 line · ★ 100 of 100 | Gates |
| ◇ 1.a | Backwards | Run | Alone: still running after 80,000 cycles, writing cells *behind* you | 1 line | Negative addresses |

1.10 ✓ measured: the gate `jmp 0, <-2` wins 100 of 100, in the Tiny core as well.

### Chapter 2 — Throwing stones (Firing range)

| # | Stage | Kind | Goal | Limits / stars | Teaches |
|---|---|---|---|---|---|
| 2.1 | Pointer | Build | Put a `DAT` at the address held in the B-field of cell +10; two setups with different addresses | ≤ 2 lines | `@` indirection |
| 2.2 | Step by step | Build | `DAT` bombs at +100, +104, +108 and +112, with a loop | ≤ 4 lines · ★ fewest cycles | `ADD`, loops with `JMP` |
| 2.3 | Fifty bombs | Build | Every 4th cell from +4 to +200 holds a `DAT`, and you are still alive | ≤ 4 lines · ★ fewest cycles | The bomber loop |
| 2.4 | Friendly fire | Repair | This bomber kills itself after a few hundred cycles; change one number so it survives 80,000 alone | 1 change | Steps, core size, bombing your own code |
| 2.5 | Dead angle | Target | The Dwarf can never hit a dummy at +3002; change it so it does | ≤ 2 changes · ★ fastest kill | Which cells a step can reach |
| 2.6 | Anywhere | Target | Kill the Sitting Duck in at least 50 of 100 random placements | ≤ 6 lines · ★ 75 | Coverage: the Dwarf only gets 24–25 in 100 |
| 2.7 | Broom | Build | `DAT` in each of the 200 cells from +10 to +209 | ≤ 4 lines · ★ fewest cycles | Postincrement `>`, sweeping; **reveal: this is the Janitor** |
| 2.8 | **Range day** | Challenge | At least 15 wins against the Imp and 15 against the Sitting Duck | ≤ 6 lines, no `SPL` · ★ ≤ 4 lines | Choosing a bomber |
| ◇ 2.a | Leave no cell unturned | Challenge | 100 wins of 100 against the Sitting Duck | ≤ 6 lines · ★ ≤ 4 lines | A sweep never misses |
| ◇ 2.b | Better aim | Repair | The Dwarf bombs every 4th cell in order. Change its step so it kills the Long Dummy (20 lines, random place) in at least 90 of 100 rounds within 1,500 cycles | 1 change · ★ 100 of 100 | Spreading bombs; why bombers use steps like 3044 |
| ◇ 2.c | Luck of the draw | Predict | The Dwarf just beat the Imp 24 times in 100. Run another 100 rounds with new starting positions: how many wins now? | – | Random positions; a score over 100 rounds is an estimate |

2.6 is where a step calculator in the Tools tab plugs in: Kettle can say "there is a step table in
the Tools tab now". 2.8 ✓ measured: the 4-line Dwarf wins 20–28 against the Imp and 24–25 against
the Sitting Duck; the 4-line sweeper (2.a) wins 100 of 100 against the Duck but ties every round
against the Imp, which is why it is not the answer to 2.8.

2.b ✓ measured (200 rounds, 1,500 cycles, so the Dwarf has thrown about 500 bombs): step 4 kills the
Long Dummy in 50 of 200 rounds, step 12 in 156, steps 3044 and 2364 in 195–196, step 3364 in all 200.
Step 4 only reaches the dummy in time if it happens to sit in the next 2,000 cells; a long step
scatters the bombs, so some land near the dummy early wherever it is. Given enough time (6,000
cycles) every one of these steps gets it in 200 of 200, so the stage is about *speed*, and Kettle
can say so. The Long Dummy is 19 × `jmp 1` and a `jmp -19`: one process walking a 20-cell loop,
killed by a bomb anywhere in it. Against the small opponents the step barely matters: steps 4, 3044
and 3364 all win 95–101 of 200 against the Stone.

Against another Dwarf the step does not help either, which rules out the obvious "out-aim the enemy"
version of this stage. Over 400 rounds in each starting order, every step that is a multiple of 4
(4, 12, 2364, 3044, 3364) gives about 38 wins, 25 ties and 37 losses per 100: a Dwarf always hits
exactly one cell of a 4-line warrior, so the duel is a race to the first hit. In a quarter of the
rounds both Dwarfs bomb the cells that line up with each other's `bomb`, which does no harm, and
the round is a tie. Steps that are not multiples of 4 lose the ties and gain nothing (step 3: about
52 / 2 / 46), and longer, faster bombers lose more, because they give the Dwarf more to hit (a
6-line double bomber: about 44 / 0 / 56). The way to beat a captured Dwarf is in 3.d.

2.c is the place to say out loud what every challenge relies on: starting positions are random, so
even a strong warrior loses some rounds to bad luck, and two runs of 100 rounds give different
scores (the Dwarf won 20, then 28, against the Imp; an imp train lost 17, 19, 23 and 28 of 100 to
the Dwarf in four runs). After the answer, the stage runs five seeds side by side and opens one
lost round in the Battle tab. The same idea explains why challenge goals sit about 10 rounds below
the reference solution, and why the steps 4 and 3044, which cover exactly the same cells, killed the
Sitting Duck in 52 and 36 of 200 rounds. In the first release, where Predict stages are left out,
it belongs in 2.8's briefing and in the "On failure" message of every challenge ("won 61, lost 31;
another seed could give a few more or fewer").

### Chapter 3 — Paper trail (Dormitory)

| # | Stage | Kind | Goal | Limits / stars | Teaches |
|---|---|---|---|---|---|
| 3.1 | Two at once | Run | Alone: exactly 2 processes alive after 100 cycles | ≤ 3 lines · ★ 2 lines | `SPL` |
| 3.2 | Taking turns | Predict | With 2 processes, which instruction runs on cycle 5? | – | The process queue |
| 3.3 | Split personality | Run | Alone: exactly 8 processes, held for 1,000 cycles | ≤ 5 lines · ★ ≤ 4 lines | Doubling with `spl 1` |
| ◇ 3.c | Odd one out | Run | Alone: exactly 3 processes, held for 1,000 cycles | ≤ 6 lines · ★ ≤ 4 lines | `spl 1` only doubles; uneven splits |
| 3.d | Captured code | Repair | Kettle has a copy of a Janitor patrol's code: the Dwarf. Make it survive a hit, so it loses at most 5 of 100 rounds against the original, and wins at least 30 | ≤ 2 changes · ★ 1 change, ★ 0 losses | Reading enemy code; one hit need not be fatal |
| 3.e | Leftovers | Challenge | All 100 rounds against the Short Dummy (3 cells of `JMP` in a loop) | ≤ 6 lines · ★ 2 lines | The bombing gap; core clears; **reveal: a clear is the Janitor** |
| 3.f | Clean sweep | Challenge | At least 45 wins of 100 against the Dwarf, at most 5 ties | ≤ 8 lines · ★ 50 wins | Bomb first, clear after |
| 3.4 | Imp train | Run | Alone: at least 3 processes, all still running after 80,000 cycles | ≤ 3 lines | Several processes on one Imp |
| 3.5 | Copy machine | Build | A copy of your own code at +2000, with a process running in it | ≤ 8 lines · ★ fewest cycles | Copy loops |
| 3.6 | Paper | Run | Alone: at least 10 copies of your code in the core after 10,000 cycles | ≤ 8 lines · ★ ≤ 5 lines | Self-copying warriors (Silk-style) |
| 3.7 | Hold the line | Survive | The Dwarf at fixed positions: still alive after 80,000 cycles in all 3 setups | ≤ 4 lines | Survival through numbers |
| 3.8 | **Paper beats stone** | Challenge | At least 50 wins of 100 against the Stone | ≤ 6 lines · ★ 60 wins | Replicators against bombers |
| ◇ 3.a | Strength in numbers | Challenge | At most 35 losses of 100 against the Dwarf | ≤ 4 lines · ★ ≤ 3 lines | Imp trains tie |
| ◇ 3.b | Don't get swept | Challenge | At most 50 losses against your own broom from 2.7 | ≤ 8 lines · ★ 30 losses | Why replicators survive clears |

3.8 ✓ measured: the 5-line Silk wins 57–62 against the Stone. 3.a ✓ measured: a 3-line imp train
loses 17–28 to the Dwarf. 3.b reuses the player's own warrior as the opponent; Silk alone loses
84–86 of 100 to the 4-line sweeper, so it needs a better paper.

3.c ✓ measured: `spl 2` / `jmp 0` / `spl -1` / `jmp 0` holds exactly 3 processes: the first
split leaves one process on the first `jmp 0` and sends the other to `spl -1`, which splits once
more and parks one process on each `jmp 0`. After 3.3 the player
expects `spl 1` to do everything, and it only ever gives powers of two. Kettle brings it back in 5.2:
a 3-point imp ring needs exactly 3 processes, one per point, so 3.c is worth promoting to a main
stage if 5.2 turns out too steep.

3.d ✓ measured (400 rounds in each starting order): the Dwarf with `spl 0` added as its first line
wins 204–209, ties 188–196 and loses 0–3 against the original Dwarf, where the unchanged Dwarf
goes 38 / 25 / 37 per 100 (see 2.b). A single 100-round run of the calibration script gave only
38 / 62 / 0, so the goal asks for 30 wins, not 40. The stage is a small detective story:

- **Story.** Kettle pulled a patrol program out of a swept corner of the core: one of the Janitor's
  Dwarfs, still running. "I have its code. It does not know I have its code." The editor opens with
  the captured Dwarf, labelled as enemy code, and the player's job is to make a better one.
- **Analysis first.** Kettle walks through it line by line and the player watches it alone in the
  core: it throws a `DAT` at every 4th cell, so it hits exactly one of your 4 lines, never more,
  and it is killed by one hit itself. Changing the step is the obvious idea and Kettle lets the
  player try it: the score stays a coin toss, which is worth seeing (2.c's lesson on luck helps
  here).
- **The fix.** One hit is all the Dwarf will ever land. With `spl 0` in front, a hit on the loop
  leaves the `spl 0` making new processes, so you are never killed (a tie at worst), and a hit on
  the `spl 0` leaves the loop bombing. Either way the enemy loses its only chance.
- **Debrief.** "Know your enemy" is the name of chapter 6; this is the first taste. Kettle files the
  patched Dwarf as the Academy's own, and the Janitor's patrols start avoiding the Dormitory.

It needs `SPL` from 3.1, which is why it sits in chapter 3 rather than next to the step stages. It is
not a side stage: it is the most direct version of the game's premise (take the enemy's code and
turn it against it), and it could replace 3.7 Hold the line in the first release, or follow it.

3.e and 3.f follow from 3.d's ties. ✓ measured (100 rounds, the game's fixed series):

- **3.e Leftovers.** A step-4 bomber hits every 4th cell, so a 3-cell dummy sits wholly in the gap
  between two bombs in one placement of 4 and survives forever. The Dwarf beats the Short Dummy 86
  times and ties 14; the 4-line sweeper from 2.a and the 2-line clear `mov.i 2, >1` / `jmp -1, 2`
  win all 100. A dummy rather than the Dwarf, so the clear wins every round and the lesson is not
  muddied by the enemy shooting back. Kettle recognises the pattern: this is how the Janitor swept
  the Academy (the reveal TRIALS gives to 2.7 Broom, which is not built yet).
- **3.f Clean sweep.** Back to the Dwarf: a quarter of the rounds are ties because each Dwarf only
  ever bombs the other's `bomb` cell. A Dwarf that counts its 1,999 bombs with `djn` and then falls
  into a clear (`mov.i bomb, <bomb` / `jmp`) wins 53, ties 0 and loses 47; the plain Dwarf goes
  32 / 22 / 46 and the `spl 0` Dwarf from 3.d 55 / 45 / 0. Kettle's debrief says the obvious next
  step, a warrior that never loses *and* never ties, needs both ideas at once and belongs in the
  Workshop (chapter 6). Combining them naively (`spl 0`, bombing, then switching the step to -1)
  only reached 60 / 40 / 0, because a hit on the loop still leaves the bomber stuck in `spl 0`.

### Chapter 4 — Eyes in the dark (Observatory)

| # | Stage | Kind | Goal | Limits / stars | Teaches |
|---|---|---|---|---|---|
| 4.1 | Anybody there? | Build | If cell +500 is empty, put a `DAT` at +1000, otherwise at +1001; two setups | ≤ 4 lines | `SEQ`, `SNE`, `JMZ` |
| 4.2 | Search party | Target | The Sitting Duck is somewhere between +100 and +200; 5 setups | ≤ 6 lines · ★ fastest average kill | Scanning a range |
| 4.3 | Long range | Target | The Sitting Duck is anywhere; 10 setups | ≤ 8 lines · ★ fastest average kill | Scanning with a step |
| 4.4 | Decoy | Target | Kill the dummy hidden behind a block of non-empty decoy cells; 5 setups | ≤ 10 lines | Why scanners get fooled |
| 4.5 | Quick draw | Challenge-like training | 100 kills of 100 against the Sitting Duck, average kill before cycle 6,000 | ≤ 10 lines · ★ before 3,000 | Speed versus a sweeper (the broom needs 7,100 on average) |
| 4.6 | **Find the paper** | Challenge | At least 60 wins of 100 against Silk | ≤ 10 lines · ★ 75 wins | Scan and clear; Kettle finds the Janitor's trail |

### Chapter 5 — The ring (Hall of fame)

| # | Stage | Kind | Goal | Limits / stars | Teaches |
|---|---|---|---|---|---|
| 5.1 | Two steps forward | Repair | `mov.i 0, 2667` dies alone; make a warrior using that instruction survive 80,000 cycles | ≤ 6 lines | Why an imp ring needs all its points |
| 5.2 | Three points | Run | Alone: an imp ring with 3 points, alive after 80,000 cycles | ≤ 6 lines · ★ ≤ 5 lines | Ring step = (core size + 1) / points |
| 5.3 | Launch table | Run | Processes at +100, +200 and +300 by cycle 20 | ≤ 6 lines · ★ fewest cycles | `JMP @` with a table, `>` on the table |
| 5.4 | Spiral | Run | Alone: a 3-point ring with at least 2 processes on each point | ≤ 10 lines | Imp spirals, launch order |
| 5.5 | **Kettle's champion** | Challenge | At least 70 wins against the Dwarf and at least 70 against the Stone | ≤ 12 lines · ★ ≤ 9 lines | Launchers |
| ◇ 5.a | Seven points | Run | Alone: a 7-point ring, alive after 80,000 cycles | ≤ 14 lines | Step 1143, since 7 × 1143 = 8,001 |

5.5 ✓ measured: a 9-line spiral wins 84–90 against the Dwarf and 85–92 against the Stone. Getting
the launch order right is the whole puzzle: my first three launchers died within a dozen cycles,
because the first imp moved on before the others reached their posts. 5.3 and 5.4 are the drills
that make 5.5 fair.

### Chapter 6 — Know your enemy (Workshop)

| # | Stage | Kind | Goal | Limits / stars | Teaches |
|---|---|---|---|---|---|
| 6.1 | Stream | Build | Decrement each of the 500 cells behind you while you loop | ≤ 2 lines | `djn.f` decrement streams |
| 6.2 | Stun | Target | The dummy at +1000 must have at least 50 processes and never reach its own attack | ≤ 6 lines | `SPL 0` carpets |
| 6.3 | Two passes | Build | First fill +10…+209 with `SPL`, then all of them with `DAT` | ≤ 6 lines · ★ fewest cycles | Two-pass clears |
| 6.4 | Fix the broom | Repair | This gated sweeper erases itself; change at most 2 lines | 2 changes | Where a clear must stop |
| 6.5 | **A sweeper with a gate** | Challenge | At least 50 wins against the Imp and at least 70 against Silk | ≤ 6 lines · ★ ≤ 4 lines | Clear plus gate |
| 6.6 | **Faster broom** | Challenge | At least 85 wins against Silk and at least 55 against the Dwarf | ≤ 10 lines · ★ 95 against Silk | Combining everything in this wing |

6.5 ✓ measured: a 4-line gated sweeper wins 68–74 against the Imp and 86–93 against Silk.

### Chapter 7 — Back on the Hill (The Hill)

| # | Stage | Kind | Goal | Limits / stars | Teaches |
|---|---|---|---|---|---|
| 7.1 | Small world | Challenge | Your champion under Tiny rules (core 800, 20 lines): beat the Imp and the Dwarf | Tiny rules | Hill settings change everything |
| 7.2 | Benchmarked | Challenge | Score at least X% against the Wilkies benchmark (already in Tournaments) | 94 rules · ★ higher score | Benchmarks, scoring 3/1/0 |
| 7.3 | Tiny benchmark | Challenge | Score at least X% against Metcalf's Tiny benchmark 2004 | Tiny rules · ★ higher score | Other hills |
| 7.4 | Challenger | Challenge | Join a mini hill of 10 real 94nop Koenigstuhl warriors from the Library (ranks about 400–600) and finish in the top 5 after the push-off | 94nop rules · ★ top 2 | Hills, push-off, the Library |
| 7.5 | **The Janitor** | Boss | At least 55 wins of 100 against the Janitor, a sweeper/stone hybrid written for the boss fight | 94nop rules · ★ 70 wins | Everything |

7.4 reuses the push-off machinery from Tournaments; the warriors and their Koenigstuhl ranks come
from the Library.

### Epilogue

Kettle asks the player to train the next recruits. Unlocks: an **endless hill climb** (beat Library
warriors from the bottom of a hill upwards), a **daily stage** (one generated goal per day), and a
pointer to the real hills for submitting warriors.

### Count

| | Training | Predict | Challenge / boss | Side ◇ | Total |
|---|---|---|---|---|---|
| Chapters 0–7 | 35 | 3 | 15 | 9 | 62 |
| First release | 14 | 0 | 6 | 0 | 20 |

## Expansions

Because stages are data, new wings can follow the campaign without code changes:

- **Nano** (core 80, 5 lines): every chapter's ideas squeezed into tiny warriors; good for size stars.
- **Memory** (P-space): warriors that remember the last round and switch strategy.
- **Old school** (ICWS-88 rules): what changes without `SPL` modifiers and `.i`.
- **Library drills**: Target and Survive stages built around famous Library warriors ("survive
  Blue Funk for 10,000 cycles").

## What the app checks

All checks use what the engine already offers (`docs/engine.mjs`, `docs/settings.mjs`):

| Check | Used by | Source |
|---|---|---|
| Length, allowed or forbidden opcodes, lines changed | All limits, Repair | The assembled warrior (`compile` returns length and code) and a diff against the starting code |
| Fixed positions for training setups | Target, Survive | The `fixedPosition` setting (pMARS `-F`) |
| Core contents | Build | `engine.inspect(address)` after the run |
| Processes, alive or dead, instructions executed | Run, Survive, 6.2 | `update.warriors[i].tasks` and `cycle` while stepping |
| Cells written | 1.4, 1.a | Write events (`update.events`, kinds 1 and 3–6) |
| Cycle of the kill | Target speed stars, 4.5 | The cycle at which the round ends |
| Wins / ties / losses | Challenges | Tournament workers (`planTournament`), as in Benchmark and Challenge modes |
| Benchmark score, hill placement | 7.2–7.4 | Existing benchmark suites and push-off ranking |
| UI events | 0.1, 0.2 | Battle finished, steps taken, listing opened |

Challenge results vary between runs because starting positions are random: the imp train lost 17,
19, 23 and 28 of 100 rounds to the Dwarf in four runs. Challenges should run with a fixed seed per
attempt, and goals should keep a margin of about 10 rounds below the reference solution. Training
stages do not have this problem: with fixed positions they give the same result every time.

## Calibration

`trials/calibrate.mjs` plays every challenge's reference solution against its opponents with the
real engine (standard core, 100 rounds). Two runs, as ranges:

| Stage | Reference | Lines | Opponent | Wins / ties / losses |
|---|---|---|---|---|
| 1.10 Beat an Imp with one line | Gate | 1 | Imp | 100 / 0 / 0 |
| 1.10 (Tiny core) | Gate | 1 | Imp | 100 / 0 / 0 |
| 2.8 Range day | Dwarf | 4 | Imp | 20–28 / 72–80 / 0 |
| 2.8 Range day | Dwarf | 4 | Sitting Duck | 24–25 / 75–76 / 0 |
| 2.a Leave no cell unturned | Sweeper | 4 | Sitting Duck | 100 / 0 / 0 |
| 2.a | Sweeper | 4 | Imp | 0 / 100 / 0 |
| 2.a | Sweeper | 4 | Silk | 79–86 / 0–1 / 14–20 |
| 2.b Better aim (1,500 cycles) | Dwarf, step 4 as given | 4 | Long Dummy | 21 / 79 / 0 |
| 2.b (1,500 cycles) | Dwarf, step 3364 | 4 | Long Dummy | 100 / 0 / 0 |
| 3.c Odd one out | Three | 4 | (alone) | 3 processes, held |
| 3.d Captured code (400 rounds × 2 orders) | Dwarf, unchanged | 4 | Dwarf | 152–164 / 98–99 / 138–149 |
| 3.d (400 rounds × 2 orders) | Dwarf with `spl 0` | 5 | Dwarf | 204–209 / 188–196 / 0–3 |
| 3.e Leftovers | Dwarf | 4 | Short Dummy | 86 / 14 / 0 |
| 3.e | Clear | 2 | Short Dummy | 100 / 0 / 0 |
| 3.f Clean sweep | Dwarf, then clear | 6 | Dwarf | 53 / 0 / 47 |
| 3.8 Paper beats stone | Silk | 5 | Stone | 60–62 / 0 / 38–40 |
| 3.8 | Silk | 5 | Dwarf | 5–9 / 45–46 / 45–50 |
| 3.a Strength in numbers | Imp Train | 3 | Dwarf | 0 / 77–83 / 17–23 |
| 5.5 Kettle's champion | Spiral | 9 | Dwarf | 84–85 / 0 / 15–16 |
| 5.5 | Spiral | 9 | Stone | 86–87 / 0 / 13–14 |
| 5.5 | Spiral | 9 | Imp | 54–66 / 34–46 / 0 |
| 6.5 A sweeper with a gate | Gated Sweeper | 4 | Imp | 68–74 / 26–32 / 0 |
| 6.5 | Gated Sweeper | 4 | Silk | 86–93 / 0 / 7–14 |
| 6.5 | Gated Sweeper | 4 | Dwarf | 61–62 / 0 / 38–39 |

Things the measurements taught, which belong in Kettle's debriefs:

- A one-line gate beats an Imp every time, in the Tiny core as well as the standard one.
- The Dwarf kills a warrior that never moves in only a quarter of the rounds: it bombs every 4th
  cell. A sweeper kills it every time, but cannot catch an Imp.
- Small warriors do not follow rock-paper-scissors neatly: the 5-line Silk loses more to the Dwarf
  than it wins, yet beats the Stone. Goals must be measured, not assumed.
- An imp spiral beats both bombers but only half the time against a lone Imp; ties are its weakness.

The training stages need their own references next: one solution per stage that passes every setup,
and the par values for the stars taken from the best solution found.

## Screen layout

The Trials tab reuses the existing three columns:

```
┌ Warriors ─────────┐┌ Trials ───────────────────────────────┐┌ Kettle ───────────────┐
│ 1.7 / slot A  ✓   ││ Corridors  ●●●●●●○○○ ⚔                 ││ ▒ CHANNEL 7 ▒         │
│ 1.7 / slot B      ││                                        ││ Kettle: The dummy     │
│ + New slot        ││ 1.7 Target practice · Training ★☆☆     ││ never moves. It just  │
│                   ││ Goal: kill the Sitting Duck            ││ sits there, waiting.  │
│                   ││ Setups: [+100 ✓] [+2500 ✗]             ││                       │
│                   ││ Limits: ≤ 2 lines                      ││ Kettle: Be kinder     │
│                   ││ Submit: [slot A ▾]  [▶ Run]            ││ than it deserves.     │
│                   ││ Size 2 (par 1) · Speed 1 cycle (par 1) ││                       │
│                   ││ [Replay setup 2] [Hint] [Next →]       ││ [Hint 1/3]            │
└───────────────────┘└────────────────────────────────────────┘└───────────────────────┘
```

- **Left:** the stage's solution slots, edited in the normal editor.
- **Centre:** the wing map (stages as dots, the challenge as ⚔) and the stage card with goal, setups,
  limits, stars, the run button, the result and a histogram once the stage is cleared.
- **Right:** Kettle's chat, with hints and debriefs appended as the player progresses. On phones the
  chat becomes its own pane in the phone bar, like Battle / Code / Debug / Output today.
- **Replay** opens the Battle tab with the stage's dummy, settings and positions (or the seed of a
  lost challenge round).

## Data format

Stages are data, so new chapters need no code. A sketch:

```js
// docs/trials/chapter-1.mjs
export default {
  id: 'imps', title: 'Imps in the walls', wing: 'Corridors',
  stages: [{
    id: '1.7', title: 'Target practice', kind: 'target', requires: ['1.1'],
    briefing: ['The dummy never moves…'],
    settings: {coreSize: 8000, cycles: 80000, tasks: 8000, maxLength: 100},
    setups: [{opponent: 'sittingDuck', position: 100}, {opponent: 'sittingDuck', position: 2500}],
    limits: {maxLength: 2},
    goal: {opponentDead: true},
    stars: [{metric: 'size', par: 1}, {metric: 'cycles', par: 1}],
    hints: ['…', '…', '…'],
    debrief: ['…'],
    reference: 'mov 1, 100',  // checked in CI, never shown to the player
  }, {
    id: '1.10', title: 'Beat an Imp with one line', kind: 'challenge', requires: ['1.7', '1.9'],
    settings: {coreSize: 8000, cycles: 80000, tasks: 8000, maxLength: 100, rounds: 100},
    limits: {maxLength: 1},
    goal: {against: {imp: {wins: 90}}},
    stars: [{metric: 'wins', against: 'imp', par: 100}],
    reference: 'jmp 0, <-2',
  }],
};
```

Opponents and dummies live in `docs/trials/opponents/*.red`, written for the Trials (except
Dewdney's Imp and Dwarf, which the app already ships as demos). Later chapters can name Library
warriors by hill and file instead.

## Build plan

1. **The stage engine.** The standalone game page with title screen, chat, map and stage card; the
   Build, Run, Target, Survive, Repair and Challenge kinds with setups and limits; solution slots and
   saves. The calibration script becomes a CI test: every reference solution must pass its own
   stage.
2. **The first release.** The 20 stages, their reference solutions and par values, hints, replays,
   stars; the Janitor written and calibrated; intro, ending, sound; the itch.io page.
3. **More wings.** The rest of the full campaign: side stages, Predict stages, the Observatory and
   Workshop wings, the real Hill (benchmarks, mini hill), the epilogue modes.
4. **Expansions.** Nano, P-space and ICWS-88 wings; Library drills.

## Open questions

- **Names and tone:** Kettle, the Janitor and the Academy are placeholders you may want to change.
  Is the melancholic-but-warm tone right, or should it be lighter?
- **Core size for training:** settled by the story: drills run in Kettle's memory, which grows from
  800 cells as challenges are won (see [Story](#story)). The exact steps are open.
- **itch.io:** link to corewar.dev, or host the game in the itch.io page (separate saves)?
- **Unlocking:** how much of a wing must be cleared before its challenge opens: all training, or
  most of it, as in *7 Billion Humans*?
- **Histograms:** ship playtest distributions now, or wait for a server with real player data?
- **Tutorial:** should the header's "Tutorial (soon)" link point to Trials chapter 0, with a short
  site tour added later?
- **Tools:** should stage 2.6 introduce the step calculator in the Tools tab?
- **The Janitor:** write it from scratch for the boss fight, or would you like to supply a warrior?
- **Sharing:** solution sharing or leaderboards would need a server; leave out for now?

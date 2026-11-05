// SPDX-License-Identifier: GPL-2.0-or-later
// Stages of the Trials game (TRIALS.md). Stages are data: the page (trials.mjs) shows them and
// trials-check.mjs runs them. First draft: the prologue and the first wing.

// Practice dummies and opponents. Imp and Dwarf are A. K. Dewdney's classics.
export const opponents = {
  imp: ';redcode-94\n;name Imp\nmov.i 0, 1\n',
  dwarf: ';redcode-94\n;name Dwarf\nadd.ab #4, bomb\nmov.i bomb, @bomb\njmp -2\nbomb dat 0, 0\n',
  dummy: ';redcode-94\n;name Dummy\njmp 0\n',
};

// Drills use a small core so every cell is big enough to follow; challenges use the hill standard.
const DRILL = {coreSize: 800, cycles: 8000, tasks: 800, maxLength: 100};
const STANDARD = {coreSize: 8000, cycles: 80000, tasks: 8000, maxLength: 100};

// The field manual: short entries that unlock as stages introduce them.
export const manual = {
  core: ['The core', 'A ring of memory cells. Each cell holds one instruction. Addresses wrap around at the end.'],
  mov: ['MOV a, b', 'Copies cell a to cell b.'],
  relative: ['Addresses', 'Counted from the instruction that is running: 0 is itself, 1 the next cell, -1 the cell before.'],
  dat: ['DAT', 'Data, not code. A process that runs a DAT stops. Every empty cell holds DAT 0, 0.'],
  jmp: ['JMP a', 'Continue at cell a instead of the next cell.'],
  djn: ['DJN a, b', 'Takes one off b; if the result is not zero, continue at a.'],
  immediate: ['#', 'An immediate number: #2 is the number 2 itself, not the cell 2 away.'],
  predecrement: ['<', 'Takes one off the B-number of the cell it points to, before using it. <-2 bites the cell two behind you.'],
};

export const wings = [
  {id: 'terminal', title: 'Terminal', blurb: 'An old debugging channel.'},
  {id: 'corridors', title: 'Corridors', blurb: 'Crawling with leftover Imps.'},
  {id: 'range', title: 'Firing range', blurb: 'Coming soon.', locked: true},
  {id: 'dormitory', title: 'Dormitory', blurb: 'Coming soon.', locked: true},
  {id: 'hall', title: 'Hall of fame', blurb: 'Coming soon.', locked: true},
  {id: 'hill', title: 'The Hill', blurb: 'Coming soon.', locked: true},
];

export const stages = [
  {
    id: '0.1', wing: 'terminal', title: 'Handshake', kind: 'demo',
    goal: 'Press Run and watch two of Kettle\'s old sparring programs fight.',
    settings: {...STANDARD, cycles: 8000},
    setups: [{warriors: ['imp', 'dwarf']}],
    check: {type: 'finish'},
    briefing: [
      '▒ CARRIER DETECTED ON CHANNEL 7 ▒',
      '…hello? Is someone on this line?',
      'Sorry. Static. I have been talking to an empty core for a long time.',
      'If you are a person, do something only a person would do. Press the big button. I will wait.',
    ],
    debrief: [
      'You did it. You actually did it. Hello, operator.',
      'I am K-7, training unit of the Academy of the Hill. The recruits called me Kettle.',
      'That grid is the core: 8,000 memory cells. Every coloured cell is one a program has written. Blue is the Imp, which crawls. Orange is the Dwarf, which throws bombs.',
      'I can still read programs and run them. I cannot write them any more. My hands shake.',
      'You will be my hands. But not yet. First, drills.',
    ],
  },
  {
    id: '1.1', wing: 'corridors', title: 'Echo', kind: 'drill',
    goal: 'Cell +5 holds a copy of your first instruction.',
    limits: {maxLength: 5},
    stars: [{metric: 'size', par: 1, text: '1 instruction'}],
    settings: DRILL, setups: [{}], marks: [5],
    check: {type: 'copy', from: 0, to: 5},
    manual: ['core', 'mov', 'relative'],
    start: '; Drill 1: Echo\n; Write your instruction below, then press Run.\n\n',
    briefing: [
      'Drill one. Every recruit starts here.',
      'A program is a list of instructions, one per cell. `MOV a, b` copies cell a to cell b.',
      'Addresses count from the instruction that is running: `0` is the instruction itself, `1` the next cell, `-1` the one before.',
      'Put a copy of your first instruction five cells ahead. I marked the cell for you.',
    ],
    hints: [
      'Counted from your first instruction, where is your first instruction?',
      'Copy from 0. Copy to 5.',
      '`mov 0, 5` is a whole program.',
    ],
    debrief: [
      'Clean. The copy landed exactly where you aimed.',
      'Then your program ran into the next cell. It was empty, and an empty cell holds `DAT`, which stops whoever runs it. Drills are allowed to end like that.',
      'Keep that line in mind. Change one number and it becomes the most famous program ever written.',
    ],
    solution: 'mov 0, 5',
    wrong: 'mov 0, 4',
  },
  {
    id: '1.2', wing: 'corridors', title: 'Lights out', kind: 'drill',
    goal: 'Run exactly 3 instructions. The third one must stop you.',
    limits: {maxLength: 5},
    stars: [{metric: 'size', par: 1, text: '1 instruction',
      missed: 'There is a one-line answer. It counts. Look up `DJN` in the field manual when you are curious.'}],
    settings: DRILL, setups: [{}],
    check: {type: 'steps', count: 3},
    manual: ['dat', 'jmp', 'djn', 'immediate'],
    start: '; Drill 2: Lights out\n\n',
    briefing: [
      'An empty cell holds `DAT 0, 0`. Running a DAT stops a program. That is how programs die in the core.',
      '`JMP a` continues at cell a instead of the next one.',
      'Drill two: run exactly three instructions, and let the third be the one that stops you.',
    ],
    hints: [
      'Count every instruction, including the one that stops you.',
      'Two instructions that each move on to the next cell, then something that stops you.',
      '`jmp 1` twice. You do not even need to write the DAT: the core is full of them.',
    ],
    debrief: [
      'Three. Not two, not four.',
      'Empty core is a minefield of DAT. Every program you meet will try to make you step on one.',
    ],
    solution: 'djn 0, #2',
    wrong: 'jmp 1\njmp 1\njmp 1',
  },
  {
    id: '1.3', wing: 'corridors', title: 'Move along', kind: 'drill',
    goal: 'Alone in the core: still running after 8,000 cycles, with at least 400 cells filled.',
    limits: {maxLength: 1},
    settings: DRILL, setups: [{}],
    check: {type: 'survive', filled: 400},
    start: '; Drill 3: Move along\n\n',
    briefing: [
      'Now the reverse. Never stop.',
      'You already know how to copy an instruction forward. What happens if the copy lands exactly where you run next?',
      'One line.',
    ],
    hints: [
      'Your program lives as long as the next cell it runs is not a DAT.',
      'In Echo you copied yourself five cells ahead. Try a shorter distance.',
      '`mov 0, 1`.',
    ],
    debrief: [
      'That is an Imp. One instruction that copies itself one cell ahead, forever.',
      'Imps are nearly impossible to kill, and the corridors are full of them. Remember how they move: one cell per turn.',
    ],
    solution: 'mov 0, 1',
    wrong: 'mov 0, 2',
  },
  {
    id: '1.4', wing: 'corridors', title: 'Target practice', kind: 'drill',
    goal: 'Kill the dummy in both setups: once at +100, once at +500.',
    limits: {maxLength: 4},
    stars: [{metric: 'size', par: 2, text: '2 instructions'},
      {metric: 'cycles', par: 2, text: 'both dummies dead by cycle 2', missed: 'Both dummies stood still. You could have hit each of them before cycle 3.'}],
    settings: DRILL,
    setups: [{opponent: 'dummy', position: 100, label: '+100'}, {opponent: 'dummy', position: 500, label: '+500'}],
    check: {type: 'win'},
    start: '; Drill 4: Target practice\n\n',
    briefing: [
      'Time to hit something. Meet the dummy: `JMP 0`. It jumps to itself, forever. It never moves and never fights back.',
      'Kill it by copying a DAT over it, so that its next turn runs into one.',
      'Two setups today: the dummy at +100, then at +500. The same program has to hit both.',
    ],
    hints: [
      'Any empty cell is a DAT. Copy one onto the dummy.',
      'Every line counts addresses from itself. A line one cell further down needs a number one smaller to hit the same place.',
      '`mov 2, 100` and then `mov 1, 499`: two copies of the empty cell below them.',
    ],
    debrief: [
      'Two dummies, two holes.',
      'Did you see what happened after? You ran into a DAT yourself, one turn after the dummy did. You won because it fell first.',
      'Out there, nobody tells you where the enemy is. That is a lesson for another wing.',
    ],
    solution: 'mov 2, 100\nmov 1, 499',
    wrong: 'mov 1, 100',
  },
  {
    id: '1.5', wing: 'corridors', title: 'Behind you', kind: 'drill',
    goal: 'Kill an Imp crawling your way: once from 100 cells behind you, once from 300.',
    limits: {maxLength: 2},
    stars: [
      {metric: 'size', par: 1, text: '1 instruction', missed: 'There is a one-line answer that does not care where the Imp starts. Ask for a hint if you want it.'},
      {metric: 'cycles', par: 2, text: 'every Imp dead by cycle 2', missed: 'You knew exactly where both Imps started. Two direct hits would have got them before they took a second step.'},
    ],
    settings: DRILL,
    setups: [{opponent: 'imp', position: 700, label: '-100'}, {opponent: 'imp', position: 500, label: '-300'}],
    check: {type: 'win'},
    manual: ['predecrement'],
    start: '; Drill 5: Behind you\n\n',
    briefing: [
      'The corridor behind you is not empty. An Imp starts 100 cells back, crawling your way, one cell per turn. In the second setup it starts 300 back.',
      'When it reaches you, it copies itself over your code. After that, you are an Imp too. Well, your code is.',
      'One more tool for the field manual: `<` in front of an address takes one off the B-number of that cell before using it. Programs use it to count. You can use it to damage.',
      'Stop the Imp. Two lines at most. There are two stars here, and I am not sure one program can get both.',
    ],
    hints: [
      'An Imp only survives while every copy it makes is intact. A broken copy walks it into empty core.',
      'You cannot chase it. Stay where you are with `JMP 0`, and use its B-number to damage the cell just behind you every turn.',
      'Try `JMP 0` with a B-number of `<-2`.',
    ],
    debrief: [
      'It walked in, and it never walked out.',
      'If you stood still: that is a gate. Every turn your `<-2` bites the cell two behind you. The Imp copies itself there, the copy breaks before it runs, and the Imp steps into empty core. We used to paint these on the doors.',
      'If you shot first: also good. A known enemy is a dead enemy. Out there they will not tell you where it starts.',
    ],
    solution: 'jmp 0, <-2',
    solutions: ['mov 2, 700\nmov 1, 500'],
    wrong: 'jmp 0',
  },
  {
    id: '1.6', wing: 'corridors', title: 'Beat an Imp with one line', kind: 'challenge',
    goal: 'Win at least 90 of 100 rounds against the Imp. Both of you start at random places.',
    limits: {maxLength: 1},
    stars: [{metric: 'wins', par: 100, text: '100 of 100'}],
    settings: {...STANDARD, rounds: 100},
    setups: [{opponent: 'imp'}],
    check: {type: 'wins', wins: 90},
    start: '; Challenge: Beat an Imp with one line\n\n',
    briefing: [
      '▒ CORRIDORS: 41 IMPS DETECTED ▒',
      'This is it. The corridors are crawling with Imps, and they do not start where I tell you.',
      'The full core, 8,000 cells. A hundred rounds, you and one Imp, placed at random. Win 90.',
      'Ties do not count. An Imp that never dies is still an Imp in my corridors.',
      'One line.',
    ],
    hints: [
      'Does it matter where the Imp starts? It always walks the same way.',
      'Your answer to Behind you never cared where the Imp came from.',
      'The gate from Behind you is one line.',
    ],
    debrief: [
      '{wins} to {losses}. You did not even move. You just stood there and let them walk into you.',
      '▒ WING RESTORED: CORRIDORS ▒',
      'The corridors are ours again. Thank you, operator.',
      'Next is the firing range, where the Academy\'s bombers trained. I have not looked inside since the night of the Janitor.',
      '…I will tell you about the Janitor. Later. The firing range is still being rebuilt.',
    ],
    solution: 'jmp 0, <-2',
    wrong: 'mov 0, 1',
  },
];

// SPDX-License-Identifier: GPL-2.0-or-later
// Calibration for the Trials design (TRIALS.md): plays each challenge's reference solution against its
// opponents with the real engine and prints the results, so challenge thresholds rest on measured numbers.
// Usage: node trials/calibrate.mjs [rounds]
import {Engine} from '../docs/engine.mjs';

const rounds = Number(process.argv[2]) || 100;
const red = (name, body) => `;redcode-94\n;name ${name}\n;assert 1\n${body}\n`;
const STANDARD = {coreSize: 8000, cycles: 80000, tasks: 8000, maxLength: 100};
const TINY = {coreSize: 800, cycles: 8000, tasks: 800, maxLength: 20, distance: 20};

// Opponents. Imp and Dwarf are A. K. Dewdney's classics; the others are written for the Trials.
export const opponents = {
  imp: red('Imp', 'mov.i 0, 1'),
  dwarf: red('Dwarf', 'add.ab #4, bomb\nmov.i bomb, @bomb\njmp -2\nbomb dat 0, 0'),
  sittingDuck: red('Sitting Duck', 'jmp 0'),
  stone: red('Stone', 'add.ab #3044, 2\nmov.i 2, @1\njmp -2, 0\ndat 0, 0'),
  silk: red('Silk', '     spl 1\n     spl 1\n     spl 1\nsilk spl @0, 1800\n     mov.i }-1, >-1'),
};

// Reference solutions: proof that a challenge can be met, not the best answer.
export const references = [
  {trial: '1.2 Beat an Imp with one line', settings: STANDARD, warrior: red('Gate', 'jmp 0, <-2'), against: ['imp']},
  {trial: '1.2 (Tiny core)', settings: TINY, warrior: red('Gate', 'jmp 0, <-2'), against: ['imp']},
  {trial: '1.3 Strength in numbers', settings: STANDARD, warrior: red('Imp Train', 'spl 1\nspl 1\nmov.i 0, 1'), against: ['dwarf', 'imp']},
  {trial: '2.1 Your first bomber (the Dwarf)', settings: STANDARD, warrior: opponents.dwarf, against: ['imp', 'sittingDuck']},
  {trial: '2.3 Leave no cell unturned', settings: STANDARD, warrior: red('Sweeper', 'loop mov.i bomb, >ptr\n     jmp loop\nptr  dat 0, 2\nbomb dat 0, 0'), against: ['sittingDuck', 'imp', 'silk']},
  {trial: '6.1 A sweeper with a gate', settings: STANDARD, warrior: red('Gated Sweeper', 'loop mov.i bomb, >ptr\n     djn.f loop, <ptr-5\nptr  dat 0, 2\nbomb dat 0, 0'), against: ['sittingDuck', 'imp', 'dwarf', 'silk']},
  {trial: '3.2 Paper beats stone', settings: STANDARD, warrior: opponents.silk, against: ['stone', 'dwarf', 'imp']},
  {trial: "5.2 Kettle's champion", settings: STANDARD,
   warrior: red('Spiral', 'step equ 2667\n     spl 1\n     spl 1\nvec  jmp @ptr, >ptr\nptr  dat 0, 1\nt0   jmp imp\nt1   jmp imp+step\nt2   jmp imp+2*step\nt3   jmp imp+3*step\nimp  mov.i 0, step'),
   against: ['dwarf', 'stone', 'imp']},
];

async function play(sources, settings) {
  const config = {...settings, rounds, warriors: sources.length};
  const engine = await Engine.create(config, {});
  const banks = engine.compile(sources);
  let update = engine.start(), peak = 0;
  while (!update.done) {
    update = engine.advance(1000, 8);
    peak = Math.max(peak, update.warriors[0].tasks);
  }
  return {length: banks[0].length, peak, ...update.warriors[0]};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`| Trial | Reference | Lines | Opponent | Wins / ties / losses (${rounds} rounds) |`);
  console.log('|---|---|---|---|---|');
  for (const r of references) {
    const name = r.warrior.match(/;name (.*)/)[1];
    for (const id of r.against) {
      const result = await play([r.warrior, opponents[id]], r.settings);
      console.log(`| ${r.trial} | ${name} | ${result.length} | ${opponents[id].match(/;name (.*)/)[1]} | ${result.wins} / ${result.ties} / ${result.losses} |`);
    }
    const solo = await play([r.warrior], {...r.settings, rounds: 1});
    console.log(`| ${r.trial} | ${name} | ${solo.length} | (alone) | peak ${solo.peak} processes |`);
  }
}

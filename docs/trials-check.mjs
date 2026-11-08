// SPDX-License-Identifier: GPL-2.0-or-later
// Runs a Trials stage (trials-stages.mjs) with the real engine and checks its goal.
// The page passes `frame` to animate each update; tests run without it at full speed.
import {Engine} from './engine.mjs';
import {opponents} from './trials-stages.mjs';

const normal = text => text.trim().replace(/\s+/g, ' ');
const isEmpty = text => /^DAT\.F \$ 0, \$ 0$/.test(normal(text));
const plural = (n, word) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : word.endsWith('s') ? 'es' : 's'}`;

// The source the engine assembles: a player's text gets a '94 header if it has none.
export function warriorSource(text, name = 'Recruit') {
  return /^\s*;redcode/im.test(text) ? text : `;redcode-94\n;name ${name}\n${text}\n`;
}

// How setups name their opponent: the dummy is a thing, the others are programs with names.
export const opponentName = setup => setup.opponent === 'dummy' ? 'dummy' : opponents[setup.opponent]?.match(/;name (.*)/)?.[1] ?? 'opponent';

function setupLabel(stage, setup, index) {
  return stage.setups.length < 2 ? '' : `Setup ${index + 1}${setup.label ? ` (${opponentName(setup)} at ${setup.label})` : ''}: `;
}

// Returns {passed, message, length, wins, ties, losses, rounds, series, stars: [bool per stage.stars]}.
// `series` holds each setup's own wins, ties and losses. A failure carries `reason`: 'assembly', 'limit' or 'goal'.
// `choice` is the player's answer to a predict stage.
export async function runStage(stage, source, {frame = async () => 100000, log = () => {}, choice = null} = {}) {
  // `cycles` is the slowest setup's last cycle, for speed stars.
  const result = {passed: true, length: 0, wins: 0, ties: 0, losses: 0, rounds: 0, cycles: 0, series: []};
  for (const [index, setup] of stage.setups.entries()) {
    const names = setup.warriors ?? [null, ...(setup.opponent ? [setup.opponent] : [])];
    const sources = names.map(name => name ? opponents[name] : warriorSource(source));
    // A setup's `position` places the opponent for every round; a `series` number only starts a different
    // random series (pMARS takes a numeric -F as the first offset and the seed for the rest).
    const position = setup.position ?? setup.series;
    const config = {...stage.settings, rounds: stage.settings.rounds ?? 1, warriors: sources.length,
      fixedPosition: position == null ? '' : String(position), fixedSeries: position == null};
    const lines = [];
    const engine = await Engine.create(config, {log: line => { lines.push(line); log(line); }});
    let banks;
    try { banks = engine.compile(sources); }
    catch (error) {
      return {...result, passed: false, reason: 'assembly', message: lines.filter(line => line.trim()).join('\n') || error.message};
    }
    if (!setup.warriors) {
      result.length = banks[0].length;
      const max = stage.limits?.maxLength;
      if (max && result.length > max)
        return {...result, passed: false, reason: 'limit', message: `Your warrior is ${plural(result.length, 'instruction')} long. The limit is ${max}.`};
    }
    let update = engine.start(), count = await frame(update, {engine, setup, index, stage});
    while (!update.done) {
      update = engine.advance(Math.max(1, Math.min(100000, count)), 8);
      count = await frame(update, {engine, setup, index, stage});
    }
    const me = update.warriors[0];
    result.wins += me.wins; result.ties += me.ties; result.losses += me.losses; result.rounds += me.wins + me.ties + me.losses;
    result.series.push({wins: me.wins, ties: me.ties, losses: me.losses});
    result.cycles = Math.max(result.cycles, update.cycle);
    const fail = message => ({...result, passed: false, reason: 'goal', message: setupLabel(stage, setup, index) + message});
    const check = stage.check;
    if (check.type === 'copy') {
      const copy = engine.inspect(check.to), first = engine.inspect(check.from);
      if (isEmpty(copy)) return fail(`Cell +${check.to} is still empty.`);
      if (normal(copy) !== normal(first)) return fail(`Cell +${check.to} holds ${normal(copy)}, not a copy of your first instruction.`);
    } else if (check.type === 'steps') {
      if (!me.losses) return fail(`Your program was still running after ${plural(update.cycle, 'instruction')}.`);
      if (update.cycle !== check.count) return fail(`Your program stopped on instruction ${update.cycle}, not ${check.count}.`);
    } else if (check.type === 'survive') {
      if (me.losses) return fail(`Your program stopped after ${plural(update.cycle, 'cycle')}.`);
      let filled = 0;
      for (let address = 0; address < stage.settings.coreSize; ++address) if (!isEmpty(engine.inspect(address))) ++filled;
      if (filled < check.filled) return fail(`Still running, but only ${plural(filled, 'cell')} filled, not ${check.filled}.`);
    } else if (check.type === 'processes') {
      if (me.losses) return fail(`Your program stopped after ${plural(update.cycle, 'cycle')}.`);
      if (me.tasks !== check.count) return fail(`${plural(me.tasks, 'process')} running after ${plural(update.cycle, 'cycle')}, not ${check.count}.`);
    } else if (check.type === 'win') {
      if (me.losses) return fail('You died first.');
      if (!me.wins) return fail(`Nobody died in ${stage.settings.cycles.toLocaleString('en')} cycles.`);
    }
  }
  const check = stage.check, goal = message => ({...result, passed: false, reason: 'goal', message});
  if (check.type === 'wins') {
    if (result.wins < check.wins) return goal(`${plural(result.wins, 'win')} of ${result.rounds}. You need ${check.wins}.`);
    if (check.maxLosses != null && result.losses > check.maxLosses) return goal(`${plural(result.losses, 'loss')} of ${result.rounds}. At most ${check.maxLosses} allowed.`);
    if (check.maxTies != null && result.ties > check.maxTies) return goal(`${plural(result.ties, 'tie')} of ${result.rounds}. At most ${check.maxTies} allowed.`);
  }
  result.stars = (stage.stars ?? []).map(star =>
    star.metric === 'size' ? result.length <= star.par : star.metric === 'wins' ? result.wins >= star.par :
    star.metric === 'losses' ? result.losses <= star.par : star.metric === 'cycles' ? result.cycles <= star.par :
    star.metric === 'prediction' ? choice === stage.answer : false);
  return result;
}

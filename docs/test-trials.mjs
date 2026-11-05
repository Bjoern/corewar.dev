// SPDX-License-Identifier: GPL-2.0-or-later
// Every Trials stage must be solvable: its solution passes and its known wrong answer fails.
import assert from 'node:assert/strict';
import {stages, manual, wings} from './trials-stages.mjs';
import {runStage} from './trials-check.mjs';

const ids = new Set();
for (const stage of stages) {
  assert(!ids.has(stage.id), `duplicate stage ${stage.id}`); ids.add(stage.id);
  assert(wings.some(wing => wing.id === stage.wing), `${stage.id}: unknown wing`);
  for (const key of stage.manual ?? []) assert(manual[key], `${stage.id}: unknown manual entry ${key}`);
  if (stage.kind === 'demo') {
    assert((await runStage(stage, '')).passed, `${stage.id}: demo does not finish`);
    continue;
  }
  // Every solution passes, and each star is earned by at least one of them.
  const results = [];
  for (const solution of [stage.solution, ...(stage.solutions ?? [])]) {
    const result = await runStage(stage, solution);
    assert(result.passed, `${stage.id} ${stage.title}: solution ${JSON.stringify(solution)} fails: ${result.message}`);
    results.push(result);
  }
  (stage.stars ?? []).forEach((star, i) => assert(results.some(r => r.stars[i]), `${stage.id}: no solution earns ★ ${star.text}`));
  const good = results[0];
  const bad = await runStage(stage, stage.wrong);
  assert(!bad.passed, `${stage.id} ${stage.title}: wrong answer passes`);
  console.log(`${stage.id} ${stage.title}: ok (${results.map(r => `${r.length} lines, cycle ${r.cycles}, stars ${r.stars.map(x => x ? '★' : '☆').join('')}`).join('; ')}); wrong answer: ${bad.message}`);
}
const tooLong = await runStage(stages.find(s => s.id === '1.6'), 'jmp 0, <-2\ndat 0, 0');
assert.equal(tooLong.reason, 'limit');
const broken = await runStage(stages.find(s => s.id === '1.1'), 'mvo 0, 5');
assert.equal(broken.reason, 'assembly');
console.log('Trials stages OK');

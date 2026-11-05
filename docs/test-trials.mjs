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
  const good = await runStage(stage, stage.solution);
  assert(good.passed, `${stage.id} ${stage.title}: solution fails: ${good.message}`);
  assert(good.stars.every(Boolean), `${stage.id}: solution misses a star`);
  const bad = await runStage(stage, stage.wrong);
  assert(!bad.passed, `${stage.id} ${stage.title}: wrong answer passes`);
  console.log(`${stage.id} ${stage.title}: ok (${good.length} lines, ${good.wins}/${good.ties}/${good.losses}); wrong answer: ${bad.message}`);
}
const tooLong = await runStage(stages.find(s => s.id === '1.6'), 'jmp 0, <-2\ndat 0, 0');
assert.equal(tooLong.reason, 'limit');
const broken = await runStage(stages.find(s => s.id === '1.1'), 'mvo 0, 5');
assert.equal(broken.reason, 'assembly');
console.log('Trials stages OK');

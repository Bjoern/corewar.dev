// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import {pairTotals,sortRows,perRound,marginColor} from './results-tables.mjs';

const w=(id,source=id)=>({id,name:id.toUpperCase(),source});
const side=(wins,ties,losses)=>({wins,ties,losses,score:3*wins+ties});
const [a,b,c]=[w('a'),w('b'),w('c')];

// Round robin: each result fills both directions; a self fight fills the diagonal once.
{
 const jobs=[{warriors:[a,b]},{warriors:[a,c]},{warriors:[b,c]},{warriors:[a,a]}].map((j,id)=>({id,...j}));
 const results=[
  {id:0,completed:10,warriors:[side(6,1,3),side(3,1,6)]},
  {id:1,completed:10,warriors:[side(0,10,0),side(0,10,0)]},
  {id:3,completed:10,warriors:[side(4,2,4),side(4,2,4)]}];
 const t=pairTotals({plan:{mode:'round-robin',entrants:[a,b,c],jobs},results});
 assert.deepEqual(t.columns.map(x=>x.id),['a','b','c']);
 assert.deepEqual(t.cells[0][1],{wins:6,ties:1,losses:3,score:19,given:10,rounds:10});
 assert.deepEqual(t.cells[1][0],{wins:3,ties:1,losses:6,score:10,given:19,rounds:10});
 assert.equal(t.cells[1][2],null,'unfinished matchup');
 assert.equal(t.cells[0][0].rounds,10,'self fight counted once');
 assert.equal(perRound(t.cells[0][1]),1.9);
 assert.match(marginColor(t.cells[0][1]),/^rgb/);assert.equal(marginColor(null),null);
}
// Benchmark: rows are candidates, columns the suite; self and hill jobs and excluded opponents are left out.
{
 const o=[w('x'),w('y'),w('z')],suite={warriors:o};
 const jobs=[{kind:'candidate',opponent:0,warriors:[a,o[0]]},{kind:'candidate',opponent:2,warriors:[a,o[2]]},{kind:'self',warriors:[a,a]},{kind:'hill',i:0,j:1,warriors:[o[0],o[1]]}].map((j,id)=>({id,...j}));
 const results=jobs.map(j=>({id:j.id,completed:5,warriors:[side(5,0,0),side(0,0,5)]}));
 const t=pairTotals({plan:{mode:'benchmark',entrants:[a],jobs},results,suite,excluded:[o[1]]});
 assert.deepEqual(t.columns.map(x=>x.id),['x','z']);
 assert.deepEqual(t.cells[0].map(x=>x?.rounds),[5,5]);
 assert.deepEqual(t.cells[0].map(x=>[x.score,x.given]),[[15,0],[15,0]],'points given come from the opponent');
}
assert.equal(pairTotals({plan:{mode:'melee',entrants:[a,b],jobs:[]},results:[]}),null);
// Sorting: by number either way, empty values last.
{
 const columns=[{key:'n',value:r=>r.n},{key:'name',value:r=>r.name}],rows=[{n:2,name:'b'},{n:null,name:'c'},{n:1,name:'a'}];
 assert.deepEqual(sortRows(rows,columns,{key:'n',dir:'asc'}).map(r=>r.n),[1,2,null]);
 assert.deepEqual(sortRows(rows,columns,{key:'n',dir:'desc'}).map(r=>r.n),[2,1,null]);
 assert.deepEqual(sortRows(rows,columns,{key:'name',dir:'asc'}).map(r=>r.name),['a','b','c']);
}
console.log('PASS: pair totals for round robin and benchmark runs, sorting.');

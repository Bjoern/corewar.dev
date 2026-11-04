// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import {gapSequence,gapRatios,findx,findxNaive,profile,classicScoreNaive,euclidCount,candidateSteps,analyzeStep,rankValue,findxLowerBound,modOf} from './stepfinder.mjs';
// Test vectors from resources/step-finder-spec.md (N = 8000, checked with a Python reference).
const sequences={3039:[3039,1117,312,131,-50,-19,-7,-2,-1],3359:[3359,-1282,-487,-179,-50,-21,8,3,1],3364:[3364,-1272,-452,-84,32,12,4],
 3094:[3094,1282,-530,222,-86,-36,14,6,-2],2365:[2365,-905,-350,-145,60,-25,10,5],1001:[1001,8,-1],2667:[2667,1]};
for(const [step,seq] of Object.entries(sequences)){
 const got=gapSequence(Number(step),8000);assert.deepEqual(got,seq,'gap sequence of '+step);
 assert.equal(Math.abs(got.at(-1)),modOf(Number(step),8000),'last term is the mod for '+step);
}
assert.equal(gapRatios([3364,-1272,-452]).length,2);
const table={3039:[29,50,129,179,487],3359:[31,50,131,181,805],3364:[31,69,107,283,478],3094:[31,75,106,181,649],2365:[27,71,115,274,663],1001:[615,815,911,959,991],2667:[6803,7403,7703,7853,7943]};
for(const [step,row] of Object.entries(table))[400,200,100,50,20].forEach((x,i)=>assert.equal(findx(Number(step),8000,x),row[i],`find-${x} of ${step}`));
// Best mod-5 steps, the spec's ranking sanity check.
const targets=[100,20,15,10],rows=candidateSteps({coreSize:8000,mod:5}).map(s=>{const r=analyzeStep(s,8000,targets);delete r.buffers;return r;});
// Steps below 100 are left out: step 15 fills the core linearly and meets find-15's lower bound (534).
const best=i=>{const pool=rows.filter(r=>r.step>=100),v=Math.min(...pool.map(r=>r.findx[i]??Infinity));return {v,steps:pool.filter(r=>r.findx[i]===v).map(r=>r.step)};};
assert.equal(best(0).v,81);assert(best(0).steps.includes(395));
assert.equal(best(1).v,401);assert(best(1).steps.includes(1995));
assert.equal(best(2).v,537);assert(best(2).steps.includes(3635));
assert.equal(best(3).v,801);assert(best(3).steps.includes(3995));
assert(rows.every(r=>findx(r.step,8000,5)===1600),'mod-5 steps reach spacing 5 only after all 1600 hits');
assert(rows.every(r=>findx(r.step,8000,4)===null),'x below the mod is never reached');
// Fast reverse pass against the naive versions on small cores.
for(const N of [100,97,64,80]){
 for(let s=1;s<N;s++){
  for(const x of [1,2,3,5,10,20,40])assert.equal(findx(s,N,x),findxNaive(s,N,x),`N=${N} s=${s} x=${x}`);
  assert.equal(profile(s,N).score,classicScoreNaive(s,N),`classic score N=${N} s=${s}`);
 }
}
assert.equal(euclidCount(5,8),4);assert.equal(euclidCount(3,8),3);assert.equal(euclidCount(0,8),0);
assert.equal(rankValue({findx:[81,401]},{coreSize:8000,targets:[100,20],ranking:'x:1',weights:[1,1]}),401);
assert.equal(rankValue({findx:[80,400]},{coreSize:8000,targets:[100,20],ranking:'weighted',weights:[1,1]}),1);
assert.equal(findxLowerBound(8000,15),534);
console.log('PASS: step finder gap sequences, find-x vectors, mod-5 ranking and reverse pass vs naive.');

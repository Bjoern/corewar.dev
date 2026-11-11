import assert from 'node:assert/strict';
import {planTournament} from './tournament-plan.mjs';
const entrants=['A','B','C'].map(id=>({id,name:id,source:';name '+id+'\njmp 0'}));
const base={entrants,config:{},rounds:10,seed:'test'};
const plan=(mode,extra={})=>planTournament({...base,mode,...extra});
assert.equal(plan('round-robin').jobs.length,3);
assert.equal(plan('round-robin',{selfFights:true}).jobs.length,6);
assert.deepEqual(plan('challenge',{challenger:'B'}).jobs.map(j=>j.warriors.map(w=>w.id)),[['B','A'],['B','C']]);
assert.equal(plan('melee').jobs[0].warriors.length,3);
assert.equal(plan('benchmark',{opponents:entrants}).jobs.length,6);
assert.equal(plan('benchmark',{opponents:entrants,selfFights:true}).jobs.length,9);
assert.equal(plan('round-robin').totalRounds,30);
assert.deepEqual(plan('round-robin'),plan('round-robin'));
assert.equal(new Set(plan('round-robin').jobs.map(j=>j.config.fixedPosition)).size,3);
assert.throws(()=>plan('round-robin',{entrants:[]}),/Select/);
assert.throws(()=>plan('round-robin',{rounds:0}),/Rounds/);
assert(plan('round-robin',{config:{permutate:true}}).jobs.every(j=>j.config.permutate));
assert(plan('challenge',{challenger:'B',config:{permutate:true}}).jobs.every(j=>j.config.permutate));
assert(plan('benchmark',{opponents:entrants,config:{permutate:true}}).jobs.every(j=>j.config.permutate));
assert(plan('melee',{entrants:entrants.slice(0,2),config:{permutate:true}}).jobs[0].config.permutate);
assert.throws(()=>plan('melee',{config:{permutate:true}}),/exactly two/);
const hill=['X','Y','Z'].map(id=>({id,name:id,source:';name '+id+'\nmov 0,1'}));
const pushed=plan('benchmark',{entrants:entrants.slice(0,2),opponents:hill,pushoff:true});
assert.deepEqual(pushed.jobs.map(j=>j.kind),['candidate','candidate','candidate','self','candidate','candidate','candidate','self']);
const withHill=plan('benchmark',{entrants:entrants.slice(0,1),opponents:hill,pushoff:true,hill:true});
assert.deepEqual(withHill.jobs.filter(j=>j.kind==='hill').map(j=>[j.i,j.j]),[[0,0],[0,1],[0,2],[1,1],[1,2],[2,2]]);
// Add a benchmark suite: its warriors join round robin and melee, so they fight each other too.
const joined=plan('round-robin',{opponents:hill,withSuite:true});
assert.equal(joined.jobs.length,15);assert.deepEqual(joined.entrants.map(w=>w.id),['A','B','C','X','Y','Z']);
assert(joined.jobs.some(j=>j.warriors[0].id==='X'&&j.warriors[1].id==='Y'));
assert.equal(plan('round-robin',{entrants:[],opponents:hill,withSuite:true}).jobs.length,3);
assert.equal(plan('melee',{opponents:hill,withSuite:true}).jobs[0].warriors.length,6);
assert.equal(plan('round-robin',{opponents:hill}).jobs.length,3); // without withSuite the suite stays out
assert.equal(plan('challenge',{challenger:'B',opponents:hill,withSuite:true}).jobs.length,2); // only round robin and melee
assert.throws(()=>plan('round-robin',{withSuite:true}),/suite/);
const big=Array.from({length:34},(_,i)=>({id:'s'+i,name:'s'+i,source:';name s'+i+'\njmp 0'}));
assert.throws(()=>plan('melee',{opponents:big,withSuite:true}),/at most 36/);
assert.equal(plan('round-robin',{opponents:big,withSuite:true}).jobs.length,37*36/2);
// Pair-keyed placement: the same two warriors get the same positions in any run.
const key=(p,a,b)=>p.jobs.find(j=>j.warriors[0].id===a&&j.warriors[1].id===b).config.fixedPosition;
assert.equal(key(pushed,'B','Y'),key(plan('benchmark',{entrants:[entrants[1]],opponents:hill,pushoff:true}),'B','Y'));
assert.equal(key(withHill,'X','Y'),key(plan('benchmark',{entrants:entrants.slice(1),opponents:hill,pushoff:true,hill:true}),'X','Y'));
assert.notEqual(key(withHill,'X','Y'),key(withHill,'X','Z'));
const hillRun=plan('benchmark',{entrants:entrants.slice(0,1),opponents:hill,pushoff:true,hill:true,hillRounds:1000});
assert.equal(hillRun.jobs.find(j=>j.kind==='hill').config.rounds,1000);assert.equal(hillRun.jobs.find(j=>j.kind==='candidate').config.rounds,10);
assert.equal(hillRun.totalRounds,4*10+6*1000);assert.deepEqual(hillRun.jobs.map(j=>j.id),[...hillRun.jobs.keys()]);
// Placement keys become numeric -F values (pMARS's text-key RNG is broken), never seed 0.
import('./tournament-plan.mjs').then(({numericPosition})=>{
 const nano={coreSize:80,maxLength:5,distance:5};
 const values=Array.from({length:500},(_,i)=>Number(numericPosition('k'+i,nano)));
 assert(values.every(v=>Number.isInteger(v)&&v>=6&&v<=75));assert(new Set(values).size>60);
 assert.match(numericPosition('x',{}),/^\d+$/);
});
assert(plan('round-robin').jobs.every(j=>/^\d+$/.test(j.config.fixedPosition)));
// -A Assemble only is a battle setting: a tournament ignores it and fights every matchup.
for(const extra of [{},{opponents:hill,pushoff:true,hill:true}])assert(plan(extra.opponents?'benchmark':'round-robin',{...extra,config:{assembleOnly:true}}).jobs.every(j=>j.config.assembleOnly===false&&j.config.rounds>0));
console.log('PASS: tournament schedules, self fights, settings validation and reproducible seeds.');

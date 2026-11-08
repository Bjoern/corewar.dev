// SPDX-License-Identifier: GPL-2.0-or-later
// The shared population search (population.mjs) on a synthetic problem: every scheme and survival
// rule improves, seeded runs repeat and a saved state continues exactly, crowding and clearing keep
// the right members, mean scores and re-scoring on new seeds, generation events and racing.
import assert from 'node:assert/strict';
import {Population,Rng,POPULATION_DEFAULTS,profileRms} from './population.mjs';

// Genomes: vectors of 6 values 0 … 49; score: closeness to a target.
const N=6,K=50,target=[7,41,23,3,30,16];
const ops={
 random:r=>Array.from({length:N},()=>r.below(K)),
 mutate:(x,r,{force}={})=>{x=[...x];let changed=false;for(let i=0;i<N;i++)if(r.random()<1/N){x[i]=r.below(K);changed=true;}if(force&&!changed){const i=r.below(N);x[i]=(x[i]+1)%K;}return x;},
 crossover:(a,b,r)=>a.map((v,i)=>r.random()<0.5?v:b[i]),
 key:x=>x.join(','),
 distance:(a,b)=>a.reduce((d,v,i)=>d+(v!==b[i]),0)/N,
};
const score=x=>300-x.reduce((d,v,i)=>d+Math.abs(v-target[i]),0);
const result=x=>({score:score(x),se:0,complete:true});
function run(pop,batches){for(let i=0;i<batches;i++){const b=pop.ask();pop.tell(b,b.map(c=>result(c.genome)));}return pop;}

// Rng: numeric seeds as before, string seeds hashed, same seed same numbers.
assert.deepEqual(new Rng(7).s,new Rng('7').s);assert.notDeepEqual(new Rng('a').s,new Rng('b').s);
{const r=new Rng('x'),f=r.fn();assert.equal(typeof f(),'number');assert(f.int(5)<5);assert.equal(f.pick(['q']),'q');assert.equal(f.weighted([0,1,0]),1);}

// Every combination improves on the start, and the same seed gives the same run.
for(const scheme of ['steady','generational'])for(const survival of ['crowding','clearing']){
 const params={population:20,scheme,survival},batches=scheme==='steady'?800:40;
 const make=()=>new Population(ops,{params,seed:3});
 const a=run(make(),batches),b=run(make(),batches);
 assert.deepEqual(a.best(),b.best(),`${scheme}/${survival} repeats`);
 const first=run(new Population(ops,{params,seed:3}),1).ranked()[0].score;
 assert(a.best().score>first+40,`${scheme}/${survival} improves: ${first} → ${a.best().score}`);
 assert(a.members.length<=20&&new Set(a.members.map(m=>m.key)).size===a.members.length,'no duplicates, no more than the population');
 // Save half-way, continue: the same as running straight through.
 const half=run(make(),batches/2),resumed=run(Population.fromState(ops,JSON.parse(JSON.stringify(half.state()))),batches/2);
 assert.deepEqual(resumed.best(),a.best(),`${scheme}/${survival} resumes exactly`);
}

// The first population: seeds, then mutants of them (seedShare), then new genomes, in one batch.
{
 const seed=[1,2,3,4,5,6],p=new Population(ops,{params:{population:10,seedShare:0.5},seeds:[seed],seed:1}),b=p.ask();
 assert.equal(b.length,10);assert(b.every(c=>c.kind==='init'));assert.deepEqual(b[0].genome,seed);
 assert(b.slice(1,6).every(c=>ops.distance(c.genome,seed)<=0.5),'mutants of the seed');
 assert.equal(new Set(b.map(c=>c.key)).size,10,'all different');
 p.tell(b,b.map(c=>result(c.genome)));assert(!p.initializing);
 assert.equal(p.ask().length,1,'steady state: one child at a time');
 const g=new Population(ops,{params:{population:10,scheme:'generational'},seed:1});run(g,1);assert.equal(g.ask().length,10,'generational: a whole population');
}
// Invalid candidates (null) are left out; the first population keeps trying until 10 are in.
{
 const p=new Population(ops,{params:{population:20},seed:2});let calls=0;
 while(p.initializing){const b=p.ask();p.tell(b,b.map(c=>++calls%3?null:result(c.genome)));}
 assert(p.members.length>=10,'at least 10 valid members: '+p.members.length);assert(p.summary().invalid>0);
 assert.throws(()=>{const q=new Population(ops,{params:{population:20},seed:2});for(let i=0;i<100;i++){const b=q.ask();q.tell(b,b.map(()=>null));}},/No valid warrior/);
}

// Deterministic crowding: past the population size a child replaces the most similar weaker member.
{
 const p=new Population(ops,{params:{population:3,survival:'crowding'},seed:1}),m=(x,s)=>({genome:x,key:ops.key(x),sum:s,n:1,score:s,se:0});
 p.s.pop=[m([0,0,0,0,0,0],100),m([9,9,9,9,9,9],50),m([0,0,0,0,0,1],10)];
 p.crowd(m([9,9,9,9,9,8],60));
 assert.deepEqual(p.members.map(x=>x.score),[100,10,60],'replaced the similar weaker one, not the weakest');
 p.crowd(m([1,1,1,1,1,1],5));assert.deepEqual(p.members.map(x=>x.score),[100,10,60],'a child weaker than all is dropped');
}
// Clearing: near-copies of a better member give way to other kinds; elites stay; radius 0 is truncation.
{
 const p=new Population(ops,{params:{niche:0.3,nicheSize:1,elite:1},seed:1}),m=(x,score)=>({genome:x,score});
 const base=[0,0,0,0,0,0],near=[0,0,0,0,0,1],other=[5,5,5,5,5,5];
 const list=[m(base,200),m(near,190),m(near,180),m(other,100)];
 assert.deepEqual(p.survivors(list,2).map(x=>x.score),[200,100],'the other kind gets in before the near-copies');
 assert.deepEqual(p.survivors(list,4).map(x=>x.score),[200,100,190,180],'cleared members fill places left over');
 p.params.elite=2;assert.deepEqual(p.survivors(list,2).map(x=>x.score),[200,190],'elites are kept');
 p.params.niche=0;assert.deepEqual(p.survivors(list,3).map(x=>x.score),[200,190,180]);
}
// New seeds: the top `rescore` members are scored again; 'mean' averages and trusts members seen
// twice, 'latest' replaces.
for(const scoreMemory of ['mean','latest']){
 const p=run(new Population(ops,{params:{population:10,scoreMemory,rescore:3},seed:5}),1),top=p.ranked().slice(0,3).map(m=>m.key);
 p.invalidate();const b=p.ask();
 assert.deepEqual(b.map(c=>c.key),top);assert(b.every(c=>c.kind==='reeval'&&c.race===null));
 const before=Object.fromEntries(p.members.map(m=>[m.key,m.score]));
 p.tell(b,b.map(c=>({score:before[c.key]-20,se:2,complete:true})));
 for(const k of top){const m=p.members.find(x=>x.key===k);assert.equal(m.score,scoreMemory==='mean'?before[k]-10:before[k]-20);assert.equal(m.n,scoreMemory==='mean'?2:1);}
 if(scoreMemory==='mean')assert(top.includes(p.best().key),'the best is one scored on two seed sets');
 const all=run(new Population(ops,{params:{population:10,rescore:0},seed:5}),1);all.invalidate();assert.equal(all.ask().length,10,'rescore 0: everyone');
}
// Generations: `population` children make one, and every reseedEvery-th asks for new seeds.
{
 const p=new Population(ops,{params:{population:5,reseedEvery:2},seed:1}),events=[];run(p,1);
 for(let i=0;i<20;i++){const b=p.ask();events.push(...p.tell(b,b.map(c=>result(c.genome))));}
 assert.deepEqual(events.filter(e=>e.type==='generation').map(e=>[e.generation,e.reseed]),[[1,false],[2,true],[3,false],[4,true]]);
 assert(events.some(e=>e.type==='best'));
}
// Racing: children race against the weakest member once the population is full, and only when on;
// a raced (incomplete) result never joins.
{
 const p=run(new Population(ops,{params:{population:10,race:true},seed:1}),1),worst=Math.min(...p.members.map(m=>m.score));
 const b=p.ask();assert.equal(b[0].race,worst);
 p.tell(b,[{score:0,se:1,complete:false}]);assert(!p.members.some(m=>m.key===b[0].key));assert.equal(p.summary().discarded,1);
 assert.equal(run(new Population(ops,{params:{population:10,race:false},seed:1}),1).ask()[0].race,null);
}
// Novelty: selection adds weight × the mean RMS distance of a member's profile to its nearest
// neighbours (population and archive); the score stays plain, racing is off, the archive is saved.
{
 assert.equal(profileRms([0,0,0,0],[30,30,30,30]),30);assert.equal(profileRms([10,20],[10,20]),0);
 const p=new Population(ops,{params:{population:4,novelty:0.5},seed:1}),m=(vec,score)=>({genome:[score],score,vec});
 const list=[m([0,0],100),m([0,0],90),m([0,0],80),m([300,300],10)];
 p.share(list);
 assert.equal(list[3].novelty,300,'the odd one out is far from all three');
 assert.equal(list[0].novelty,100,'the others: 0, 0 and 300 away');
 assert.deepEqual(list.map(x=>x.fit),[150,140,130,160]);assert.deepEqual(list.map(x=>x.score),[100,90,80,10]);
 p.s.archive=[[300,300],[300,300]];p.share(list);assert.equal(list[3].novelty,900/5,'the archive counts as neighbours: two at 0');
 const q=new Population(ops,{params:{population:12,novelty:1,race:true},seed:3});
 for(let i=0;i<4;i++){const b=q.ask();q.tell(b,b.map(c=>({...result(c.genome),opponents:c.genome.map(v=>({score:6*v}))})));}
 assert(q.s.archive.length>0,'new members join the archive now and then');assert.equal(q.ask()[0].race,null,'no racing with novelty');
 assert.deepEqual(Population.fromState(ops,q.state()).s.archive,q.s.archive);
 assert(q.members.every(x=>x.fit>=x.score));
}
assert.equal(POPULATION_DEFAULTS.scheme,'steady');
console.log('PASS: population search: schemes, survival, seeding, invalid members, crowding, clearing, score memory, generations, racing, resume.');

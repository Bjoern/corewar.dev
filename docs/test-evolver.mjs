// SPDX-License-Identifier: GPL-2.0-or-later
// Warrior evolver: every genome the operators make is a valid warrior for its settings and
// assembles (exMARS and pMARS) back to itself; seeds assemble into genomes; pasted warriors
// split; and a short nano run against the nano benchmark raises the best and mean score.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rng,genomeRules,randomGenome,mutate,mutateOnce,crossover,normalize,renderGenome,genomeKey,signed,MUTATIONS,markovModel,markovGenome,nicheGroups} from './evolver-genome.mjs';
import {Evolution,splitHoldOut} from './evolver-run.mjs';
import {EVOLVER_PRESETS,checkCustom,splitWarriors,suiteFits} from './evolver-presets.mjs';
import {Evaluator,runMatch,scoringMode} from './optimizer-fitness.mjs';
import {assemble} from './dist/exmars/fighter-client.mjs';
import {hillOf} from './exmars.mjs';
import {Engine} from './engine.mjs';

const nano=EVOLVER_PRESETS.find(p=>p.id==='nano').config,tiny=EVOLVER_PRESETS.find(p=>p.id==='tiny').config;
const valid=(g,rules)=>{
 assert(g.code.length>=1&&g.code.length<=rules.maxLength,'length '+g.code.length);
 assert(Number.isInteger(g.start)&&g.start>=0&&g.start<g.code.length,'start');
 for(const [op,m,am,a,bm,b] of g.code){
  assert(rules.opcodes.includes(op),'opcode '+op);assert(m>=0&&m<7);assert(am>=0&&am<8);assert(bm>=0&&bm<8);
  assert(a>=0&&a<rules.coreSize&&b>=0&&b<rules.coreSize,'fields');
 }
};
assert.equal(signed(40,80),-40);assert.equal(signed(79,80),-1);assert.equal(signed(39,80),39);
// Operators keep warriors valid, over many random draws and both small presets.
for(const config of [nano,tiny]){
 const rules=genomeRules(config),r=rng('ops'+config.coreSize);
 let a=randomGenome(r,rules),b=randomGenome(r,rules);
 for(let i=0;i<3000;i++){
  valid(a,rules);valid(b,rules);
  const c=i%3===0?crossover(a,b,r,rules):mutate(a,r,rules,{rate:2,structural:0.5});
  valid(c,rules);
  [a,b]=[c,i%50===0?randomGenome(r,rules):b];
 }
 // Each kind of mutation is reachable and the result is still valid.
 const seen=new Set();const g=randomGenome(rng('kinds'),rules,3);
 for(let i=0;i<500;i++){const m=mutateOnce(g,r,rules,{structural:0.5});valid(m,rules);seen.add(m.code.length-g.code.length);}
 assert(seen.has(1)&&seen.has(-1)&&seen.has(0),'insert, delete and in-place mutations happen');
}
assert.equal(MUTATIONS.length,9);
// Same seed, same genomes.
{const rules=genomeRules(nano);assert.equal(genomeKey(randomGenome(rng('s'),rules)),genomeKey(randomGenome(rng('s'),rules)));}
// Rendered Redcode assembles to exactly the genome on exMARS, and is accepted by pMARS.
for(const config of [nano,tiny]){
 const rules=genomeRules(config),r=rng('asm'),hill=hillOf(config);
 for(let i=0;i<60;i++){
  const g=randomGenome(r,rules),w=await assemble(renderGenome(g,rules),hill);
  assert(w.ok,w.errors);
  assert.deepEqual({code:w.instructions,start:w.start},g);
 }
 const g=randomGenome(r,rules,rules.maxLength),source=renderGenome(g,rules,{name:'pmars check'});
 const engine=await Engine.create({...config,warriors:1,rounds:1,assembleOnly:true,brief:true},{visual:false,log:()=>{}});
 engine.compile([source],()=>{},null,()=>{});
}
// A seed with labels and EQU becomes a genome; normalize clamps anything else into the rules.
{
 const rules=genomeRules(nano),w=await assemble(';name s\nstep equ 3\nloop add #step, ptr\nptr mov 0, 2\n jmp loop\n end loop\n',hillOf(nano));
 const g=normalize({code:w.instructions,start:w.start},rules);valid(g,rules);assert.equal(g.code.length,3);assert.equal(g.code[0][3],3);
 valid(normalize({code:[[99,9,9,-5,1,500]],start:7},rules),rules);
 valid(normalize({code:Array.from({length:12},()=>[2,6,0,1,0,2]),start:11},rules),rules);
}
// Held-out opponents: a seeded share, at least one held out and one left to train on.
{
 const list=Array.from({length:10},(_,i)=>({name:'w'+i}));
 const a=splitHoldOut(list,0.2,'s'),b=splitHoldOut(list,0.2,'s'),c=splitHoldOut(list,0.2,'t');
 assert.equal(a.heldOut.length,2);assert.equal(a.training.length,8);assert.deepEqual(a,b,'same seed, same split');
 assert.notDeepEqual(a.heldOut,c.heldOut,'another seed, another split');
 assert.deepEqual(new Set([...a.training,...a.heldOut]),new Set(list));
 assert.equal(splitHoldOut(list,0,'s').heldOut.length,0);assert.equal(splitHoldOut(list.slice(0,1),0.5,'s').heldOut.length,0);
 assert.equal(splitHoldOut(list.slice(0,2),0.5,'s').training.length,1);assert.equal(splitHoldOut(list,0.01,'s').heldOut.length,1);
}
// Presets, custom checks and pasted benchmark warriors.
assert.deepEqual(['nano','tiny','94','lp','custom'],EVOLVER_PRESETS.map(p=>p.id));
assert.deepEqual([nano.coreSize,nano.tasks,nano.cycles,nano.maxLength,nano.distance],[80,80,800,5,5]);
assert.equal(checkCustom({coreSize:800,cycles:8000,tasks:800,maxLength:20,distance:20}),null);
assert.match(checkCustom({coreSize:800,cycles:8000,tasks:800,maxLength:30,distance:20}),/distance/);
assert.match(checkCustom({coreSize:80,cycles:800,tasks:80,maxLength:5,distance:41}),/half/);
assert(suiteFits({coreSize:80,maxLength:5},nano));assert(!suiteFits({coreSize:80,maxLength:5,rules88:true},nano));
assert.deepEqual(splitWarriors(';redcode\n;name A\nmov 0, 1\nend\n;redcode\n;name B\ndat 0, 0\n').map(w=>w.name),['A','B']);
assert.deepEqual(splitWarriors(';name A\nmov 0, 1\nend\n;name B\ndat 0, 0\nend\n').map(w=>w.name),['A','B']);
assert.deepEqual(splitWarriors('mov 0, 1').map(w=>w.name),['Pasted warrior 1']);
assert.deepEqual(splitWarriors('  \n'),[]);
// Every preset's benchmarks exist in warriors_public and fit the preset.
for(const p of EVOLVER_PRESETS)for(const id of p.benchmarks){
 const d=JSON.parse(readFileSync(new URL('../warriors_public/'+id.replace(/^public-/,''),import.meta.url),'utf8'));
 assert(suiteFits(d.parameters,p.config),id);
}

// Evolving nano warriors against the nano benchmark raises the score (exact scoring, no noise).
{
 const dir=new URL('../warriors_public/nanobm07/',import.meta.url),d=JSON.parse(readFileSync(new URL('suite.benchmark.json',dir),'utf8'));
 const opponents=d.warriors.slice(0,20).map(f=>({name:f,source:readFileSync(new URL(f,dir),'latin1')}));
 const evaluator=new Evaluator({runJob:runMatch,config:nano,opponents});
 evaluator.setMode(scoringMode(nano,opponents.map(o=>o.source)));
 assert(evaluator.mode.exact);
 const e=new Evolution({evaluator,config:nano,params:{population:24},seed:'test'});
 const first=await e.init();
 for(let i=0;i<10;i++)await e.step();
 const last=e.history.at(-1);
 console.log(`nano: best ${first.best.toFixed(1)} → ${last.best.toFixed(1)}, mean ${first.mean.toFixed(1)} → ${last.mean.toFixed(1)} over ${e.generation} generations`);
 assert(last.best>first.best,'the best score goes up');
 assert(last.mean>first.mean+10,'the population mean goes up');
 for(let i=1;i<e.history.length;i++)assert(e.history[i].best>=e.history[i-1].best,'the best never drops with exact scores');
 const w=await assemble(e.bestSource('test'),hillOf(nano));assert(w.ok);
 valid(normalize({code:w.instructions,start:w.start},e.rules),e.rules);
 // Seeding from genomes (the last population) starts from them.
 const again=new Evolution({evaluator,config:nano,params:{population:24},seeds:e.snapshot(),seed:'test2'});
 assert((await again.init()).best>=last.top-1e-9);
 // "Mutations per child" reaches the operators (more mutations, children further from their parents).
 const far=new Evolution({evaluator:null,config:nano,params:{mutation:8,structural:0}}),near=new Evolution({evaluator:null,config:nano,params:{mutation:1,structural:0}});
 const r=rng('rate'),parent=randomGenome(r,e.rules,5),{distance}=await import('./evolver-genome.mjs');
 const spread=x=>Array.from({length:200},()=>distance(parent,x.ops.mutate(parent,far.engine.rng))).reduce((a,b)=>a+b,0);
 assert(spread(far)>spread(near)*2,'the mutation rate is used');
 // The optimizer's methodology on sampled scores: steady state, crowding, mean scores over seed sets,
 // racing; new placements every generation re-score the top members.
 const sampled=new Evaluator({runJob:runMatch,config:nano,opponents:opponents.slice(0,6)});sampled.setMode(scoringMode(nano,[],{mode:'sampled',rounds:20}));
 const s=new Evolution({evaluator:sampled,config:nano,params:{population:12,scheme:'steady',survival:'crowding',scoreMemory:'mean',rescore:4,race:true,reseedEvery:1},seed:'s'});
 await s.init();for(let i=0;i<3;i++)await s.step();
 assert.equal(s.generation,3);assert.equal(sampled.epoch,2,'new placements after generations 1 and 2');
 assert(s.engine.summary().population===12&&s.engine.s.rescored>0&&s.population.some(m=>m.n>=2),'members scored on two seed sets');
 assert(s.best&&s.history.length===4);
}
// Niching (clearing): near-copies of a better warrior give way to other kinds; elites stay; off at radius 0.
{
 const rules=genomeRules(nano),e=new Evolution({evaluator:null,config:nano,params:{niche:0.3,nicheSize:1,elite:1}});
 const base={code:[[2,6,0,0,0,1],[11,2,0,-1,0,0]],start:0},near={code:[[2,6,0,0,0,1],[11,2,0,-1,0,5]],start:0},other={code:[[1,2,0,0,0,0],[2,6,0,2,0,3],[11,2,0,-2,0,0]],start:0};
 const m=(g,score)=>({genome:normalize(g,rules),score});
 const list=[m(base,200),m(near,190),m(near,180),m(other,100)];
 assert.deepEqual(e.survivors(list,2).map(x=>x.score),[200,100],'the other kind gets in before the near-copies');
 assert.deepEqual(e.survivors(list,4).map(x=>x.score),[200,100,190,180],'cleared warriors fill places left over');
 e.params.elite=2;assert.deepEqual(e.survivors(list,2).map(x=>x.score),[200,190],'elites are kept');
 assert.deepEqual(nicheGroups(list.map(x=>x.genome),0.3),{group:[0,0,0,1],leaders:[0,3]});
 e.params.niche=0;assert.deepEqual(e.survivors(list,3).map(x=>x.score),[200,190,180]);
}
// Results-based fitness sharing and niches by results.
{
 const {profile,profileDistance}=await import('./population.mjs');
 const rules=genomeRules(nano),e=new Evolution({evaluator:null,config:nano,params:{fitness:'shared',niche:0.15,nicheSize:1,elite:1,nicheBy:'results'}}),pop=e.engine;
 const base={code:[[2,6,0,0,0,1],[11,2,0,-1,0,0]],start:0},near={code:[[2,6,0,0,0,1],[11,2,0,-1,0,5]],start:0},other={code:[[1,2,0,0,0,0],[2,6,0,2,0,3],[11,2,0,-2,0,0]],start:0};
 const m=(g,vec,own=null)=>({genome:normalize(g,rules),vec,own,score:(vec.reduce((a,b)=>a+b,0)+(own??0))/(vec.length+(own==null?0:1))});
 assert.deepEqual(profile({opponents:[{score:10},{score:250,self:true},{score:30}]}),{vec:[10,30],own:250},'the self fight is kept apart');
 assert.equal(profile({score:1}),null);
 assert.equal(profileDistance([0,300],[300,0]),1);assert.equal(profileDistance([100,50],[100,50]),0);
 // Two copies beat opponent A; one specialist beats B, which nobody else scores against: lower score, higher shared value.
 const a1=m(base,[300,0]),a2=m(near,[290,0]),spec=m(other,[0,200]);
 pop.share([a1,a2,spec]);
 assert(spec.score<a1.score&&spec.fit>a1.fit,`the specialist ranks first by shared value (${spec.fit.toFixed(1)} vs ${a1.fit.toFixed(1)})`);
 // Equally hard opponents: the shared value is the score.
 const b1=m(base,[100,200]),b2=m(other,[200,100]);pop.share([b1,b2]);
 assert(Math.abs(b1.fit-b1.score)<1e-9&&Math.abs(b2.fit-b2.score)<1e-9);
 // The self fight is not weighed.
 const c1=m(base,[100,200],150);pop.share([c1,m(other,[200,100],150)]);assert(Math.abs(c1.fit-c1.score)<1e-9);
 // Survival by shared value, by results: a1 and a2 are one niche (alike results), the specialist leads its own;
 // the elite (by plain score) stays first.
 pop.share([a1,a2,spec]);
 assert.deepEqual(e.survivors(pop.order([a1,a2,spec]),2),[a1,spec]);
 e.params.elite=0;assert.deepEqual(e.survivors(pop.order([a1,a2,spec]),1),[spec],'without elites the shared value decides');
 // By results, near-identical code with different results is two niches; by code, one.
 const x=m(base,[300,0]),y=m(near,[0,300]);
 assert.equal(pop.near(x,y),1);e.params.nicheBy='code';assert(pop.near(x,y)<0.15);
 // Plain fitness: the shared value is the score, so nothing changes.
 e.params.fitness='plain';pop.share([a1,a2,spec]);assert.equal(spec.fit,spec.score);
 // A short run with both on, sampled scores and self fights: it runs, keeps profiles and counts niches by results.
 const dir=new URL('../warriors_public/nanobm07/',import.meta.url),d=JSON.parse(readFileSync(new URL('suite.benchmark.json',dir),'utf8'));
 const opponents=d.warriors.slice(0,5).map(f=>({name:f,source:readFileSync(new URL(f,dir),'latin1')}));
 const ev=new Evaluator({runJob:runMatch,config:nano,opponents,options:{selfFight:true}});ev.setMode(scoringMode(nano,[],{mode:'sampled',rounds:20}));
 const run=new Evolution({evaluator:ev,config:nano,params:{population:12,fitness:'shared',nicheBy:'results',niche:0.15,reseedEvery:1,scoreMemory:'mean'},seed:'shared'});
 await run.init();await run.step();await run.step();
 assert.equal(run.population.length,12);
 assert(run.population.every(p=>p.vec?.length===5&&p.own!=null&&Number.isFinite(p.fit)),'members keep 5 opponents’ points, the self fight and a shared value');
 assert(run.profiles()?.length===12&&run.history.at(-1).niches>=1);
}
// The population map: variants of one warrior sit closer together than to another kind.
{
 const {mapLayout}=await import('./evolver-map.mjs');
 const rules=genomeRules(nano),r=rng('map'),a=randomGenome(r,rules,5),b=randomGenome(r,rules,5);
 const pop=[a,...Array.from({length:12},(_,i)=>mutateOnce(i<6?a:b,r,rules,{structural:0})),b];
 const c=mapLayout(pop),d=(i,j)=>Math.hypot(c[i][0]-c[j][0],c[i][1]-c[j][1]);
 assert(c.every(p=>p.every(Number.isFinite)));assert(c[0][0]>=0&&c[0][1]>=0,'the best sits right of and above the middle');
 const near=[1,2,3,4,5,6].reduce((s,i)=>s+d(0,i),0)/6,far=[7,8,9,10,11,12].reduce((s,i)=>s+d(0,i),0)/6;
 assert(near<far/2,`variants of a sit near it (${near.toFixed(3)} vs ${far.toFixed(3)})`);
 assert.deepEqual(mapLayout(pop),c,'deterministic');
}
// A Markov chain of the nano benchmark: drawn warriors are valid, use only the shapes and fields
// it learnt, and score better from the start than random code.
{
 const dir=new URL('../warriors_public/nanobm07/',import.meta.url),d=JSON.parse(readFileSync(new URL('suite.benchmark.json',dir),'utf8'));
 const all=d.warriors.map(f=>({name:f,source:readFileSync(new URL(f,dir),'latin1')})),rules=genomeRules(nano),genomes=[];
 for(const o of all){const w=await assemble(o.source,hillOf(nano));if(w.ok)genomes.push({code:w.instructions,start:w.start});}
 const model=markovModel(genomes,rules);
 assert.equal(model.warriors,genomes.length);assert(model.shapes>10,'shapes '+model.shapes);
 const shape=i=>[i[0],i[1],i[2],i[4]].join('.'),known=new Set(genomes.flatMap(g=>g.code.map(shape)));
 const r=rng('markov'),keys=new Set();
 for(let i=0;i<2000;i++){const g=markovGenome(r,model,rules);valid(g,rules);for(const ins of g.code)assert(known.has(shape(ins)),'unknown shape');keys.add(genomeKey(g));}
 assert(keys.size>1000,'the chain recombines rather than copies: '+keys.size+' distinct of 2000');
 assert.equal(genomeKey(markovGenome(rng('x'),model,rules)),genomeKey(markovGenome(rng('x'),model,rules)));
 assert.equal(markovModel([],rules).warriors,0);valid(markovGenome(r,markovModel([],rules),rules),rules); // An empty chain falls back to random code.
 const opponents=all.slice(0,20),evaluator=new Evaluator({runJob:runMatch,config:nano,opponents});
 evaluator.setMode(scoringMode(nano,opponents.map(o=>o.source)));
 const random=await new Evolution({evaluator,config:nano,params:{population:40},seed:'m'}).init();
 const chain=new Evolution({evaluator,config:nano,params:{population:40},seed:'m',model}),first=await chain.init();
 console.log(`nano first population: random code mean ${random.mean.toFixed(1)} best ${random.best.toFixed(1)}, Markov chain mean ${first.mean.toFixed(1)} best ${first.best.toFixed(1)}`);
 assert(first.mean>random.mean,'chain-drawn warriors start stronger than random code');
 assert.equal(chain.population.length,40);
 await chain.step();valid(chain.population[0].genome,rules);
}
// Warrior length below the hill's, other hills' settings, and a short LP run of 20-instruction warriors.
{
 const {suiteHill,sameHill}=await import('./evolver-presets.mjs'),{redcodeHeader}=await import('./evolver-genome.mjs');
 const lp=EVOLVER_PRESETS.find(p=>p.id==='lp').config;
 assert.equal(genomeRules(lp).maxLength,200);assert.equal(genomeRules({...lp,warriorLength:20}).maxLength,20);
 assert.equal(genomeRules({...nano,warriorLength:50}).maxLength,5,'never above the hill');assert.equal(genomeRules({...lp,warriorLength:20}).distance,200);
 assert.equal(redcodeHeader(lp),';redcode-lp');
 const d=JSON.parse(readFileSync(new URL('../warriors_public/lp_koenigstuhl/top50.benchmark.json',import.meta.url),'utf8'));
 assert(sameHill(suiteHill(d.parameters),lp),'the LP suite maps to the LP preset');
 assert.equal(suiteHill({...d.parameters,rules88:true}),null);assert.equal(suiteHill({coreSize:80}),null);
 assert(!suiteFits(d.parameters,EVOLVER_PRESETS.find(p=>p.id==='94').config),'an LP suite does not fit the ’94 preset');
 const dir=new URL('../warriors_public/lp_koenigstuhl/',import.meta.url);
 const opponents=d.warriors.slice(0,3).map(f=>({name:f,source:readFileSync(new URL(f,dir),'latin1')}));
 const ev=new Evaluator({runJob:runMatch,config:lp,opponents});ev.setMode(scoringMode(lp,opponents.map(o=>o.source),{rounds:10}));
 const e=new Evolution({evaluator:ev,config:{...lp,warriorLength:20},params:{population:6},seed:'lp'});
 await e.init();await e.step();
 assert(e.population.every(m=>m.genome.code.length<=20),'every warrior has at most 20 instructions');
 const src=e.bestSource('lp');assert.match(src,/^;redcode-lp/);
 const w=await assemble(src,hillOf(lp));assert(w.ok,w.errors);
}
// Closeness to known warriors: a copy, a mutated copy and a warrior holding another's code are found;
// random code is not; labels and layout make no difference.
{
 const {closest,lcs,longestRun}=await import('./evolver-similar.mjs');
 assert.equal(lcs([1,2,3,4],[1,3,4,9]),3);assert.equal(longestRun([1,2,3,4],[9,2,3,4,1]),3);assert.equal(lcs([],[1]),0);
 const lp=EVOLVER_PRESETS.find(p=>p.id==='lp').config,rules=genomeRules(lp),hill=hillOf(lp);
 const d=JSON.parse(readFileSync(new URL('../warriors_public/lp_koenigstuhl/top50.benchmark.json',import.meta.url),'utf8')),dir=new URL('../warriors_public/lp_koenigstuhl/',import.meta.url);
 const known=[];
 for(const f of d.warriors.slice(0,15)){const w=await assemble(readFileSync(new URL(f,dir),'latin1'),hill);if(w.ok)known.push({name:f,from:'benchmark',genome:{code:w.instructions,start:w.start}});}
 assert(known.length>=10);
 const target=known.find(k=>k.genome.code.length>=8);
 const top=closest(target.genome,known,lp.coreSize,3);
 assert.equal(top[0].name,target.name);assert.equal(top[0].overall,1);assert.equal(top[0].verdict,'copy');
 // Rendered again by the evolver (other labels and layout), then assembled: still the same code.
 const again=await assemble(renderGenome(normalize(target.genome,rules),rules,{header:';redcode-lp'}),hill);assert(again.ok,again.errors);
 assert.equal(closest({code:again.instructions},known,lp.coreSize,1)[0].overall,1);
 // Two point mutations: still recognised.
 const r=rng('similar');let m=normalize(target.genome,rules);for(let i=0;i<2;i++)m=mutateOnce(m,r,rules,{structural:0});
 const near=closest(m,known,lp.coreSize,1)[0];assert.equal(near.name,target.name);assert(near.overall>=0.6,'mutated copy '+near.overall);
 // A copy of its first instructions inside new code: most of yours is theirs.
 const part={code:[...target.genome.code.slice(0,6),...randomGenome(r,rules,2).code]};
 const p=closest(part,known,lp.coreSize,1)[0];assert.equal(p.name,target.name);assert.equal(p.run,6);assert.equal(p.verdict,'contains');
 // Filler does not make two warriors alike: different code, both padded with DAT 0, 0, is no copy.
 const pad=Array.from({length:150},()=>[0,6,0,0,0,0]);
 const g1={code:[...randomGenome(rng('p1'),rules,6).code,...pad]},g2={code:[...randomGenome(rng('p2'),rules,6).code,...pad]};
 assert.equal(closest(g1,[{name:'other',genome:g2}],lp.coreSize,1)[0].verdict,null,'padding alone');
 // Random code is close to nothing.
 for(let i=0;i<20;i++){const g=randomGenome(r,{...rules,maxLength:10});assert.equal(closest(g,known,lp.coreSize,1)[0].verdict,null);}
}
console.log('Evolver checks passed.');

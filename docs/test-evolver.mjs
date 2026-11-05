// SPDX-License-Identifier: GPL-2.0-or-later
// Warrior evolver: every genome the operators make is a valid warrior for its settings and
// assembles (exMARS and pMARS) back to itself; seeds assemble into genomes; pasted warriors
// split; and a short nano run against the nano benchmark raises the best and mean score.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rng,genomeRules,randomGenome,mutate,mutateOnce,crossover,normalize,renderGenome,genomeKey,signed,MUTATIONS} from './evolver-genome.mjs';
import {Evolution} from './evolver-run.mjs';
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
// Presets, custom checks and pasted benchmark warriors.
assert.deepEqual(['nano','tiny','94','custom'],EVOLVER_PRESETS.map(p=>p.id));
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
}
console.log('Evolver checks passed.');

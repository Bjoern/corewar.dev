// SPDX-License-Identifier: GPL-2.0-or-later
// The evolver's search: a population of whole warriors (evolver-genome.mjs), scored against a
// benchmark by the constant optimizer's Evaluator (optimizer-fitness.mjs: 3 per win, 1 per tie,
// (3W + T) / rounds × 100 averaged over opponents; exact on small cores, sampled otherwise).
// The population itself is population.mjs, shared with the constant optimizer's genetic algorithm;
// this module supplies the warrior operators and the run around it (scoring, best, history).
// Defaults: generational (μ + λ): each generation breeds a child per slot from tournament-selected
// parents (crossover, then point and structural mutations), and parents and children compete for
// the next generation with clearing (niching): survivors are taken best first, but a warrior within
// `niche` of a better one whose niche already holds `nicheSize` warriors goes to the back of the
// line, so near-copies of the leader give way to the best of other kinds. The best `elite` are always
// kept and a few random immigrants added. With a Markov chain of the benchmark's warriors
// (markovModel), new code is drawn from the chain instead. population.mjs lists the other choices
// (steady state, deterministic crowding, mean scores over seed sets, racing).
import {rng,genomeRules,randomGenome,markovGenome,normalize,mutate,crossover,genomeKey,renderGenome,redcodeHeader,distance,nicheGroups} from './evolver-genome.mjs';
import {Population,POPULATION_DEFAULTS} from './population.mjs';

// niche: the clearing radius (genome distance 0 … 1, 0 = no niching); nicheSize: warriors a niche keeps.
// Held-out opponents: a share of the opponents (at least one, and one left to train on) set aside
// by the run's seed, never used for selection; scoring the best warrior on them shows whether a
// run learns to fight warriors in general or only the ones it is scored against.
export function splitHoldOut(opponents,share,seed){
 const n=opponents.length,k=share>0&&n>1?Math.min(n-1,Math.max(1,Math.round(n*share))):0;
 if(!k)return {training:opponents.slice(),heldOut:[]};
 const r=rng('holdout:'+seed),order=opponents.map((_,i)=>i);
 for(let i=n-1;i>0;i--){const j=r.int(i+1);[order[i],order[j]]=[order[j],order[i]];}
 const out=new Set(order.slice(0,k));
 return {training:opponents.filter((_,i)=>!out.has(i)),heldOut:opponents.filter((_,i)=>out.has(i))};
}
export const EVOLVER_DEFAULTS={...POPULATION_DEFAULTS,population:40,generations:200,scheme:'generational',survival:'clearing',elite:2,tournament:3,mateTournament:3,
 crossover:0.5,mutation:1.5,structural:0.3,immigrants:0.05,seedShare:0.5,reseedEvery:5,niche:0.3,nicheSize:2,scoreMemory:'latest',rescore:0,race:false};

export class Evolution{
 // evaluator: an Evaluator with its mode set. seeds: genomes (or assembled warriors) to start from.
 // model: a Markov chain (markovModel) that new code is drawn from, or none for random code.
 constructor({evaluator,config,params={},seeds=[],seed='1',name='Evolved',model=null}){
  this.evaluator=evaluator;this.config=config;this.rules=genomeRules(config);this.name=name;this.model=model;
  const rules=this.rules;
  this.ops={
   random:r=>this.model?markovGenome(r.fn(),this.model,rules):randomGenome(r.fn(),rules),
   mutate:(g,r)=>mutate(g,r.fn(),rules,{rate:this.params.mutation,structural:this.params.structural}),
   crossover:(a,b,r)=>crossover(a,b,r.fn(),rules),
   key:genomeKey,distance,size:g=>g.code.length};
  this.engine=new Population(this.ops,{params:{...EVOLVER_DEFAULTS,...params},seeds:seeds.map(s=>normalize(s,rules)),seed:'evolve:'+seed});
  this.best=null;this.history=[];this.evaluations=0;this.header=redcodeHeader(config);this.reseed=false;
 }
 get params(){return this.engine.params;}
 get generation(){return this.engine.generation;}
 // The population best first.
 get population(){return this.engine.ranked();}
 source(g,extra=[]){return renderGenome(g,this.rules,{name:this.name,header:this.header,strategy:extra});}
 // Score one batch in parallel and hand it to the population.
 async run(batch){
  const results=await Promise.all(batch.map(c=>this.evaluator.evaluate(this.source(c.genome),{race:c.race})));
  this.evaluations+=batch.length;
  for(const e of this.engine.tell(batch,results))if(e.type==='generation'&&e.reseed)this.reseed=true;
 }
 // The first population: the seeds, mutants of them, and new code (random or from the chain).
 async init(){
  while(this.engine.initializing)await this.run(this.engine.ask());
  this.record();return this.stats();
 }
 survivors(list,n){return this.engine.survivors(list,n);}
 async step(){
  // Sampled scores: new placements now and then, so the population does not overfit one set.
  if(this.reseed&&!this.evaluator.mode.exact){this.reseed=false;this.evaluator.epoch++;this.engine.invalidate();await this.run(this.engine.ask());this.best=null;}
  this.reseed=false;
  const g=this.engine.generation;
  while(this.engine.generation===g)await this.run(this.engine.ask());
  this.record();return this.stats();
 }
 record(){
  const ranked=this.engine.ranked(),top={...ranked[0],result:this.engine.result(ranked[0].key)};
  if(!this.best||top.score>this.best.score||(top.score===this.best.score&&top.key!==this.best.key&&top.genome.code.length<this.best.genome.code.length))this.best={...top,generation:this.generation};
  const scores=ranked.map(m=>m.score),mean=scores.reduce((a,b)=>a+b,0)/scores.length;
  const sorted=scores.slice().sort((a,b)=>a-b),median=sorted[sorted.length>>1];
  const div=ranked.reduce((s,m)=>s+distance(m.genome,top.genome),0)/ranked.length;
  // Niches are counted with the clearing radius, or 0.3 when niching is off, so runs compare.
  const niches=nicheGroups(ranked.map(m=>m.genome),this.params.survival==='clearing'&&this.params.niche>0?this.params.niche:0.3).leaders.length;
  this.history.push({generation:this.generation,best:this.best.score,top:top.score,mean,median,diversity:div,niches});
 }
 stats(){return {...this.history.at(-1),evaluations:this.evaluations};}
 ranked(){return this.engine.ranked();}
 bestSource(benchmark=''){
  const b=this.best;if(!b)return '';
  return this.source(b.genome,[`evolved by the corewar.dev evolver, generation ${b.generation}`,`score ${b.score.toFixed(2)}${benchmark?' against '+benchmark:''}`]);
 }
 snapshot(){return this.engine.members.map(m=>m.genome);}
 // The population with scores, best first, for the population view.
 view(){return this.ranked().map(m=>({genome:m.genome,score:m.score}));}
}

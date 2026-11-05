// SPDX-License-Identifier: GPL-2.0-or-later
// The evolver's search: a population of whole warriors (evolver-genome.mjs), scored against a
// benchmark by the constant optimizer's Evaluator (optimizer-fitness.mjs: 3 per win, 1 per tie,
// (3W + T) / rounds × 100 averaged over opponents; exact on small cores, sampled otherwise).
// Each generation breeds a child per slot: tournament-selected parents, crossover, then point
// and structural mutations. Parents and children compete for the next generation (μ + λ),
// duplicates removed, the best `elite` always kept, and a few random immigrants added. With a
// Markov chain of the benchmark's warriors (markovModel), new code is drawn from the chain instead.
// Niching (clearing): survivors are taken best first, but a warrior within `niche` of a better
// one whose niche already holds `nicheSize` warriors goes to the back of the line, so near-copies
// of the leader give way to the best of other kinds of warrior.
import {rng,genomeRules,randomGenome,markovGenome,normalize,mutate,crossover,genomeKey,renderGenome,redcodeHeader,distance,nicheGroups} from './evolver-genome.mjs';

// niche: the clearing radius (genome distance 0 … 1, 0 = no niching); nicheSize: warriors a niche keeps.
export const EVOLVER_DEFAULTS={population:40,generations:200,elite:2,tournament:3,crossover:0.5,mutation:1.5,structural:0.3,immigrants:0.05,seedShare:0.5,reseedEvery:5,niche:0.3,nicheSize:2};

export class Evolution{
 // evaluator: an Evaluator with its mode set. seeds: genomes (or assembled warriors) to start from.
 // model: a Markov chain (markovModel) that new code is drawn from, or none for random code.
 constructor({evaluator,config,params={},seeds=[],seed='1',name='Evolved',model=null}){
  this.evaluator=evaluator;this.config=config;this.rules=genomeRules(config);
  this.params={...EVOLVER_DEFAULTS,...params};this.r=rng('evolve:'+seed);this.name=name;this.model=model;
  this.seeds=seeds.map(s=>normalize(s,this.rules));
  this.population=[];this.generation=0;this.best=null;this.history=[];this.evaluations=0;this.header=redcodeHeader(config);
 }
 fresh(){return this.model?markovGenome(this.r,this.model,this.rules):randomGenome(this.r,this.rules);}
 source(g,extra=[]){return renderGenome(g,this.rules,{name:this.name,header:this.header,strategy:extra});}
 async score(genomes){
  const results=await Promise.all(genomes.map(g=>this.evaluator.evaluate(this.source(g))));
  this.evaluations+=genomes.length;
  return genomes.map((g,i)=>({genome:g,key:genomeKey(g),score:results[i]?.score??0,se:results[i]?.se??0,result:results[i]??null}));
 }
 // The first population: the seeds, mutants of them, and new code (random or from the chain).
 async init(){
  const p=this.params,n=Math.max(2,p.population),list=[];
  for(const s of this.seeds)if(list.length<n)list.push(s);
  const mutants=this.seeds.length?Math.floor(n*p.seedShare):0;
  while(list.length<this.seeds.length+mutants&&list.length<n)list.push(mutate(this.r.pick(this.seeds),this.r,this.rules,p));
  // A chain can draw the same warrior twice; draw again (a few times) so the population is full.
  const known=new Set(list.map(genomeKey));
  for(let tries=0;list.length<n;tries++){const g=this.fresh(),key=genomeKey(g);if(known.has(key)&&tries<n*20)continue;known.add(key);list.push(g);}
  this.population=this.unique(await this.score(list));
  this.sort();this.population=this.survivors(this.population,n);this.record();return this.stats();
 }
 // Clearing: list sorted best first. The best `elite` always stay, then niche leaders and the
 // first `nicheSize` of each niche, then the cleared ones by score if places are left.
 survivors(list,n){
  const p=this.params;
  if(!(p.niche>0))return list.slice(0,n);
  const leaders=[],kept=[],cleared=[];
  list.forEach((m,i)=>{
   const leader=leaders.find(l=>distance(m.genome,l.m.genome)<p.niche);
   if(!leader){leaders.push({m,count:1});kept.push(m);}
   else if(leader.count<Math.max(1,p.nicheSize)||i<p.elite){leader.count++;kept.push(m);}
   else cleared.push(m);
  });
  return [...kept,...cleared].slice(0,n);
 }
 unique(list){const seen=new Set();return list.filter(m=>!seen.has(m.key)&&seen.add(m.key));}
 sort(){this.population.sort((a,b)=>b.score-a.score||a.genome.code.length-b.genome.code.length);}
 pick(){
  let best=null;
  for(let k=0;k<this.params.tournament;k++){const m=this.r.pick(this.population);if(!best||m.score>best.score)best=m;}
  return best.genome;
 }
 child(){
  const p=this.params;
  let g=this.pick();
  if(this.r()<p.crossover&&this.population.length>1)g=crossover(g,this.pick(),this.r,this.rules);
  return mutate(g,this.r,this.rules,p);
 }
 async step(){
  const p=this.params,n=Math.max(2,p.population),known=new Set(this.population.map(m=>m.key)),children=[];
  // Sampled scores: new placements now and then, so the population does not overfit one set.
  if(!this.evaluator.mode.exact&&p.reseedEvery>0&&this.generation>0&&this.generation%p.reseedEvery===0){
   this.evaluator.epoch++;this.population=await this.score(this.population.map(m=>m.genome));this.best=null;
  }
  const immigrants=Math.round(n*p.immigrants);
  for(let tries=0;children.length<n&&tries<n*20;tries++){
   const g=children.length<immigrants?this.fresh():this.child(),key=genomeKey(g);
   if(known.has(key))continue;known.add(key);children.push(g);
  }
  const scored=await this.score(children);
  this.population=this.unique([...this.population,...scored]);
  this.sort();this.population=this.survivors(this.population,n);
  this.generation++;this.record();return this.stats();
 }
 record(){
  const top=this.population[0];
  if(!this.best||top.score>this.best.score||(top.score===this.best.score&&top.key!==this.best.key&&top.genome.code.length<this.best.genome.code.length))this.best={...top,generation:this.generation};
  const scores=this.population.map(m=>m.score),mean=scores.reduce((a,b)=>a+b,0)/scores.length;
  const sorted=scores.slice().sort((a,b)=>a-b),median=sorted[sorted.length>>1];
  const div=this.population.reduce((s,m)=>s+distance(m.genome,top.genome),0)/this.population.length;
  // Niches are counted with the clearing radius, or 0.3 when niching is off, so runs compare.
  const ranked=this.ranked().map(m=>m.genome),niches=nicheGroups(ranked,this.params.niche>0?this.params.niche:0.3).leaders.length;
  this.history.push({generation:this.generation,best:this.best.score,top:top.score,mean,median,diversity:div,niches});
 }
 stats(){return {...this.history.at(-1),evaluations:this.evaluations};}
 // The population best first (cleared warriors sit behind kept ones in this.population).
 ranked(){return this.population.slice().sort((a,b)=>b.score-a.score||a.genome.code.length-b.genome.code.length);}
 bestSource(benchmark=''){
  const b=this.best;if(!b)return '';
  return this.source(b.genome,[`evolved by the corewar.dev evolver, generation ${b.generation}`,`score ${b.score.toFixed(2)}${benchmark?' against '+benchmark:''}`]);
 }
 snapshot(){return this.population.map(m=>m.genome);}
 // The population with scores, best first, for the population view.
 view(){return this.ranked().map(m=>({genome:m.genome,score:m.score}));}
}

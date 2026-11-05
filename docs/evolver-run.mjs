// SPDX-License-Identifier: GPL-2.0-or-later
// The evolver's search: a population of whole warriors (evolver-genome.mjs), scored against a
// benchmark by the constant optimizer's Evaluator (optimizer-fitness.mjs: 3 per win, 1 per tie,
// (3W + T) / rounds × 100 averaged over opponents; exact on small cores, sampled otherwise).
// Each generation breeds a child per slot: tournament-selected parents, crossover, then point
// and structural mutations. Parents and children compete for the next generation (μ + λ),
// duplicates removed, the best `elite` always kept, and a few random immigrants added.
import {rng,genomeRules,randomGenome,normalize,mutate,crossover,genomeKey,renderGenome,redcodeHeader,distance} from './evolver-genome.mjs';

export const EVOLVER_DEFAULTS={population:40,generations:200,elite:2,tournament:3,crossover:0.5,mutation:1.5,structural:0.3,immigrants:0.05,seedShare:0.5,reseedEvery:5};

export class Evolution{
 // evaluator: an Evaluator with its mode set. seeds: genomes (or assembled warriors) to start from.
 constructor({evaluator,config,params={},seeds=[],seed='1',name='Evolved'}){
  this.evaluator=evaluator;this.config=config;this.rules=genomeRules(config);
  this.params={...EVOLVER_DEFAULTS,...params};this.r=rng('evolve:'+seed);this.name=name;
  this.seeds=seeds.map(s=>normalize(s,this.rules));
  this.population=[];this.generation=0;this.best=null;this.history=[];this.evaluations=0;this.header=redcodeHeader(config);
 }
 source(g,extra=[]){return renderGenome(g,this.rules,{name:this.name,header:this.header,strategy:extra});}
 async score(genomes){
  const results=await Promise.all(genomes.map(g=>this.evaluator.evaluate(this.source(g))));
  this.evaluations+=genomes.length;
  return genomes.map((g,i)=>({genome:g,key:genomeKey(g),score:results[i]?.score??0,se:results[i]?.se??0,result:results[i]??null}));
 }
 // The first population: the seeds, mutants of them, and random code.
 async init(){
  const p=this.params,n=Math.max(2,p.population),list=[];
  for(const s of this.seeds)if(list.length<n)list.push(s);
  const mutants=this.seeds.length?Math.floor(n*p.seedShare):0;
  while(list.length<this.seeds.length+mutants&&list.length<n)list.push(mutate(this.r.pick(this.seeds),this.r,this.rules,p));
  while(list.length<n)list.push(randomGenome(this.r,this.rules));
  this.population=this.unique(await this.score(list));
  this.sort();this.record();return this.stats();
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
   const g=children.length<immigrants?randomGenome(this.r,this.rules):this.child(),key=genomeKey(g);
   if(known.has(key))continue;known.add(key);children.push(g);
  }
  const scored=await this.score(children);
  const elite=this.population.slice(0,p.elite);
  this.population=this.unique([...elite,...this.population.slice(p.elite),...scored]);
  this.sort();this.population=this.population.slice(0,n);
  this.generation++;this.record();return this.stats();
 }
 record(){
  const top=this.population[0];
  if(!this.best||top.score>this.best.score||(top.score===this.best.score&&top.key!==this.best.key&&top.genome.code.length<this.best.genome.code.length))this.best={...top,generation:this.generation};
  const scores=this.population.map(m=>m.score),mean=scores.reduce((a,b)=>a+b,0)/scores.length;
  const sorted=scores.slice().sort((a,b)=>a-b),median=sorted[sorted.length>>1];
  const div=this.population.reduce((s,m)=>s+distance(m.genome,top.genome),0)/this.population.length;
  this.history.push({generation:this.generation,best:this.best.score,top:top.score,mean,median,diversity:div});
 }
 stats(){return {...this.history.at(-1),evaluations:this.evaluations};}
 bestSource(benchmark=''){
  const b=this.best;if(!b)return '';
  return this.source(b.genome,[`evolved by the corewar.dev evolver, generation ${b.generation}`,`score ${b.score.toFixed(2)}${benchmark?' against '+benchmark:''}`]);
 }
 snapshot(){return this.population.map(m=>m.genome);}
}

// SPDX-License-Identifier: GPL-2.0-or-later
// The population search shared by the constant optimizer's genetic algorithm (optimizer-search.mjs:
// a genome is one index per template variable) and the warrior evolver (evolver-run.mjs: a genome
// is a whole warrior). It knows genomes only through the operators it is given, and keeps all its
// state, including the random numbers, in one JSON-serialisable object, so a run can be saved and
// continued exactly.
//
// Operators: random(rng) → a new genome (first population, immigrants); mutate(genome, rng, {force})
//   → a changed copy (force: change at least one gene); crossover(a, b, rng) → a child;
//   key(genome) → a string, equal for equal genomes; distance(a, b) → 0 … 1;
//   size(genome) → a number, optional: of two equal scores the smaller ranks first.
// Use: ask() → the next batch [{genome, key, kind, race}] (kind: init, child, immigrant or reeval;
//   race: a score below which the candidate may be dropped early, or null); score each, then
//   tell(batch, results), each result null for an invalid warrior or {score, se, complete}.
//   invalidate() after the scoring seeds changed: the next ask() scores the top members again.
//
// The methodology is configurable, so each tool keeps its own defaults:
//   scheme       'steady': one child at a time joins the population (genetic2.rb);
//                'generational': a whole population of children, then parents and children compete (μ + λ).
//   survival     'crowding': a child replaces the most similar weaker member, if any (deterministic crowding);
//                'clearing': best first, but a member within `niche` of a better one whose niche already
//                holds `nicheSize` goes to the back of the line; the best `elite` always stay. niche 0 is
//                plain truncation.
//   tournament, mateTournament  tournament sizes for the first and the second parent.
//   crossover    share of children with two parents.  immigrants  share of children that are new genomes.
//   seedShare    share of the first population made of mutants of the seed genomes.
//   reseedEvery  generations between new scoring seeds (the driver decides whether scores are sampled).
//   scoreMemory  'mean': a member's score is the mean over every seed set it was scored on, and only
//                members seen on two sets count as the best; 'latest': the newest score replaces the old.
//   rescore      how many top members are scored again on new seeds (0 = the whole population).
//   race         race each child against the weakest member.

// sfc32: small, fast, and its four words are the whole state. A string seed is hashed.
export class Rng{
 constructor(seed){
  if(Array.isArray(seed)){this.s=[...seed];return;}
  let h;
  if(typeof seed==='string'&&!/^\s*\d+\s*$/.test(seed)){h=2166136261;for(const c of seed)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;}
  else h=Number(seed)>>>0;
  h^=0x9e3779b9;this.s=[0,0,0,0].map(()=>(h=Math.imul(h^(h>>>16),0x45d9f3b)>>>0,h^=h>>>16,h>>>0));
  for(let i=0;i<12;i++)this.next();
 }
 next(){let [a,b,c,d]=this.s;const t=(((a+b)>>>0)+d)>>>0;d=(d+1)>>>0;a=b^(b>>>9);b=(c+(c<<3))>>>0;c=((c<<21)|(c>>>11))>>>0;c=(c+t)>>>0;this.s=[a>>>0,b>>>0,c,d];return t;}
 random(){return this.next()/4294967296;}
 below(n){return Math.floor(this.random()*n);}
 int(lo,hi){return lo+this.below(hi-lo+1);}
 choice(list){return list[this.below(list.length)];}
 exp(mean){return -Math.log(1-this.random())*mean;}
 weighted(weights){let total=0;for(const w of weights)total+=w;let r=this.random()*total;for(let i=0;i<weights.length;i++){r-=weights[i];if(r<0)return i;}return weights.length-1;}
 // The same numbers as a function with int(n), pick(list) and weighted(weights), the form the evolver's genome operators take.
 fn(){return this._fn??=Object.assign(()=>this.random(),{int:n=>this.below(n),pick:list=>this.choice(list),weighted:w=>this.weighted(w)});}
}
const clone=o=>JSON.parse(JSON.stringify(o));

export const POPULATION_DEFAULTS={population:50,scheme:'steady',survival:'crowding',niche:0.3,nicheSize:2,elite:2,tournament:3,mateTournament:1,
 crossover:0.75,immigrants:0.05,seedShare:0.5,reseedEvery:1,scoreMemory:'mean',rescore:6,race:true};
export const SCHEMES=['steady','generational'],SURVIVALS=['crowding','clearing'],SCORE_MEMORIES=['mean','latest'];
const RETRIES=20,INVALID_LIMIT=1000;

export class Population{
 // seeds: genomes the first population starts from (all valid for the operators).
 constructor(operators,{params={},seeds=[],seed=1}={}){
  this.ops=operators;this.rng=new Rng(seed);this.results=new Map();
  this.s={params:{...POPULATION_DEFAULTS,...params},seeds:seeds.map(clone),pop:[],reeval:[],born:0,children:0,generation:0,immigrants:0,discarded:0,invalid:0,rescored:0,rng:null};
 }
 static fromState(operators,state){const self=Object.create(Population.prototype);self.ops=operators;self.s=clone(state);self.rng=new Rng(state.rng);self.results=new Map();return self;}
 state(){this.s.rng=[...this.rng.s];return clone(this.s);}
 get params(){return this.s.params;}
 get size(){return Math.max(2,this.s.params.population|0);}
 get generation(){return this.s.generation;}
 get members(){return this.s.pop;}
 // The first population is still being made: until `population` were tried, and (when many were
 // invalid or duplicates) until at least 10 are in, within a bound for tiny search spaces.
 get initializing(){const s=this.s,n=this.size;return s.born<n||(s.pop.length<Math.min(10,n)&&s.born<4*n);}
 // The full result of a member's latest scoring (per-opponent rows), kept outside the saved state.
 result(key){return this.results.get(key)??null;}

 rank(list){const size=this.ops.size;return list.slice().sort((a,b)=>b.score-a.score||(size?size(a.genome)-size(b.genome):0));}
 ranked(){return this.rank(this.s.pop);}
 best(){
  const p=this.s.pop;if(!p.length)return null;
  const trusted=this.s.params.scoreMemory==='mean'?p.filter(m=>m.n>=2):[];
  return this.rank(trusted.length?trusted:p)[0];
 }
 invalidate(){const s=this.s,k=s.params.rescore>0?s.params.rescore:s.pop.length;s.reeval=this.ranked().slice(0,k).map(m=>m.key);}
 tournament(size){const p=this.s.pop;let best=null;for(let i=0;i<Math.max(1,size|0);i++){const m=this.rng.choice(p);if(!best||m.score>best.score)best=m;}return best;}

 ask(){
  const s=this.s,p=s.params,n=this.size;
  if(s.reeval.length){
   const keys=s.reeval;s.reeval=[];
   const batch=keys.map(k=>s.pop.find(m=>m.key===k)).filter(Boolean).map(m=>({genome:clone(m.genome),key:m.key,kind:'reeval',race:null}));
   if(batch.length)return batch;
  }
  const known=new Set(s.pop.map(m=>m.key)),batch=[];
  const fresh=(make,force)=>{
   let g=make(),key=this.ops.key(g);
   for(let t=0;known.has(key)&&t<RETRIES;t++){g=force?this.ops.mutate(g,this.rng,{force:true}):make();key=this.ops.key(g);}
   known.add(key);return {genome:g,key};
  };
  const race=p.race&&s.pop.length>=n?Math.min(...s.pop.map(m=>m.score)):null;
  if(this.initializing){
   // Seeds first, then mutants of them (seedShare), then new genomes; all at once, so they score in parallel.
   const count=s.born<n?n-s.born:Math.max(1,Math.min(10,n)-s.pop.length),seeds=s.seeds,mutants=seeds.length?Math.floor(n*p.seedShare):0;
   for(let j=0;j<count;j++){
    const i=s.born+j;let c;
    if(i<seeds.length)c=fresh(()=>clone(seeds[i]),true);
    else if(i<seeds.length+mutants)c=fresh(()=>this.ops.mutate(clone(this.rng.choice(seeds)),this.rng,{force:true}),true);
    else c=fresh(()=>this.ops.random(this.rng),false);
    batch.push({...c,kind:'init',race:null});
   }
   return batch;
  }
  if(!s.pop.length)throw new Error('No valid warrior found to breed from.');
  const count=p.scheme==='generational'?n:1;
  for(let j=0;j<count;j++){
   if(this.rng.random()<p.immigrants){batch.push({...fresh(()=>this.ops.random(this.rng),false),kind:'immigrant',race});continue;}
   const c=fresh(()=>{
    const a=this.tournament(p.tournament).genome;
    const g=s.pop.length>1&&this.rng.random()<p.crossover?this.ops.crossover(a,this.tournament(p.mateTournament).genome,this.rng):clone(a);
    return this.ops.mutate(g,this.rng,{force:false});
   },true);
   batch.push({...c,kind:'child',race});
  }
  return batch;
 }

 tell(batch,results){
  const s=this.s,p=s.params,events=[],before=this.best(),beforeKey=before?.key,beforeScore=before?.score;
  let joined=false;
  batch.forEach((c,i)=>{
   const r=results[i]??null;
   if(c.kind==='reeval'){
    const m=s.pop.find(m=>m.key===c.key);
    if(m&&r?.complete){
     s.rescored++;this.results.set(m.key,r);
     if(p.scoreMemory==='mean'){m.sum+=r.score;m.n++;m.score=m.sum/m.n;m.se=r.se/Math.sqrt(m.n);}
     else{m.sum=r.score;m.n=1;m.score=r.score;m.se=r.se;}
    }
    return;
   }
   if(c.kind==='init')s.born++;
   else{s.children++;if(c.kind==='immigrant')s.immigrants++;}
   if(!r){
    s.invalid++;
    if(!s.pop.length&&s.invalid>=INVALID_LIMIT)throw new Error(`No valid warrior found among ${INVALID_LIMIT} candidates.`);
    return;
   }
   if(!r.complete||s.pop.some(m=>m.key===c.key)){s.discarded++;return;}
   const m={genome:c.genome,key:c.key,sum:r.score,n:1,score:r.score,se:r.se};
   this.results.set(c.key,r);joined=true;
   if(p.survival==='crowding')this.crowd(m);else s.pop.push(m);
  });
  if(joined&&p.survival!=='crowding'){
   const before=s.pop.length;s.pop=this.survivors(this.rank(s.pop),this.size);s.discarded+=before-s.pop.length;
  }
  this.forget();
  // A generation is `population` children; the first population is generation 0.
  const generation=Math.floor(s.children/this.size);
  if(generation>s.generation){s.generation=generation;events.push({type:'generation',generation,reseed:p.reseedEvery>0&&generation%p.reseedEvery===0});}
  const after=this.best();
  if(after&&(after.key!==beforeKey||after.score>beforeScore))events.push({type:'best',score:after.score,key:after.key,genome:clone(after.genome)});
  return events;
 }
 // Deterministic crowding: past the population size, the child replaces the most similar weaker member,
 // the weaker of two equally similar ones; a child weaker than every member is dropped.
 crowd(child){
  const s=this.s;s.pop.push(child);
  if(s.pop.length<=this.size)return;
  let worst=null,wd=Infinity;
  for(const m of s.pop){
   if(m===child||!(m.score<child.score))continue;
   const d=this.ops.distance(m.genome,child.genome);
   if(d<wd||(d===wd&&m.score<worst.score)){worst=m;wd=d;}
  }
  s.pop.splice(s.pop.indexOf(worst??child),1);s.discarded++;
 }
 // Clearing on a list sorted best first: the best `elite` always stay, then niche leaders and the first
 // `nicheSize` of each niche, then the cleared ones by score while places are left.
 survivors(list,n){
  const p=this.s.params;
  if(!(p.niche>0))return list.slice(0,n);
  const leaders=[],kept=[],cleared=[];
  list.forEach((m,i)=>{
   const leader=leaders.find(l=>this.ops.distance(m.genome,l.m.genome)<p.niche);
   if(!leader){leaders.push({m,count:1});kept.push(m);}
   else if(leader.count<Math.max(1,p.nicheSize)||i<p.elite){leader.count++;kept.push(m);}
   else cleared.push(m);
  });
  return [...kept,...cleared].slice(0,n);
 }
 // Results of members that left the population are no longer needed.
 forget(){if(this.results.size>4*this.size){const keep=new Set(this.s.pop.map(m=>m.key));for(const k of this.results.keys())if(!keep.has(k))this.results.delete(k);}}
 summary(){const s=this.s,scores=s.pop.map(m=>m.score).sort((a,b)=>a-b);return {population:s.pop.length,median:scores.length?scores[scores.length>>1]:null,generation:s.generation,born:s.born,children:s.children,immigrants:s.immigrants,discarded:s.discarded,invalid:s.invalid};}
}

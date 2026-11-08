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
//   fitness      'plain': selection uses the score; 'shared': results-based fitness sharing (shared()
//                below): points against an opponent count for more the fewer points the population
//                takes from it, so a warrior that beats what the others lose to is worth keeping even
//                with a lower score. Selection (tournaments, survival) uses the shared value; the
//                score, the best, the elites and racing's bar stay plain (racing is off when shared).
//   nicheBy      'code': niching and crowding compare genomes (ops.distance); 'results': they compare
//                what members score against each opponent (profileDistance), so niches are kinds of
//                result, however the code looks. Results need per-opponent rows ({opponents}) in the results.
//   novelty      weight of a novelty bonus, 0 = off (after corewar-rl train.py): a member's novelty is
//                how unlike its results profile is from those of its NOVELTY_K nearest neighbours among
//                the population and an archive of profiles seen before (the RMS difference in points per
//                opponent, so on the score's scale), and selection adds novelty × weight to the value it
//                uses (the plain or shared score). Each new member joins the archive with chance
//                ARCHIVE_ADD / population, so it remembers kinds that died out. Like sharing, it only
//                steers selection: the score and the best stay plain, and racing is off with it.

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
 crossover:0.75,immigrants:0.05,seedShare:0.5,reseedEvery:1,scoreMemory:'mean',rescore:6,race:true,fitness:'plain',nicheBy:'code',novelty:0};
export const SCHEMES=['steady','generational'],SURVIVALS=['crowding','clearing'],SCORE_MEMORIES=['mean','latest'],FITNESSES=['plain','shared'],NICHE_BY=['code','results'];
const RETRIES=20,INVALID_LIMIT=1000;
// Points against one opponent run 0 … 300 ((3W + T) / rounds × 100). SHARE_FLOOR keeps an opponent
// the whole population scores nothing against from weighing without bound: 20 points is a tie in a
// fifth of the rounds.
const MAX_POINTS=300,SHARE_FLOOR=20;
// Novelty: neighbours counted, profiles added to the archive per population's worth of new members, and its size.
const NOVELTY_K=15,ARCHIVE_ADD=4,ARCHIVE_SIZE=500;
// The RMS difference in points per opponent between two profiles.
export function profileRms(a,b){
 const n=Math.min(a.length,b.length);if(!n)return 0;
 let d=0;for(let i=0;i<n;i++)d+=(a[i]-b[i])**2;
 return Math.sqrt(d/n);
}

// A result's points against each opponent, the self fight apart (it is a different warrior for each
// member, so it is never shared or compared): {vec, own} or null without per-opponent rows.
export function profile(r){
 const rows=r?.opponents;if(!rows?.length)return null;
 const vec=[];let own=null;
 for(const o of rows){if(o.self)own=o.score;else vec.push(o.score);}
 return {vec,own};
}
// How unlike two profiles are, 0 … 1: the mean difference in points per opponent over the most
// there can be, so 1 is the opposite result against every opponent. Sampling noise alone puts two
// copies of one warrior some way apart (about 0.08 at 40 rounds), so radii of 0.1 … 0.2 suit it.
export function profileDistance(a,b){
 const n=Math.min(a.length,b.length);if(!n)return 1;
 let d=0;for(let i=0;i<n;i++)d+=Math.abs(a[i]-b[i]);
 return d/n/MAX_POINTS;
}
const fitOf=m=>m.fit??m.score;

export class Population{
 // seeds: genomes the first population starts from (all valid for the operators).
 constructor(operators,{params={},seeds=[],seed=1}={}){
  this.ops=operators;this.rng=new Rng(seed);this.results=new Map();
  this.s={params:{...POPULATION_DEFAULTS,...params},seeds:seeds.map(clone),pop:[],reeval:[],born:0,children:0,generation:0,immigrants:0,discarded:0,invalid:0,rescored:0,archive:[],rng:null};
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
 // Best first by what selection uses: the shared value with fitness 'shared', else the score.
 order(list){const size=this.ops.size;return list.slice().sort((a,b)=>fitOf(b)-fitOf(a)||b.score-a.score||(size?size(a.genome)-size(b.genome):0));}
 ranked(){return this.rank(this.s.pop);}
 best(){
  const p=this.s.pop;if(!p.length)return null;
  const trusted=this.s.params.scoreMemory==='mean'?p.filter(m=>m.n>=2):[];
  return this.rank(trusted.length?trusted:p)[0];
 }
 invalidate(){const s=this.s,k=s.params.rescore>0?s.params.rescore:s.pop.length;s.reeval=this.ranked().slice(0,k).map(m=>m.key);}
 tournament(size){const p=this.s.pop;let best=null;for(let i=0;i<Math.max(1,size|0);i++){const m=this.rng.choice(p);if(!best||fitOf(m)>fitOf(best))best=m;}return best;}

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
  // A child below the weakest score may still be worth keeping for its shared value, so no racing then.
  const race=p.race&&p.fitness!=='shared'&&!(p.novelty>0)&&s.pop.length>=n?Math.min(...s.pop.map(m=>m.score)):null;
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
     const pr=profile(r),mean=p.scoreMemory==='mean';
     if(mean){m.sum+=r.score;m.n++;m.score=m.sum/m.n;m.se=r.se/Math.sqrt(m.n);}
     else{m.sum=r.score;m.n=1;m.score=r.score;m.se=r.se;}
     // The profile follows the score: averaged over seed sets, or the latest.
     if(pr&&mean&&m.vec?.length===pr.vec.length){m.vec=m.vec.map((v,j)=>v+(pr.vec[j]-v)/m.n);if(pr.own!=null)m.own=m.own==null?pr.own:m.own+(pr.own-m.own)/m.n;}
     else if(pr){m.vec=pr.vec;m.own=pr.own;}
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
   const m={genome:c.genome,key:c.key,sum:r.score,n:1,score:r.score,se:r.se},pr=profile(r);
   if(pr){m.vec=pr.vec;m.own=pr.own;}
   // The novelty archive: profiles of new members, a few per population's worth.
   if(p.novelty>0&&pr?.vec.length&&this.rng.random()<ARCHIVE_ADD/this.size){s.archive??=[];if(s.archive.length<ARCHIVE_SIZE)s.archive.push(pr.vec.slice());else s.archive[this.rng.below(ARCHIVE_SIZE)]=pr.vec.slice();}
   this.results.set(c.key,r);joined=true;
   if(p.survival==='crowding')this.crowd(m);else s.pop.push(m);
  });
  if(joined&&p.survival!=='crowding'){
   const before=s.pop.length;this.share(s.pop);s.pop=this.survivors(this.order(s.pop),this.size);s.discarded+=before-s.pop.length;
  }
  // Shared values depend on who is in the population, so they are worked out again for the survivors.
  this.share(s.pop);
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
  this.share(s.pop);
  let worst=null,wd=Infinity;
  for(const m of s.pop){
   if(m===child||!(fitOf(m)<fitOf(child)))continue;
   const d=this.near(m,child);
   if(d<wd||(d===wd&&fitOf(m)<fitOf(worst))){worst=m;wd=d;}
  }
  s.pop.splice(s.pop.indexOf(worst??child),1);s.discarded++;
 }
 // Clearing on a list sorted best first (order()): the best `elite` by score always stay, then niche
 // leaders and the first `nicheSize` of each niche, then the cleared ones in order while places are left.
 survivors(list,n){
  const p=this.s.params,elite=new Set(this.rank(list).slice(0,Math.max(0,p.elite|0)));
  const first=list.filter(m=>elite.has(m));
  if(!(p.niche>0))return [...first,...list.filter(m=>!elite.has(m))].slice(0,n);
  const leaders=[],kept=[],cleared=[];
  for(const m of list){
   const leader=leaders.find(l=>this.near(m,l.m)<p.niche);
   if(!leader){leaders.push({m,count:1});if(!elite.has(m))kept.push(m);}
   else if(leader.count<Math.max(1,p.nicheSize)||elite.has(m)){leader.count++;if(!elite.has(m))kept.push(m);}
   else cleared.push(m);
  }
  return [...first,...kept,...cleared].slice(0,n);
 }
 // How unlike two members are, for niching and crowding: by results with nicheBy 'results' (when both
 // have per-opponent results to compare), else by code.
 near(a,b){
  if(this.s.params.nicheBy==='results'&&a.vec?.length&&a.vec.length===b.vec?.length)return profileDistance(a.vec,b.vec);
  return this.ops.distance(a.genome,b.genome);
 }
 // Results-based fitness sharing over `list`: each opponent weighs 1 / (the population's mean points
 // against it + SHARE_FLOOR), scaled so the weights average 1; a member's shared value is its weighted
 // mean points (the self fight unweighted). Opponents the population beats easily count for little,
 // the ones it hardly scores against for a lot, and many copies of one kind lower the weight of what
 // they beat, so a crowd of copies is worth less than the same number of different kinds. When every
 // opponent is equally hard the shared value is the score. With fitness 'plain' it is the score.
 share(list){
  for(const m of list)m.fit=m.score;
  if(this.s.params.fitness==='shared')this.shareResults(list);
  if(this.s.params.novelty>0)this.addNovelty(list);
 }
 // The novelty bonus (see novelty above): each member's mean RMS distance to its nearest neighbours.
 addNovelty(list){
  const k=list.find(m=>m.vec?.length)?.vec.length;if(!k)return;
  const same=list.filter(m=>m.vec?.length===k),pool=[...same.map(m=>m.vec),...(this.s.archive||[]).filter(v=>v.length===k)];
  // The K smallest squared distances, kept sorted in a small array; the root of the mean square only at the end.
  const near=new Float64Array(NOVELTY_K);
  for(const m of same){
   const a=m.vec;let count=0;
   for(const v of pool){
    if(v===a)continue;
    const limit=count<NOVELTY_K?Infinity:near[NOVELTY_K-1];let d=0;
    for(let j=0;j<k&&d<limit;j++){const x=a[j]-v[j];d+=x*x;}
    if(d>=limit)continue;
    let i=count<NOVELTY_K?count++:NOVELTY_K-1;
    while(i>0&&near[i-1]>d){near[i]=near[i-1];i--;}
    near[i]=d;
   }
   if(!count)continue;
   let t=0;for(let i=0;i<count;i++)t+=Math.sqrt(near[i]/k);
   m.novelty=t/count;m.fit+=this.s.params.novelty*m.novelty;
  }
 }
 shareResults(list){
  const k=list.find(m=>m.vec?.length)?.vec.length;if(!k)return;
  const same=list.filter(m=>m.vec?.length===k),mean=new Array(k).fill(0);
  for(const m of same)for(let j=0;j<k;j++)mean[j]+=m.vec[j]/same.length;
  const w=mean.map(x=>1/(x+SHARE_FLOOR)),wm=w.reduce((a,b)=>a+b,0)/k;
  for(const m of same){
   let t=0;for(let j=0;j<k;j++)t+=m.vec[j]*w[j]/wm;
   m.fit=(t+(m.own??0))/(k+(m.own==null?0:1));
  }
 }
 // Results of members that left the population are no longer needed.
 forget(){if(this.results.size>4*this.size){const keep=new Set(this.s.pop.map(m=>m.key));for(const k of this.results.keys())if(!keep.has(k))this.results.delete(k);}}
 summary(){const s=this.s,scores=s.pop.map(m=>m.score).sort((a,b)=>a-b);return {population:s.pop.length,median:scores.length?scores[scores.length>>1]:null,generation:s.generation,born:s.born,children:s.children,immigrants:s.immigrants,discarded:s.discarded,invalid:s.invalid};}
}

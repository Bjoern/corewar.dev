// SPDX-License-Identifier: GPL-2.0-or-later
// Search methods of the constant optimizer. They know only the domain size of each variable
// and never see Redcode or engines. Each method keeps all its state, including the RNG, in
// one JSON-serialisable object, so a run can be saved and continued exactly.
//
// Interface: propose() -> {x, kind, race}  (race: a score below which the candidate may be
//            dropped early, or null);  observe(proposal, result) where result is null for an
//            invalid warrior or {score, se, complete};  best() -> {x, score, se, n} | null;
//            invalidate() after the scoring seeds changed;  state().
//
// Simulated annealing: cwopt's search (tools-import/cwopt/search.py), whose move set and
// acceptance rule are John Metcalf's annealing5.rb, used with his permission.
// Genetic algorithm: cwopt's ga.py with deterministic crowding, BLX-α and single-point
// crossover, immigrants and asymmetric tournaments from Metcalf's genetic2.rb.

// sfc32: small, fast, and its four words are the whole state.
export class Rng{
 constructor(seed){
  if(Array.isArray(seed)){this.s=[...seed];return;}
  let h=(Number(seed)>>>0)^0x9e3779b9;this.s=[0,0,0,0].map(()=>(h=Math.imul(h^(h>>>16),0x45d9f3b)>>>0,h^=h>>>16,h>>>0));
  for(let i=0;i<12;i++)this.next();
 }
 next(){let [a,b,c,d]=this.s;const t=(((a+b)>>>0)+d)>>>0;d=(d+1)>>>0;a=b^(b>>>9);b=(c+(c<<3))>>>0;c=((c<<21)|(c>>>11))>>>0;c=(c+t)>>>0;this.s=[a>>>0,b>>>0,c,d];return t;}
 random(){return this.next()/4294967296;}
 below(n){return Math.floor(this.random()*n);}
 int(lo,hi){return lo+this.below(hi-lo+1);}
 choice(list){return list[this.below(list.length)];}
 exp(mean){return -Math.log(1-this.random())*mean;}
}
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const clone=o=>JSON.parse(JSON.stringify(o));

export const ANNEAL_DEFAULTS={sweepLimit:160,annealScale:150,multiProb:0.1,delta:20,restartPatience:400,keepBest:5,restartProb:0.3,maxSweepPasses:50,race:true};
export const GA_DEFAULTS={population:50,tourX:3,tourY:1,immigrants:0.05,blxRate:0.5,blxAlpha:0.3,mutation:1.5,creepProb:0.7,creepMean:15,elite:6,race:true};

export class Annealing{
 constructor(sizes,start,seed,options={}){
  const opts={...ANNEAL_DEFAULTS,...options},sweepVars=sizes.map((n,i)=>i).filter(i=>sizes[i]>1&&sizes[i]<=opts.sweepLimit);
  this.rng=new Rng(seed);
  this.s={method:'anneal',sizes:[...sizes],start:start.map(v=>v??null),opts,phase:sweepVars.length?'sweep':'anneal',current:null,best:[],pending:null,reeval:[],
   sweep:Annealing.newSweep(sweepVars),anneal:{temp:0,i:0},steps:0,sinceBest:0,stall:0,restarts:0,accepts:0,initTries:0,rng:null};
 }
 static newSweep(vars){return {vars,k:0,pos:0,pass:0,improved:false,best:null};}
 static fromState(state){const self=Object.create(Annealing.prototype);self.s=clone(state);self.rng=new Rng(state.rng);return self;}
 state(){this.s.rng=[...this.rng.s];return clone(this.s);}
 get current(){return this.s.current;}
 best(){const b=this.s.best[0];return b?{...b,n:1}:null;}
 invalidate(){
  const q=[];for(const e of [this.s.current,...this.s.best].filter(Boolean))if(!q.some(x=>same(x,e.x)))q.push(e.x);
  this.s.reeval=q;this.s.pending=null;this.s.sweep.best=null;
 }
 propose(){
  const s=this.s;if(s.pending)return s.pending;
  let p;
  if(s.reeval.length)p={x:[...s.reeval[0]],kind:'reeval'};
  else if(!s.current)p={x:s.start.map((v,i)=>v??this.rng.below(s.sizes[i])),kind:'init'};
  else{
   p=s.phase==='sweep'?this.proposeSweep():null;
   if(!p)p=s.stall>=s.opts.restartPatience&&s.best.length?this.proposeRestart():this.proposeAnneal();
  }
  p.race=s.opts.race&&s.current&&['sweep','anneal'].includes(p.kind)?s.current.score:null;
  s.pending=p;return p;
 }
 proposeSweep(){
  const s=this.s,sw=s.sweep;let cur=s.current.x;
  for(;;){
   if(sw.k>=sw.vars.length){
    sw.pass++;
    if(sw.improved&&sw.pass<s.opts.maxSweepPasses){Object.assign(sw,{k:0,pos:0,improved:false});continue;}
    s.phase='anneal';return null;
   }
   const v=sw.vars[sw.k];
   if(sw.pos>=s.sizes[v]){
    // Variable done: move to the best value found for it.
    if(sw.best&&sw.best.score>s.current.score){s.current=sw.best;cur=s.current.x;sw.improved=true;s.accepts++;}
    Object.assign(sw,{k:sw.k+1,pos:0,best:null});continue;
   }
   const pos=sw.pos++;if(pos===cur[v])continue;
   const x=[...cur];x[v]=pos;return {x,kind:'sweep'};
  }
 }
 step(size){const d=Math.max(1,Math.min(this.s.opts.delta,Math.floor(size/4)));let k=0;while(!k)k=this.rng.int(-d,d);return k;}
 proposeAnneal(){
  const s=this.s,sizes=s.sizes,movable=sizes.map((n,i)=>i).filter(i=>sizes[i]>1),x=[...s.current.x];
  if(!movable.length)return {x,kind:'anneal'};
  for(const j of movable)if(this.rng.random()<s.opts.multiProb)x[j]=(x[j]+this.step(sizes[j])+sizes[j])%sizes[j];
  const a=s.anneal,i=movable[a.i%movable.length];a.i=(a.i+1)%movable.length;
  if(this.rng.random()<0.5)x[i]=this.rng.below(sizes[i]);else x[i]=(x[i]+this.step(sizes[i])+sizes[i])%sizes[i];
  if(same(x,s.current.x))x[i]=(x[i]+this.step(sizes[i])+sizes[i])%sizes[i];
  return {x,kind:'anneal'};
 }
 proposeRestart(){
  const s=this.s,base=this.rng.choice(s.best).x,x=[...base],movable=s.sizes.map((n,i)=>i).filter(i=>s.sizes[i]>1);
  for(const i of movable)if(this.rng.random()<s.opts.restartProb)x[i]=this.rng.below(s.sizes[i]);
  if(movable.length&&same(x,base)){const i=this.rng.choice(movable);x[i]=(x[i]+this.step(s.sizes[i])+s.sizes[i])%s.sizes[i];}
  return {x,kind:'restart'};
 }
 observe(proposal,result){
  const s=this.s;
  if(!s.pending||!same(proposal.x,s.pending.x))throw new Error('observe() without propose()');
  s.pending=null;s.steps++;
  const {kind,x}=proposal,events=[],entry=result?{x:[...x],score:result.score,se:result.se}:null,complete=!!result?.complete;
  if(kind==='reeval'){
   s.reeval.shift();
   if(entry&&result.complete){if(s.current&&same(s.current.x,x))s.current=entry;s.best=s.best.map(e=>same(e.x,x)?{...entry}:e).sort((a,b)=>b.score-a.score);}
   return events;
  }
  if(kind==='init'||kind==='restart'){
   if(!entry){
    if(kind==='init'){
     // Random start values may give an invalid warrior: draw again.
     if(s.start.every(v=>v!==null)||++s.initTries>=1000)throw new Error('The start values do not give a valid warrior.');
     return events;
    }
    s.stall=0;s.restarts++;return events;
   }
   s.current=entry;
   if(kind==='restart'){s.restarts++;s.stall=0;s.sweep=Annealing.newSweep(s.sweep.vars);s.phase=s.sweep.vars.length?'sweep':'anneal';s.anneal.temp=0;events.push({type:'restart',score:entry.score});}
  }else if(!entry||!complete){if(kind==='anneal')s.anneal.temp++;}
  else if(kind==='sweep'){const ref=s.sweep.best?s.sweep.best.score:s.current.score;if(entry.score>ref)s.sweep.best=entry;}
  else if(kind==='anneal'){
   const a=s.anneal;a.temp++;const delta=entry.score-s.current.score;
   if(delta>=0||Math.exp(delta*s.opts.annealScale/a.temp)>this.rng.random()){s.current=entry;a.temp=0;s.accepts++;events.push({type:'accept',score:entry.score});}
  }
  if(entry&&complete&&this.addBest(entry)){s.sinceBest=0;s.stall=0;events.push({type:'best',score:entry.score,x:[...x]});}
  else{s.sinceBest++;s.stall++;}
  return events;
 }
 addBest(entry){
  const best=this.s.best,top=best[0]?.score;
  if(best.some(e=>same(e.x,entry.x)))return false;
  best.push({...entry});best.sort((a,b)=>b.score-a.score);best.length=Math.min(best.length,this.s.opts.keepBest);
  return top===undefined||entry.score>top;
 }
 summary(){const s=this.s;return {phase:s.phase,steps:s.steps,accepts:s.accepts,restarts:s.restarts,current:s.current?.score??null};}
}

// Steady-state GA. A member's score is the running mean over the seeds it was scored on;
// after each population-sized batch of children the seeds change and the top members are
// scored again, so a member counts as best only once it was seen on two seeds.
export class Genetic{
 constructor(sizes,start,seed,options={},seeds=[]){
  const opts={...GA_DEFAULTS,...options};
  this.rng=new Rng(seed);
  this.s={method:'ga',sizes:[...sizes],start:start.map(v=>v??null),seeds:seeds.map(x=>[...x]),opts,pop:[],pending:null,reeval:[],steps:0,children:0,born:0,immigrants:0,discarded:0,initTries:0,rng:null};
 }
 static fromState(state){const self=Object.create(Genetic.prototype);self.s=clone(state);self.rng=new Rng(state.rng);return self;}
 state(){this.s.rng=[...this.rng.s];return clone(this.s);}
 random(){return this.s.sizes.map(n=>this.rng.below(n));}
 trusted(){const p=this.s.pop,t=p.filter(m=>m.n>=2);return (t.length?t:p).slice().sort((a,b)=>b.score-a.score);}
 best(){const b=this.trusted()[0];return b?{x:[...b.x],score:b.score,se:b.se,n:b.n}:null;}
 invalidate(){
  // New seeds: score the best members again so their means cover two seeds.
  const ranked=this.s.pop.slice().sort((a,b)=>b.score-a.score).slice(0,this.s.opts.elite);
  this.s.reeval=ranked.map(m=>[...m.x]);this.s.pending=null;
 }
 tournament(size){const p=this.s.pop;let best=null;for(let i=0;i<Math.max(1,size);i++){const m=this.rng.choice(p);if(!best||m.score>best.score)best=m;}return best;}
 mutate(x,force){
  const s=this.s,n=s.sizes.length,rate=s.opts.mutation/Math.max(1,n);let changed=0;
  do{
   for(let i=0;i<n;i++){
    if(s.sizes[i]<2||this.rng.random()>=rate)continue;changed++;
    // Big numeric domains creep; small ones (and opcode or mode lists) get a fresh value.
    if(s.sizes[i]>100&&this.rng.random()<s.opts.creepProb)x[i]=((x[i]+(this.rng.random()<0.5?-1:1)*Math.floor(this.rng.exp(s.opts.creepMean)+1))%s.sizes[i]+s.sizes[i])%s.sizes[i];
    else x[i]=this.rng.below(s.sizes[i]);
   }
  }while(force&&!changed&&s.sizes.some(v=>v>1));
  return x;
 }
 crossover(a,b){
  const s=this.s,n=a.length,kind=this.rng.below(4);
  if(kind===0)return a.map((v,i)=>this.rng.random()<0.5?v:b[i]);
  if(kind===1){const cut=this.rng.int(1,Math.max(1,n-1));return a.map((v,i)=>i<cut?v:b[i]);}
  if(kind===2)return a.map((v,i)=>{
   // BLX-α only where index order means distance (numeric ranges), not on token lists.
   if(s.sizes[i]<=100||this.rng.random()>=s.opts.blxRate)return v;
   const lo=Math.min(v,b[i]),hi=Math.max(v,b[i]),d=(hi-lo)*s.opts.blxAlpha;
   return ((Math.floor(lo-d+this.rng.random()*(hi-lo+2*d+1)))%s.sizes[i]+s.sizes[i])%s.sizes[i];
  });
  return [...a];
 }
 propose(){
  const s=this.s;if(s.pending)return s.pending;
  let p;
  if(s.reeval.length)p={x:[...s.reeval[0]],kind:'reeval'};
  else if(s.pop.length<Math.min(10,s.opts.population)||(s.born<s.opts.population&&s.pop.length<s.opts.population)){
   // Start values first, then earlier bests, then mutants of those and random members.
   const start=s.start.map((v,i)=>v??this.rng.below(s.sizes[i]));
   const queue=[start,...s.seeds];
   const x=s.born<queue.length?[...queue[s.born]]:this.rng.random()<0.5&&s.pop.length?this.mutate([...this.rng.choice(s.pop).x],true):this.random();
   p={x,kind:'init'};
  }else if(this.rng.random()<s.opts.immigrants)p={x:this.random(),kind:'immigrant'};
  else{
   const a=this.tournament(s.opts.tourX),b=this.tournament(s.opts.tourY);
   let x=this.mutate(this.crossover(a.x,b.x),false);
   if(s.pop.some(m=>same(m.x,x)))x=this.mutate(x,true);
   p={x,kind:'child'};
  }
  // Race against the weakest member: a child scoring below it would be dropped anyway.
  const worst=s.pop.length>=s.opts.population?Math.min(...s.pop.map(m=>m.score)):null;
  p.race=s.opts.race&&p.kind!=='reeval'&&worst!==null?worst:null;
  s.pending=p;return p;
 }
 observe(proposal,result){
  const s=this.s;
  if(!s.pending||!same(proposal.x,s.pending.x))throw new Error('observe() without propose()');
  s.pending=null;s.steps++;
  const events=[],{kind,x}=proposal,before=this.best();
  if(kind==='reeval'){
   s.reeval.shift();
   const m=s.pop.find(m=>same(m.x,x));
   if(m&&result?.complete){m.sum+=result.score;m.n++;m.score=m.sum/m.n;m.se=result.se/Math.sqrt(m.n);}
  }else{
   if(kind==='init')s.born++;else{s.children++;if(kind==='immigrant')s.immigrants++;}
   if(!result){
    if(kind==='init'&&!s.pop.length&&s.start.every(v=>v!==null)&&s.born===1)throw new Error('The start values do not give a valid warrior.');
    if(kind==='init'&&++s.initTries>=1000&&!s.pop.length)throw new Error('No valid warrior found among 1000 random values.');
   }else if(!result.complete||s.pop.some(m=>same(m.x,x)))s.discarded++;
   else{
    const child={x:[...x],sum:result.score,n:1,score:result.score,se:result.se};
    s.pop.push(child);
    if(s.pop.length>s.opts.population){
     // Deterministic crowding: the child replaces the most similar weaker member, if any.
     const weaker=s.pop.filter(m=>m!==child&&m.score<child.score);
     if(!weaker.length){s.pop.pop();s.discarded++;}
     else{
      const dist=m=>m.x.reduce((d,v,i)=>d+(v!==child.x[i]),0);
      weaker.sort((a,b)=>dist(a)-dist(b)||a.score-b.score);
      s.pop.splice(s.pop.indexOf(weaker[0]),1);
     }
    }
    if(s.children&&s.children%s.opts.population===0)events.push({type:'generation'});
   }
  }
  const after=this.best();
  if(after&&(!before||!same(after.x,before.x)||after.score>before.score))events.push({type:'best',score:after.score,x:after.x});
  return events;
 }
 summary(){const p=this.s.pop.map(m=>m.score).sort((a,b)=>a-b);return {steps:this.s.steps,population:p.length,median:p.length?p[p.length>>1]:null,children:this.s.children,discarded:this.s.discarded};}
}
// Every combination of the "!!" variables (grid), in order with the last one changing fastest;
// the other variables stay at their start values. propose() returns null when all are scored.
// Keeps the top results and, for a single grid variable, the score of every value.
export const EXHAUSTIVE_DEFAULTS={keep:20,race:true};
export class Exhaustive{
 constructor(sizes,start,grid,options={}){
  const opts={...EXHAUSTIVE_DEFAULTS,...options};
  if(!grid.length)throw new Error('No !! markers: nothing to test exhaustively.');
  const missing=start.flatMap((v,i)=>v===null&&!grid.includes(i)?[i]:[]);
  if(missing.length)throw new Error('missing start values');
  const total=grid.reduce((p,i)=>p*sizes[i],1);
  this.s={method:'exhaustive',sizes:[...sizes],start:start.map(v=>v??0),grid:[...grid],opts,total,next:0,steps:0,top:[],pending:null,
   scores:grid.length===1?Array(sizes[grid[0]]).fill(null):null,invalid:0,raced:0};
 }
 static fromState(state){const self=Object.create(Exhaustive.prototype);self.s=clone(state);return self;}
 state(){return clone(this.s);}
 get done(){return this.s.next>=this.s.total&&!this.s.pending;}
 candidate(k){
  const s=this.s,x=[...s.start];
  for(let g=s.grid.length-1;g>=0;g--){const i=s.grid[g];x[i]=k%s.sizes[i];k=Math.floor(k/s.sizes[i]);}
  return x;
 }
 best(){const b=this.s.top[0];return b?{...b,x:[...b.x],n:1}:null;}
 invalidate(){}
 propose(){
  const s=this.s;if(s.pending)return s.pending;
  if(s.next>=s.total)return null;
  // Racing drops a candidate once it is clearly below the best so far; its score is then partial.
  const p={x:this.candidate(s.next),kind:'grid',index:s.next,race:s.opts.race&&s.top.length?s.top[0].score:null};
  s.pending=p;return p;
 }
 observe(proposal,result){
  const s=this.s;
  if(!s.pending||!same(proposal.x,s.pending.x))throw new Error('observe() without propose()');
  s.pending=null;s.next++;s.steps++;
  const events=[];
  if(!result){s.invalid++;return events;}
  if(!result.complete){s.raced++;return events;}
  if(s.scores)s.scores[proposal.x[s.grid[0]]]=result.score;
  const before=s.top[0]?.score;
  s.top.push({x:[...proposal.x],score:result.score,se:result.se});
  s.top.sort((a,b)=>b.score-a.score);s.top.length=Math.min(s.top.length,s.opts.keep);
  if(before===undefined||result.score>before)events.push({type:'best',score:result.score,x:[...proposal.x]});
  return events;
 }
 summary(){const s=this.s;return {tested:s.next,total:s.total,invalid:s.invalid,raced:s.raced};}
}
export function restoreMethod(state){return state.method==='ga'?Genetic.fromState(state):state.method==='exhaustive'?Exhaustive.fromState(state):Annealing.fromState(state);}

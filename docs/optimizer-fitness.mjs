// SPDX-License-Identifier: GPL-2.0-or-later
// Scoring for the constant optimizer, after cwopt (tools-import/cwopt/fitness.py).
// A candidate fights each opponent one on one. A round scores 3 for a win and 1 for a tie,
// shown as (3W + T) / rounds × 100 and averaged over opponents (0–300; 100 = all ties).
//  exact:   small cores without P-space: one match per opponent in permutation mode, every
//           legal position with both starting orders once. No noise.
//  sampled: the rounds split into slices with seeded placements. All candidates of one epoch
//           share the seeds (common random numbers); racing drops a candidate after a slice
//           when it is more than z standard errors behind the score it has to beat.
import {Engine,settings} from './engine.mjs';
import {ExmarsRunner,exmarsBlocker,ENGINE_NAMES} from './exmars.mjs';
import {numericPosition} from './tournament-plan.mjs';
import {permutationRounds} from './hill-scores.mjs';

// selfFight: the candidate also fights a copy of itself, as one more opponent (hills such as Koenigstuhl count it).
export const SCORING_DEFAULTS={rounds:250,slices:5,z:3,exactLimit:2000,reseedEvery:10,validateRounds:2000,selfFight:false};
export const matchConfig=config=>({coreSize:config.coreSize,cycles:config.cycles,tasks:config.tasks,maxLength:config.maxLength,distance:config.distance,pspace:config.pspace,rules88:config.rules88,noPspace:config.noPspace,formula:config.formula||'(W*W-1)/S'});
const PSPACE_RE=/^[^;]*\b(ldp|stp)\b/im;
export const usesPspace=source=>PSPACE_RE.test(source);

// One match, run to the end: {wins, ties, losses, engine} of the first warrior, or {error}.
// exMARS runs it when it gives pMARS's result (exmars.mjs), with one fighter per worker that keeps
// the opponents loaded; otherwise, and for assembly errors (pMARS's messages), a fresh pMARS engine.
let exmars=null;
const jobSettings=job=>({...job.config,warriors:2,rounds:job.rounds,permutate:!!job.permutate,fixedPosition:job.position||'',brief:true,verbose:false,sort:false,fixedSeries:false,assembleOnly:false});
export async function runMatch(job,options){
 const useExmars=options?.useExmars!==false;
 let diagnostics='',fallback=null;
 if(useExmars){
  exmars??=new ExmarsRunner();
  const r=await exmars.run(jobSettings(job),[job.a,job.b]);
  if(!r.fallback){const w=r.warriors[0];return {wins:w.wins,ties:w.ties,losses:w.losses,engine:'exmars'};}
  fallback=r.fallback;
 }
 try{
  const engine=await Engine.create(jobSettings(job),
   {visual:false,log:text=>{diagnostics=(diagnostics+'\n'+text).slice(-4000);}});
  let assembling=0;
  engine.compile([job.a,job.b],()=>{},null,i=>{assembling=i;});
  assembling=-1;
  engine.setDebug(false);engine.setTrace(false);engine.start();
  let done=0;
  while(!done){done=engine.module._web_advance(100000,8);if(done<0)throw new Error('Engine advance failed.');}
  const w=engine.update(true).warriors[0];
  return {wins:w.wins,ties:w.ties,losses:w.losses,engine:'pmars',fallback};
 }catch(error){return {error:error.message,diagnostics:diagnostics.trim(),warrior:error.warriorIndex};}
}
// One candidate against several opponents, one match each: job {config, a, opponents: [source],
// rounds, permutate, positions: [placement seed per opponent] (optional)}. Returns an array with
// runMatch's result per opponent, in order; it stops after the first error. exMARS checks the
// settings and sets up the fighter once for all of them (ExmarsRunner.pairs); a pair it can't run
// goes to pMARS on its own, as runMatch would.
export async function runBatch(job,options){
 const useExmars=options?.useExmars!==false;
 const n=job.opponents.length,out=[];
 let pairs=null,why=null;
 if(useExmars){
  exmars??=new ExmarsRunner();
  const r=await exmars.pairs(jobSettings({...job,position:''}),job.a,job.opponents,{positions:job.positions||null});
  if(Array.isArray(r))pairs=r;else why=r.fallback;
 }
 for(let i=0;i<n;i++){
  const p=pairs?.[i];
  if(p&&!p.fallback){out.push(p);continue;}
  const r=await runMatch({config:job.config,a:job.a,b:job.opponents[i],rounds:job.rounds,permutate:job.permutate,position:job.positions?.[i]},{useExmars:false});
  if(!r.error&&useExmars)r.fallback=p?.fallback??why;
  out.push(r);if(r.error)break;
 }
 return out;
}
// The same through a function that runs one match (runMatch's job), for callers that only have one.
export const batchOf=runJob=>(job,token)=>Promise.all(job.opponents.map((b,i)=>runJob({config:job.config,a:job.a,b,rounds:job.rounds,permutate:job.permutate,
 ...(job.positions?{position:job.positions[i]}:{})},token)));
// The engine the optimizer will use for these settings, and why not exMARS when it can't.
export function plannedEngine(config,mode){
 const blocker=exmarsBlocker(settings({...matchConfig(config),warriors:2,rounds:mode.rounds,permutate:!!mode.exact}));
 return blocker?{engine:'pmars',why:blocker}:{engine:'exmars',why:''};
}
// "exMARS", "pMARS" or "exMARS 97% · pMARS 3%" from the counts of matches each engine ran.
export function engineSummary(engines){
 const total=engines.exmars+engines.pmars;if(!total)return '—';
 if(!engines.pmars)return ENGINE_NAMES.exmars;if(!engines.exmars)return ENGINE_NAMES.pmars;
 const share=n=>Math.round(n/total*100)+'%';
 return `${ENGINE_NAMES.exmars} ${share(engines.exmars)} · ${ENGINE_NAMES.pmars} ${share(engines.pmars)}`;
}
const points=r=>(3*r.wins+r.ties)/Math.max(1,r.wins+r.ties+r.losses)*100;

// Exact when every legal position with both orders fits in exactLimit rounds and nothing uses P-space.
// mode 'screen' (the evolver's), where exact scoring is possible: screenRounds random placements
// per opponent, one slice, for selection, and `judge`, the exact mode, for the best warriors.
export function scoringMode(config,sources,options={}){
 const o={...SCORING_DEFAULTS,...options},rounds=permutationRounds(config);
 if(o.mode==='sampled')return {exact:false,rounds:o.rounds,why:'sampled (chosen)'};
 const pspace=sources.some(usesPspace);
 if(rounds<=o.exactLimit&&!pspace&&o.mode==='screen'){
  const k=Math.max(1,Math.min(rounds,o.screenRounds|0||8));
  return {exact:false,rounds:k,slices:1,judge:{exact:true,rounds},why:`screened: ${k} random placements per opponent for selection, the leaders scored again each generation, exact (all ${rounds} placements) for the best`};
 }
 if(rounds<=o.exactLimit&&!pspace)return {exact:true,rounds,why:`exact: all ${rounds} placements per opponent`};
 return {exact:false,rounds:o.rounds,why:pspace?'sampled: P-space instructions keep state between rounds':`sampled: ${rounds} placements per opponent is more than ${o.exactLimit}`};
}

// runBatch(job, token) -> Promise<[{wins,ties,losses}|{error}]>: one candidate against a list of
// opponents (runBatch above), the fast way: a worker pool's run() in the browser, runBatch in Node.
// runJob(job, token) -> Promise<{wins,ties,losses}|{error}>, one match per call, is still taken in
// its place (each opponent a job of its own); runMatch itself is run as runBatch.
export class Evaluator{
 constructor({runJob=null,runBatch:batch=null,config,opponents,options={},seed='1'}){
  this.runBatch=batch??(runJob===runMatch||!runJob?runBatch:batchOf(runJob));this.config=matchConfig(config);this.opponents=opponents;this.options={...SCORING_DEFAULTS,...options};this.seed=String(seed);
  this.cache=new Map();this.epoch=0;this.evaluations=0;this.cached=0;this.raced=0;this.invalid=0;this.matches=0;
  this.engines={exmars:0,pmars:0};this.fallback=null;
 }
 setMode(mode){this.mode=mode;}
 position(epoch,slice,opponent){return numericPosition(`opt:${this.seed}:${epoch}:${slice}:${opponent}`,this.config);}
 // Score one candidate source. race: drop it early when clearly below this score.
 async evaluate(source,{race=null,epoch=this.epoch}={}){
  const key=epoch+'\n'+source,hit=this.cache.get(key);
  if(hit&&(hit.complete||race===null||hit.score+this.options.z*hit.se<race)){this.cached++;return hit;}
  this.evaluations++;
  const result=this.mode.exact?await this.exact(source):await this.sampled(source,race,epoch);
  if(!result)this.invalid++;else if(!result.complete)this.raced++;
  if(result)this.cache.set(key,result);
  if(this.cache.size>20000)this.cache.delete(this.cache.keys().next().value);
  return result;
 }
 // One job: this candidate against these opponents (positions: a placement seed for each, or none).
 batch(source,list,rounds,{permutate=false,positions=null,token=null}={}){
  this.matches+=list.length;
  return this.runBatch({config:this.config,a:source,opponents:list.map(o=>o.source),rounds,permutate,...(positions?{positions}:{})},token)
   .then(r=>Array.isArray(r)?r:[r]);
 }
 check(results){
  for(const r of results)if(r.engine){this.engines[r.engine]++;if(r.fallback)this.fallback=r.fallback;}
  const failed=results.find(r=>r.error);
  if(failed){if(failed.warrior===1)throw new Error('An opponent did not assemble: '+failed.error);this.lastError=failed;return null;}
  return results;
 }
 // The opponents of one candidate: the benchmark, and with selfFight a copy of the candidate last.
 rivals(source){return this.options.selfFight?[...this.opponents,{name:'itself (self fight)',source,self:true}]:this.opponents;}
 perOpponent(totals,list){return totals.map((t,i)=>({name:list[i].name,...(list[i].self?{self:true}:{}),...t,score:points(t)}));}
 async exact(source){
  const list=this.rivals(source),results=this.check(await this.batch(source,list,this.mode.rounds,{permutate:true}));
  if(!results)return null;
  const per=this.perOpponent(results,list),score=per.reduce((s,r)=>s+r.score,0)/per.length;
  return {score,se:0,complete:true,slices:1,rounds:this.mode.rounds,opponents:per};
 }
 async sampled(source,race,epoch,{rounds=this.mode.rounds,slices=this.mode.slices??this.options.slices,useRace=true}={}){
  const list=this.rivals(source),per=Math.ceil(rounds/slices),totals=list.map(()=>({wins:0,ties:0,losses:0})),sliceScores=[];
  // Queue every slice at once so no worker waits between slices; racing cancels the rest.
  const token={cancelled:false},queued=Array.from({length:slices},(_,k)=>this.batch(source,list,per,{positions:list.map((o,i)=>this.position(epoch,k,i)),token}));
  for(let k=0;k<slices;k++){
   const results=this.check(await queued[k]);
   if(!results){token.cancelled=true;return null;}
   results.forEach((r,i)=>{totals[i].wins+=r.wins;totals[i].ties+=r.ties;totals[i].losses+=r.losses;});
   sliceScores.push(results.reduce((s,r)=>s+points(r),0)/results.length);
   const {mean,se}=meanSe(sliceScores);
   if(useRace&&race!==null&&k>=1&&k<slices-1&&mean+this.options.z*se<race){token.cancelled=true;return {score:mean,se,complete:false,slices:k+1,rounds:per*(k+1),opponents:this.perOpponent(totals,list)};}
  }
  const {mean,se}=meanSe(sliceScores);
  return {score:mean,se,complete:true,slices,rounds:per*slices,opponents:this.perOpponent(totals,list)};
 }
 // Held out: placements no search step has seen, so the score is not biased by selection.
 async validate(source,rounds=this.options.validateRounds){
  if(this.mode.exact)return this.exact(source);
  return this.sampled(source,null,'holdout',{rounds,slices:Math.max(1,Math.ceil(rounds/250)),useRace:false});
 }
}
export function meanSe(values){
 const n=values.length,mean=values.reduce((a,b)=>a+b,0)/n;
 if(n<2)return {mean,se:0};
 const v=values.reduce((a,b)=>a+(b-mean)**2,0)/(n-1);
 return {mean,se:Math.sqrt(v/n)};
}

// Browser pool: one Web Worker per slot, jobs handed out as workers become free. A job is one match
// (runMatch's) or one candidate against a list of opponents (runBatch's, with `opponents`), one
// message either way. When there are fewer batches waiting than idle workers (one candidate at a
// time, or many cores), a batch's opponents are split over the idle workers.
export class WorkerPool{
 constructor(size,url){
  this.size=size;this.url=url;this.idle=[];this.queue=[];this.all=[];this.serial=0;this.pending=new Map();this.scheduled=false;
  for(let i=0;i<size;i++){const w=new Worker(url,{type:'module'});w.onmessage=({data})=>this.done(w,data);w.onerror=e=>this.failed(w,e);this.all.push(w);this.idle.push(w);}
 }
 // Handing out waits for the end of the current task, so that jobs queued together are seen together.
 run(job,token=null){return new Promise(resolve=>{this.queue.push({job,token,resolve});if(!this.scheduled){this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.pump();});}});}
 // Splits the waiting batches into parts while that leaves no more parts than idle workers.
 split(){
  const idle=this.idle.length,q=this.queue.length;
  if(!q||idle<=q)return;
  const per=Math.floor(idle/q);if(per<2)return;
  this.queue=this.queue.flatMap(task=>{
   const n=task.job.opponents?.length??0,parts=Math.min(per,n);
   if(parts<2||task.token?.cancelled)return [task];
   const size=Math.ceil(n/parts),results=[];let left=Math.ceil(n/size);
   const finish=()=>{const bad=results.find(r=>!Array.isArray(r));task.resolve(bad??results.flat());};
   const out=[];
   for(let s=0,k=0;s<n;s+=size,k++){
    const job={...task.job,opponents:task.job.opponents.slice(s,s+size)};
    if(task.job.positions)job.positions=task.job.positions.slice(s,s+size);
    out.push({job,token:task.token,resolve:r=>{results[k]=r;if(--left===0)finish();}});
   }
   return out;
  });
 }
 pump(){
  this.split();
  while(this.idle.length&&this.queue.length){
   const task=this.queue.shift();
   if(task.token?.cancelled){task.resolve({error:'cancelled'});continue;}
   const w=this.idle.pop(),id=++this.serial;
   this.pending.set(w,{...task,id});w.postMessage({id,job:task.job});
  }
 }
 done(w,data){const task=this.pending.get(w);this.pending.delete(w);this.idle.push(w);task?.resolve(data.result);this.pump();}
 failed(w,event){const task=this.pending.get(w);this.pending.delete(w);this.idle.push(w);task?.resolve({error:event.message||'Worker failed'});this.pump();}
 terminate(){for(const w of this.all)w.terminate();for(const t of [...this.pending.values(),...this.queue])t.resolve({error:'stopped'});this.all=[];this.idle=[];this.queue=[];this.pending.clear();}
}

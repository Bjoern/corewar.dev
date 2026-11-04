// SPDX-License-Identifier: GPL-2.0-or-later
// Scoring for the constant optimizer, after cwopt (tools-import/cwopt/fitness.py).
// A candidate fights each opponent one on one. A round scores 3 for a win and 1 for a tie,
// shown as (3W + T) / rounds × 100 and averaged over opponents (0–300; 100 = all ties).
//  exact:   small cores without P-space: one match per opponent in permutation mode, every
//           legal position with both starting orders once. No noise.
//  sampled: the rounds split into slices with seeded placements. All candidates of one epoch
//           share the seeds (common random numbers); racing drops a candidate after a slice
//           when it is more than z standard errors behind the score it has to beat.
import {Engine} from './engine.mjs';
import {numericPosition} from './tournament-plan.mjs';
import {permutationRounds} from './hill-scores.mjs';

export const SCORING_DEFAULTS={rounds:250,slices:5,z:3,exactLimit:2000,reseedEvery:10,validateRounds:2000};
export const matchConfig=config=>({coreSize:config.coreSize,cycles:config.cycles,tasks:config.tasks,maxLength:config.maxLength,distance:config.distance,pspace:config.pspace,rules88:config.rules88,noPspace:config.noPspace,formula:config.formula||'(W*W-1)/S'});
const PSPACE_RE=/^[^;]*\b(ldp|stp)\b/im;
export const usesPspace=source=>PSPACE_RE.test(source);

// One match, run to the end: {wins, ties, losses} of the first warrior, or {error}.
export async function runMatch(job){
 let diagnostics='';
 try{
  const engine=await Engine.create({...job.config,warriors:2,rounds:job.rounds,permutate:!!job.permutate,fixedPosition:job.position||'',brief:true,verbose:false,sort:false,fixedSeries:false,assembleOnly:false},
   {visual:false,log:text=>{diagnostics=(diagnostics+'\n'+text).slice(-4000);}});
  let assembling=0;
  engine.compile([job.a,job.b],()=>{},null,i=>{assembling=i;});
  assembling=-1;
  engine.setDebug(false);engine.setTrace(false);engine.start();
  let done=0;
  while(!done){done=engine.module._web_advance(100000,8);if(done<0)throw new Error('Engine advance failed.');}
  const w=engine.update(true).warriors[0];
  return {wins:w.wins,ties:w.ties,losses:w.losses};
 }catch(error){return {error:error.message,diagnostics:diagnostics.trim(),warrior:error.warriorIndex};}
}
const points=r=>(3*r.wins+r.ties)/Math.max(1,r.wins+r.ties+r.losses)*100;

// Exact when every legal position with both orders fits in exactLimit rounds and nothing uses P-space.
export function scoringMode(config,sources,options={}){
 const o={...SCORING_DEFAULTS,...options},rounds=permutationRounds(config);
 if(o.mode==='sampled')return {exact:false,rounds:o.rounds,why:'sampled (chosen)'};
 const pspace=sources.some(usesPspace);
 if(rounds<=o.exactLimit&&!pspace)return {exact:true,rounds,why:`exact: all ${rounds} placements per opponent`};
 return {exact:false,rounds:o.rounds,why:pspace?'sampled: P-space instructions keep state between rounds':`sampled: ${rounds} placements per opponent is more than ${o.exactLimit}`};
}

// runJob(job) -> Promise<{wins,ties,losses}|{error}>; a worker pool in the browser, runMatch in Node.
export class Evaluator{
 constructor({runJob,config,opponents,options={},seed='1'}){
  this.runJob=runJob;this.config=matchConfig(config);this.opponents=opponents;this.options={...SCORING_DEFAULTS,...options};this.seed=String(seed);
  this.cache=new Map();this.epoch=0;this.evaluations=0;this.cached=0;this.raced=0;this.invalid=0;this.matches=0;
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
 async jobs(list,token){
  this.matches+=list.length;
  return this.check(await Promise.all(list.map(job=>this.runJob(job,token))));
 }
 check(results){
  const failed=results.find(r=>r.error);
  if(failed){if(failed.warrior===1)throw new Error('An opponent did not assemble: '+failed.error);this.lastError=failed;return null;}
  return results;
 }
 perOpponent(totals){return totals.map((t,i)=>({name:this.opponents[i].name,...t,score:points(t)}));}
 async exact(source){
  const results=await this.jobs(this.opponents.map(o=>({config:this.config,a:source,b:o.source,rounds:this.mode.rounds,permutate:true})));
  if(!results)return null;
  const per=this.perOpponent(results),score=per.reduce((s,r)=>s+r.score,0)/per.length;
  return {score,se:0,complete:true,slices:1,rounds:this.mode.rounds,opponents:per};
 }
 async sampled(source,race,epoch,{rounds=this.mode.rounds,slices=this.options.slices,useRace=true}={}){
  const per=Math.ceil(rounds/slices),totals=this.opponents.map(()=>({wins:0,ties:0,losses:0})),sliceScores=[];
  // Queue every slice at once so no worker waits between slices; racing cancels the rest.
  const token={cancelled:false},queued=Array.from({length:slices},(_,k)=>Promise.all(this.opponents.map((o,i)=>this.runJob({config:this.config,a:source,b:o.source,rounds:per,position:this.position(epoch,k,i)},token))));
  this.matches+=slices*this.opponents.length;
  for(let k=0;k<slices;k++){
   const results=this.check(await queued[k]);
   if(!results){token.cancelled=true;return null;}
   results.forEach((r,i)=>{totals[i].wins+=r.wins;totals[i].ties+=r.ties;totals[i].losses+=r.losses;});
   sliceScores.push(results.reduce((s,r)=>s+points(r),0)/results.length);
   const {mean,se}=meanSe(sliceScores);
   if(useRace&&race!==null&&k>=1&&k<slices-1&&mean+this.options.z*se<race){token.cancelled=true;return {score:mean,se,complete:false,slices:k+1,rounds:per*(k+1),opponents:this.perOpponent(totals)};}
  }
  const {mean,se}=meanSe(sliceScores);
  return {score:mean,se,complete:true,slices,rounds:per*slices,opponents:this.perOpponent(totals)};
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

// Browser pool: one Web Worker per slot, jobs handed out as workers become free.
export class WorkerPool{
 constructor(size,url){
  this.size=size;this.url=url;this.idle=[];this.queue=[];this.all=[];this.serial=0;this.pending=new Map();
  for(let i=0;i<size;i++){const w=new Worker(url,{type:'module'});w.onmessage=({data})=>this.done(w,data);w.onerror=e=>this.failed(w,e);this.all.push(w);this.idle.push(w);}
 }
 run(job,token=null){return new Promise((resolve,reject)=>{this.queue.push({job,token,resolve,reject});this.pump();});}
 pump(){
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

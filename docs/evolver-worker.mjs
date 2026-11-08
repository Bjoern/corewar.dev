// SPDX-License-Identifier: GPL-2.0-or-later
// The evolver runs here, off the page's thread: the population, breeding and bookkeeping
// (evolver-run.mjs). Matches go to a pool of the constant optimizer's match workers
// (optimizer-worker.mjs), one per CPU core asked for; a browser without nested workers runs
// them here, one at a time. Messages in: start, pause, resume, stop. Out: started, generation,
// paused, done, error.
import {Evaluator,WorkerPool,runMatch,scoringMode,matchConfig,plannedEngine,engineSummary} from './optimizer-fitness.mjs';
import {Evolution,splitHoldOut,runNotes} from './evolver-run.mjs';
import {genomeRules,markovModel} from './evolver-genome.mjs';
import {hillOf} from './exmars.mjs';

let run=null;
const post=message=>self.postMessage(message);

// Seed warriors arrive as Redcode; exMARS's assembler turns them into genomes as they are.
async function assembleSeeds(sources,config){
 if(!sources.length)return [];
 const {assemble}=await import('./dist/exmars/fighter-client.mjs');
 const hill=hillOf({...config,distance:config.distance||config.maxLength});
 const out=[];
 for(const {name,source} of sources){
  const w=await assemble(source,hill);
  if(!w.ok)throw new Error(`The seed ${name} did not assemble for these settings:\n${w.errors}`);
  if(w.instructions.some(i=>i[0]>=16))throw new Error(`The seed ${name} uses P-space (LDP/STP), which the evolver does not write.`);
  const max=genomeRules(config).maxLength;
  if(w.instructions.length>max)throw new Error(`The seed ${name} has ${w.instructions.length} instructions, more than the warrior length of ${max}.`);
  out.push({code:w.instructions,start:w.start});
 }
 return out;
}

// The Markov chain learns from the opponents that assemble for these settings; the rest are skipped.
async function opponentModel(opponents,config){
 const {assemble}=await import('./dist/exmars/fighter-client.mjs');
 const hill=hillOf({...config,distance:config.distance||config.maxLength}),genomes=[];
 for(const {source} of opponents){try{const w=await assemble(source,hill);if(w.ok)genomes.push({code:w.instructions,start:w.start});}catch{}}
 return markovModel(genomes,genomeRules(config));
}

// Opponents that don't assemble for these settings are left out, as the Tournaments tab does, with
// pMARS's message: one round against a warrior that dies at once costs next to nothing.
async function usableOpponents(list,config){
 const usable=[],excluded=[];
 for(const [index,o] of list.entries()){
  const r=await runMatch({config,a:'dat 0, 0',b:o.source,rounds:1});
  if(r.error)excluded.push({index,name:o.name,reason:[r.error,r.diagnostics].filter(Boolean).join(' — ')});else usable.push(o);
 }
 return {usable,excluded};
}

async function start(job){
 const config=matchConfig(job.config);
 // The evolved warriors may be shorter than the hill allows (warriorLength); matches use the hill's settings.
 const own={...config,warriorLength:Number(job.config.warriorLength)||0};
 // The run exists from here, so Stop works while the opponents are checked.
 const r={state:'running',pool:null,validation:null,validatedKey:null,started:Date.now(),elapsed:0,resumedAt:Date.now(),wake:null,job};
 run=r;
 let usable,excluded;
 try{({usable,excluded}=await usableOpponents(job.opponents,config));}catch(error){if(r.state!=='stopped'){r.state='stopped';post({type:'error',message:error.message});}return;}
 if(r.state==='stopped'||run!==r)return;
 if(!usable.length){r.state='stopped';post({type:'error',message:'None of the opponents assembled for these settings.',excluded});return;}
 // Held-out opponents never take part in selection (or in the Markov chain); the best warrior is
 // scored on them in the same mode, so the two scores compare.
 const {training:opponents,heldOut}=splitHoldOut(usable,job.holdOut||0,job.seed);
 const mode=scoringMode(config,usable.map(o=>o.source),job.scoring);
 // The run's notes count the opponents that take part.
 if(job.noteInput){const n=job.noteInput;job.notes=runNotes({...n,scoring:{exact:mode.exact,rounds:mode.rounds},
  benchmark:{...n.benchmark,opponents:usable.length,own:usable.filter(o=>o.own).length,heldOut:heldOut.length}});}
 const size=Math.max(1,job.workers|0);
 const pool=typeof Worker!=='undefined'&&size>1?new WorkerPool(size,new URL('./optimizer-worker.mjs',import.meta.url)):null;
 // Self fight: every warrior also fights a copy of itself, in training and held-out scores alike.
 const options={selfFight:!!job.selfFight};
 const evaluator=new Evaluator({runJob:pool?(j=>pool.run(j)):(j=>runMatch(j)),config,opponents,options,seed:job.seed});
 evaluator.setMode(mode);
 const validator=heldOut.length?new Evaluator({runJob:pool?(j=>pool.run(j)):(j=>runMatch(j)),config,opponents:heldOut,options,seed:job.seed+':held-out'}):null;
 validator?.setMode(mode);
 Object.assign(r,{pool,evaluator,validator});
 try{
  const seeds=[...(job.seedGenomes||[]),...await assembleSeeds(job.seedSources||[],own)];
  const model=job.markov?await opponentModel(opponents,own):null;
  if(model&&!model.warriors)throw new Error('None of the opponents assembled for these settings, so there is no Markov chain to draw from.');
  r.evolution=new Evolution({evaluator,config:own,params:job.params,seeds,seed:job.seed,name:job.name||'Evolved',model,notes:job.notes||[],before:job.before||0});
  const engine=plannedEngine(config,mode);
  post({type:'started',why:mode.why,exact:mode.exact,rounds:mode.rounds,engine:engine.engine,engineWhy:engine.why,workers:pool?size:1,nested:!!pool||size===1,
   markov:model&&{warriors:model.warriors,instructions:model.instructions,shapes:model.shapes,skipped:opponents.length-model.warriors},
   training:opponents.map(o=>o.name),heldOut:heldOut.map(o=>o.name),excluded});
  const first=await r.evolution.init();
  if(r.state==='stopped'||run!==r)return;
  await report(r,first);if(r.state==='stopped'||run!==r)return;
  const limit=job.params.generations>0?job.params.generations:Infinity;
  while(run===r&&r.state!=='stopped'){
   if(r.state==='paused'){post({type:'paused',generation:r.evolution.generation,elapsed:r.elapsed});await new Promise(resolve=>{r.wake=resolve;});continue;}
   if(r.evolution.generation>=limit){finish(r,`Finished ${limit} generations.`);return;}
   const stats=await r.evolution.step();
   if(r.state==='stopped'||run!==r)return;
   await report(r,stats);
  }
 }catch(error){
  if(r.state==='stopped')return;
  r.state='stopped';pool?.terminate();post({type:'error',message:error.message});
 }
}
function elapsed(r){return r.elapsed+(r.state==='running'?Date.now()-r.resumedAt:0);}
async function report(r,stats){
 const e=r.evolution,b=e.best;
 // The best warrior on the held-out opponents, scored again only when the best changes.
 if(r.validator&&b&&r.validatedKey!==b.key){r.validation=await r.validator.evaluate(e.source(b.genome));r.validatedKey=b.key;}
 if(r.validation)stats={...stats,heldOut:r.validation.score};
 post({type:'generation',stats,elapsed:elapsed(r),matches:r.evaluator.matches,engines:engineSummary(r.evaluator.engines),cached:r.evaluator.cached,invalid:r.evaluator.invalid,
  best:b?{source:e.bestSource(r.job.benchmarkName,{heldOut:r.validation?.score??null}),score:b.score,se:b.se,generation:b.generation,length:b.genome.code.length,opponents:b.result?.opponents??[],
   heldOut:r.validation?{score:r.validation.score,se:r.validation.se,opponents:r.validation.opponents}:null}:null,
  population:e.snapshot(),scores:e.view().map(m=>m.score),ranked:e.view().map(m=>m.genome),radius:e.nicheRadius,
  // Niches by results: the population view groups by these instead of by code.
  profiles:e.profiles()});
}
function finish(r,reason){
 if(r.state!=='stopped')r.elapsed=elapsed(r);
 r.state='stopped';r.pool?.terminate();
 post({type:'done',reason,elapsed:r.elapsed,generation:r.evolution?.generation??0});
}
self.onmessage=({data})=>{
 const r=run;
 if(data.type==='start'){if(r&&r.state!=='stopped'){r.state='stopped';r.pool?.terminate();r.wake?.();}start(data.job);return;}
 if(!r)return;
 if(data.type==='pause'&&r.state==='running'){r.elapsed=elapsed(r);r.state='paused';}
 else if(data.type==='resume'&&r.state==='paused'){r.state='running';r.resumedAt=Date.now();r.wake?.();r.wake=null;}
 else if(data.type==='stop'&&r.state!=='stopped'){finish(r,'Stopped.');r.wake?.();}
};

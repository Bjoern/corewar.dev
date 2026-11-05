// SPDX-License-Identifier: GPL-2.0-or-later
// The evolver runs here, off the page's thread: the population, breeding and bookkeeping
// (evolver-run.mjs). Matches go to a pool of the constant optimizer's match workers
// (optimizer-worker.mjs), one per CPU core asked for; a browser without nested workers runs
// them here, one at a time. Messages in: start, pause, resume, stop. Out: started, generation,
// paused, done, error.
import {Evaluator,WorkerPool,runMatch,scoringMode,matchConfig,plannedEngine,engineSummary} from './optimizer-fitness.mjs';
import {Evolution,splitHoldOut} from './evolver-run.mjs';
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

async function start(job){
 const config=matchConfig(job.config);
 // Held-out opponents never take part in selection (or in the Markov chain); the best warrior is
 // scored on them in the same mode, so the two scores compare.
 const {training:opponents,heldOut}=splitHoldOut(job.opponents,job.holdOut||0,job.seed);
 const mode=scoringMode(config,job.opponents.map(o=>o.source),job.scoring);
 const size=Math.max(1,job.workers|0);
 const pool=typeof Worker!=='undefined'&&size>1?new WorkerPool(size,new URL('./optimizer-worker.mjs',import.meta.url)):null;
 const evaluator=new Evaluator({runJob:pool?(j=>pool.run(j)):(j=>runMatch(j)),config,opponents,seed:job.seed});
 evaluator.setMode(mode);
 const validator=heldOut.length?new Evaluator({runJob:pool?(j=>pool.run(j)):(j=>runMatch(j)),config,opponents:heldOut,seed:job.seed+':held-out'}):null;
 validator?.setMode(mode);
 const r={state:'running',pool,evaluator,validator,validation:null,validatedKey:null,started:Date.now(),elapsed:0,resumedAt:Date.now(),wake:null,job};
 run=r;
 try{
  const seeds=[...(job.seedGenomes||[]),...await assembleSeeds(job.seedSources||[],config)];
  const model=job.markov?await opponentModel(opponents,config):null;
  if(model&&!model.warriors)throw new Error('None of the opponents assembled for these settings, so there is no Markov chain to draw from.');
  r.evolution=new Evolution({evaluator,config,params:job.params,seeds,seed:job.seed,name:job.name||'Evolved',model});
  const engine=plannedEngine(config,mode);
  post({type:'started',why:mode.why,exact:mode.exact,rounds:mode.rounds,engine:engine.engine,engineWhy:engine.why,workers:pool?size:1,nested:!!pool||size===1,
   markov:model&&{warriors:model.warriors,instructions:model.instructions,shapes:model.shapes,skipped:opponents.length-model.warriors},
   training:opponents.map(o=>o.name),heldOut:heldOut.map(o=>o.name)});
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
  best:b?{source:e.bestSource(r.job.benchmarkName),score:b.score,se:b.se,generation:b.generation,length:b.genome.code.length,opponents:b.result?.opponents??[],
   heldOut:r.validation?{score:r.validation.score,se:r.validation.se,opponents:r.validation.opponents}:null}:null,
  population:e.snapshot(),scores:e.view().map(m=>m.score),ranked:e.view().map(m=>m.genome),radius:e.params.niche>0?e.params.niche:0.3});
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

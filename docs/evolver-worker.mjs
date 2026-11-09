// SPDX-License-Identifier: GPL-2.0-or-later
// The evolver runs here, off the page's thread: the population, breeding and bookkeeping
// (evolver-run.mjs, or the soup of evolver-soup.mjs). Matches go to a pool of the constant optimizer's match workers
// (optimizer-worker.mjs), one per CPU core asked for; a browser without nested workers runs
// them here, one at a time. Messages in: start, pause, resume, stop. Out: started, generation,
// paused, done, error.
import {Evaluator,WorkerPool,runMatch,runBatch,runDuels,scoringMode,matchConfig,plannedEngine,engineSummary} from './optimizer-fitness.mjs';
import {Evolution,splitHoldOut,runNotes,SCREEN_PARAMS} from './evolver-run.mjs';
import {genomeRules,markovModel,structureOf,structureText} from './evolver-genome.mjs';
import {SoupEvolution} from './evolver-soup.mjs';
import {hillOf,separationOf} from './exmars.mjs';

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
 // A soup scores only the warriors it harvests, each one in full: no screened scoring there.
 const soup=job.params.scheme==='soup';
 const mode=scoringMode(config,usable.map(o=>o.source),soup&&job.scoring?.mode==='screen'?{...job.scoring,mode:'auto'}:job.scoring);
 // The run's notes count the opponents that take part.
 // Screened scoring sets how scores are kept (SCREEN_PARAMS); the notes say so.
 if(mode.judge)job.params={...job.params,...SCREEN_PARAMS};
 const notes=extra=>{if(job.noteInput){const n=job.noteInput;job.notes=runNotes({...n,params:job.params,scoring:{exact:mode.exact,rounds:mode.rounds,...(mode.judge?{judge:mode.judge.rounds}:{})},
  benchmark:{...n.benchmark,opponents:usable.length,own:usable.filter(o=>o.own).length,heldOut:heldOut.length},...extra});}};
 notes({});
 const size=Math.max(1,job.workers|0);
 const pool=typeof Worker!=='undefined'&&size>1?new WorkerPool(size,new URL('./optimizer-worker.mjs',import.meta.url)):null;
 // Self fight: every warrior also fights a copy of itself, in training and held-out scores alike.
 const options={selfFight:!!job.selfFight};
 const evaluator=new Evaluator({runBatch:pool?((j,token)=>pool.run(j,token)):runBatch,config,opponents,options,seed:job.seed});
 evaluator.setMode(mode);
 // Screened: the leaders' exact scores pick the best warrior, and the held-out score is exact too.
 const judge=mode.judge?new Evaluator({runBatch:pool?((j,token)=>pool.run(j,token)):runBatch,config,opponents,options,seed:job.seed}):null;
 judge?.setMode(mode.judge);
 const validator=heldOut.length?new Evaluator({runBatch:pool?((j,token)=>pool.run(j,token)):runBatch,config,opponents:heldOut,options,seed:job.seed+':held-out'}):null;
 validator?.setMode(mode.judge??mode);
 Object.assign(r,{pool,evaluator,validator,judge});
 try{
  const seeds=[...(job.seedGenomes||[]),...await assembleSeeds(job.seedSources||[],own)];
  // A kept structure is the first seed's opcodes; new code then has them, so no Markov chain.
  if(job.params.keepStructure&&seeds.length)notes({structure:structureText(structureOf(seeds[0]))});
  const model=job.markov&&!job.params.keepStructure?await opponentModel(opponents,own):null;
  if(model&&!model.warriors)throw new Error('None of the opponents assembled for these settings, so there is no Markov chain to draw from.');
  // Known warriors that new ones may not copy, assembled for these settings.
  let known=[];
  if(job.known?.length&&job.params.avoidKnown&&job.params.avoidKnown!=='off'){
   const {assembleKnown}=await import('./evolver-similar.mjs');
   ({known}=await assembleKnown(job.known.map(w=>({...w,hill:{...config,...(w.hill||{})}}))));
   if(r.state==='stopped'||run!==r)return;
  }
  const setup={evaluator,judge,config:own,params:job.params,seeds,seed:job.seed,name:job.name||'Evolved',model,notes:job.notes||[],before:job.before||0,known};
  r.evolution=soup?new SoupEvolution({...setup,duel:duels(pool,config),layout:job.seedLayout||null}):new Evolution(setup);
  const engine=plannedEngine(config,mode);
  post({type:'started',why:mode.why,exact:mode.exact,rounds:mode.rounds,engine:engine.engine,engineWhy:engine.why,workers:pool?size:1,nested:!!pool||size===1,
   markov:model&&{warriors:model.warriors,instructions:model.instructions,shapes:model.shapes,skipped:opponents.length-model.warriors},
   training:opponents.map(o=>o.name),heldOut:heldOut.map(o=>o.name),excluded,known:known.length});
  const first=await r.evolution.init();
  if(r.state==='stopped'||run!==r)return;
  await report(r,first);if(r.state==='stopped'||run!==r)return;
  const limit=job.params.generations>0?job.params.generations:Infinity;
  while(run===r&&r.state!=='stopped'){
   if(r.state==='paused'){post({type:'paused',generation:r.evolution.generation,elapsed:r.elapsed});await new Promise(resolve=>{r.wake=resolve;});continue;}
   // Generations: how many this run adds to where it started.
   if(r.evolution.generation-r.evolution.before>=limit){finish(r,`Finished ${limit} generations${r.evolution.before?`, up to generation ${r.evolution.generation}`:''}.`);return;}
   const stats=await r.evolution.step();
   if(r.state==='stopped'||run!==r)return;
   await report(r,stats);
  }
 }catch(error){
  if(r.state==='stopped')return;
  r.state='stopped';pool?.terminate();post({type:'error',message:error.message});
 }
}
// The soup's duels: random placements from the soup's own random numbers (so a run repeats with any
// number of workers), shared out over the pool in one job per worker.
function duels(pool,config){
 const sep=separationOf(config),span=config.coreSize-2*sep+1;
 return async(list,rounds,rand)=>{
  const positions=list.map(()=>String(sep+1+rand.below(span-1))),parts=pool?Math.min(pool.size,list.length):1,size=Math.ceil(list.length/Math.max(1,parts));
  const jobs=[];for(let s=0;s<list.length;s+=size)jobs.push({config,duels:list.slice(s,s+size),rounds,positions:positions.slice(s,s+size)});
  const results=await Promise.all(jobs.map(j=>pool?pool.run(j):runDuels(j)));
  return results.flatMap((r,k)=>Array.isArray(r)&&r.length===jobs[k].duels.length?r:Array(jobs[k].duels.length).fill(null));
 };
}
function elapsed(r){return r.elapsed+(r.state==='running'?Date.now()-r.resumedAt:0);}
async function report(r,stats){
 const e=r.evolution,b=e.best;
 // The best warrior on the held-out opponents, scored again only when the best changes.
 if(r.validator&&b&&r.validatedKey!==b.key){r.validation=await r.validator.evaluate(e.source(b.genome));r.validatedKey=b.key;}
 if(r.validation)stats={...stats,heldOut:r.validation.score};
 const engines={...r.evaluator.engines};if(r.judge)for(const k in engines)engines[k]+=r.judge.engines[k];
 post({type:'generation',stats,elapsed:elapsed(r),matches:r.evaluator.matches+(r.judge?.matches??0)+(e.duels??0),engines:engineSummary(engines),cached:r.evaluator.cached,invalid:r.evaluator.invalid,
  best:b?{source:e.bestSource(r.job.benchmarkName,{heldOut:r.validation?.score??null}),score:b.score,se:b.se,generation:b.generation,length:b.genome.code.length,opponents:b.result?.opponents??[],
   heldOut:r.validation?{score:r.validation.score,se:r.validation.se,opponents:r.validation.opponents}:null}:null,
  population:e.snapshot(),scores:e.view().map(m=>m.score),ranked:e.view().map(m=>m.genome),radius:e.nicheRadius,
  // Niches by results: the population view groups by these instead of by code.
  profiles:e.profiles(),
  // A soup: the grid, row by row (the population view draws it as a grid).
  ...(e.grid?{grid:e.grid,bestFirst:e.bestFirst()}:{})});
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

// SPDX-License-Identifier: GPL-2.0-or-later
// How fast the optimizer's and evolver's Evaluator scores one warrior: exact nano scoring of one
// Metcalf Nano 2007 warrior against 50 others, by the raw exMARS fighter (the floor), by runMatch
// per opponent, and by the Evaluator inline and through worker pools. Prints ms per evaluation.
//   deno run -A docs/bench-evaluator.mjs [reps]
import {readFileSync} from 'node:fs';
import * as fitness from './optimizer-fitness.mjs';
import {hillOf} from './exmars.mjs';
import {assemble,createFighter} from './dist/exmars/fighter-client.mjs';

const {Evaluator,WorkerPool,runMatch,scoringMode}=fitness,runBatch=fitness.runBatch;
const reps=Number(process.argv[2])||20;
const dir=new URL('../warriors_public/nanobm07/',import.meta.url);
const suite=JSON.parse(readFileSync(new URL('suite.benchmark.json',dir),'utf8'));
const all=suite.warriors.map(f=>({name:f,source:readFileSync(new URL(f,dir),'latin1')}));
const config={coreSize:80,cycles:800,tasks:80,maxLength:5,distance:5,pspace:5,rules88:false,noPspace:false,formula:'(W*W-1)/S'};
const candidate=all[0],opponents=all.slice(1,51);
const mode=scoringMode(config,[]);
const time=async(label,fn,n=reps,scale=1)=>{await fn();const t=performance.now();for(let i=0;i<n;i++)await fn();const ms=(performance.now()-t)/n*scale;console.log(`${label.padEnd(44)} ${ms.toFixed(1).padStart(7)} ms`);return ms;};
const results={};

// The floor: the fighter alone, every warrior assembled and loaded once.
{
 const hill=hillOf(config),fighter=await createFighter(hill),load=async s=>fighter.load(await assemble(s,hill,{rounds:mode.rounds}));
 const a=await load(candidate.source),bs=[];for(const o of opponents)bs.push(await load(o.source));
 results.wasm=await time('wasm fighter.exact x50',()=>{for(const b of bs)fighter.exact(a,b,{position:0});});
}
results.runMatch=await time('runMatch x50',async()=>{for(const o of opponents)await runMatch({config,a:candidate.source,b:o.source,rounds:mode.rounds,permutate:true});});
const evaluator=extra=>{const e=new Evaluator({config,opponents,...extra});e.setMode(mode);return e;};
results.perMatch=await time('Evaluator, a job per match, inline',()=>evaluator({runJob:runMatch}).exact(candidate.source));
if(runBatch)results.batch=await time('Evaluator, a job per candidate, inline',()=>evaluator({runBatch}).exact(candidate.source));
const url=new URL('./optimizer-worker.mjs',import.meta.url);
{
 const pool=new WorkerPool(1,url),e=evaluator({runJob:j=>pool.run(j)});
 results.pool1=await time('Evaluator, 1 worker, a message per match',()=>e.exact(candidate.source));
 if(runBatch){const b=evaluator({runBatch:j=>pool.run(j)});results.pool1batch=await time('Evaluator, 1 worker, a message per candidate',()=>b.exact(candidate.source));}
 pool.terminate();
}
// Throughput: a generation of 40 candidates (copies, scored without the cache) over several workers.
const workers=Math.max(2,Math.min(8,(navigator.hardwareConcurrency||4)-1));
{
 const pool=new WorkerPool(workers,url),gen=40;
 const run=async e=>{await Promise.all(Array.from({length:gen},()=>e.exact(candidate.source)));};
 const per=(label,e)=>time(label,()=>run(e),Math.max(1,reps>>2),workers/gen);
 results.poolN=await per(`${workers} workers x 40 candidates, per match`,evaluator({runJob:j=>pool.run(j)}));
 if(runBatch)results.poolNbatch=await per(`${workers} workers x 40 candidates, per candidate`,evaluator({runBatch:j=>pool.run(j)}));
 // One candidate at a time (annealing, the held-out score): split over the workers when they would sit idle.
 if(runBatch)results.split=await time(`${workers} workers, one candidate (split)`,()=>evaluator({runBatch:j=>pool.run(j)}).exact(candidate.source));
 pool.terminate();
}
console.log('("workers x 40": ms per evaluation per worker, the wall time of the generation x workers / 40)');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,+v.toFixed(1)]))));

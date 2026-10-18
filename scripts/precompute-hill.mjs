// SPDX-License-Identifier: GPL-2.0-or-later
// Precompute a benchmark suite's hill scores (every suite warrior against every other, self
// fights included) and save them as hill-scores.json next to the suite's descriptor, so push-off
// benchmarks in the app only fight the candidates.
//
//   node scripts/precompute-hill.mjs warriors_public/94top50 [--rounds 1000] [--all-positions]
//        [--workers 8] [--seed hill-1] [--exmars <exmars-fast.exe or bundle folder>] [--yes]
//
// Defaults: 1000 rounds per pair on cores above 1000 cells, every starting position otherwise.
// The default engine is the app's own (docs/engine.mjs). --exmars runs an exMARS executable
// instead, about 2.5 times faster; it has no permutation or '88 assembly mode (see below).
import {readFile,writeFile,rename,readdir,stat,mkdtemp,rm} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {availableParallelism,tmpdir} from 'node:os';
import path from 'node:path';
import {readBenchmark} from '../docs/benchmarks.mjs';
import {hillJobs} from '../docs/tournament-plan.mjs';
import {defaultHillRounds,permutationRounds,writeHillScores} from '../docs/hill-scores.mjs';
import {koenScore} from '../docs/pushoff.mjs';

const valued=['--rounds','--workers','--seed','--exmars'];
const args=process.argv.slice(2),flag=name=>args.includes(name),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const target=args.find((a,i)=>!a.startsWith('--')&&!valued.includes(args[i-1]));
if(!target){console.error('Usage: node scripts/precompute-hill.mjs <suite folder or .benchmark.json> [--rounds N] [--all-positions] [--workers N] [--seed S] [--exmars PATH] [--yes]');process.exit(2);}
const withoutBom=text=>text.charCodeAt(0)===0xFEFF?text.slice(1):text;
const descriptorPath=(await stat(target)).isDirectory()?path.join(target,(await readdir(target)).find(f=>f.endsWith('.benchmark.json'))??''):target;
const folder=path.dirname(descriptorPath);
// Rewriting the descriptor keeps its line endings (supplied suites use CRLF).
const descriptorText=withoutBom(await readFile(descriptorPath,'utf8')),eol=descriptorText.includes('\r\n')?'\r\n':'\n';
const descriptor=JSON.parse(descriptorText);
// Same decoding as scripts/benchmark_catalog.py: UTF-8, else Windows-1252.
const decode=bytes=>{try{return withoutBom(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return new TextDecoder('windows-1252').decode(bytes);}};
const files=Object.fromEntries(await Promise.all(descriptor.warriors.map(async file=>[file,decode(await readFile(path.join(folder,file)))])));
const {scores:_,...plain}=descriptor;
const suite=readBenchmark(plain,files,'precompute'),config=suite.config;

const defaults=defaultHillRounds(config),permutate=flag('--all-positions')||(!option('--rounds')&&defaults.permutate);
const rounds=permutate?permutationRounds(config):Number(option('--rounds',defaults.rounds));
const seed=option('--seed','hill-1'),workers=Math.max(1,Number(option('--workers',availableParallelism())));
const jobs=hillJobs(suite.warriors,{seed,config,rounds,permutate}),total=jobs.length*rounds;

// exMARS: P-space is always core/16 and shared, as in pMARS. It cannot run every starting
// position, cannot switch off P-space instructions, and assembles '88 warriors with the '94
// parser, whose default modifiers reproduce '88 behaviour. Checked against the built-in engine.
let exmars=option('--exmars'),engine;
if(exmars){
 if(permutate){console.error('exMARS cannot fight every starting position. Use the built-in engine (no --exmars) or --rounds N.');process.exit(2);}
 // Cross-checked on the Koenigstuhl hills with shared -F seeds: '94nop and '88 matched pMARS in every
 // cell, but 13% of the P-space hill's cells differed by a few points, so P-space suites stay on pMARS.
 if(!config.noPspace&&!config.rules88){console.error('exMARS differs from pMARS in P-space battles. Use the built-in engine (no --exmars) for this suite.');process.exit(2);}
 if(config.pspace&&config.pspace!==Math.max(1,Math.floor(config.coreSize/16))){console.error(`exMARS always uses P-space ${Math.floor(config.coreSize/16)}; this suite sets ${config.pspace}.`);process.exit(2);}
 if((await stat(exmars)).isDirectory())exmars=path.join(exmars,'bin',config.coreSize===8000&&config.tasks===8000?'standard':'generic','exmars-fast.exe');
 if(config.rules88)console.warn('Note: exMARS has no ICWS ’88 mode; the warriors are assembled with ’94 defaults, which give ’88 behaviour.');
 engine='exmars '+createHash('sha256').update(await readFile(exmars)).digest('hex').slice(0,16);
}else engine='pmars-wasm '+(JSON.parse(await readFile(new URL('../engine-lock.json',import.meta.url),'utf8')).commit||'');
console.log(`${suite.name}: ${suite.warriors.length} warriors, ${jobs.length.toLocaleString()} pairs × ${rounds.toLocaleString()} rounds${permutate?' (every starting position)':''} = ${total.toLocaleString()} rounds on ${workers} workers with ${exmars?path.basename(path.dirname(exmars))+' exMARS':'the built-in engine'}.`);
if(total>20_000_000&&!flag('--yes')){console.error('That is a very large run. Pass --yes to start it, or lower --rounds.');process.exit(1);}

const n=suite.warriors.length,matrix=Array.from({length:n},()=>Array(n).fill(null));
const started=Date.now();let next=0,done=0;
function record(job,completed,[x,y]){
 matrix[job.i][job.j]=koenScore(x.wins,x.ties,completed);if(job.i!==job.j)matrix[job.j][job.i]=koenScore(y.wins,y.ties,completed);
 if(++done%Math.max(1,Math.floor(jobs.length/20))===0||done===jobs.length){const elapsed=(Date.now()-started)/1000;console.log(`${done}/${jobs.length} pairs · ${Math.round(elapsed)} s · about ${Math.round(elapsed/done*(jobs.length-done))} s left`);}
}

if(exmars){
 const scratch=await mkdtemp(path.join(tmpdir(),'hill-'));
 try{
  const paths=await Promise.all(suite.warriors.map(async(w,i)=>{const file=path.join(scratch,i+'.red');await writeFile(file,w.source);return file;}));
  const run=job=>new Promise((resolve,reject)=>{
   // The job's numeric -F: exMARS places warriors exactly like pMARS for the same value.
   const argv=['-s',config.coreSize,'-c',config.cycles,'-p',config.tasks,'-l',config.maxLength,'-d',config.distance||config.maxLength,'-r',rounds,'-F',job.config.fixedPosition,paths[job.i],paths[job.j]].map(String);
   execFile(exmars,argv,{windowsHide:true},(error,stdout,stderr)=>{
    const rows=stdout.trim().split(/\r?\n/).map(line=>line.trim().split(/\s+/).map(Number));
    if(error||rows.length<2||rows.some(r=>r.length<2||r.some(Number.isNaN)))return reject(new Error(`${job.warriors.map(w=>w.file).join(' vs ')}: ${stderr||stdout||error?.message}`));
    record(job,rounds,rows.slice(0,2).map(([wins,ties])=>({wins,ties})));resolve();
   });
  });
  await Promise.all(Array.from({length:Math.min(workers,jobs.length)},async()=>{while(next<jobs.length)await run(jobs[next++]);}));
 }finally{await rm(scratch,{recursive:true,force:true});}
}else{
 await Promise.all(Array.from({length:Math.min(workers,jobs.length)},()=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./precompute-worker.mjs',import.meta.url));
  const send=()=>{if(next>=jobs.length){worker.terminate().then(resolve);return;}const job=jobs[next++];worker.job=job;worker.postMessage({config:job.config,sources:job.warriors.map(w=>w.source)});};
  worker.on('message',result=>{
   if(result.error){worker.terminate();reject(new Error(`${worker.job.warriors.map(w=>w.file).join(' vs ')}: ${result.error}\n${result.diagnostics}`));return;}
   record(worker.job,result.completed,result.warriors);send();
  });
  worker.on('error',reject);send();
 })));
}

const output=writeHillScores(suite,{rounds,permutate,seed,createdAt:new Date().toISOString().slice(0,10),engine,scores:matrix});
const scoresPath=path.join(folder,descriptor.scores||'hill-scores.json');
await writeFile(scoresPath+'.tmp',JSON.stringify(output)+'\n');await rename(scoresPath+'.tmp',scoresPath);
if(!descriptor.scores){descriptor.scores='hill-scores.json';await writeFile(descriptorPath,(JSON.stringify(descriptor,null,2)+'\n').replace(/\n/g,eol));console.log(`Added "scores": "hill-scores.json" to ${descriptorPath}.`);}
console.log(`Saved ${scoresPath}. Rebuild with python scripts/build.py to ship it.`);

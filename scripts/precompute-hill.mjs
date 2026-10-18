// SPDX-License-Identifier: GPL-2.0-or-later
// Precompute a benchmark suite's hill scores (every suite warrior against every other, self
// fights included) and save them as hill-scores.json next to the suite's descriptor, so push-off
// benchmarks in the app only fight the candidates.
//
//   node scripts/precompute-hill.mjs warriors_public/94top50 [--rounds 1000] [--all-positions]
//        [--workers 8] [--seed hill-1] [--exmars <exmars-fast.exe or bundle folder>] [--verify N] [--yes]
//
// Defaults: 1000 rounds per pair on cores above 1000 cells, every starting position otherwise.
// The default engine is the app's own (docs/engine.mjs). --exmars runs an exMARS executable
// for pairs without P-space, about three times faster; --verify N rechecks N of them on pMARS.
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

const valued=['--rounds','--workers','--seed','--exmars','--verify'];
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
// position, and assembles '88 warriors with the '94 parser, whose default modifiers reproduce
// '88 behaviour. Cross-checked with shared -F seeds: the '94nop and '88 Koenigstuhl hills matched
// pMARS in every cell, but 13% of the P-space hill's cells differed. So pairs where either warrior
// uses P-space (LDP, STP or PIN) always run on the built-in engine; exMARS runs the rest.
// Other differences exist (LP hill: Bipolar, without P-space), so use --verify with --exmars.
const usesPspace=source=>/(^|\s)(ldp|stp|pin)(\.[a-z]+)?(\s|$)/im.test(source.split(/\r?\n/).map(line=>line.replace(/;.*/,'')).join('\n'));
let exmars=option('--exmars'),engine='pmars-wasm '+(JSON.parse(await readFile(new URL('../engine-lock.json',import.meta.url),'utf8')).commit||'');
let exmarsJobs=[],builtinJobs=jobs;
if(exmars){
 if(permutate){console.error('exMARS cannot fight every starting position. Use the built-in engine (no --exmars) or --rounds N.');process.exit(2);}
 if(config.pspace&&config.pspace!==Math.max(1,Math.floor(config.coreSize/16))){console.error(`exMARS always uses P-space ${Math.floor(config.coreSize/16)}; this suite sets ${config.pspace}.`);process.exit(2);}
 if((await stat(exmars)).isDirectory())exmars=path.join(exmars,'bin',config.coreSize===8000&&config.tasks===8000?'standard':'generic','exmars-fast.exe');
 if(config.rules88)console.warn('Note: exMARS has no ICWS ’88 mode; the warriors are assembled with ’94 defaults, which give ’88 behaviour.');
 const pspace=suite.warriors.map(w=>usesPspace(w.source));
 exmarsJobs=jobs.filter(j=>!pspace[j.i]&&!pspace[j.j]);builtinJobs=jobs.filter(j=>pspace[j.i]||pspace[j.j]);
 const exmarsId='exmars '+createHash('sha256').update(await readFile(exmars)).digest('hex').slice(0,16);
 engine=builtinJobs.length?`${exmarsId} + ${engine} for P-space pairs`:exmarsId;
 console.log(`${pspace.filter(Boolean).length} warriors use P-space: ${builtinJobs.length.toLocaleString()} pairs on the built-in engine, ${exmarsJobs.length.toLocaleString()} on ${path.basename(path.dirname(exmars))} exMARS.`);
}
console.log(`${suite.name}: ${suite.warriors.length} warriors, ${jobs.length.toLocaleString()} pairs × ${rounds.toLocaleString()} rounds${permutate?' (every starting position)':''} = ${total.toLocaleString()} rounds on ${workers} workers.`);
if(total>20_000_000&&!flag('--yes')){console.error('That is a very large run. Pass --yes to start it, or lower --rounds.');process.exit(1);}

const n=suite.warriors.length,matrix=Array.from({length:n},()=>Array(n).fill(null));
const started=Date.now();let done=0;
function record(job,completed,[x,y]){
 matrix[job.i][job.j]=koenScore(x.wins,x.ties,completed);if(job.i!==job.j)matrix[job.j][job.i]=koenScore(y.wins,y.ties,completed);
 if(++done%Math.max(1,Math.floor(jobs.length/40))===0||done===jobs.length){const elapsed=(Date.now()-started)/1000;console.log(`${done}/${jobs.length} pairs · ${Math.round(elapsed)} s · about ${Math.round(elapsed/done*(jobs.length-done))} s left`);}
}
async function runExmars(list,onResult){
 const scratch=await mkdtemp(path.join(tmpdir(),'hill-'));
 try{
  const paths=await Promise.all(suite.warriors.map(async(w,i)=>{const file=path.join(scratch,i+'.red');await writeFile(file,w.source);return file;}));
  const run=job=>new Promise((resolve,reject)=>{
   // The job's numeric -F: exMARS places warriors exactly like pMARS for the same value.
   const argv=['-s',config.coreSize,'-c',config.cycles,'-p',config.tasks,'-l',config.maxLength,'-d',config.distance||config.maxLength,'-r',rounds,'-F',job.config.fixedPosition,paths[job.i],paths[job.j]].map(String);
   execFile(exmars,argv,{windowsHide:true},(error,stdout,stderr)=>{
    const rows=stdout.trim().split(/\r?\n/).map(line=>line.trim().split(/\s+/).map(Number));
    if(error||rows.length<2||rows.some(r=>r.length<2||r.some(Number.isNaN)))return reject(new Error(`${job.warriors.map(w=>w.file).join(' vs ')}: ${stderr||stdout||error?.message}`));
    onResult(job,rounds,rows.slice(0,2).map(([wins,ties])=>({wins,ties})));resolve();
   });
  });
  let next=0;await Promise.all(Array.from({length:Math.min(workers,list.length)},async()=>{while(next<list.length)await run(list[next++]);}));
 }finally{await rm(scratch,{recursive:true,force:true});}
}
async function runBuiltin(list,onResult){
 let next=0;
 await Promise.all(Array.from({length:Math.min(workers,list.length)},()=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./precompute-worker.mjs',import.meta.url));
  const send=()=>{if(next>=list.length){worker.terminate().then(resolve);return;}const job=list[next++];worker.job=job;worker.postMessage({config:job.config,sources:job.warriors.map(w=>w.source)});};
  worker.on('message',result=>{
   if(result.error){worker.terminate();reject(new Error(`${worker.job.warriors.map(w=>w.file).join(' vs ')}: ${result.error}\n${result.diagnostics}`));return;}
   onResult(worker.job,result.completed,result.warriors);send();
  });
  worker.on('error',reject);send();
 })));
}
if(exmarsJobs.length)await runExmars(exmarsJobs,record);
if(builtinJobs.length)await runBuiltin(builtinJobs,record);

// --verify N: rerun N random exMARS pairs on the built-in engine; any difference aborts.
const verify=Math.min(exmarsJobs.length,Number(option('--verify',0)));
if(verify){
 const sample=[...exmarsJobs].sort(()=>Math.random()-0.5).slice(0,verify),mismatches=[];
 await runBuiltin(sample,(job,completed,[x,y])=>{if(koenScore(x.wins,x.ties,completed)!==matrix[job.i][job.j]||(job.i!==job.j&&koenScore(y.wins,y.ties,completed)!==matrix[job.j][job.i]))mismatches.push(job.warriors.map(w=>w.file).join(' vs '));});
 if(mismatches.length){console.error(`exMARS differs from the built-in engine on ${mismatches.length} of ${verify} checked pairs, e.g. ${mismatches.slice(0,3).join('; ')}. Nothing saved.`);process.exit(1);}
 console.log(`Verified: ${verify} random exMARS pairs match the built-in engine exactly.`);
}

const output=writeHillScores(suite,{rounds,permutate,seed,createdAt:new Date().toISOString().slice(0,10),engine,scores:matrix});
const scoresPath=path.join(folder,descriptor.scores||'hill-scores.json');
await writeFile(scoresPath+'.tmp',JSON.stringify(output)+'\n');await rename(scoresPath+'.tmp',scoresPath);
if(!descriptor.scores){descriptor.scores='hill-scores.json';await writeFile(descriptorPath,(JSON.stringify(descriptor,null,2)+'\n').replace(/\n/g,eol));console.log(`Added "scores": "hill-scores.json" to ${descriptorPath}.`);}
console.log(`Saved ${scoresPath}. Rebuild with python scripts/build.py to ship it.`);

// SPDX-License-Identifier: GPL-2.0-or-later
// Past runs of the Tournaments tab, kept in this browser so earlier results can be shown again,
// run again or used as the setup of a new run. A record holds what planTournament needs to plan
// the run again (the warriors' sources, the opponents, the settings and options) and the results,
// not the plan's jobs, which can be many and are the same each time they are planned.
import {planTournament} from './tournament-plan.mjs';

// The newest runs kept; saving another drops the oldest.
export const HISTORY_LIMIT=30;
const keepWarrior=({id,name,file,source,colorIndex,fromSuite})=>({id,name,file:file??null,source,...(colorIndex!==undefined&&{colorIndex}),...(fromSuite&&{fromSuite})});

// setup: what the plan does not record ({selfFights, withSuite, challenger, ranking, suiteId, suiteName}).
// samples: the score chart's points. Hill fights are left out; their scores are kept as hillData.
// hillData: the hill scores the results were ranked with, when not run.hillData.
export function snapshotRun(run,{id,savedAt=new Date().toISOString(),setup,samples=[],hillData=run.hillData}){
 const plan=run.plan,hill=new Set(plan.jobs.filter(j=>j.kind==='hill').map(j=>j.id));
 const entrants=plan.entrants.filter(w=>!w.fromSuite).map(keepWarrior);
 const opponents=plan.mode==='benchmark'?(run.suite?.warriors||[]).map(keepWarrior):setup.withSuite?plan.entrants.filter(w=>w.fromSuite).map(keepWarrior):[];
 return {version:1,id,savedAt,state:run.state,
  setup:{mode:plan.mode,rounds:plan.rounds,seed:plan.seed,pushoff:!!plan.pushoff,hillRounds:plan.hillRounds,hillPermutate:!!plan.hillPermutate,...setup},
  config:run.config,entrants,opponents,suiteName:run.suite?.name??setup.suiteName??null,
  results:run.results.filter(r=>!hill.has(r.id)).map(({id,completed,engine,fallback,warriors})=>({id,completed,engine,...(fallback&&{fallback}),warriors:warriors.map(({wins,ties,losses,score})=>({wins,ties,losses,score}))})),
  excluded:run.excluded.map(({id,name,source,reason})=>({id,name,source,reason})),
  skipped:run.skipped.filter(id=>!hill.has(id)),
  variant:run.variant??null,hillData:hillData?{...hillData}:null,
  elapsed:run.elapsed,samples:samples.map(({x,values})=>({x,values:[...values]}))};
}

// The plan of a record, as Start would make it. hill: also schedule the hill fights.
export function replan(record,{hill=false}={}){
 const s=record.setup;
 const plan=planTournament({mode:s.mode,entrants:record.entrants,opponents:record.opponents,withSuite:!!s.withSuite,challenger:s.challenger,
  rounds:s.rounds,seed:s.seed,config:record.config,selfFights:!!s.selfFights,pushoff:s.pushoff,hill,hillRounds:s.hillRounds??s.rounds,hillPermutate:!!s.hillPermutate});
 if(!hill&&s.pushoff)Object.assign(plan,{hillRounds:s.hillRounds,hillPermutate:!!s.hillPermutate});
 return plan;
}

// A finished run again, to show its results.
export function restoreRun(record){
 const plan=replan(record);
 return {plan,config:record.config,results:record.results.map(r=>({...r,type:'done'})),excluded:record.excluded.map(e=>({...e})),skipped:[...record.skipped],
  next:plan.jobs.length,state:record.state,elapsed:record.elapsed||0,since:null,workers:0,
  ...(plan.mode==='benchmark'&&{suite:{name:record.suiteName,warriors:record.opponents}}),
  ...(plan.pushoff&&{variant:record.variant,hillKey:null,hillData:record.hillData}),
  restored:{id:record.id,savedAt:record.savedAt}};
}

// What the list shows. top: the best warriors by score per 100 rounds (and place in a push-off).
export function summarize(record,{top=[],settings=''}={}){
 const s=record.setup;
 return {id:record.id,savedAt:record.savedAt,state:record.state,mode:s.mode,pushoff:s.pushoff,variant:record.variant,ranking:s.ranking,
  suiteName:s.mode==='benchmark'||s.withSuite?record.suiteName:null,opponents:record.opponents.length,
  entrants:record.entrants.map(w=>w.name),rounds:s.rounds,seed:s.seed,settings,top,
  matchups:record.results.length};
}

// IndexedDB: summaries for the list and the full records apart, so listing stays quick.
// Without storage (private windows, blocked site data) the history lasts until the page reloads.
const DB='corewar-run-history';
function open(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('summaries',{keyPath:'id'});db.createObjectStore('runs',{keyPath:'id'});};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
export function createRunHistory({limit=HISTORY_LIMIT,storage=globalThis.indexedDB?open:null}={}){
 const memory={summaries:new Map(),runs:new Map()};let persistent=!!storage;
 async function transact(mode,work){
  const db=await storage();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(['summaries','runs'],mode),out=work(tx.objectStore('summaries'),tx.objectStore('runs'));
   tx.oncomplete=()=>{db.close();resolve(out?.result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};
  });
 }
 const newest=list=>list.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
 async function list(){
  if(persistent)try{return newest(await transact('readonly',summaries=>summaries.getAll()));}catch{persistent=false;}
  return newest([...memory.summaries.values()]);
 }
 async function get(id){
  if(persistent)try{return await transact('readonly',(_,runs)=>runs.get(id))??null;}catch{persistent=false;}
  return memory.runs.get(id)??null;
 }
 async function remove(ids){
  ids=[].concat(ids);
  for(const id of ids){memory.summaries.delete(id);memory.runs.delete(id);}
  if(persistent)try{await transact('readwrite',(summaries,runs)=>{for(const id of ids){summaries.delete(id);runs.delete(id);}});}catch{persistent=false;}
 }
 // Saves a record (replacing one with the same id) and drops the oldest beyond the limit.
 // Returns the ids dropped. Throws when the browser refuses to store it (quota).
 async function save(record,summary){
  memory.summaries.set(record.id,summary);memory.runs.set(record.id,record);
  if(persistent)try{await transact('readwrite',(summaries,runs)=>{summaries.put(summary);runs.put(record);});}
  catch(error){if(error?.name==='QuotaExceededError'){await remove(record.id);throw new Error('This browser has no room to keep this run. Delete some past runs and try again.');}persistent=false;}
  const old=(await list()).slice(limit).map(s=>s.id);if(old.length)await remove(old);
  return old;
 }
 return {list,get,save,remove,get persistent(){return persistent;}};
}

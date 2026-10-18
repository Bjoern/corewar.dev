// SPDX-License-Identifier: GPL-2.0-or-later
// Hill score matrices for push-off benchmarks: the suite warriors' results against
// each other, stored as per-round Koenigstuhl scores (see pushoff.mjs) so they can be
// combined with candidate fights run at any number of rounds.

// Settings that change who wins. Rounds, seed, permutation and score formula only change
// how starting positions are sampled or how points are counted, so they are recorded, not keyed.
export const matchParameters=['coreSize','cycles','tasks','maxLength','distance','pspace','rules88','noPspace'];
export const hillParameters=config=>Object.fromEntries(matchParameters.map(k=>[k,config[k]]));
export const sameParameters=(a,b)=>matchParameters.every(k=>a[k]===b[k]);

// Rounds that cover every legal starting position once, for both first-warrior choices.
export const permutationRounds=c=>2*(c.coreSize-2*(c.distance||c.maxLength)+1);
// Default hill fights: 1000 random rounds on large cores, every position on small ones.
export function defaultHillRounds(config){
 return config.coreSize>1000?{rounds:1000,permutate:false}:{rounds:permutationRounds(config),permutate:true};
}

// FNV-1a: stable, synchronous ids for placement keys (not for security).
export function sourceId(source){let h=0x811c9dc5;for(let i=0;i<source.length;i++){h^=source.charCodeAt(i);h=Math.imul(h,0x01000193);}return (h>>>0).toString(36);}

export async function cacheKey(warriors,config,engine=''){
 const text=JSON.stringify({parameters:hillParameters(config),engine,sources:warriors.map(w=>w.source)});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Shipped or downloaded file: {version, rounds, seed, createdAt, parameters, warriors:[paths], scores:[[...]]}
export function readHillScores(data,suite){
 if(!data||data.version!==1)throw new Error('Hill scores must have version: 1.');
 const n=suite.warriors.length;
 if(!Array.isArray(data.warriors)||data.warriors.length!==n||data.warriors.some((file,i)=>file!==suite.warriors[i].file))throw new Error('Hill scores list different warriors than the suite.');
 if(!Array.isArray(data.scores)||data.scores.length!==n||data.scores.some(row=>!Array.isArray(row)||row.length!==n||row.some(x=>!Number.isInteger(x)||x<0||x>3e6)))throw new Error(`Hill scores need a ${n}×${n} matrix of integers from 0 to 3000000.`);
 if(!Number.isInteger(data.rounds)||data.rounds<1)throw new Error('Hill scores need a positive rounds count.');
 if(!data.parameters||!sameParameters(data.parameters,suite.config))throw new Error('Hill scores were computed with different match settings than the suite.');
 return {rounds:data.rounds,permutate:data.permutate===true,seed:String(data.seed??''),createdAt:String(data.createdAt??''),engine:String(data.engine??''),scores:data.scores.map(r=>[...r]),source:'suite'};
}
export function writeHillScores(suite,hill){
 return {version:1,rounds:hill.rounds,permutate:!!hill.permutate,seed:hill.seed,createdAt:hill.createdAt,engine:hill.engine||'',parameters:hillParameters(suite.config),warriors:suite.warriors.map(w=>w.file),scores:hill.scores};
}

// The candidate is appended as the last warrior. keep lists the hill indices to use.
export function withCandidate(hill,keep,row,column,self){
 const m=keep.map(i=>[...keep.map(j=>hill[i][j]),column[i]]);
 m.push([...keep.map(j=>row[j]),self]);
 return m;
}

// Browser cache (IndexedDB); falls back to memory when storage is unavailable.
const memory=new Map();
function database(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('corewar-hill-scores',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('matrices');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
async function transact(mode,work){
 const db=await database();
 return new Promise((resolve,reject)=>{const tx=db.transaction('matrices',mode),request=work(tx.objectStore('matrices'));tx.oncomplete=()=>{db.close();resolve(request.result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};});
}
export async function loadCached(key){
 if(memory.has(key))return memory.get(key);
 try{const value=await transact('readonly',store=>store.get(key));if(value)memory.set(key,value);return value??null;}catch{return null;}
}
export async function saveCached(key,value){
 memory.set(key,value);
 try{await transact('readwrite',store=>store.put(value,key));}catch{}
}

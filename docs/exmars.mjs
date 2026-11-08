// SPDX-License-Identifier: GPL-2.0-or-later
// exMARS for headless matches of 2 to 36 warriors (Tournaments and Tools). exMARS gives the
// same results as pMARS round for round (exmars-lock.json; tested in test-exmars.mjs) and is
// several times faster, and its fighter stays loaded, so a warrior is assembled once per worker.
// It runs a match only when the result is the same as pMARS's: ICWS '94, the default P-space
// size, a numeric or no placement seed, a score formula in W and S (scored here from exMARS's
// survivor counts, as pMARS scores them: score-formula.mjs), and a permutation only when it
// covers every position (exMARS's exact mode, pMARS's -P: one match, so P-space persists between
// its rounds, and the placement seed orders them as -F does). Everything else, and anything the
// fighter refuses, runs on pMARS as before.
import {defaults} from './settings.mjs';
import {formulaTable,scoreFrom} from './score-formula.mjs';

const LDP=16,STP=17; // exMARS opcode numbers (dist/exmars/README: instruction encoding)
export const ENGINE_NAMES={exmars:'exMARS',pmars:'pMARS'};
export const separationOf=c=>c.distance||c.maxLength;
export const permutationRoundsOf=c=>2*(c.coreSize-2*separationOf(c)+1);
// pMARS's default P-space: the largest coreSize/i for i = 16 … 1 that divides the core.
function pmarsPspace(c){if(c.pspace)return c.pspace;for(let i=16;i>0;i--)if(c.coreSize%i===0)return c.coreSize/i;return c.coreSize;}

// Why these settings need pMARS, or null when exMARS gives the same result.
export function exmarsBlocker(config){
 const c={...defaults,...config};
 if(c.warriors<2||c.warriors>36)return 'a single warrior';
 if(c.rules88)return 'ICWS ’88 rules';
 if(!formulaTable(c.formula,c.warriors))return 'a score formula with other registers or an error';
 if(c.warriors*separationOf(c)>c.coreSize)return 'warriors that do not fit the core';
 if(c.coreSize>65535)return 'a core above 65535';
 if(separationOf(c)<c.maxLength)return 'a minimum distance below the warrior length';
 if(2*separationOf(c)>c.coreSize)return 'a minimum distance above half the core';
 // On a no-P-space hill (94nop uses -S 1) the size matters only to sources that name PSPACESIZE; run() checks.
 if(!c.noPspace&&pmarsPspace(c)!==Math.floor(c.coreSize/16))return 'a P-space size other than core size / 16';
 if(c.fixedSeries)return 'a fixed series';
 if(c.rounds<1)return 'no rounds';
 const position=positionBlocker(c,c.fixedPosition);if(position)return position;
 if(c.permutate&&c.rounds!==permutationRoundsOf(c))return 'a permutation of fewer rounds than positions';
 return null;
}
// Why exMARS can't read this placement seed (for settings c), or null.
function positionBlocker(c,position){
 if(position===''||position==null)return null;
 const p=Number(position);
 // Two warriors: the second one's offset. A melee: any seed pMARS takes, up to 2^30.
 const max=c.warriors>2?2**30:c.coreSize-separationOf(c);
 return !/^\d+$/.test(String(position).trim())||p<separationOf(c)||p>max?'a placement seed exMARS does not read':null;
}
export const hillOf=c=>({coreSize:c.coreSize,cycles:c.cycles,processes:c.tasks,maxLength:c.maxLength,minDistance:separationOf(c)});
// The fighter's settings as a short id, to tell when they change.
const hillId=h=>`${h.coreSize}/${h.cycles}/${h.processes}/${h.maxLength}/${h.minDistance}`;
const usesPspace=w=>w.pin!==null||w.instructions.some(i=>i[0]===LDP||i[0]===STP);

// One per worker. run() returns pMARS-shaped results, or {fallback: reason} when pMARS must run
// the match (assembly errors are reported by pMARS, with its messages).
export class ExmarsRunner{
 constructor({maxWarriors=2000,moduleUrl=new URL('./dist/exmars/fighter-client.mjs',import.meta.url).href}={}){this.maxWarriors=maxWarriors;this.moduleUrl=moduleUrl;this.client=null;this.fighter=null;this.hillKey='';this.loaded=new Map();}
 async #load(){this.client??=await import(this.moduleUrl);return this.client;}
 async #fighterFor(hill){
  const key=hillId(hill),{createFighter}=await this.#load();
  // Other settings, or a full cache, start over: configure() drops every loaded warrior.
  if(!this.fighter){this.fighter=await createFighter(hill);this.loaded.clear();}
  else if(key!==this.hillKey||this.loaded.size>=this.maxWarriors){this.fighter.configure(hill);this.loaded.clear();}
  this.hillKey=key;return this.fighter;
 }
 // The ROUNDS constant takes the match's round count, as in pMARS.
 #cached(source,rounds){return this.loaded.get(rounds+'\0'+source);}
 async #warrior(source,hill,rounds){
  const key=rounds+'\0'+source;
  if(this.loaded.has(key))return this.loaded.get(key);
  const {assemble}=await this.#load(),w=await assemble(source,hill,{rounds});
  const entry=w.ok?{ok:true,handle:this.fighter.load(w),name:w.name,pspace:usesPspace(w)}:{ok:false};
  this.loaded.set(key,entry);return entry;
 }
 // onAssembled() is called once every warrior is loaded, before the fight.
 async run(config,sources,{onAssembled=()=>{}}={}){
  const c={...defaults,...config},blocker=exmarsBlocker({...c,warriors:sources.length});
  if(blocker)return {fallback:blocker};
  if(sources.length!==c.warriors||sources.some(s=>typeof s!=='string'))return {fallback:'a warrior count other than the settings'};
  if(c.noPspace&&pmarsPspace(c)!==Math.floor(c.coreSize/16)&&sources.some(s=>/PSPACESIZE/i.test(s)))return {fallback:'PSPACESIZE with another P-space size'};
  const hill=hillOf(c),table=formulaTable(c.formula,sources.length);
  try{
   await this.#fighterFor(hill);
   const list=[];for(const source of sources)list.push(await this.#warrior(source,hill,c.rounds));
   if(list.some(w=>!w.ok))return {fallback:'assembly'};
   const pspace=list.some(w=>w.pspace);
   if(c.noPspace&&pspace)return {fallback:'P-space on a no-P-space hill'};
   onAssembled();
   const position=c.fixedPosition?Number(c.fixedPosition):0;
   // Per warrior: rounds it ended dead, then alive with 1, 2, … n survivors.
   let histograms;
   if(list.length>2)histograms=this.fighter.fightMany(list.map(w=>w.handle),{rounds:c.rounds,position}).results;
   else{
    const [a,b]=list,r=c.permutate?this.fighter.exact(a.handle,b.handle,{position}):this.fighter.fight(a.handle,b.handle,{rounds:c.rounds,position});
    histograms=[[r.losses,r.wins,r.ties],[r.wins,r.losses,r.ties]];
   }
   // As the site's pMARS reports: a win is a round survived alone, a tie one survived with others.
   return {engine:'exmars',completed:c.rounds,warriors:list.map((w,i)=>{const h=histograms[i];
    return {name:w.name,wins:h[1],ties:h.slice(2).reduce((a,b)=>a+b,0),losses:h[0],score:scoreFrom(h,table)};})};
  }catch(error){return this.#failed(error);}
 }
 // A refused input or a fighter error: start a fresh fighter next time and let pMARS run this one.
 #failed(error){
  try{this.fighter?.dispose();}catch{}
  this.fighter=null;this.hillKey='';this.loaded.clear();
  return {fallback:'exMARS error: '+error.message};
 }
 // One warrior against each of `others`, one on one, as run() would score each pair, with the
 // settings checked and the fighter set up once for all of them. positions: one placement seed per
 // opponent (else the settings' fixedPosition). Returns one entry per opponent, {wins, ties, losses,
 // engine} or {fallback} for a pair pMARS must run, or one {fallback} when pMARS must run them all.
 async pairs(config,source,others,{positions=null}={}){
  const c={...defaults,...config,warriors:2,fixedPosition:''},blocker=exmarsBlocker(c);
  if(blocker)return {fallback:blocker};
  if([source,...others].some(s=>typeof s!=='string'))return {fallback:'a warrior count other than the settings'};
  const otherSize=c.noPspace&&pmarsPspace(c)!==Math.floor(c.coreSize/16);
  if(otherSize&&/PSPACESIZE/i.test(source))return {fallback:'PSPACESIZE with another P-space size'};
  const base=config.fixedPosition,hill=hillOf(c);
  try{
   await this.#fighterFor(hill);
   const a=await this.#warrior(source,hill,c.rounds);
   if(!a.ok)return {fallback:'assembly'};
   if(c.noPspace&&a.pspace)return {fallback:'P-space on a no-P-space hill'};
   const out=new Array(others.length);
   for(let i=0;i<others.length;i++){
    const p=positions?positions[i]:base,why=positionBlocker(c,p);
    if(why){out[i]={fallback:why};continue;}
    if(otherSize&&/PSPACESIZE/i.test(others[i])){out[i]={fallback:'PSPACESIZE with another P-space size'};continue;}
    const b=this.#cached(others[i],c.rounds)??await this.#warrior(others[i],hill,c.rounds);
    if(!b.ok){out[i]={fallback:'assembly'};continue;}
    if(c.noPspace&&b.pspace){out[i]={fallback:'P-space on a no-P-space hill'};continue;}
    const position=p?Number(p):0;
    const r=c.permutate?this.fighter.exact(a.handle,b.handle,{position}):this.fighter.fight(a.handle,b.handle,{rounds:c.rounds,position});
    out[i]={wins:r.wins,ties:r.ties,losses:r.losses,engine:'exmars'};
   }
   return out;
  }catch(error){return this.#failed(error);}
 }
}

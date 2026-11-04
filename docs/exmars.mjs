// SPDX-License-Identifier: GPL-2.0-or-later
// exMARS for headless matches of 2 to 36 warriors (Tournaments and Tools). exMARS gives the
// same results as pMARS round for round (exmars-lock.json; tested in test-exmars.mjs) and is
// several times faster, and its fighter stays loaded, so a warrior is assembled once per worker.
// It runs a match only when the result is the same as pMARS's: ICWS '94, the default P-space
// size, a numeric or no placement seed, a score formula in W and S (scored here from exMARS's
// survivor counts, as pMARS scores them: score-formula.mjs), and a permutation only when it
// covers every position without P-space (exMARS's exact mode). Everything else, and anything
// the fighter refuses, runs on pMARS as before.
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
 if(c.fixedPosition!==''&&c.fixedPosition!=null){
  const p=Number(c.fixedPosition);
  // Two warriors: the second one's offset. A melee: any seed pMARS takes, up to 2^30.
  const max=c.warriors>2?2**30:c.coreSize-separationOf(c);
  if(!/^\d+$/.test(String(c.fixedPosition).trim())||p<separationOf(c)||p>max)return 'a placement seed exMARS does not read';
 }
 if(c.permutate&&c.rounds!==permutationRoundsOf(c))return 'a permutation of fewer rounds than positions';
 return null;
}
export const hillOf=c=>({coreSize:c.coreSize,cycles:c.cycles,processes:c.tasks,maxLength:c.maxLength,minDistance:separationOf(c)});
const usesPspace=w=>w.pin!==null||w.instructions.some(i=>i[0]===LDP||i[0]===STP);

// One per worker. run() returns pMARS-shaped results, or {fallback: reason} when pMARS must run
// the match (assembly errors are reported by pMARS, with its messages).
export class ExmarsRunner{
 constructor({maxWarriors=2000,moduleUrl=new URL('./dist/exmars/fighter-client.mjs',import.meta.url).href}={}){this.maxWarriors=maxWarriors;this.moduleUrl=moduleUrl;this.client=null;this.fighter=null;this.hillKey='';this.loaded=new Map();}
 async #load(){this.client??=await import(this.moduleUrl);return this.client;}
 async #fighterFor(hill){
  const key=JSON.stringify(hill),{createFighter}=await this.#load();
  // Other settings, or a full cache, start over: configure() drops every loaded warrior.
  if(!this.fighter){this.fighter=await createFighter(hill);this.loaded.clear();}
  else if(key!==this.hillKey||this.loaded.size>=this.maxWarriors){this.fighter.configure(hill);this.loaded.clear();}
  this.hillKey=key;return this.fighter;
 }
 // The ROUNDS constant takes the match's round count, as in pMARS.
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
   // pMARS's permutation runs the positions in a shuffled order; only without P-space is the order irrelevant.
   if(c.permutate&&pspace)return {fallback:'a permutation with P-space'};
   onAssembled();
   const position=c.fixedPosition?Number(c.fixedPosition):0;
   // Per warrior: rounds it ended dead, then alive with 1, 2, … n survivors.
   let histograms;
   if(list.length>2)histograms=this.fighter.fightMany(list.map(w=>w.handle),{rounds:c.rounds,position}).results;
   else{
    const [a,b]=list,r=c.permutate?this.fighter.exact(a.handle,b.handle):this.fighter.fight(a.handle,b.handle,{rounds:c.rounds,position});
    histograms=[[r.losses,r.wins,r.ties],[r.wins,r.losses,r.ties]];
   }
   // As the site's pMARS reports: a win is a round survived alone, a tie one survived with others.
   return {engine:'exmars',completed:c.rounds,warriors:list.map((w,i)=>{const h=histograms[i];
    return {name:w.name,wins:h[1],ties:h.slice(2).reduce((a,b)=>a+b,0),losses:h[0],score:scoreFrom(h,table)};})};
  }catch(error){
   // A refused input or a fighter error: start a fresh fighter next time and let pMARS run this one.
   try{this.fighter?.dispose();}catch{}
   this.fighter=null;this.hillKey='';this.loaded.clear();
   return {fallback:'exMARS error: '+error.message};
  }
 }
}

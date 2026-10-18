// SPDX-License-Identifier: GPL-2.0-or-later
import {settings,defaults} from './settings.mjs';
import {sourceId} from './hill-scores.mjs';

// pMARS turns a non-numeric -F into an RC5 key, but its rotate macros (ROL/ROR in pos.c) shift
// by y instead of 32-y, so text keys give clustered placements: often only a few hundred
// distinct offsets per 1000 rounds, and keys like "k1" and "k2" collide. A numeric -F takes the
// standard path instead, as in KOTH scripts and exMARS: it is the first round's offset and seeds
// the Park–Miller generator for the rest. So each text key is hashed to a valid offset.
export function numericPosition(key,config){
 const c={...defaults,...config},separation=c.distance||c.maxLength,span=c.coreSize-2*separation+1;
 // Never the separation itself: that is RNG seed 0, which exMARS (unlike pMARS) never advances.
 return String(separation+1+parseInt(sourceId(key),36)%(span-1));
}
const pairPosition=(seed,warriors,config)=>numericPosition(`pair:${seed}:${warriors.map(w=>sourceId(w.source)).join(':')}`,config);
// The suite warriors against each other, each pair once with self fights, as stored in hill
// scores. Their rounds and permutation are independent of the candidates' fights.
export function hillJobs(opponents,{seed,config,rounds,permutate=false}){
 if(!Number.isInteger(rounds)||rounds<1||rounds>2147483647)throw new Error('Hill rounds must be a positive integer.');
 const jobs=[];
 for(let i=0;i<opponents.length;i++)for(let j=i;j<opponents.length;j++)jobs.push({kind:'hill',i,j,warriors:[opponents[i],opponents[j]],
  config:settings({...config,warriors:2,rounds,permutate,brief:true,verbose:false,sort:false,fixedSeries:false,assembleOnly:false,fixedPosition:pairPosition(seed,[opponents[i],opponents[j]],config)})});
 return jobs;
}
// pushoff (benchmark mode): add each candidate's self fight and key placement by the warrior
// pair, so a pair fights from the same positions in every run; hill also schedules hillJobs
// (at hillRounds, optionally every starting position) when no stored scores exist.
export function planTournament({mode,entrants,opponents=[],challenger,rounds,seed,config,selfFights=false,pushoff=false,hill=false,hillRounds=rounds,hillPermutate=false}) {
 if(!entrants.length)throw new Error('Select at least one warrior in the roster.');
 if(!Number.isInteger(rounds)||rounds<1||rounds>2147483647)throw new Error('Rounds must be a positive integer.');
 if(typeof seed!=='string'||!seed.trim()||seed.length>120)throw new Error('Enter a seed of 1–120 characters.');
 if(config.assembleOnly)throw new Error('Turn off Assemble only in match settings.');
 const pairs=[],kinds=[];
 if(mode==='melee')pairs.push(entrants);
 else if(mode==='round-robin'){
  for(let i=0;i<entrants.length;i++)for(let j=selfFights?i:i+1;j<entrants.length;j++)pairs.push([entrants[i],entrants[j]]);
 }else if(mode==='challenge'){
  const candidate=entrants.find(w=>w.id===challenger);
  if(!candidate)throw new Error('Choose a challenger.');
  for(const opponent of entrants)if(selfFights||opponent.id!==candidate.id)pairs.push([candidate,opponent]);
 }else if(mode==='benchmark'){
  if(!opponents.length)throw new Error('Choose a benchmark suite.');
  for(const candidate of entrants){
   opponents.forEach((opponent,o)=>{if(pushoff||selfFights||candidate.source!==opponent.source){pairs.push([candidate,opponent]);kinds.push({kind:'candidate',opponent:o});}});
   if(pushoff){pairs.push([candidate,candidate]);kinds.push({kind:'self'});}
  }
 }else throw new Error('Unknown tournament mode.');
 if(!pairs.length)throw new Error('No matchups: select more warriors or enable self fights.');
 const jobs=pairs.map((warriors,id)=>({id,warriors,...kinds[id],config:settings({...config,warriors:warriors.length,rounds,
  brief:true,verbose:false,sort:false,fixedSeries:false,assembleOnly:false,
  fixedPosition:pushoff?pairPosition(seed,warriors,config):numericPosition(`tournament:${seed}:${id}`,config)})}));
 if(pushoff&&hill)for(const job of hillJobs(opponents,{seed,config,rounds:hillRounds,permutate:hillPermutate}))jobs.push({id:jobs.length,...job});
 return {mode,seed,rounds,pushoff,hillRounds:hill?hillRounds:null,hillPermutate:hill&&hillPermutate,jobs,entrants:entrants.map(w=>({...w})),totalRounds:jobs.reduce((t,j)=>t+j.config.rounds,0)};
}

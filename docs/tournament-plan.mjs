// SPDX-License-Identifier: GPL-2.0-or-later
import {settings} from './settings.mjs';

export function planTournament({mode,entrants,opponents=[],challenger,rounds,seed,config,selfFights=false}) {
 if(!entrants.length)throw new Error('Select at least one warrior in the roster.');
 if(!Number.isInteger(rounds)||rounds<1||rounds>2147483647)throw new Error('Rounds must be a positive integer.');
 if(typeof seed!=='string'||!seed.trim()||seed.length>120)throw new Error('Enter a seed of 1–120 characters.');
 if(config.assembleOnly)throw new Error('Turn off Assemble only in match settings.');
 if(config.permutate)throw new Error('Turn off Permutate positions for tournaments.');
 const pairs=[];
 if(mode==='melee')pairs.push(entrants);
 else if(mode==='round-robin'){
  for(let i=0;i<entrants.length;i++)for(let j=selfFights?i:i+1;j<entrants.length;j++)pairs.push([entrants[i],entrants[j]]);
 }else if(mode==='challenge'){
  const candidate=entrants.find(w=>w.id===challenger);
  if(!candidate)throw new Error('Choose a challenger.');
  for(const opponent of entrants)if(selfFights||opponent.id!==candidate.id)pairs.push([candidate,opponent]);
 }else if(mode==='benchmark'){
  if(!opponents.length)throw new Error('Choose a benchmark suite.');
  for(const candidate of entrants)for(const opponent of opponents)if(selfFights||candidate.source!==opponent.source)pairs.push([candidate,opponent]);
 }else throw new Error('Unknown tournament mode.');
 if(!pairs.length)throw new Error('No matchups: select more warriors or enable self fights.');
 const jobs=pairs.map((warriors,id)=>({id,warriors,config:settings({...config,warriors:warriors.length,rounds,
  brief:true,verbose:false,sort:false,fixedSeries:false,fixedPosition:`tournament:${seed}:${id}`,assembleOnly:false})}));
 return {mode,seed,rounds,jobs,entrants:entrants.map(w=>({...w})),totalRounds:jobs.length*rounds};
}

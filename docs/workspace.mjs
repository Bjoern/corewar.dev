// SPDX-License-Identifier: GPL-2.0-or-later
// Saved workspace: warrior sources, roster choices and settings, never battle state or results.
export const WORKSPACE_KEY='corewar-workspace';
export const WORKSPACE_FORMAT='corewar.dev-workspace';
export const WORKSPACE_VERSION=1;
const MAX_WARRIORS=36,MAX_SOURCE=65536;
const fail=message=>{throw new Error('Not a corewar.dev workspace: '+message+'.');};
const text=(value,max,name)=>{if(typeof value!=='string' || value.length>max)fail(name+' must be text of at most '+max+' characters');return value;};
// Returns a normalized copy, or throws with a message suitable for the status line.
export function parseWorkspace(data) {
 if(typeof data==='string'){try{data=JSON.parse(data);}catch{fail('the file is not valid JSON');}}
 if(!data || typeof data!=='object' || data.format!==WORKSPACE_FORMAT)fail('the format marker is missing');
 if(data.version!==WORKSPACE_VERSION)fail('version '+data.version+' is not supported');
 if(!Array.isArray(data.warriors) || data.warriors.length>MAX_WARRIORS)fail('expected a list of at most '+MAX_WARRIORS+' warriors');
 const warriors=data.warriors.map((w,i)=>{
  if(!w || typeof w!=='object')fail('warrior '+(i+1)+' is not an object');
  return {source:text(w.source,MAX_SOURCE,'warrior source'),original:w.original==null?null:text(w.original,MAX_SOURCE,'original source'),
   file:w.file==null?null:text(w.file,255,'file name'),excluded:w.excluded===true};
 });
 const index=value=>Number.isInteger(value) && value>=0 && value<warriors.length;
 const openTabs=Array.isArray(data.openTabs)?[...new Set(data.openTabs.filter(index))]:[];
 const settings=data.settings && typeof data.settings==='object'?data.settings:{};
 const values=settings.values && typeof settings.values==='object'?settings.values:{};
 const battle=data.battle && typeof data.battle==='object'?data.battle:{};
 const tournament=data.tournament && typeof data.tournament==='object'?data.tournament:{};
 const pick=(source,key,type)=>typeof source[key]===type?source[key]:undefined;
 return {format:WORKSPACE_FORMAT,version:WORKSPACE_VERSION,warriors,openTabs,active:index(data.active)?data.active:-1,
  mode:data.mode==='tournament'?'tournament':'battle',welcomeDismissed:data.welcomeDismissed===true,
  settings:{preset:typeof settings.preset==='string'?settings.preset:'custom',values},
  battle:{speed:pick(battle,'speed','string'),debugEnabled:pick(battle,'debugEnabled','boolean')},
  tournament:{mode:['melee','round-robin','benchmark','challenge'].includes(tournament.mode)?tournament.mode:undefined,
   rounds:pick(tournament,'rounds','string'),seed:pick(tournament,'seed','string'),selfFights:pick(tournament,'selfFights','boolean'),
   suite:pick(tournament,'suite','string')}};
}

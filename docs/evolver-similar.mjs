// SPDX-License-Identifier: GPL-2.0-or-later
// How close a warrior is to known ones (the benchmark, your warriors, the library): did an evolver run
// find something of its own, or rebuild a known engine? A Markov chain of the opponents, or a seed,
// can lead straight back to one, often with new constants, lines in another order and dead code around
// it. The evolver's check and the Similar warriors tool (tool-similar.mjs) both use this.
//
// What is compared: the code that runs. A short solo run in pMARS (traceExecuted) marks which of the
// warrior's own instructions execute; dead code (never reached, data, leftovers) is left out, so it
// cannot dilute the match. Known warriors are compared whole, as their engine may run only after a
// boot copies it elsewhere. Both sides are assembled code ([op, modifier, A mode, A field, B mode,
// B field], fields modulo the core size), so labels, EQUs and layout make no difference, and a run of
// one instruction repeated (DAT filler) counts once.
//
// How: a local alignment (Smith–Waterman) of your code against each known warrior, which finds the
// best-matching block in it, wherever it sits and whatever surrounds it. Pairs of instructions score
//   identical      1     the same instruction, fields and all
//   same wiring    0.9   the same opcode, modifier and modes, and the fields that point into the
//                         warrior (near ones) the same: the same design, other constants
//   same shape     0.7   the same opcode, modifier and modes, other fields
//   same opcode    0     neither helps nor hurts
//   different     −0.5
// and a gap (an instruction one side has and the other not) −0.5, so a few inserted, removed or
// moved lines still align. Covered is the share of your code aligned to an instruction of the same
// shape or closer.

const mod=(x,n)=>((Math.trunc(x)%n)+n)%n;
export const GRADES={identical:1,wiring:0.9,shape:0.7,opcode:0,different:-0.5},GAP=-0.5;

// The instructions of `source` that execute in a solo run of up to `steps` steps (pMARS, the hill's
// settings): their indices in the assembled code (`start` is its start instruction, `length` its
// instruction count; what runs beyond it, such as an imp's copies, is not its code).
export async function traceExecuted(source,config,start,length,{steps=4000}={}){
 const {Engine}=await import('./engine.mjs');
 const engine=await Engine.create({...config,warriors:1,rounds:1,brief:true,permutate:false},{visual:false,log:()=>{}});
 engine.compile([source],()=>{},null,()=>{});
 let state=engine.start();engine.setTrace(true);
 const addresses=[];
 while(!state.done&&addresses.length<steps){state=engine.advance(Math.min(500,steps-addresses.length),8);for(const t of state.trace)addresses.push(t.address);}
 if(!addresses.length)throw new Error('The warrior did not run.');
 // The first instruction executed is the start one, which gives where the warrior was loaded.
 const base=mod(addresses[0]-start,config.coreSize),out=new Set();
 for(const a of addresses){const i=mod(a-base,config.coreSize);if(i<length)out.add(i);}
 return out;
}

// One warrior's code ready to compare: optionally only the instructions at `keep` (indices), in
// order, then runs of one instruction counted once. `near` is how far a field may point and still
// count as pointing into the warrior (wiring), normally the hill's maximum length. `index` holds each
// instruction's place in the assembled code.
export function prepare(genome,coreSize,{keep=null,near=100}={}){
 const signed=f=>{f=mod(f,coreSize);return f>coreSize/2?f-coreSize:f;};
 let code=(genome.code||[]).map((i,n)=>[i[0],i[1],i[2],signed(i[3]),i[4],signed(i[5]),n]);
 if(keep)code=code.filter((_,i)=>keep.has(i));
 code=code.filter((x,i,all)=>!i||x.slice(0,6).join()!==all[i-1].slice(0,6).join());
 return {code:code.map(x=>x.slice(0,6)),index:code.map(x=>x[6]),near,length:code.length};
}
// How alike two instructions are, as a grade name.
export function grade(x,y,near){
 if(x[0]!==y[0])return 'different';
 if(x[1]!==y[1]||x[2]!==y[2]||x[4]!==y[4])return 'opcode';
 if(x[3]===y[3]&&x[5]===y[5])return 'identical';
 const wired=(a,b)=>{const na=Math.abs(a)<near,nb=Math.abs(b)<near;return na||nb?a===b:true;};
 return wired(x[3],y[3])&&wired(x[5],y[5])?'wiring':'shape';
}
// The best local alignment of `a` (yours) against `b`: score, and of yours how many instructions are
// covered (same shape or closer), identical and the same wiring, the aligned blocks of each, and
// `pairs`, the alignment in order: [yours, theirs, grade], an index of -1 for a gap.
export function align(a,b){
 const n=a.length,m=b.length,near=Math.max(a.near,b.near);
 if(!n||!m)return {score:0,covered:0,identical:0,wiring:0,yourFrom:0,yourTo:0,theirFrom:0,theirTo:0,pairs:[]};
 const H=new Float64Array((n+1)*(m+1)),move=new Uint8Array((n+1)*(m+1)),G=[];
 let best=0,bi=0,bj=0;
 for(let i=1;i<=n;i++){
  const row=[];
  for(let j=1;j<=m;j++){
   const g=grade(a.code[i-1],b.code[j-1],near);row.push(g);
   const k=i*(m+1)+j,d=H[k-m-2]+GRADES[g],up=H[k-m-1]+GAP,left=H[k-1]+GAP;
   let h=0,mv=0;if(d>h){h=d;mv=1;}if(up>h){h=up;mv=2;}if(left>h){h=left;mv=3;}
   H[k]=h;move[k]=mv;if(h>best){best=h;bi=i;bj=j;}
  }
  G.push(row);
 }
 let i=bi,j=bj,covered=0,identical=0,wiring=0;const pairs=[];
 while(i>0&&j>0&&move[i*(m+1)+j]){
  const mv=move[i*(m+1)+j];
  if(mv===1){const g=G[i-1][j-1];if(GRADES[g]>=GRADES.shape)covered++;if(g==='identical')identical++;if(g==='wiring')wiring++;i--;j--;pairs.push([i,j,g]);}
  else if(mv===2){i--;pairs.push([i,-1,'gap']);}else{j--;pairs.push([-1,j,'gap']);}
 }
 return {score:best,covered,identical,wiring,yourFrom:i,yourTo:bi,theirFrom:j,theirTo:bj,pairs:pairs.reverse()};
}
// What a match amounts to: 'copy' (80% or more of yours identical), 'known' (80% or more covered:
// the same design), 'partial' (half or more covered), or null. Under 3 instructions says nothing.
export function verdict(s,length){
 if(length<3)return null;
 if(s.identical>=0.8*length)return 'copy';
 if(s.covered>=0.8*length)return 'known';
 if(s.covered>=0.5*length)return 'partial';
 return null;
}
// The known warriors ({name, from, genome, and their hill's settings as `hill` when not `coreSize`'s})
// matching `yours` (prepared) best, best first: by how much of yours they cover, then by alignment
// score, then identical instructions. Each row keeps its warrior as `known` and its code as `theirs`.
export function closest(yours,known,coreSize,limit=10){
 const rows=known.map(k=>{
  const theirs=k.prepared??=prepare(k.genome,k.hill?.coreSize??coreSize,{near:k.hill?.maxLength??yours.near}),s=align(yours,theirs);
  return {name:k.name,from:k.from,length:theirs.length,...s,share:yours.length?s.covered/yours.length:0,verdict:verdict(s,yours.length),known:k,theirs};
 }).sort((x,y)=>y.covered-x.covered||y.score-x.score||y.identical-x.identical);
 return {rows:rows.slice(0,limit),matching:rows.filter(r=>r.verdict==='copy'||r.verdict==='known').length};
}

// ---- known warriors
// Hill settings from a library hill's parameters, as the assembler and the solo run take them.
export const hillSettings=p=>({coreSize:p.coreSize,cycles:p.cycles,tasks:p.tasks,maxLength:p.maxLength,distance:p.distance||p.maxLength,
 rules88:!!p.rules88,noPspace:!!p.noPspace,pspace:Number(p.pspace)||0,formula:'(W*W-1)/S'});
const hillKey=c=>['coreSize','cycles','tasks','maxLength','distance'].map(k=>c[k]).join('/')+(c.rules88?'/88':'');
// The library hills, each with its settings as `hill`.
export async function libraryHills(){
 const {libraryCatalog}=await import('./library-catalog.mjs');
 return libraryCatalog.map(h=>({...h,hill:hillSettings(h.parameters)}));
}
// One library hill's warriors as {name, file, source, from, hill}, loaded once per page.
const hillWarriors=new Map();
export function libraryWarriors(h){
 if(!hillWarriors.has(h.id))hillWarriors.set(h.id,(async()=>{
  const [index,texts]=await Promise.all([fetch(h.index).then(r=>r.json()),fetch(h.text).then(r=>r.json())]);
  return index.filter(w=>texts[w.file]).map(w=>({name:`${w.name}${w.author?' by '+w.author:''}`,file:w.file,source:texts[w.file],from:'library '+h.label,hill:h.hill}));
 })().catch(error=>{hillWarriors.delete(h.id);throw error;}));
 return hillWarriors.get(h.id);
}
// Warriors ({name, source, from, hill}) assembled for their hill's settings, each once (`cache` keeps
// the code by hill and source across calls): the same code under two names (a benchmark's copy and
// the library's) counts once. Returns {known, failed}: the ones that assembled, with `genome`, and
// how many did not. `progress(done, total)` is called now and then, and gives the page a turn.
export async function assembleKnown(list,{cache=new Map(),progress=null}={}){
 const {assemble}=await import('./dist/exmars/fighter-client.mjs'),{hillOf}=await import('./exmars.mjs');
 const known=[],seen=new Set();let failed=0;
 for(const [i,w] of list.entries()){
  const key=hillKey(w.hill)+'\n'+w.source;
  if(!seen.has(key)){
   seen.add(key);
   if(!cache.has(key)){let g=null;try{const a=await assemble(w.source,hillOf(w.hill));if(a.ok)g={code:a.instructions,start:a.start};}catch{}cache.set(key,g);}
   const g=cache.get(key),code=g&&hillKey(w.hill)+'\n'+g.code.map(x=>x.join()).join(';');
   if(!g)failed++;else if(!seen.has(code)){seen.add(code);known.push({...w,genome:g});}
  }
  if(progress&&i%200===199){progress(i+1,list.length);await new Promise(r=>setTimeout(r));}
 }
 return {known,failed};
}
// Instruction numbers as ranges, from 1: 2–8, 11.
export function ranges(list){
 const out=[];for(const i of [...list].sort((a,b)=>a-b)){const last=out.at(-1);if(last&&i===last[1]+1)last[1]=i;else out.push([i,i]);}
 return out.map(([a,b])=>a===b?String(a+1):`${a+1}–${b+1}`).join(', ');
}
// What a comparison found, in a sentence or two. `ran`: the indices that ran (null: all compared);
// `total`: the warrior's instruction count; `checked`: what it was compared with.
export function summary({rows,matching},{yours,ran,total,checked}){
 const top=rows[0],n=yours.length,pct=x=>Math.round(100*x)+'%';
 const runs=ran?`${n} instruction${n===1?'':'s'} run${n===1?'s':''} (${ranges(ran)} of ${total}; repeats counted once)`:`${n} instructions`;
 const also=matching>1?` The same code is in ${matching} known warriors, so it may be a common engine rather than one warrior’s.`:'';
 if(!top)return `Nothing to compare with.`;
 if(n<3)return `Only ${runs}: too little to compare. Compared with ${checked}.`;
 if(top.verdict==='copy')return `Of its code, ${runs}: ${top.identical} identical to ${top.name} (${top.from}). A copy.${also} Compared with ${checked}.`;
 if(top.verdict==='known')return `Of its code, ${runs}: ${pct(top.share)} match ${top.name} (${top.from}) in design: ${top.identical} identical, ${top.wiring} the same wiring with other constants, the rest the same shape.${also} Compared with ${checked}.`;
 if(top.verdict==='partial')return `Of its code, ${runs}: ${pct(top.share)} match ${top.name} (${top.from}), the rest is its own.${also} Compared with ${checked}.`;
 return `Of its code, ${runs}: no close match among ${checked}. The closest, ${top.name}, covers ${pct(top.share)}.`;
}

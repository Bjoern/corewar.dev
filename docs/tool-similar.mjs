// SPDX-License-Identifier: GPL-2.0-or-later
// Similar warriors view of the Tools tab: how close a warrior is to known ones (the library's hills and
// your warriors), and the matching code side by side. The comparison is in evolver-similar.mjs, which
// the evolver's “Compare with known warriors” uses too.
import {el} from './tools.mjs';
import {describeSettings} from './tournaments.mjs';
import {renderInstruction} from './evolver-genome.mjs';
import {warriorFilename} from './warrior-files.mjs';
import {prepare,closest,traceExecuted,summary,libraryHills,libraryWarriors,assembleKnown,hillSettings} from './evolver-similar.mjs';

const HELP=[
 ['What it does','It checks whether a warrior is something new or a known design: a warrior of yours before a tournament, an evolved one, or a library warrior, to see which others share its engine. Only your warrior runs, a short solo run in pMARS that marks which of its instructions execute; the known warriors are compared as code, which takes a second or two even for the whole library.'],
 ['What is compared','The code of yours that runs, so a boot’s leftovers, decoys and data cannot dilute a match (the status line says which instructions ran), against the whole of each known warrior, as its engine may only run after a boot copies it. Both are assembled code, so labels, EQUs and layout make no difference, and one instruction repeated in a row (DAT filler) counts once.'],
 ['How','A local alignment finds the best-matching block in each known warrior, wherever it sits. Identical instructions count most (=), then the same wiring (≈: same opcode, modifier and modes, and the same fields where they point into the warrior, only far constants differing), then the same shape (~: other fields); a different instruction (×) or a line one side has and the other not counts against it, so a few lines added, removed or moved still align. Covered is the share of your code that runs matched at the same shape or closer. 80% identical is a copy, 80% covered the same design with other constants, half or more a partial match. When several known warriors hold the same code it is a common engine, which the status line says.'],
 ['Other hills','“All other library hills” compares with every hill’s warriors, each assembled for its own hill, as designs are often moved from one hill to another (a ’94 paper on the LP hill, a stone on the X hill). Far constants then differ with the core size, so such a match shows as the same design or shape rather than identical. 94nop and P-space share their settings, so either one counts as “these settings” for the other.'],
 ['Side by side','Click a row to see the two aligned blocks next to each other, instruction by instruction, with the instruction numbers in each warrior. Lines only one side has are the gaps.'],
 ['Limits','It compares code, not behaviour: a warrior that works like a known one with different code is not found. A warrior that only runs its main code after many steps (a long boot, a P-space switch to a strategy it has not used yet) may show little that ran: the solo run is 4,000 steps, alone in the core.']
];
// The hill a ;redcode line names, as a library hill id.
const HEADERS={nano:'nano',tiny:'tiny',lp:'lp','94nop':'94nop',nop:'94nop','94x':'x',x:'x','88':'88',icws:'icws',icws64:'icws64','94':'pspace',pspace:'pspace',odd:'odd'};
export const hillFromHeader=source=>HEADERS[/^\s*;\s*redcode-?(\S*)/im.exec(source)?.[1]?.toLowerCase()??'']??null;
const MARK={identical:'=',wiring:'≈',shape:'~',opcode:'·',different:'×',gap:''};
const sameSettings=(a,b)=>['coreSize','cycles','tasks','maxLength','distance'].every(k=>Number(a[k])===Number(b[k]))&&!!a.rules88===!!b.rules88;

export function mount(root,{roster,addWarrior,readConfig,loadState,saveState}){
 const saved=loadState()||{};
 const field=(...nodes)=>el('div',{className:'tool-field'},...nodes);
 const labelled=(id,text,control)=>{control.id=id;return [el('label',{htmlFor:id,textContent:text}),control];};
 // ---- the warrior
 const source=el('textarea',{className:'opt-editor sim-editor',spellcheck:false,value:saved.source??'',placeholder:';redcode-94nop\n;name My warrior\n…\n\nPaste a warrior, or load one below.',ariaLabel:'Warrior to compare'});
 const rosterSelect=el('select',{});
 const loadRoster=el('button',{type:'button',className:'small',textContent:'Load'});
 const libHill=el('select',{});
 const libName=el('input',{type:'search',placeholder:'warrior name',spellcheck:false,autocomplete:'off'});
 const libList=el('datalist',{id:'simLibNames'});libName.setAttribute('list','simLibNames');
 const loadLib=el('button',{type:'button',className:'small',textContent:'Load'});
 const loadStatus=el('p',{className:'hint',role:'status'});
 // ---- settings
 const hillSelect=el('select',{});
 const hillNote=el('p',{className:'hint'});
 const sameLib=el('input',{type:'checkbox',checked:saved.same??true});
 const otherLib=el('input',{type:'checkbox',checked:!!saved.other});
 const mine=el('input',{type:'checkbox',checked:saved.mine??true});
 const compare=el('button',{type:'button',className:'primary',textContent:'Compare'});
 const status=el('p',{className:'hint',role:'status'});
 const table=el('table',{className:'tool-table sim-table'});
 const results=el('div',{className:'tool-table-wrap',hidden:true},table);
 const detailHead=el('h3',{textContent:'Side by side'});
 const detailNote=el('p',{className:'hint'});
 const detailTable=el('table',{className:'tool-table sim-pairs'});
 const addTheirs=el('button',{type:'button',className:'small',textContent:'Add theirs to warriors'});
 const detail=el('section',{className:'t-card',hidden:true},detailHead,detailNote,el('div',{className:'tool-actions'},addTheirs),el('div',{className:'tool-table-wrap'},detailTable));
 const help=el('details',{className:'tool-help',open:!saved.helpClosed},el('summary',{textContent:'How it works'}),...HELP.map(([h,t])=>el('div',{},el('strong',{textContent:h}),el('p',{textContent:t}))));
 root.append(el('div',{className:'opt-layout'},
  el('div',{},
   el('section',{className:'t-card'},el('h3',{textContent:'Warrior'}),source,
    el('div',{className:'tool-form'},
     field(...labelled('simRoster','From your warriors',rosterSelect),loadRoster),
     field(...labelled('simLibHill','From the library',libHill),libName,libList,loadLib),loadStatus)),
   el('section',{className:'t-card'},el('h3',{textContent:'Compare with'}),
    el('div',{className:'tool-form'},field(...labelled('simHill','Settings',hillSelect)),hillNote,
     field(el('label',{},sameLib,' Library warriors with these settings')),
     field(el('label',{},otherLib,' All other library hills (each with its own settings)')),
     field(el('label',{},mine,' Your warriors'))),
    el('div',{className:'tool-actions'},compare),status)),
  el('div',{className:'opt-main'},el('section',{className:'t-card'},el('h3',{textContent:'Closest known warriors'}),results),detail)),help);

 let hills=[],lastRows=[],shown=null;const assembled=new Map();
 function persist(){saveState({source:source.value,hill:hillSelect.value,libHill:libHill.value,same:sameLib.checked,other:otherLib.checked,mine:mine.checked,helpClosed:!help.open});}
 const settings=()=>{
  if(hillSelect.value==='battle'){const c=readConfig();return hillSettings(c);}
  return hills.find(h=>h.id===hillSelect.value)?.hill??null;
 };
 function showHill(){const c=settings();hillNote.textContent=c?describeSettings(c):'';}
 (async()=>{
  try{
   hills=await libraryHills();
   const opts=()=>hills.map(h=>new Option(`${h.label} hill`,h.id));
   hillSelect.replaceChildren(...opts(),new Option('Battle tab settings','battle'));
   libHill.replaceChildren(...opts());
   hillSelect.value=saved.hill&&[...hillSelect.options].some(o=>o.value===saved.hill)?saved.hill:hillFromHeader(source.value)??'94nop';
   libHill.value=saved.libHill&&hills.some(h=>h.id===saved.libHill)?saved.libHill:hillSelect.value==='battle'?'94nop':hillSelect.value;
   showHill();fillNames();
  }catch(error){hillNote.textContent='The library could not be loaded: '+error.message;}
 })();
 function fillRoster(){
  const list=roster();
  rosterSelect.replaceChildren(...(list.length?list.map((w,i)=>new Option(w.name,String(i))):[new Option('no warriors loaded','')]));
  loadRoster.disabled=!list.length;
 }
 async function fillNames(){
  const h=hills.find(x=>x.id===libHill.value);if(!h)return;
  try{const list=await libraryWarriors(h);if(libHill.value===h.id)libList.replaceChildren(...list.map(w=>new Option(w.name)));}catch{}
 }
 function setSource(text,from){
  source.value=text;const id=hillFromHeader(text);
  if(id&&hills.some(h=>h.id===id))hillSelect.value=id;
  showHill();persist();loadStatus.textContent=from;
 }
 loadRoster.onclick=()=>{const w=roster()[Number(rosterSelect.value)];if(w)setSource(w.source,`Loaded ${w.name}.`);};
 libHill.onchange=()=>{libName.value='';fillNames();persist();};
 const loadFromLibrary=async()=>{
  const h=hills.find(x=>x.id===libHill.value),q=libName.value.trim().toLowerCase();if(!h||!q)return;
  try{
   const list=await libraryWarriors(h),w=list.find(x=>x.name.toLowerCase()===q)??list.find(x=>x.name.toLowerCase().startsWith(q))??list.find(x=>x.name.toLowerCase().includes(q));
   if(!w){loadStatus.textContent=`No warrior on the ${h.label} hill matches “${libName.value}”.`;return;}
   libName.value=w.name;setSource(w.source,`Loaded ${w.name} from the ${h.label} hill.`);hillSelect.value=h.id;showHill();persist();
  }catch(error){loadStatus.textContent='The library could not be loaded: '+error.message;}
 };
 loadLib.onclick=loadFromLibrary;
 libName.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadFromLibrary();}});
 hillSelect.onchange=()=>{showHill();persist();};
 for(const c of [sameLib,otherLib,mine])c.onchange=persist;
 source.addEventListener('change',()=>{const id=hillFromHeader(source.value);if(id&&hills.some(h=>h.id===id)&&hillSelect.value!=='battle')hillSelect.value=id;showHill();persist();});
 help.addEventListener('toggle',persist);

 compare.onclick=async()=>{
  const text=source.value,c=settings();
  if(!text.trim()){status.textContent='Paste a warrior or load one first.';return;}
  if(!c){status.textContent='Pick the settings first.';return;}
  if(!sameLib.checked&&!otherLib.checked&&!mine.checked){status.textContent='Pick something to compare with.';return;}
  compare.disabled=true;status.textContent='Finding the code that runs…';
  try{
   const {assemble}=await import('./dist/exmars/fighter-client.mjs'),{hillOf}=await import('./exmars.mjs');
   const a=await assemble(text,hillOf(c));
   if(!a.ok)throw new Error('The warrior did not assemble for these settings:\n'+a.errors);
   let ran=null,traceNote='';
   try{ran=await traceExecuted(text,c,a.start,a.instructions.length);}catch(error){traceNote=` (the solo run failed, so all its code was compared: ${error.message})`;}
   const yours=prepare({code:a.instructions},c.coreSize,{keep:ran,near:c.maxLength});
   status.textContent='Loading known warriors…';
   const list=[],from=[];
   if(mine.checked){const r=roster();list.push(...r.map(w=>({name:w.name,source:w.source,from:'your warriors',hill:c})));if(r.length)from.push('your warriors');}
   const picked=hills.filter(h=>sameSettings(h.hill,c)?sameLib.checked:otherLib.checked);
   for(const h of picked){status.textContent=`Loading the ${h.label} hill…`;list.push(...await libraryWarriors(h));}
   if(picked.length)from.push(picked.length===hills.length?'all library hills':`the library’s ${picked.map(h=>h.label).join(', ')} hill${picked.length===1?'':'s'}`);
   const {known,failed}=await assembleKnown(list,{cache:assembled,progress:(i,n)=>{status.textContent=`Assembling known warriors… ${i} of ${n}`;}});
   status.textContent='Comparing…';await new Promise(r=>setTimeout(r));
   // The warrior itself (loaded from the library or your warriors) is not a match.
   const found=closest(yours,known.filter(k=>k.source!==text),c.coreSize,25);
   lastRows=found.rows;shown={yours,assembledYours:a,coreSize:c.coreSize};
   const checked=`${known.length} known warrior${known.length===1?'':'s'} from ${from.join(' and ')||'nowhere'}${failed?` (${failed} did not assemble)`:''}${traceNote}`;
   status.textContent=summary(found,{yours,ran,total:a.instructions.length,checked});
   render();if(lastRows.length)showPair(0);else detail.hidden=true;
  }catch(error){status.textContent=error.message;results.hidden=true;detail.hidden=true;}
  finally{compare.disabled=false;}
 };
 const label={copy:' · copy',known:' · same design',partial:' · partly'};
 function render(){
  results.hidden=!lastRows.length;
  table.replaceChildren(el('thead',{},el('tr',{},...[['Warrior'],['From'],['Length','instructions, a run of one instruction counted once'],['Covered','share of your code that runs aligned to the same shape or closer'],['Identical','instructions identical, fields and all'],['Same wiring','same shape, and the fields that point into the warrior the same'],['Score','local alignment score']].map(([h,title])=>el('th',{scope:'col',textContent:h,title:title||''})))),
   el('tbody',{},...lastRows.map((r,i)=>{
    const tr=el('tr',{className:(r.verdict?'evo-held':'')+(i===shownIndex?' selected':''),tabIndex:0},el('td',{textContent:r.name+(label[r.verdict]??'')}),el('td',{textContent:r.from}),
     ...[String(r.length),Math.round(100*r.share)+'%',String(r.identical),String(r.wiring),r.score.toFixed(1)].map(v=>el('td',{className:'num',textContent:v})));
    tr.onclick=()=>showPair(i);tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showPair(i);}};
    return tr;
   })));
 }
 let shownIndex=-1;
 function showPair(i){
  const r=lastRows[i];if(!r||!shown)return;shownIndex=i;render();
  const theirCore=r.known.hill?.coreSize??shown.coreSize,yourCode=shown.assembledYours.instructions,theirCode=r.known.genome.code;
  detail.hidden=false;detailHead.textContent=`Side by side: ${r.name}`;
  detailNote.textContent=`${r.from}. Numbers are instruction numbers in each warrior, from 1. = identical, ≈ same wiring, ~ same shape, · same opcode, × different; a blank side is a line the other has and it does not.`;
  const yourLine=k=>k<0?['','']:[String(shown.yours.index[k]+1),renderInstruction(yourCode[shown.yours.index[k]],shown.coreSize)];
  const theirLine=k=>k<0?['','']:[String(r.theirs.index[k]+1),renderInstruction(theirCode[r.theirs.index[k]],theirCore)];
  detailTable.replaceChildren(el('thead',{},el('tr',{},...['#','Yours','','Theirs','#'].map(h=>el('th',{scope:'col',textContent:h})))),
   el('tbody',{},...r.pairs.map(([y,t,g])=>{
    const [yn,yi]=yourLine(y),[tn,ti]=theirLine(t);
    return el('tr',{className:'sim-'+g},el('td',{className:'num',textContent:yn}),el('td',{},el('code',{textContent:yi})),el('td',{className:'sim-mark',textContent:MARK[g],title:g==='gap'?'':g}),el('td',{},el('code',{textContent:ti})),el('td',{className:'num',textContent:tn}));
   })));
  addTheirs.onclick=()=>{try{addWarrior(r.known.source,r.known.file||warriorFilename(r.known.name));detailNote.textContent=`Added ${r.name} to your warriors.`;fillRoster();}catch(error){detailNote.textContent=error.message;}};
 }
 fillRoster();
 return {show:fillRoster};
}

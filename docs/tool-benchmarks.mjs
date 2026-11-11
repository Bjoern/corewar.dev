// SPDX-License-Identifier: GPL-2.0-or-later
// Benchmarks view of the Tools tab: every benchmark suite in one place, to look into and edit. Your
// own suites change in place (name, description, match settings, warriors and their sources) and are
// saved with the workspace; built-in ones are read only and can be copied to edit. The suites
// themselves live in benchmark-store.mjs, shared with Tournaments, the library and the other tools.
import {el} from './tools.mjs';
import {describeSettings} from './tournaments.mjs';
import {readBenchmark,importBenchmarkFiles,benchmarkParameters} from './benchmarks.mjs';
import {benchmarkZip} from './benchmark-zip.mjs';
import {warriorFilename} from './warrior-files.mjs';
import {renderTable} from './results-tables.mjs';

const HELP=[
 ['What a suite is','A benchmark suite is a set of opponents with the match settings they fight under. Benchmark mode in Tournaments tests your warriors against one, round robin and melee can add one, and the optimizer and evolver score against one.'],
 ['Your suites and built-in ones','Built-in suites come with the site and are read only: Make an editable copy to change one. Your own suites (made here, from the library, from tournament results, or imported) change as you edit them, and are saved with your workspace in this browser and in Export workspace. Download .zip keeps a copy on its own, which Import reads back.'],
 ['Settings','The settings are the suite’s own, the ones its warriors were written for. Use in match settings puts them into the match settings that Battle, Tournaments and the tools run with; Take match settings does the opposite.'],
 ['Hill scores','Some suites ship hill scores, the results of their warriors against each other, for push-off rankings. They belong to exactly those warriors and settings, so changing either drops them; a push-off run in Tournaments computes them again.']
];
const NUMBERS=[['coreSize','Core size'],['cycles','Cycles'],['tasks','Processes'],['maxLength','Max length'],['distance','Min distance','0: the max length'],['pspace','P-space size','0: automatic'],['rounds','Rounds per opponent']];
const FLAGS=[['rules88','ICWS ’88 rules'],['noPspace','No P-space'],['permutate','All starting positions (-P)']];
const MAX_SUITE=500;
const settingKeys=benchmarkParameters.filter(k=>k!=='rounds');
const authorOf=source=>/^\s*;\s*author\s+(.*?)\s*$/im.exec(source)?.[1]||'';
// Lines of code, not counting comments, blank lines and anything after END.
function codeLines(source){
 let n=0;for(const line of source.split(/\r?\n/)){const code=line.replace(/;.*/,'').trim();if(!code)continue;if(/^end\b/i.test(code))break;n++;}return n;
}
const plural=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const fileStem=name=>name.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'benchmark';
// A file name not yet in used (lower-cased names), with -2, -3… before the extension if needed.
function uniquePath(name,used){
 const dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
 let file=name,n=2;while(used.has(file.toLowerCase()))file=stem+'-'+(n++)+ext;
 used.add(file.toLowerCase());return file;
}

export function mount(root,{roster,addWarrior,loadedSources=()=>[],readConfig,applyConfig=()=>{},suiteStore:store,useSuite=()=>{},loadState,saveState}){
 const saved=loadState()||{};
 let current=saved.selected&&store.get(saved.selected)?saved.selected:null,shown=null,viewing=null;
 const checked=new Set(),sort={key:'index',dir:'asc'};
 const button=(text,props={})=>el('button',{type:'button',textContent:text,...props});
 const status=()=>el('p',{className:'hint bm-status',role:'status'});
 const say=(node,text,failed=false)=>{node.textContent=text;node.dataset.result=failed?'failed':'ok';};

 // ---- the list of suites
 const list=el('div',{className:'bm-suites',role:'list'});
 const newSuite=button('New suite from your selected warriors',{id:'bmNewSuite'});
 const importFiles=el('input',{type:'file',multiple:true,accept:'.json,.red,.rc,.txt',id:'bmImportFiles'}),importFolder=el('input',{type:'file',multiple:true,id:'bmImportFolder'});
 importFolder.setAttribute('webkitdirectory','');
 const listStatus=status();listStatus.id='bmListStatus';
 const listCard=el('aside',{className:'t-card bm-list'},el('h3',{textContent:'Suites'}),list,
  el('div',{className:'bm-list-actions'},newSuite,
   el('label',{className:'bm-upload'},'Import a suite (descriptor and warrior files)',importFiles),
   el('label',{className:'bm-upload'},'Import a folder',importFolder)),listStatus);

 // ---- the selected suite
 const nameInput=el('input',{id:'bmName',className:'bm-name',maxLength:100,ariaLabel:'Suite name',spellcheck:false});
 const kind=el('span',{className:'bm-kind'});
 const description=el('textarea',{className:'bm-description',placeholder:'Description (optional): what the suite is for, where its warriors come from',ariaLabel:'Suite description',rows:2});
 const runIt=button('Use in Tournaments',{id:'bmUse',className:'primary',title:'Benchmark mode with this suite, its settings put into the match settings'});
 const zip=button('Download .zip',{id:'bmZip',title:'The descriptor and every warrior file, to keep or share; Import reads it back once unpacked'});
 const descriptorButton=button('Download descriptor');
 const copy=button('Make an editable copy');
 const remove=button('Remove suite',{className:'danger'});
 const headStatus=status();
 const headCard=el('section',{className:'t-card'},el('div',{className:'bm-title'},nameInput,kind),description,
  el('div',{className:'tool-actions'},runIt,zip,descriptorButton,copy,remove),headStatus);

 const settingsLine=el('p',{className:'hint'});
 const fields=new Map();
 const grid=el('div',{className:'bm-settings'});
 for(const [key,label,hint] of NUMBERS){const input=el('input',{type:'number',min:0,step:1});fields.set(key,input);grid.append(el('label',{title:hint||''},label,input));}
 const formula=el('input',{spellcheck:false});fields.set('formula',formula);
 grid.append(el('label',{className:'bm-wide'},'Score formula',formula));
 for(const [key,label] of FLAGS){const input=el('input',{type:'checkbox'});fields.set(key,input);grid.append(el('label',{className:'bm-flag'},input,' '+label));}
 const useSettings=button('Use in match settings',{title:'Put these settings into the match settings that Battle, Tournaments and the tools use'});
 const takeSettings=button('Take match settings',{title:'Replace these settings with the current match settings (rounds stay)'});
 const scoresLine=el('p',{className:'hint',hidden:true});
 const settingsStatus=status();
 const settingsCard=el('section',{className:'t-card'},el('h3',{textContent:'Settings'}),settingsLine,grid,
  el('div',{className:'tool-actions'},useSettings,takeSettings),scoresLine,settingsStatus);

 const warriorsTitle=el('h3',{textContent:'Warriors'});
 const filter=el('input',{type:'search',placeholder:'Filter by name, author or file',ariaLabel:'Filter warriors',spellcheck:false,autocomplete:'off'});
 const checkAll=button('Check all',{className:'small',title:'Check every warrior the filter shows'}),checkNone=button('Check none',{className:'small'});
 const addChecked=button('Add checked to warriors',{title:'Add the checked warriors to your warriors, as from the library'});
 const removeChecked=button('Remove checked from suite',{className:'danger'});
 const table=el('table',{id:'bmWarriors',className:'tool-table bm-table'});
 const tableWrap=el('div',{className:'tool-table-wrap'},table);
 const sourceName=el('h4',{});
 const source=el('textarea',{className:'opt-editor bm-source',spellcheck:false,ariaLabel:'Warrior source'});
 const saveSource=button('Save source',{className:'primary'}),addOne=button('Add to warriors'),closeSource=button('Close');
 const sourcePanel=el('div',{className:'bm-source-panel',hidden:true},sourceName,source,el('div',{className:'tool-actions'},saveSource,addOne,closeSource));
 const addSelected=button('Add your selected warriors');
 const addFiles=el('input',{type:'file',multiple:true,accept:'.red,.rc,.txt,.war'});
 const addRow=el('div',{className:'tool-actions bm-add'},addSelected,el('label',{className:'bm-upload'},'Add warrior files',addFiles));
 const warriorsStatus=status();
 const warriorsCard=el('section',{className:'t-card'},warriorsTitle,
  el('div',{className:'tool-actions'},filter,checkAll,checkNone,addChecked,removeChecked),warriorsStatus,tableWrap,sourcePanel,addRow);

 const json=el('textarea',{id:'bmDescriptor',className:'opt-editor bm-json',spellcheck:false,ariaLabel:'Suite descriptor (JSON)'});
 const applyJson=button('Apply',{id:'bmApplyDescriptor'});
 const jsonStatus=status();jsonStatus.id='bmDescriptorStatus';
 const jsonCard=el('details',{className:'t-card bm-advanced'},el('summary',{textContent:'Descriptor (JSON)'}),
  el('p',{className:'hint',textContent:'The suite as its suite.benchmark.json file: name, description, parameters and the warrior files in order. Edit it here for anything the fields above do not cover. Warrior files it no longer lists are dropped.'}),json,el('div',{className:'tool-actions'},applyJson),jsonStatus);

 const help=el('details',{className:'tool-help',open:!saved.helpClosed},el('summary',{textContent:'How it works'}),...HELP.map(([h,t])=>el('div',{},el('strong',{textContent:h}),el('p',{textContent:t}))));
 help.addEventListener('toggle',persist);
 root.append(el('div',{className:'bm-layout'},listCard,el('div',{className:'bm-main'},headCard,settingsCard,warriorsCard,jsonCard)),help);

 function persist(){saveState({selected:current,helpClosed:!help.open});}
 const suite=()=>store.get(current);
 const own=()=>!!suite()&&!store.builtIn(suite());
 function select(id){
  if(!store.get(id))return;
  if(id!==current){current=id;checked.clear();viewing=null;filter.value='';for(const s of [headStatus,settingsStatus,warriorsStatus,jsonStatus])s.textContent='';resetRemove();}
  persist();render();
 }

 // Change your own suite: mutate(descriptor,files) edits copies, and the suite is read again from them.
 // Changing the warriors or settings drops shipped hill scores, which were for the old ones.
 async function edit(mutate,{keepScores=false}={}){
  const old=await store.load(current);if(store.builtIn(old))throw new Error('Built-in suites are read only. Make an editable copy to change it.');
  const descriptor=structuredClone(old.descriptor),files={...old.files};
  const result=mutate(descriptor,files);
  const listed=new Set(descriptor.warriors);for(const file of Object.keys(files))if(!listed.has(file))delete files[file];
  const dropped=!keepScores&&descriptor.scores!==undefined;if(dropped)delete descriptor.scores;
  store.replace(old,readBenchmark(descriptor,files,old.id,dropped?null:old.scoresData));
  return {result,note:dropped?' Its hill scores were dropped, as they were for the old warriors and settings.':''};
 }
 // Settings errors name the field as the form does (settings.mjs names the parameter).
 const LABELS=Object.fromEntries([...NUMBERS,...FLAGS,['formula','Score formula']].map(([k,l])=>[k,l]));
 const friendly=message=>message.replace(/^(\w+)(?= must)/,key=>LABELS[key]||key);
 const attempt=async(where,action)=>{where.textContent='';try{const message=await action();if(message)say(where,message);}catch(error){say(where,friendly(error.message),true);render();}};

 // ---- list
 function suiteMeta(s){
  const count=s.warriors?s.warriors.length:Array.isArray(s.descriptor?.warriors)?s.descriptor.warriors.length:0;
  return `${plural(count,'warrior')} · ${s.config.rules88?'’88':'’94'} · core ${s.config.coreSize}`;
 }
 function renderList(){
  const mine=store.suites.filter(s=>!store.builtIn(s)),builtIn=store.suites.filter(s=>store.builtIn(s));
  const item=s=>{const b=el('button',{type:'button',className:'bm-suite',role:'listitem'},el('strong',{textContent:s.name}),el('small',{textContent:suiteMeta(s)}));
   if(s.id===current)b.setAttribute('aria-current','true');b.onclick=()=>select(s.id);return b;};
  list.replaceChildren(
   el('p',{className:'bm-group',textContent:'Your suites'}),...(mine.length?mine.map(item):[el('p',{className:'hint',textContent:'None yet. Make one from your warriors, from the library’s Create benchmark, or from a warrior’s results in Tournaments.'})]),
   el('p',{className:'bm-group',textContent:'Built in'}),...builtIn.map(item));
 }

 // ---- detail
 const setValue=(node,value,prop='value')=>{if(document.activeElement===node&&shown===suite())return;node[prop]=value;};
 function rows(s){
  const words=filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (s.warriors||[]).map((w,i)=>({id:w.file,index:i+1,name:w.name,author:authorOf(w.source),file:w.file,lines:codeLines(w.source),source:w.source,rowClass:w.file===viewing?'picked':''}))
   .filter(r=>words.every(word=>(r.name+' '+r.author+' '+r.file).toLowerCase().includes(word)));
 }
 function renderWarriors(s){
  const mineToo=!store.builtIn(s);
  if(!s.warriors){warriorsTitle.textContent='Warriors';table.replaceChildren();tableWrap.hidden=true;sourcePanel.hidden=true;
   say(warriorsStatus,s.loadError||'Loading the warriors…',!!s.loadError);if(!s.loadError)store.load(s).catch(()=>{});return;}
  tableWrap.hidden=false;
  for(const id of [...checked])if(!s.warriors.some(w=>w.file===id))checked.delete(id);
  const shownRows=rows(s);
  warriorsTitle.textContent=`Warriors (${s.warriors.length}${shownRows.length!==s.warriors.length?`, ${shownRows.length} shown`:''})`;
  const box={key:'check',label:'',sortable:false,className:'check',cell:row=>{
   const input=el('input',{type:'checkbox',checked:checked.has(row.id)});input.setAttribute('aria-label','Check '+row.name);
   input.onchange=()=>{if(input.checked)checked.add(row.id);else checked.delete(row.id);counts();};return input;}};
  const name={key:'name',label:'Name',firstDir:'asc',value:r=>r.name,cell:r=>{const b=el('button',{type:'button',className:'link-button',textContent:r.name,title:mineToo?'View and edit the source':'View the source'});b.onclick=()=>{viewing=viewing===r.id?null:r.id;render();if(viewing)sourcePanel.scrollIntoView({block:'nearest',behavior:'smooth'});};return b;}};
  renderTable(table,[box,{key:'index',label:'#',firstDir:'asc',className:'num',value:r=>r.index},name,
   {key:'author',label:'Author',firstDir:'asc',value:r=>r.author||null},{key:'file',label:'File',firstDir:'asc',value:r=>r.file},
   {key:'lines',label:'Lines',className:'num',title:'Lines of code, without comments',value:r=>r.lines}],shownRows,sort,render);
  const w=viewing&&s.warriors.find(x=>x.file===viewing);
  sourcePanel.hidden=!w;
  if(w){sourceName.textContent=`${w.name} · ${w.file}`;if(shown!==s||document.activeElement!==source)source.value=w.source;source.readOnly=!mineToo;saveSource.hidden=!mineToo;}
  counts();
 }
 function counts(){
  const s=suite(),n=s?.warriors?s.warriors.filter(w=>checked.has(w.file)).length:0;
  addChecked.disabled=removeChecked.disabled=!n;
  addChecked.textContent=n?`Add ${n} checked to warriors`:'Add checked to warriors';
  removeChecked.textContent=n?`Remove ${n} checked from suite`:'Remove checked from suite';
  const selected=roster().filter(w=>w.checked).length;
  addSelected.disabled=!selected;addSelected.textContent=selected?`Add your ${plural(selected,'selected warrior')}`:'Add your selected warriors';
  newSuite.disabled=!selected;newSuite.title=selected?`A new suite of your ${plural(selected,'selected warrior')}, with the match settings`:'Select warriors in the Battle tab’s list first';
 }
 function render(){
  if(!suite())current=(store.suites.find(s=>!store.builtIn(s))||store.suites[0])?.id??null;
  renderList();
  const s=suite();if(!s)return;
  const mineToo=!store.builtIn(s);
  setValue(nameInput,s.name);nameInput.readOnly=!mineToo;
  kind.textContent=mineToo?'Your suite · saved with your workspace':'Built in · read only';kind.dataset.kind=mineToo?'own':'builtin';
  setValue(description,s.descriptor.description||'');description.readOnly=!mineToo;description.hidden=!mineToo&&!s.descriptor.description;
  copy.hidden=mineToo;remove.hidden=!mineToo;zip.disabled=!s.warriors;
  settingsLine.textContent=`${describeSettings(s.config)} · ${s.rounds} rounds per opponent`;
  for(const [key,input] of fields){
   const value=key==='rounds'?s.rounds:s.config[key];
   if(input.type==='checkbox')setValue(input,!!value,'checked');else setValue(input,value??'');
   input.disabled=!mineToo;
  }
  takeSettings.hidden=!mineToo;
  scoresLine.hidden=s.descriptor.scores===undefined;
  scoresLine.textContent=s.scoresProblem?`Hill scores: ${s.scoresProblem}`:`Ships hill scores (${s.descriptor.scores}) for push-off rankings.`;
  addRow.hidden=removeChecked.hidden=!mineToo;
  renderWarriors(s);
  if(shown!==s||document.activeElement!==json)json.value=JSON.stringify(s.descriptor,null,2);
  json.readOnly=!mineToo;applyJson.hidden=!mineToo;
  shown=s;
 }

 // ---- list actions
 newSuite.onclick=()=>attempt(listStatus,()=>{
  const warriors=roster().filter(w=>w.checked);if(!warriors.length)throw new Error('Select warriors in the Battle tab’s list first.');
  if(warriors.length>MAX_SUITE)throw new Error(`A suite holds at most ${MAX_SUITE} warriors.`);
  const config=readConfig(),used=new Set(),files={};
  const paths=warriors.map(w=>{const file=uniquePath(warriorFilename(w.name),used);files[file]=w.source;return file;});
  const taken=new Set(store.suites.map(s=>s.name));let name='New suite',n=2;while(taken.has(name))name='New suite '+(n++);
  const created=store.create({version:1,name,parameters:{...Object.fromEntries(settingKeys.filter(k=>k in config).map(k=>[k,config[k]])),rounds:100},warriors:paths},files,{from:'tools'});
  select(created.id);nameInput.focus();nameInput.select();
  return `Created “${name}” with ${plural(warriors.length,'warrior')} and the match settings. Give it a name above.`;
 });
 for(const input of [importFiles,importFolder])input.onchange=()=>attempt(listStatus,async()=>{
  try{const imported=store.add(await importBenchmarkFiles(input.files,store.newId('import')),'tools');select(imported.id);
   return `Imported “${imported.name}” (${plural(imported.warriors.length,'warrior')}). It is saved with your workspace in this browser.`;}
  finally{input.value='';}
 });

 // ---- suite actions
 nameInput.onchange=()=>attempt(headStatus,async()=>{const name=nameInput.value.trim();if(!name)throw new Error('A suite needs a name.');await edit(d=>{d.name=name;},{keepScores:true});return '';});
 nameInput.onkeydown=event=>{if(event.key==='Enter')nameInput.blur();else if(event.key==='Escape'){nameInput.value=suite().name;nameInput.blur();}};
 description.onchange=()=>attempt(headStatus,async()=>{const text=description.value.trim();await edit(d=>{if(text)d.description=text;else delete d.description;},{keepScores:true});return '';});
 runIt.onclick=()=>useSuite(current);
 zip.onclick=()=>attempt(headStatus,async()=>{const s=await store.load(current);download(benchmarkZip(s),fileStem(s.name)+'.zip');return '';});
 descriptorButton.onclick=()=>{const s=suite();download(new Blob([JSON.stringify(s.descriptor,null,2)+'\n'],{type:'application/json'}),'suite.benchmark.json');};
 copy.onclick=()=>attempt(headStatus,async()=>{
  const s=await store.load(current),descriptor=structuredClone(s.descriptor);descriptor.name=(s.name+' (copy)').slice(0,100);
  const created=store.create(descriptor,s.files,{scores:s.scoresData,from:'tools'});select(created.id);
  return `“${created.name}” is yours to edit, and saved with your workspace.`;
 });
 // Removing takes a second click, so a stray click does not lose a suite.
 let removeTimer=null;
 function resetRemove(){clearTimeout(removeTimer);removeTimer=null;remove.textContent='Remove suite';}
 remove.onclick=()=>{
  const s=suite();if(!s||store.builtIn(s))return;
  if(!removeTimer){remove.textContent=`Click again to remove “${s.name}”`;removeTimer=setTimeout(resetRemove,4000);return;}
  resetRemove();store.remove(s);say(listStatus,`Removed “${s.name}”.`);
 };

 // ---- settings
 for(const [key,input] of fields)input.onchange=()=>attempt(settingsStatus,async()=>{
  let value;
  if(input.type==='checkbox')value=input.checked;
  else if(key==='formula'){value=input.value.trim();if(!value)throw new Error('A score formula is required.');}
  else{value=Number(input.value);if(input.value===''||!Number.isInteger(value))throw new Error('Enter a whole number.');}
  const {note}=await edit(d=>{d.parameters={...(d.parameters||{}),[key]:value};},{keepScores:key==='rounds'});
  return note.trim();
 });
 useSettings.onclick=()=>{const s=suite();applyConfig(Object.fromEntries(settingKeys.map(k=>[k,s.config[k]])));say(settingsStatus,`The match settings are now “${s.name}”’s. Battle, Tournaments and the tools run with them.`);};
 takeSettings.onclick=()=>attempt(settingsStatus,async()=>{
  const config=readConfig();
  const {note}=await edit(d=>{d.parameters={...Object.fromEntries(settingKeys.filter(k=>k in config).map(k=>[k,config[k]])),rounds:d.parameters?.rounds??suite().rounds};});
  return 'The suite now has the match settings.'+note;
 });

 // ---- warriors
 filter.oninput=render;
 checkAll.onclick=()=>{const s=suite();if(s?.warriors)for(const r of rows(s))checked.add(r.id);render();};
 checkNone.onclick=()=>{checked.clear();render();};
 function addToRoster(warriors){
  const loaded=new Set(loadedSources()),todo=[],seen=new Set();
  for(const w of warriors)if(!loaded.has(w.source)&&!seen.has(w.source)){seen.add(w.source);todo.push(w);}
  if(!todo.length)return warriors.length===1?'It is already in your warriors.':'They are already in your warriors.';
  let added=0;
  try{for(const w of todo){addWarrior(w.source,w.file.split('/').pop());added++;}}
  catch(error){throw new Error((added?plural(added,'warrior')+' added. ':'')+error.message);}
  const skipped=warriors.length-added;
  return `${plural(added,'warrior')} added to your warriors${skipped?` (${skipped} already there)`:''}.`;
 }
 addChecked.onclick=()=>attempt(warriorsStatus,()=>addToRoster(suite().warriors.filter(w=>checked.has(w.file))));
 addOne.onclick=()=>attempt(warriorsStatus,()=>addToRoster(suite().warriors.filter(w=>w.file===viewing)));
 removeChecked.onclick=()=>attempt(warriorsStatus,async()=>{
  const n=checked.size;
  const {note}=await edit(d=>{const left=d.warriors.filter(f=>!checked.has(f));if(!left.length)throw new Error('A suite needs at least one warrior. Remove the suite instead.');d.warriors=left;});
  if(checked.has(viewing))viewing=null;checked.clear();render();
  return `Removed ${plural(n,'warrior')} from the suite.`+note;
 });
 closeSource.onclick=()=>{viewing=null;render();};
 saveSource.onclick=()=>attempt(warriorsStatus,async()=>{
  const file=viewing,text=source.value;
  if(new TextEncoder().encode(text).length>65536)throw new Error('A warrior can be at most 64 KiB.');
  const {note}=await edit((d,files)=>{files[file]=text;});
  return `Saved ${file}.`+note;
 });
 // New warriors get file names of their own and are skipped if the suite has their source already.
 function addSources(list){
  return edit((d,files)=>{
   const have=new Set(Object.values(files)),used=new Set(d.warriors.map(f=>f.toLowerCase()));let added=0,same=0;
   for(const {name,source} of list){
    if(have.has(source)){same++;continue;}
    if(d.warriors.length>=MAX_SUITE)throw new Error(`A suite holds at most ${MAX_SUITE} warriors.`);
    const file=uniquePath(name,used);d.warriors.push(file);files[file]=source;have.add(source);added++;
   }
   return {added,same};
  });
 }
 const addedText=({added,same},note)=>(added?`Added ${plural(added,'warrior')} to the suite.`:'Nothing added.')+(same?` ${same} ${same===1?'was':'were'} in it already.`:'')+note;
 addSelected.onclick=()=>attempt(warriorsStatus,async()=>{
  const list=roster().filter(w=>w.checked).map(w=>({name:warriorFilename(w.name),source:w.source}));
  if(!list.length)throw new Error('Select warriors in the Battle tab’s list first.');
  const {result,note}=await addSources(list);return addedText(result,note);
 });
 addFiles.onchange=()=>attempt(warriorsStatus,async()=>{
  try{
   const list=[];
   for(const f of addFiles.files){if(f.size>65536)throw new Error('Warrior exceeds 64 KiB: '+f.name);list.push({name:f.name.replace(/[\\/:\0]/g,'_')||'warrior.red',source:await f.text()});}
   const {result,note}=await addSources(list);return addedText(result,note);
  }finally{addFiles.value='';}
 });

 // ---- descriptor
 applyJson.onclick=()=>attempt(jsonStatus,async()=>{
  let parsed;try{parsed=JSON.parse(json.value);}catch(error){throw new Error('Not valid JSON: '+error.message);}
  await edit(d=>{for(const k of Object.keys(d))delete d[k];Object.assign(d,parsed);},{keepScores:true});
  return 'Applied.';
 });

 store.subscribe(()=>{if(!root.hidden)render();});
 // The warrior list stays beside the tools, so ticking or adding warriors there changes what Add your selected warriors and New suite take.
 const recount=()=>{if(!root.hidden&&suite())counts();};
 document.addEventListener('change',recount);document.addEventListener('click',()=>setTimeout(recount));
 render();
 return {show(){render();},hide(){},select};
}

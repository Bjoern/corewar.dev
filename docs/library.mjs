// SPDX-License-Identifier: GPL-2.0-or-later
// The warrior library: search published Koenigstuhl warriors, add them to the workspace, download them,
// or turn a selection into a benchmark suite.
// Each hill's index is fetched the first time that hill is searched; warrior sources load when opened or added,
// or all at once per hill when full-text search is switched on or many of its warriors are used together.
import {libraryCatalog} from './library-catalog.mjs';
import {storeZip,benchmarkZip} from './benchmark-zip.mjs';
import {readBenchmark} from './benchmarks.mjs';
import {describeSettings} from './tournaments.mjs';

const PAGE=100, STATE_KEY='corewar-library', MAX_LOADED=36, MAX_SUITE=500;
// A first visit (and Reset) searches this hill: the most popular one, with a much smaller index than all hills together.
const DEFAULT_HILL='94nop';
const RANKINGS={rec:'Recursive',br:'Battle royal',top50:'Top 50'};
const COLUMNS={rank:'Rank',name:'Name',author:'Author',strategy:'Strategy'};
const FIELDS=['name','author','strategy','file'];
// Text is compared as lowercase words without accents or punctuation, so a term matches from the start of a word:
// "imp" finds "Imp" and "imps" but not "simple", and "paper/stone" finds "paper stone".
const fold=text=>' '+text.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

// "author:metcalf paper" → [{field:'author',text:' metcalf'},{field:null,text:' paper'}]; quotes keep a phrase together.
export function parseQuery(query){
 const terms=[];
 for(const m of query.matchAll(/(?:(\w+):)?(?:"([^"]*)"?|(\S+))/g)){
  let field=m[1]?.toLowerCase()??null,text=m[2]??m[3]??'';
  if(field && !FIELDS.includes(field) && field!=='source'){text=m[1]+':'+text;field=null;}
  text=fold(text);
  if(text.trim())terms.push({field,text});
 }
 return terms;
}
// Unprefixed terms search the header fields, plus the whole source when it is loaded for full-text search.
export function matches(warrior,terms,fullText=false){
 const fields=fullText?[...FIELDS,'source']:FIELDS;
 return terms.every(({field,text})=>field?(warrior.folded[field]??'').includes(text):fields.some(f=>warrior.folded[f]?.includes(text)));
}

// The ids of the hills to search: the chosen ones, or every hill when none is chosen.
export const searchedHills=(chosen,catalog=libraryCatalog)=>chosen.size?catalog.filter(h=>chosen.has(h.id)).map(h=>h.id):catalog.map(h=>h.id);
// Benchmark file paths: plain file names from one hill, "hill/file" when the selection spans several.
export function suitePaths(warriors){
 const many=new Set(warriors.map(w=>w.hill)).size>1;
 return warriors.map(w=>many?w.hill+'/'+w.file:w.file);
}
const plural=(n,word)=>n.toLocaleString()+' '+word+(n===1?'':'s');
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const safeName=text=>text.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'koenigstuhl';

export function setupLibrary({addWarrior,loadedFiles,addBenchmark}){
 const $=id=>document.getElementById(id);
 let noticeTimer=0;
 const notice=(text,error=false)=>{const n=$('libraryNotice');n.textContent=text;n.dataset.error=String(error);n.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{n.hidden=true;},error?8000:4000);};
 const hills=new Map(),loading=new Map(),texts=new Map(),textLoading=new Map(),sources=new Map();
 const hillOf=id=>libraryCatalog.find(h=>h.id===id);
 let saved={};try{saved=JSON.parse(localStorage.getItem(STATE_KEY))||{};}catch{}
 // No chosen hill means every hill; choosing hills narrows the search to them.
 const defaultHills=()=>new Set(hillOf(DEFAULT_HILL)?[DEFAULT_HILL]:[]);
 let chosen=Array.isArray(saved.hills)?new Set(saved.hills.filter(id=>hillOf(id))):defaultHills();
 if(chosen.size===libraryCatalog.length)chosen.clear();
 const sameHills=(a,b)=>a.size===b.size&&[...a].every(id=>b.has(id));
 let sortBy=COLUMNS[saved.sortBy]?saved.sortBy:'rank',descending=saved.descending===true;
 let shown=PAGE,open=null,results=[],active=false,searchSerial=0,selectedOnly=false;
 // Selected warriors by "hill/file"; kept across searches until cleared or the page is closed.
 const selected=new Map();
 const keyOf=w=>w.hill+'/'+w.file;
 $('librarySearch').value=typeof saved.query==='string'?saved.query:'';
 if(saved.ranking==='br')$('libraryRanking').value='br';
 $('libraryTop50').checked=saved.top50===true;
 $('libraryFullText').checked=saved.fullText===true;
 const save=()=>{try{localStorage.setItem(STATE_KEY,JSON.stringify({hills:[...chosen],query:$('librarySearch').value,sortBy,descending,ranking:$('libraryRanking').value,top50:$('libraryTop50').checked,fullText:$('libraryFullText').checked}));}catch{}};
 const ids=()=>searchedHills(chosen);

 function hillButtons(){
  const all=document.createElement('button');all.type='button';all.className='lib-hill';all.textContent='All hills';
  all.setAttribute('aria-pressed',String(!chosen.size));all.title='Search every hill';
  all.onclick=()=>{chosen.clear();changed();};
  $('libraryHills').replaceChildren(...(libraryCatalog.length>1?[all]:[]),...libraryCatalog.map(h=>{
   const b=document.createElement('button');b.type='button';b.className='lib-hill';b.setAttribute('aria-pressed',String(chosen.has(h.id)));
   b.title=h.count.toLocaleString()+' warriors'+(h.options?' · pMARS '+h.options:'');
   const label=document.createElement('span');label.textContent=h.label;const count=document.createElement('small');count.textContent=' '+h.count.toLocaleString();
   b.append(label,count);
   // Hills toggle on and off; turning off the last one searches every hill again.
   b.onclick=()=>{if(chosen.has(h.id))chosen.delete(h.id);else chosen.add(h.id);if(chosen.size===libraryCatalog.length)chosen.clear();changed();};
   return b;
  }));
  $('libraryTop50Label').hidden=!ids().some(id=>hillOf(id)?.rankings.includes('top50'));
  updated();resetButton();
 }
 // The snapshot date of the searched hills, as one date or the oldest and newest when they differ.
 const day=iso=>new Date(iso+'T12:00:00Z').toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
 function updated(){
  const dates=[...new Set(ids().map(id=>hillOf(id).updated).filter(Boolean))].sort();
  $('libraryUpdated').textContent=!dates.length?'':dates.length===1?'Last updated '+day(dates[0])+'.':'Last updated between '+day(dates[0])+' and '+day(dates.at(-1))+'.';
 }
 // Reset appears once the search differs from a fresh one: the default hill, no query or filters, by rank.
 const isFresh=()=>sameHills(chosen,defaultHills())&&!$('librarySearch').value&&!$('libraryTop50').checked&&!$('libraryFullText').checked&&$('libraryRanking').value==='rec'&&sortBy==='rank'&&!descending&&!selectedOnly;
 function resetButton(){$('libraryReset').hidden=isFresh();}
 $('libraryReset').onclick=()=>{
  chosen=defaultHills();$('librarySearch').value='';$('libraryTop50').checked=false;$('libraryFullText').checked=false;$('libraryRanking').value='rec';
  sortBy='rank';descending=false;selectedOnly=false;$('librarySelectedOnly').checked=false;columnHeaders();changed();$('librarySearch').focus();
 };
 // Column headers sort the results; choosing the current column again reverses the order.
 function columnHeaders(){
  $('libraryColumns').replaceChildren(...Object.entries(COLUMNS).map(([key,label])=>{
   const b=document.createElement('button');b.type='button';b.className='lib-sort lib-col-'+key;
   const current=key===sortBy;
   b.textContent=label+(current?(descending?' ↓':' ↑'):'');
   b.setAttribute('aria-pressed',String(current));
   b.title=current?'Reverse the order':'Sort by '+label.toLowerCase()+(key==='rank'?' ('+RANKINGS[$('libraryRanking').value]+')':'');
   b.onclick=()=>{if(sortBy===key)descending=!descending;else{sortBy=key;descending=false;}shown=PAGE;save();columnHeaders();search();};
   return b;
  }));
 }
 function fetchJson(url,what){
  return fetch(url).then(r=>{if(!r.ok)throw new Error('Could not load '+what+' ('+r.status+').');return r.json();});
 }
 function load(id){
  if(hills.has(id))return Promise.resolve(hills.get(id));
  if(!loading.has(id)){
   const hill=hillOf(id);
   loading.set(id,fetchJson(hill.index,'the '+hill.label+' library').then(list=>{
    const warriors=list.map(w=>({...w,hill:id,strategy:w.strategy||'',folded:Object.fromEntries(FIELDS.map(f=>[f,fold(w[f]||'')]))}));
    hills.set(id,warriors);return warriors;
   }).finally(()=>loading.delete(id)));
  }
  return loading.get(id);
 }
 // One file holds every source of a hill: used by full-text search and when many of its warriors are needed at once.
 function loadText(id){
  if(texts.has(id))return Promise.resolve();
  if(!textLoading.has(id)){
   const hill=hillOf(id);
   textLoading.set(id,Promise.all([load(id),fetchJson(hill.text,'the '+hill.label+' sources')]).then(([warriors,files])=>{
    for(const w of warriors){const text=files[w.file]??'';w.folded.source=fold(text);sources.set(id+'/'+w.file,Promise.resolve(text));}
    texts.set(id,true);
   }).finally(()=>textLoading.delete(id)));
  }
  return textLoading.get(id);
 }
 function sortKey(){
  const ranking=$('libraryRanking').value;
  if(sortBy==='rank')return w=>w[ranking]?.[0]??null;
  // Leading punctuation ("- Evolved imps", "^C") is ignored so text sorts by its first letter or digit.
  return w=>(sortBy==='strategy'?w.strategy.split('\n')[0]:w[sortBy]).replace(/^[^\p{L}\p{N}]+/u,'').toLowerCase()||null;
 }
 function sortResults(list){
  const key=sortKey(),direction=descending?-1:1,collator=new Intl.Collator(undefined,{numeric:true});
  // Warriors without a value (unranked, or no strategy) stay at the end in either direction.
  return list.sort((a,b)=>{
   const x=key(a),y=key(b);
   if(x===null||y===null)return x===y?0:x===null?1:-1;
   const order=typeof x==='number'?x-y:collator.compare(x,y);
   return order*direction||collator.compare(a.hill,b.hill);
  });
 }
 async function search(){
  resetButton();
  // "Show selected only" lists the selection itself, whatever the hills and search say.
  if(selectedOnly){results=sortResults([...selected.values()]);render();return;}
  const serial=++searchSerial,searched=ids(),fullText=$('libraryFullText').checked;
  const missing=searched.filter(id=>!hills.has(id)||(fullText&&!texts.has(id)));
  if(missing.length){
   $('libraryCount').textContent=fullText&&searched.some(id=>!texts.has(id))?'Loading warrior sources for full-text search…':'Loading…';
   try{await Promise.all(searched.map(id=>fullText?loadText(id):load(id)));}catch(error){$('libraryCount').textContent=error.message;return;}
   if(serial!==searchSerial)return; // A newer search started while this one was loading.
  }
  const terms=parseQuery($('librarySearch').value),top50=$('libraryTop50').checked && !$('libraryTop50Label').hidden;
  results=sortResults(searched.flatMap(id=>hills.get(id)).filter(w=>(!top50||w.top50)&&matches(w,terms,fullText)));
  render();
 }
 function changed(){shown=PAGE;open=null;save();hillButtons();search();}

 const scoreText=pair=>'#'+pair[0]+' · '+pair[1].toFixed(2);
 function row(w,loaded,many){
  const item=document.createElement('li');item.className='lib-row';item.dataset.key=keyOf(w);
  const head=document.createElement('div');head.className='lib-head';
  const check=document.createElement('input');check.type='checkbox';check.className='lib-check';check.checked=selected.has(item.dataset.key);
  check.setAttribute('aria-label','Select '+w.name);
  check.onchange=()=>{if(check.checked)selected.set(item.dataset.key,w);else selected.delete(item.dataset.key);selection();};
  const toggle=document.createElement('button');toggle.type='button';toggle.className='lib-toggle lib-grid';toggle.setAttribute('aria-expanded',String(open===item.dataset.key));
  const by=$('libraryRanking').value;
  const rank=document.createElement('span');rank.className='lib-rank';rank.textContent=w[by]?'#'+w[by][0]:'–';rank.title=RANKINGS[by]+' rank';
  const name=document.createElement('strong');name.className='lib-name';name.textContent=w.name;
  if(many){const tag=document.createElement('span');tag.className='lib-tag';tag.textContent=w.hill;name.append(' ',tag);}
  const author=document.createElement('span');author.className='lib-author';author.textContent=w.author||'unknown author';
  const strategy=document.createElement('span');strategy.className='lib-strategy';strategy.textContent=w.strategy.split('\n')[0];
  toggle.append(rank,name,author,strategy);
  toggle.onclick=()=>{open=open===item.dataset.key?null:item.dataset.key;render();};
  const add=document.createElement('button');add.type='button';add.className='lib-add';
  const isLoaded=loaded.has(w.file);
  add.textContent=isLoaded?'Added':'Add';add.disabled=isLoaded;
  add.title=isLoaded?'Already in your warriors':'Add to your warriors';add.setAttribute('aria-label',(isLoaded?'Added: ':'Add ')+w.name);
  add.onclick=async()=>{
   add.disabled=true;
   try{addWarrior(await source(w),w.file);notice(w.name+' added to your warriors.');}
   catch(error){add.disabled=false;notice(error.message,true);}
  };
  head.append(check,toggle,add);item.append(head);
  if(open===item.dataset.key)item.append(details(w));
  return item;
 }
 function details(w){
  const box=document.createElement('div');box.className='lib-details';
  const facts=document.createElement('p');facts.className='lib-facts';
  facts.textContent=Object.keys(RANKINGS).filter(k=>w[k]).map(k=>RANKINGS[k]+' '+scoreText(w[k])).join('   ');
  const origin=hillOf(w.hill)?.origin;
  if(origin){const a=document.createElement('a');a.href=origin+encodeURIComponent(w.remote??w.file);a.target='_blank';a.rel='noopener';a.textContent=(w.remote??w.file)+' on Koenigstuhl';facts.append('   ',a);}
  const actions=document.createElement('span');actions.className='lib-file-actions';
  const save=document.createElement('button');save.type='button';save.textContent='Download';save.title='Save '+w.file;
  save.onclick=async()=>{try{download(new Blob([await source(w)],{type:'text/plain'}),w.file);}catch(error){notice(error.message,true);}};
  const copy=document.createElement('button');copy.type='button';copy.textContent='Copy';copy.title='Copy the source to the clipboard';
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(await source(w));notice(w.file+' copied to the clipboard.');}catch(error){notice('Could not copy: '+error.message,true);}};
  actions.append(save,copy);facts.append(actions);
  box.append(facts);
  if(w.strategy.includes('\n')){const s=document.createElement('p');s.className='lib-full-strategy';s.textContent=w.strategy;box.append(s);}
  const pre=document.createElement('pre');pre.className='lib-source';pre.textContent='Loading source…';box.append(pre);
  source(w).then(text=>{pre.textContent=text;}).catch(error=>{pre.textContent=error.message;});
  return box;
 }
 function source(w){
  const key=keyOf(w);
  if(!sources.has(key))sources.set(key,fetch('library/'+encodeURIComponent(w.hill)+'/'+encodeURIComponent(w.file)).then(r=>{if(!r.ok)throw new Error('Could not load '+w.file+' ('+r.status+').');return r.text();}).catch(error=>{sources.delete(key);throw error;}));
  return sources.get(key);
 }
 // Sources for many warriors: a hill's sources file when many of its warriors are needed, single files otherwise.
 async function sourcesOf(list){
  const perHill=new Map();for(const w of list)perHill.set(w.hill,(perHill.get(w.hill)||0)+1);
  await Promise.all([...perHill].filter(([,n])=>n>20).map(([id])=>loadText(id)));
  const out=new Array(list.length);let next=0;
  const worker=async()=>{while(next<list.length){const i=next++;out[i]=await source(list[i]);}};
  await Promise.all(Array.from({length:Math.min(8,list.length)},worker));
  return out;
 }
 function render(){
  const loaded=new Set(loadedFiles()),many=selectedOnly?new Set(results.map(w=>w.hill)).size>1:ids().length>1;
  if(selectedOnly)$('libraryCount').textContent='Showing the '+plural(results.length,'selected warrior');
  else{
   const total=ids().reduce((n,id)=>n+(hills.get(id)?.length||0),0);
   $('libraryCount').textContent=(results.length===total?total.toLocaleString()+' warriors':results.length.toLocaleString()+' of '+total.toLocaleString()+' warriors')+($('libraryFullText').checked?' · searching full source':'');
  }
  $('libraryResults').replaceChildren(...results.slice(0,shown).map(w=>row(w,loaded,many)));
  $('libraryMore').hidden=results.length<=shown;
  $('libraryMore').textContent='Show '+Math.min(PAGE,results.length-shown).toLocaleString()+' more';
  selection();
 }
 // The header checkbox and the action bar follow the selection.
 function selection(){
  const inResults=results.filter(w=>selected.has(keyOf(w))).length,all=$('librarySelectAll');
  all.checked=results.length>0&&inResults===results.length;all.indeterminate=inResults>0&&inResults<results.length;
  all.disabled=!results.length;
  const label=all.checked?'Unselect all '+plural(results.length,'matching warrior'):'Select all '+plural(results.length,'matching warrior');
  all.title=label;all.setAttribute('aria-label',label);
  $('librarySelection').hidden=!selected.size&&!selectedOnly;
  $('librarySelected').textContent=plural(selected.size,'warrior')+' selected';
  for(const id of ['libraryAddSelected','libraryZip','libraryBenchmark','libraryClear'])$(id).disabled=!selected.size;
  $('libraryAddSelected').title=selected.size>MAX_LOADED?'At most '+MAX_LOADED+' warriors can be loaded':'Add the selected warriors to your warriors';
  $('libraryBenchmark').title=selected.size>MAX_SUITE?'A benchmark holds at most '+MAX_SUITE+' warriors':'Make a benchmark suite of the selected warriors';
 }
 $('librarySelectAll').onchange=()=>{
  const all=results.length>0&&results.every(w=>selected.has(keyOf(w)));
  for(const w of results){if(all)selected.delete(keyOf(w));else selected.set(keyOf(w),w);}
  if(selectedOnly)search();else render();
 };
 $('librarySelectedOnly').onchange=()=>{selectedOnly=$('librarySelectedOnly').checked;shown=PAGE;open=null;search();};
 $('libraryClear').onclick=()=>{selected.clear();if(selectedOnly){selectedOnly=false;$('librarySelectedOnly').checked=false;search();}else render();};
 const selectedList=()=>sortResults([...selected.values()]);
 $('libraryAddSelected').onclick=async()=>{
  const loaded=new Set(loadedFiles()),todo=selectedList().filter(w=>!loaded.has(w.file));
  if(!todo.length){notice('The selected warriors are already in your warriors.');return;}
  if(todo.length+loaded.size>MAX_LOADED){notice(`At most ${MAX_LOADED} warriors can be loaded: ${loaded.size} already loaded and ${todo.length} more selected.`,true);return;}
  let added=0;
  try{const list=await sourcesOf(todo);for(const [i,w] of todo.entries()){addWarrior(list[i],w.file);added++;}notice(plural(added,'warrior')+' added to your warriors.');}
  catch(error){notice((added?plural(added,'warrior')+' added. ':'')+error.message,true);}
  render();
 };
 $('libraryZip').onclick=async()=>{
  const list=selectedList();
  try{
   const files=await sourcesOf(list),paths=suitePaths(list),hillIds=[...new Set(list.map(w=>w.hill))];
   download(storeZip(paths.map((p,i)=>[p,files[i]])),'koenigstuhl-'+safeName(hillIds.join('-'))+'-'+list.length+'.zip');
  }catch(error){notice(error.message,true);}
 };

 // Create benchmark: the selection as opponents, with the match settings of one hill.
 const dialog=$('libraryBenchmarkDialog'),withSettings=libraryCatalog.filter(h=>h.parameters);
 const sameRules=(a,b)=>JSON.stringify({...a,rounds:0})===JSON.stringify({...b,rounds:0});
 function benchmarkSettings(){
  const hill=hillOf($('libraryBenchmarkHill').value),used=[...new Set([...selected.values()].map(w=>w.hill))];
  $('libraryBenchmarkSettings').textContent=hill?describeSettings(hill.parameters)+' · Koenigstuhl: pmars '+hill.options:'';
  const mixed=used.map(hillOf).filter(h=>!h.parameters||!hill||!sameRules(h.parameters,hill.parameters)).map(h=>h.label);
  const warnings=[];
  if(mixed.length)warnings.push('Warriors from '+mixed.join(', ')+' were made for other rules than '+hill.label+'.');
  if(hill?.id==='odd')warnings.push('The Odd hill holds warriors from special rule sets; these are its default settings.');
  $('libraryBenchmarkWarning').textContent=warnings.join(' ');$('libraryBenchmarkWarning').hidden=!warnings.length;
 }
 $('libraryBenchmarkHill').onchange=()=>{const hill=hillOf($('libraryBenchmarkHill').value);$('libraryBenchmarkRounds').value=hill.parameters.rounds;benchmarkSettings();};
 $('libraryBenchmark').onclick=()=>{
  const list=selectedList();
  if(list.length>MAX_SUITE){notice(`A benchmark holds at most ${MAX_SUITE} warriors; ${list.length.toLocaleString()} are selected.`,true);return;}
  const used=[...new Set(list.map(w=>w.hill))],first=used.map(hillOf).find(h=>h.parameters)||withSettings[0];
  $('libraryBenchmarkHill').replaceChildren(...withSettings.map(h=>new Option(h.label+' hill',h.id)));
  $('libraryBenchmarkHill').value=first.id;$('libraryBenchmarkRounds').value=first.parameters.rounds;
  const dates=[...new Set(used.map(id=>hillOf(id).updated).filter(Boolean))].sort();
  const top50=list.every(w=>w.top50)&&$('libraryTop50').checked?' top 50':'';
  $('libraryBenchmarkName').value=('Koenigstuhl '+used.join(' + ')+top50+' · '+plural(list.length,'warrior')+(dates.length?' · '+dates.at(-1):'')).slice(0,100);
  $('libraryBenchmarkWhat').textContent=plural(list.length,'selected warrior')+' from '+used.join(', ')+' become the opponents.';
  $('libraryBenchmarkStatus').textContent='';
  benchmarkSettings();dialog.showModal();$('libraryBenchmarkName').select();
 };
 // The descriptor and sources of the benchmark in the dialog; throws with a message for the dialog.
 async function benchmark(){
  const name=$('libraryBenchmarkName').value.trim(),rounds=Number($('libraryBenchmarkRounds').value),hill=hillOf($('libraryBenchmarkHill').value);
  if(!name){$('libraryBenchmarkName').focus();throw new Error('Enter a name for the benchmark.');}
  if(!Number.isInteger(rounds)||rounds<1){$('libraryBenchmarkRounds').focus();throw new Error('Rounds must be a positive whole number.');}
  const list=selectedList(),paths=suitePaths(list),used=[...new Set(list.map(w=>w.hill))];
  const dates=[...new Set(used.map(id=>hillOf(id).updated).filter(Boolean))].sort();
  $('libraryBenchmarkStatus').textContent='Loading '+plural(list.length,'warrior source')+'…';
  const files=await sourcesOf(list);
  const descriptor={version:1,name,
   description:`${plural(list.length,'warrior')} from the Koenigstuhl ${used.join(', ')} hill${used.length>1?'s':''}${dates.length?' (snapshot '+dates.join(', ')+')':''}, with the ${hill.label} hill's settings (pmars ${hill.options}).`,
   parameters:{...hill.parameters,rounds},warriors:paths};
  const sourcesByPath=Object.fromEntries(paths.map((p,i)=>[p,files[i]]));
  readBenchmark(descriptor,sourcesByPath); // validate before using or saving it
  return {descriptor,files:sourcesByPath};
 }
 async function finish(action){
  const buttons=[$('libraryBenchmarkUse'),$('libraryBenchmarkZip')];buttons.forEach(b=>{b.disabled=true;});
  try{await action(await benchmark());}
  catch(error){$('libraryBenchmarkStatus').textContent=error.message;}
  finally{buttons.forEach(b=>{b.disabled=false;});}
 }
 $('libraryBenchmarkUse').onclick=()=>finish(({descriptor,files})=>{addBenchmark(descriptor,files);dialog.close();});
 $('libraryBenchmarkZip').onclick=()=>finish(({descriptor,files})=>{
  download(benchmarkZip(readBenchmark(descriptor,files)),safeName(descriptor.name)+'.zip');
  $('libraryBenchmarkStatus').textContent='Saved. Import it later under Tournaments → Benchmark → Import a suite.';
 });

 let typing=0;
 $('librarySearch').addEventListener('input',()=>{clearTimeout(typing);typing=setTimeout(()=>{shown=PAGE;open=null;save();search();},120);});
 $('libraryTop50').onchange=$('libraryFullText').onchange=()=>{shown=PAGE;save();search();};
 $('libraryRanking').onchange=()=>{shown=PAGE;save();columnHeaders();search();};
 $('libraryMore').onclick=()=>{shown+=PAGE;render();};
 hillButtons();columnHeaders();
 return {
  show(){active=true;if(!libraryCatalog.length){$('libraryCount').textContent='No hills are included in this build.';return;}if(results.length)render();else search();},
  hide(){active=false;},
  refresh(){if(active && hills.size)render();}
 };
}

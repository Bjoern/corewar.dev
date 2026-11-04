// SPDX-License-Identifier: GPL-2.0-or-later
// The warrior library: search published Koenigstuhl warriors and add them to the workspace.
// Each hill's index is fetched the first time that hill is searched; warrior sources load when opened or added,
// or all at once per hill when full-text search is switched on.
import {libraryCatalog} from './library-catalog.mjs';

const PAGE=100, STATE_KEY='corewar-library';
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

export function setupLibrary({addWarrior,loadedFiles}){
 const $=id=>document.getElementById(id);
 let noticeTimer=0;
 const notice=(text,error=false)=>{const n=$('libraryNotice');n.textContent=text;n.dataset.error=String(error);n.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{n.hidden=true;},error?8000:4000);};
 const hills=new Map(),loading=new Map(),texts=new Map(),textLoading=new Map(),sources=new Map();
 let saved={};try{saved=JSON.parse(localStorage.getItem(STATE_KEY))||{};}catch{}
 let chosen=new Set((saved.hills||[]).filter(id=>libraryCatalog.some(h=>h.id===id)));
 if(!chosen.size && libraryCatalog.length)chosen.add(libraryCatalog[0].id);
 let sortBy=COLUMNS[saved.sortBy]?saved.sortBy:'rank',descending=saved.descending===true;
 let shown=PAGE,open=null,results=[],active=false,searchSerial=0;
 $('librarySearch').value=typeof saved.query==='string'?saved.query:'';
 if(saved.ranking==='br')$('libraryRanking').value='br';
 $('libraryTop50').checked=saved.top50===true;
 $('libraryFullText').checked=saved.fullText===true;
 const save=()=>{try{localStorage.setItem(STATE_KEY,JSON.stringify({hills:[...chosen],query:$('librarySearch').value,sortBy,descending,ranking:$('libraryRanking').value,top50:$('libraryTop50').checked,fullText:$('libraryFullText').checked}));}catch{}};

 function hillButtons(){
  const all=document.createElement('button');all.type='button';all.className='lib-hill';all.textContent='All hills';
  all.setAttribute('aria-pressed',String(chosen.size===libraryCatalog.length));
  all.onclick=()=>{chosen=new Set(libraryCatalog.map(h=>h.id));changed();};
  $('libraryHills').replaceChildren(...(libraryCatalog.length>1?[all]:[]),...libraryCatalog.map(h=>{
   const b=document.createElement('button');b.type='button';b.className='lib-hill';b.setAttribute('aria-pressed',String(chosen.has(h.id)));
   b.title=h.count.toLocaleString()+' warriors';
   const label=document.createElement('span');label.textContent=h.label;const count=document.createElement('small');count.textContent=' '+h.count.toLocaleString();
   b.append(label,count);
   // Hills toggle on and off; the last one stays on so there is always something to search.
   b.onclick=()=>{if(!chosen.has(h.id))chosen.add(h.id);else if(chosen.size>1)chosen.delete(h.id);changed();};
   return b;
  }));
  const top50=[...chosen].some(id=>libraryCatalog.find(h=>h.id===id)?.rankings.includes('top50'));
  $('libraryTop50Label').hidden=!top50;
 }
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
   const hill=libraryCatalog.find(h=>h.id===id);
   loading.set(id,fetchJson(hill.index,'the '+hill.label+' library').then(list=>{
    const warriors=list.map(w=>({...w,hill:id,strategy:w.strategy||'',folded:Object.fromEntries(FIELDS.map(f=>[f,fold(w[f]||'')]))}));
    hills.set(id,warriors);return warriors;
   }).finally(()=>loading.delete(id)));
  }
  return loading.get(id);
 }
 // Full-text search loads every source of a hill in one file and folds it into each warrior's searchable text.
 function loadText(id){
  if(texts.has(id))return Promise.resolve();
  if(!textLoading.has(id)){
   const hill=libraryCatalog.find(h=>h.id===id);
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
 async function search(){
  const serial=++searchSerial,ids=[...chosen],fullText=$('libraryFullText').checked;
  const missing=ids.filter(id=>!hills.has(id)||(fullText&&!texts.has(id)));
  if(missing.length){
   $('libraryCount').textContent=fullText&&ids.some(id=>!texts.has(id))?'Loading warrior sources for full-text search…':'Loading…';
   try{await Promise.all(ids.map(id=>fullText?loadText(id):load(id)));}catch(error){$('libraryCount').textContent=error.message;return;}
   if(serial!==searchSerial)return; // A newer search started while this one was loading.
  }
  const terms=parseQuery($('librarySearch').value),top50=$('libraryTop50').checked && !$('libraryTop50Label').hidden;
  const key=sortKey(),direction=descending?-1:1,collator=new Intl.Collator(undefined,{numeric:true});
  results=ids.flatMap(id=>hills.get(id)).filter(w=>(!top50||w.top50)&&matches(w,terms,fullText));
  // Warriors without a value (unranked, or no strategy) stay at the end in either direction.
  results.sort((a,b)=>{
   const x=key(a),y=key(b);
   if(x===null||y===null)return x===y?0:x===null?1:-1;
   const order=typeof x==='number'?x-y:collator.compare(x,y);
   return order*direction||collator.compare(a.hill,b.hill);
  });
  render();
 }
 function changed(){shown=PAGE;open=null;save();hillButtons();search();}

 const scoreText=pair=>'#'+pair[0]+' · '+pair[1].toFixed(2);
 function row(w,loaded,many){
  const item=document.createElement('li');item.className='lib-row';item.dataset.key=w.hill+'/'+w.file;
  const head=document.createElement('div');head.className='lib-head';
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
  add.textContent=isLoaded?'Added ✓':'Add';add.disabled=isLoaded;
  add.title=isLoaded?'Already in your warriors':'Add to your warriors';add.setAttribute('aria-label',(isLoaded?'Added: ':'Add ')+w.name);
  add.onclick=async()=>{
   add.disabled=true;
   try{addWarrior(await source(w),w.file);notice(w.name+' added to your warriors.');}
   catch(error){add.disabled=false;notice(error.message,true);}
  };
  head.append(toggle,add);item.append(head);
  if(open===item.dataset.key)item.append(details(w));
  return item;
 }
 function details(w){
  const box=document.createElement('div');box.className='lib-details';
  const facts=document.createElement('p');facts.className='lib-facts';
  facts.textContent=Object.keys(RANKINGS).filter(k=>w[k]).map(k=>RANKINGS[k]+' '+scoreText(w[k])).join('   ');
  const origin=libraryCatalog.find(h=>h.id===w.hill)?.origin;
  if(origin){const a=document.createElement('a');a.href=origin+encodeURIComponent(w.file);a.target='_blank';a.rel='noopener';a.textContent=w.file+' on Koenigstuhl';facts.append('   ',a);}
  box.append(facts);
  if(w.strategy.includes('\n')){const s=document.createElement('p');s.className='lib-full-strategy';s.textContent=w.strategy;box.append(s);}
  const pre=document.createElement('pre');pre.className='lib-source';pre.textContent='Loading source…';box.append(pre);
  source(w).then(text=>{pre.textContent=text;}).catch(error=>{pre.textContent=error.message;});
  return box;
 }
 function source(w){
  const key=w.hill+'/'+w.file;
  if(!sources.has(key))sources.set(key,fetch('library/'+encodeURIComponent(w.hill)+'/'+encodeURIComponent(w.file)).then(r=>{if(!r.ok)throw new Error('Could not load '+w.file+' ('+r.status+').');return r.text();}).catch(error=>{sources.delete(key);throw error;}));
  return sources.get(key);
 }
 function render(){
  const loaded=new Set(loadedFiles()),many=chosen.size>1;
  const total=[...chosen].reduce((n,id)=>n+(hills.get(id)?.length||0),0);
  $('libraryCount').textContent=(results.length===total?total.toLocaleString()+' warriors':results.length.toLocaleString()+' of '+total.toLocaleString()+' warriors')+($('libraryFullText').checked?' · searching full source':'');
  $('libraryResults').replaceChildren(...results.slice(0,shown).map(w=>row(w,loaded,many)));
  $('libraryMore').hidden=results.length<=shown;
  $('libraryMore').textContent='Show '+Math.min(PAGE,results.length-shown).toLocaleString()+' more';
 }

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

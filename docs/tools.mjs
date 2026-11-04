// SPDX-License-Identifier: GPL-2.0-or-later
// The Tools tab: helpers for warrior authors. Each tool is one entry in TOOLS with a mount
// function that builds its view the first time it is opened; adding a tool is adding an entry.
// Addresses: #tools shows the overview, #tools/<id> opens a tool.
const $=id=>document.getElementById(id);
const el=(tag,props={},...children)=>{const e=Object.assign(document.createElement(tag),props);e.append(...children.filter(c=>c!=null));return e;};
export const TOOLS=[
 {id:'optimizer',title:'Constant optimizer',icon:'⚙',
  summary:'Tune the numbers in your warrior (steps, offsets, decoy distances, even opcodes and modes) against a benchmark, with simulated annealing or a genetic algorithm.',
  load:()=>import('./tool-optimizer.mjs')},
 {id:'step-finder',title:'Step finder',icon:'⌗',
  summary:'Rank bombing and scanning steps for a core size by how fast they leave no gap a small warrior could hide in, and see why a step is good or bad.',
  load:()=>import('./tool-stepfinder.mjs')}
];
const IDEAS=['Scanner patterns with two locations per scan (CMP/SEQ with an offset)','Optimizing several steps together, as Stefan Strack’s Mopt does','Decoy and quickscan layout checks'];
const STORE='corewar.tools.v1';
export function loadToolState(id){try{return JSON.parse(localStorage.getItem(STORE)||'{}')[id]??null;}catch{return null;}}
export function saveToolState(id,value){try{const all=JSON.parse(localStorage.getItem(STORE)||'{}');all[id]=value;localStorage.setItem(STORE,JSON.stringify(all));}catch{}}

export function setupTools(context){
 const panel=$('toolsPanel'),mounted=new Map();let current=null,active=false;
 const nav=el('nav',{className:'tools-nav','ariaLabel':'Tools'});
 const body=el('div',{className:'tools-body'});
 panel.append(nav,body);
 const overviewButton=el('button',{type:'button',className:'tools-nav-item',textContent:'Overview'});overviewButton.dataset.tool='';
 nav.append(overviewButton,...TOOLS.map(t=>{const b=el('button',{type:'button',className:'tools-nav-item'},el('span',{className:'tools-icon',ariaHidden:'true',textContent:t.icon}),' '+t.title);b.dataset.tool=t.id;return b;}));
 nav.addEventListener('click',event=>{const b=event.target.closest('[data-tool]');if(b)open(b.dataset.tool,true);});
 const overview=el('section',{className:'tools-overview'},
  el('h2',{textContent:'Tools for warrior authors'}),
  el('p',{className:'tools-lead',textContent:'Helpers for the parts of writing a warrior that are tedious by hand. Everything runs in this browser, on the same pMARS engine as the Battle tab; nothing is uploaded.'}),
  el('div',{className:'tools-cards'},...TOOLS.map(t=>{
   const card=el('button',{type:'button',className:'tools-card'},el('span',{className:'tools-card-icon',ariaHidden:'true',textContent:t.icon}),el('strong',{textContent:t.title}),el('span',{textContent:t.summary}),el('span',{className:'tools-card-open',textContent:'Open →'}));
   card.dataset.tool=t.id;card.onclick=()=>open(t.id,true);return card;
  }),el('div',{className:'tools-card tools-card-ideas'},el('strong',{textContent:'More tools'}),el('span',{textContent:'The Tools tab is meant to grow. Ideas on the list:'}),el('ul',{},...IDEAS.map(i=>el('li',{textContent:i}))))));
 body.append(overview);
 async function open(id,chosen){
  const tool=TOOLS.find(t=>t.id===id)||null;current=tool?.id??'';
  for(const b of nav.querySelectorAll('[data-tool]')){if(b.dataset.tool===current)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  overview.hidden=!!tool;
  for(const [key,view] of mounted)view.root.hidden=key!==current;
  if(chosen){saveToolState('_last',current);if(active)history.replaceState(history.state,'','#tools'+(current?'/'+current:''));}
  if(!tool)return;
  if(!mounted.has(tool.id)){
   const root=el('section',{className:'tool-view'});root.dataset.tool=tool.id;
   root.append(el('div',{className:'tool-head'},el('h2',{},el('span',{className:'tools-icon',ariaHidden:'true',textContent:tool.icon}),' '+tool.title),el('p',{className:'tools-lead',textContent:tool.summary})));
   const view={root,api:null};mounted.set(tool.id,view);body.append(root);
   try{const module=await tool.load();view.api=module.mount(root,{...context,loadState:()=>loadToolState(tool.id),saveState:v=>saveToolState(tool.id,v)})||null;}
   catch(error){root.append(el('p',{className:'t-warning',textContent:'This tool could not load: '+error.message}));}
   root.hidden=current!==tool.id;
  }
  mounted.get(tool.id).api?.show?.();
 }
 return {
  show(){
   active=true;
   const fromHash=/^#tools\/([\w-]+)/.exec(location.hash)?.[1];
   open(fromHash??current??loadToolState('_last')??'',false);
  },
  hide(){active=false;for(const view of mounted.values())view.api?.hide?.();},
  open:id=>open(id,true)
 };
}
export {el};

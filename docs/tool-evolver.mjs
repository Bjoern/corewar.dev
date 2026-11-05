// SPDX-License-Identifier: GPL-2.0-or-later
// Warrior evolver view of the Tools tab. Genomes and operators: evolver-genome.mjs; the search:
// evolver-run.mjs, run by evolver-worker.mjs off the page's thread; presets and their benchmarks:
// evolver-presets.mjs. Scoring is the constant optimizer's (optimizer-fitness.mjs).
import {el} from './tools.mjs';
import {EVOLVER_PRESETS,CUSTOM_FIELDS,checkCustom,suiteFits,splitWarriors} from './evolver-presets.mjs';
import {EVOLVER_DEFAULTS} from './evolver-run.mjs';
import {matchConfig,scoringMode,plannedEngine} from './optimizer-fitness.mjs';
import {benchmarkCatalog} from './benchmark-catalog.mjs';
import {readBenchmark} from './benchmarks.mjs';
import {describeSettings} from './tournaments.mjs';
import {warriorFilename} from './warrior-files.mjs';

const STEPS=[
 'Pick a preset (the nano hill is quick) and the benchmark to challenge. Add your own opponents if you like.',
 'Start from random code, or seed the population with a warrior of yours.',
 'Press Start. The best score and the chart update after every generation; pause, continue or stop at any time.',
 'Copy the best warrior, open it in the editor, or step through a round against one opponent in the debugger.'
];
const TOPICS=[
 ['What it does','The evolver breeds whole warriors. Each generation, parents chosen by tournament are crossed over (two-point on the instruction lists, or instruction by instruction) and mutated: opcodes, modifiers, addressing modes and fields change, and instructions are inserted, deleted, duplicated or swapped. Parents and children compete for the next generation; the best are always kept, and a few random immigrants keep the population from settling too early.'],
 ['Valid warriors','Every warrior the evolver writes has 1 to the maximum length of instructions, fields inside the core and ICWS ’94 instructions. It leaves out LDP and STP: P-space keeps state between rounds, which would rule out exact scoring.'],
 ['Scores','Each warrior fights each opponent one on one: 3 points per win, 1 per tie, shown as (3W + T) per round × 100 and averaged over the opponents. 100 means all ties, 300 all wins. Small cores (nano, tiny with few positions) are scored exactly, over every legal start position with both starting orders; bigger cores are sampled on seeded positions that change every few generations, so a warrior cannot just fit one set of positions.'],
 ['Mutation settings','Mutations per child is the mean number of point changes (at least one). Structural share is how many of those insert, delete, duplicate or swap instructions or move the start. Crossover is the share of children with two parents. Immigrants are random new warriors per generation.'],
 ['Seeding','A seed warrior is assembled for the chosen settings (labels, EQU and FOR loops are fine) and joins the first population with mutants of it; the rest is random code. “The last run” continues from the population the last run ended with, for the same settings.'],
 ['Off the page’s thread','The search runs in a Web Worker, and the battles in one more worker per CPU core, so the page stays responsive. Battles run on exMARS, the engine the constant optimizer uses.'],
];
const fmt=(n,d=1)=>n===null||n===undefined||!isFinite(n)?'—':Number(n).toFixed(d);
const clock=ms=>{const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
function download(text,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const configKey=c=>[c.coreSize,c.cycles,c.tasks,c.maxLength,c.distance].join('/');

export function mount(root,{roster,addWarrior,openInEditor,openInDebugger,loadState,saveState}){
 const saved=loadState()||{};
 const field=(...nodes)=>el('div',{className:'tool-field'},...nodes);
 const labelled=(id,text,control)=>{control.id=id;return [el('label',{htmlFor:id,textContent:text}),control];};
 const num=(value,attrs={})=>el('input',{type:'number',value:String(value),...attrs});
 // ---- settings
 const presetSelect=el('select',{},...EVOLVER_PRESETS.map(p=>new Option(p.title,p.id)));
 presetSelect.value=EVOLVER_PRESETS.some(p=>p.id===saved.preset)?saved.preset:'nano';
 const presetNote=el('p',{className:'hint'});
 const custom={...EVOLVER_PRESETS.find(p=>p.id==='custom').config,...(saved.custom||{})};
 const customInputs=Object.fromEntries(CUSTOM_FIELDS.map(([key,,min,max])=>[key,num(custom[key],{min,max,step:1})]));
 const customBox=el('div',{className:'tool-field evo-custom'},...CUSTOM_FIELDS.flatMap(([key,label])=>labelled('evo-'+key,label,customInputs[key])));
 const customCheck=el('p',{className:'opt-error',role:'status',hidden:true});
 const suiteSelect=el('select',{});
 const suiteInfo=el('p',{className:'hint'});
 const useRoster=el('input',{type:'checkbox',checked:!!saved.useRoster});
 // Opponents of your own, pasted or loaded from files, kept between visits.
 let own=Array.isArray(saved.own)?saved.own.filter(w=>typeof w?.source==='string').slice(0,50):[];
 const pasteBox=el('textarea',{className:'evo-paste',spellcheck:false,placeholder:';name My opponent\nmov 0, 1\n\nPaste one or more warriors (each starting with ;redcode, or ending with END).'});
 const addPasted=el('button',{type:'button',className:'small',textContent:'Add pasted'});
 const fileInput=el('input',{type:'file',multiple:true,accept:'.red,.txt,.rc,text/plain',hidden:true});
 const addFiles=el('button',{type:'button',className:'small',textContent:'Add files…'});
 const ownList=el('ul',{className:'evo-own'});
 const ownBox=el('details',{className:'opt-advanced',open:!!own.length},el('summary',{textContent:'Your benchmark warriors'}),
  el('p',{className:'hint',textContent:'They fight alongside the benchmark, or alone when the benchmark is “Only your warriors”.'}),
  pasteBox,el('div',{className:'tool-actions'},addPasted,addFiles,fileInput),ownList,
  field(el('label',{},useRoster,' Also fight the warriors loaded in the Battle tab')));
 // ---- seed
 const seedSelect=el('select',{},new Option('Random code','random'),new Option('A warrior from the Battle tab','roster'),new Option('A pasted warrior','paste'),new Option('The last run’s population','last'));
 seedSelect.value=saved.seedMode||'random';
 const rosterSeed=el('select',{});
 const seedText=el('textarea',{className:'evo-paste',spellcheck:false,value:saved.seedText||'',placeholder:';name Seed\nspl 0\nmov 0, 1'});
 const seedShare=num(saved.seedShare??EVOLVER_DEFAULTS.seedShare,{min:0,max:1,step:0.05});
 const seedHint=el('p',{className:'hint'});
 // ---- evolution
 const population=num(saved.population??40,{min:4,max:500,step:1});
 const generations=num(saved.generations??200,{min:0,max:100000,step:10});
 const mutation=num(saved.mutation??EVOLVER_DEFAULTS.mutation,{min:1,max:10,step:0.1});
 const structural=num(saved.structural??EVOLVER_DEFAULTS.structural,{min:0,max:1,step:0.05});
 const crossoverRate=num(saved.crossover??EVOLVER_DEFAULTS.crossover,{min:0,max:1,step:0.05});
 const immigrants=num(saved.immigrants??EVOLVER_DEFAULTS.immigrants,{min:0,max:0.5,step:0.01});
 const elite=num(saved.elite??EVOLVER_DEFAULTS.elite,{min:0,max:50,step:1});
 const scoringSelect=el('select',{},new Option('Exact when possible','auto'),new Option('Always sampled','sampled'));scoringSelect.value=saved.scoring||'auto';
 const rounds=num(saved.rounds??100,{min:10,max:5000,step:10});
 const processors=Math.max(1,navigator.hardwareConcurrency||2);
 const workers=num(saved.workers??Math.max(1,processors-1),{min:1,max:processors,step:1});
 const seed=el('input',{value:saved.seed??'1',maxLength:40,size:6});
 const params=el('div',{className:'tool-form'},
  field(...labelled('evoPopulation','Population',population),...labelled('evoGenerations','Generations',generations),el('span',{className:'hint',textContent:'0 = until stopped'})),
  field(...labelled('evoMutation','Mutations per child',mutation),...labelled('evoCrossover','Crossover rate',crossoverRate)),
  el('details',{className:'opt-advanced',open:!!saved.advancedOpen},el('summary',{textContent:'More settings'}),
   el('div',{className:'tool-form'},
    field(...labelled('evoStructural','Structural share',structural),...labelled('evoImmigrants','Immigrants',immigrants),...labelled('evoElite','Elite',elite)),
    field(...labelled('evoScoring','Scoring',scoringSelect),...labelled('evoRounds','Sampled rounds per opponent',rounds)),
    field(...labelled('evoSeed','Random seed',seed),el('span',{className:'hint',textContent:'same seed, same run'})))),
  field(...labelled('evoWorkers','CPU cores',workers),el('span',{className:'hint',textContent:`of ${processors}; each runs one battle at a time`})));
 // ---- run
 const start=el('button',{type:'button',className:'primary',textContent:'▶ Start'});
 const pause=el('button',{type:'button',textContent:'Ⅱ Pause',disabled:true});
 const stop=el('button',{type:'button',textContent:'■ Stop',disabled:true});
 const runStatus=el('p',{className:'opt-status',role:'status'});
 const bestScore=el('p',{className:'evo-best-score',ariaLive:'polite'},el('span',{className:'hint',textContent:'Best score'}),el('strong',{textContent:'—'}));
 const stats=el('dl',{className:'opt-stats'});
 const chart=el('canvas',{className:'opt-chart',ariaLabel:'Best and mean score per generation'});
 // ---- best
 const bestHead=el('p',{className:'hint',textContent:saved.lastBest?'Best warrior of the last run.':'No warrior yet.'});
 const bestCode=el('pre',{className:'opt-best evo-code',textContent:saved.lastBest?.source||''});
 const copyBest=el('button',{type:'button',textContent:'Copy'});
 const editBest=el('button',{type:'button',textContent:'Open in editor'});
 const debugBest=el('button',{type:'button',textContent:'Open in debugger'});
 const debugOpponent=el('select',{ariaLabel:'Opponent in the debugger'});
 const addBest=el('button',{type:'button',textContent:'Add to warriors'});
 const downloadBest=el('button',{type:'button',textContent:'Download .red'});
 const actionStatus=el('p',{className:'hint',role:'status'});
 const opponentsTable=el('table',{className:'tool-table'});
 const opponentsBox=el('details',{className:'opt-opponents-box',hidden:true},el('summary',{textContent:'Score per opponent'}),el('div',{className:'tool-table-wrap'},opponentsTable));
 const help=el('details',{className:'tool-help',open:!saved.helpClosed},el('summary',{textContent:'How to use the evolver'}),
  el('ol',{className:'tool-steps'},...STEPS.map(s=>el('li',{textContent:s}))),
  el('div',{className:'tool-topics'},...TOPICS.map(([h,body])=>el('details',{},el('summary',{textContent:h}),el('p',{textContent:body})))));
 root.append(help,el('div',{className:'opt-layout'},
  el('div',{className:'opt-main'},
   el('section',{className:'t-card'},el('h3',{textContent:'Settings and benchmark'}),
    el('div',{className:'tool-form'},field(...labelled('evoPreset','Preset',presetSelect)),presetNote,customBox,customCheck,
     field(...labelled('evoSuite','Benchmark',suiteSelect)),suiteInfo),ownBox),
   el('section',{className:'t-card'},el('h3',{textContent:'Start from'}),
    el('div',{className:'tool-form'},field(...labelled('evoSeedMode','Seed',seedSelect),rosterSeed),seedText,
     field(...labelled('evoSeedShare','Share of mutants of the seed',seedShare)),seedHint)),
   el('section',{className:'t-card'},el('h3',{textContent:'Evolution'}),params)),
  el('div',{className:'opt-main'},
   el('section',{className:'t-card opt-run'},el('h3',{textContent:'Run'}),el('div',{className:'tool-actions'},start,pause,stop),runStatus,bestScore,stats,chart),
   el('section',{className:'t-card'},el('h3',{textContent:'Best warrior'}),bestHead,bestCode,
    el('div',{className:'tool-actions'},copyBest,editBest,addBest,downloadBest),
    el('div',{className:'tool-actions'},debugBest,el('label',{className:'hint',textContent:'against'}),debugOpponent),actionStatus,opponentsBox))));

 // ---- state
 let run=null,suite=null,lastBest=saved.lastBest||null,lastPopulation=saved.lastPopulation||null;
 const suites=new Map();
 const preset=()=>EVOLVER_PRESETS.find(p=>p.id===presetSelect.value);
 function config(){
  const p=preset();if(p.id!=='custom')return {...p.config};
  const c={...p.config};for(const [key] of CUSTOM_FIELDS)c[key]=Number(customInputs[key].value);
  c.pspace=0; // pMARS's default size; the evolver writes no P-space instructions.
  return c;
 }
 function persist(){
  saveState({preset:presetSelect.value,custom:Object.fromEntries(CUSTOM_FIELDS.map(([k])=>[k,Number(customInputs[k].value)])),suites:{...(saved.suites||{}),[presetSelect.value]:suiteSelect.value},
   own,useRoster:useRoster.checked,seedMode:seedSelect.value,seedText:seedText.value,seedShare:seedShare.value,population:population.value,generations:generations.value,mutation:mutation.value,
   structural:structural.value,crossover:crossoverRate.value,immigrants:immigrants.value,elite:elite.value,scoring:scoringSelect.value,rounds:rounds.value,workers:workers.value,seed:seed.value,
   helpClosed:!help.open,advancedOpen:params.querySelector('.opt-advanced').open,lastBest,lastPopulation});
  saved.suites={...(saved.suites||{}),[presetSelect.value]:suiteSelect.value};
 }
 let persistTimer=null;const schedulePersist=()=>{clearTimeout(persistTimer);persistTimer=setTimeout(persist,300);};
 root.addEventListener('change',schedulePersist);root.addEventListener('toggle',schedulePersist,true);
 seedText.addEventListener('input',schedulePersist);

 // ---- presets and benchmarks
 function showPreset(applyDefaults){
  const p=preset(),c=config();
  presetNote.textContent=p.note;customBox.hidden=p.id!=='custom';
  customCheck.textContent=p.id==='custom'?checkCustom(c)??'':'';customCheck.hidden=!customCheck.textContent;
  const ids=p.id==='custom'?benchmarkCatalog.filter(s=>suiteFits(s.descriptor.parameters,c)).map(s=>s.id):p.benchmarks.filter(id=>benchmarkCatalog.some(s=>s.id===id));
  const previous=suiteSelect.value;
  suiteSelect.replaceChildren(...ids.map(id=>new Option(benchmarkCatalog.find(s=>s.id===id).descriptor.name,id)),new Option('Only your warriors','none'));
  const want=saved.suites?.[p.id];
  suiteSelect.value=[...suiteSelect.options].some(o=>o.value===want)?want:[...suiteSelect.options].some(o=>o.value===previous)&&!applyDefaults?previous:suiteSelect.options[0].value;
  if(applyDefaults){population.value=p.defaults.population;generations.value=p.defaults.generations;if(p.defaults.rounds)rounds.value=p.defaults.rounds;}
  loadSuite();
 }
 async function loadSuite(){
  const id=suiteSelect.value;suite=null;
  if(id==='none'){suiteInfo.textContent='Only your benchmark warriors'+(useRoster.checked?' and the Battle tab’s warriors':'')+'.';showOpponentCount();return;}
  const entry=benchmarkCatalog.find(s=>s.id===id);if(!entry)return;
  suiteInfo.textContent='Loading the benchmark…';
  try{
   if(!suites.has(id)){
    const response=await fetch(new URL(entry.data,import.meta.url));if(!response.ok)throw new Error('HTTP '+response.status);
    const {files,scores}=await response.json();suites.set(id,readBenchmark(entry.descriptor,files,id,scores??null));
   }
   if(suiteSelect.value!==id)return;
   suite=suites.get(id);showOpponentCount();
  }catch(error){suiteInfo.textContent='Could not load the benchmark: '+error.message;}
 }
 function opponents(){
  const list=[...(suite?.warriors??[]).map(w=>({name:w.name,source:w.source,file:w.file})),...own.map(w=>({name:w.name,source:w.source,file:warriorFilename(w.name)}))];
  if(useRoster.checked)list.push(...roster().map(w=>({name:w.name,source:w.source,file:warriorFilename(w.name)})));
  return list;
 }
 function showOpponentCount(){
  const n=opponents().length,c=config();
  const parts=[`${n} opponent${n===1?'':'s'}`+(suite?` (${suite.warriors.length} from ${suite.name}${n>suite.warriors.length?', '+(n-suite.warriors.length)+' of yours':''})`:'')];
  if(n&&!checkCustom(c)){const mode=scoringMode(matchConfig(c),opponents().map(o=>o.source),{mode:scoringSelect.value,rounds:Number(rounds.value)||100});const e=plannedEngine(matchConfig(c),mode);
   parts.push(mode.why,e.engine==='exmars'?'engine exMARS':`engine pMARS (exMARS can’t run ${e.why})`);}
  suiteInfo.textContent=parts.join(' · ');
 }
 presetSelect.addEventListener('change',()=>{showPreset(true);showSeed();});
 for(const input of Object.values(customInputs))input.addEventListener('change',()=>{showPreset(false);showSeed();});
 suiteSelect.addEventListener('change',()=>{loadSuite();});
 for(const c of [useRoster,scoringSelect,rounds])c.addEventListener('change',showOpponentCount);
 function showOwn(){
  ownList.replaceChildren(...own.map((w,i)=>{const remove=el('button',{type:'button',className:'small',textContent:'Remove',ariaLabel:'Remove '+w.name});
   remove.onclick=()=>{own.splice(i,1);showOwn();persist();showOpponentCount();};return el('li',{},el('span',{textContent:w.name}),remove);}));
 }
 function addOwn(list){
  if(!list.length){actionStatus.textContent='No warrior found in that text.';return;}
  own.push(...list);own=own.slice(0,50);showOwn();persist();showOpponentCount();
  runStatus.textContent=`Added ${list.length} benchmark warrior${list.length===1?'':'s'} of yours.`;
 }
 addPasted.onclick=()=>{addOwn(splitWarriors(pasteBox.value));if(own.length)pasteBox.value='';};
 addFiles.onclick=()=>fileInput.click();
 fileInput.onchange=async()=>{const list=[];for(const f of fileInput.files){if(f.size>65536)continue;for(const w of splitWarriors(await f.text()))list.push({...w,name:/^Pasted warrior/.test(w.name)?f.name:w.name});}fileInput.value='';addOwn(list);};

 // ---- seed
 function refreshRoster(){
  const list=roster(),before=rosterSeed.value;
  rosterSeed.replaceChildren(...(list.length?list.map((w,i)=>new Option(w.name,String(i))):[new Option('No warriors loaded','')]));
  if([...rosterSeed.options].some(o=>o.value===before))rosterSeed.value=before;
 }
 function showSeed(){
  const m=seedSelect.value;rosterSeed.hidden=m!=='roster';seedText.hidden=m!=='paste';
  seedShare.parentNode.hidden=m==='random'||m==='last';
  const c=config();
  seedHint.textContent=m==='random'?`Every warrior of the first population is random code of 1 to ${c.maxLength} instructions.`
   :m==='last'?(lastPopulation?.key===configKey(c)?`Continues from the ${lastPopulation.genomes.length} warriors the last run ended with.`:'No earlier run with these settings; a run with these settings saves its population here.')
   :`The seed must assemble with at most ${c.maxLength} instructions. Mutants of it fill the share above; random code fills the rest.`;
 }
 seedSelect.addEventListener('change',showSeed);

 // ---- run
 function setRunning(state){
  const active=state==='running'||state==='paused'||state==='pausing';
  start.disabled=state==='running'||state==='pausing';pause.disabled=state!=='running';stop.disabled=!active;
  start.textContent=state==='paused'?'▶ Continue':'▶ Start';
  for(const c of [presetSelect,suiteSelect,...Object.values(customInputs),seedSelect,rosterSeed,seedText,seedShare,population,mutation,structural,crossoverRate,immigrants,elite,scoringSelect,rounds,workers,seed,useRoster,addPasted,addFiles])c.disabled=active;
 }
 function begin(){
  if(run?.state==='paused'){run.worker.postMessage({type:'resume'});run.state='running';run.resumedAt=Date.now();setRunning('running');runStatus.textContent='Running.';return;}
  const c=config(),problem=checkCustom(c);
  if(problem){runStatus.textContent=problem;return;}
  if(suiteSelect.value!=='none'&&!suite){runStatus.textContent='The benchmark is still loading.';return;}
  const list=opponents();
  if(!list.length){runStatus.textContent='There are no opponents. Choose a benchmark or add warriors of your own.';return;}
  const seedSources=[],seedGenomes=[];
  if(seedSelect.value==='roster'){const w=roster()[Number(rosterSeed.value)];if(!w){runStatus.textContent='Load a warrior in the Battle tab to seed from it.';return;}seedSources.push({name:w.name,source:w.source});}
  if(seedSelect.value==='paste'){if(!seedText.value.trim()){runStatus.textContent='Paste the seed warrior first.';return;}seedSources.push({name:'the pasted warrior',source:seedText.value});}
  if(seedSelect.value==='last'){if(lastPopulation?.key!==configKey(c)){runStatus.textContent='There is no earlier population for these settings.';return;}seedGenomes.push(...lastPopulation.genomes);}
  const p=preset();
  const job={config:c,opponents:list.map(({name,source})=>({name,source})),benchmarkName:suite?.name||'your warriors',name:`Evolved ${p.id==='custom'?'warrior':p.title.replace(/ hill$/,'')}`,
   seed:seed.value,workers:Math.max(1,Math.min(processors,Number(workers.value)||1)),scoring:{mode:scoringSelect.value,rounds:Math.max(10,Number(rounds.value)||100)},seedSources,seedGenomes,
   params:{population:Math.max(4,Number(population.value)||40),generations:Math.max(0,Number(generations.value)||0),mutation:Math.max(1,Number(mutation.value)||1.5),
    structural:Math.min(1,Math.max(0,Number(structural.value))),crossover:Math.min(1,Math.max(0,Number(crossoverRate.value))),immigrants:Math.min(0.5,Math.max(0,Number(immigrants.value))),
    elite:Math.max(0,Number(elite.value)|0),seedShare:seedSources.length?Math.min(1,Math.max(0,Number(seedShare.value))):0}};
  run?.worker.terminate();
  const worker=new Worker(new URL('./evolver-worker.mjs',import.meta.url),{type:'module'});
  const r={worker,state:'running',job,opponents:list,history:[],best:null,started:Date.now(),config:c,key:configKey(c)};run=r;
  worker.onmessage=({data})=>{if(run===r)message(r,data);};
  worker.onerror=event=>{if(run!==r)return;r.state='finished';setRunning('finished');runStatus.textContent='The evolver stopped: '+(event.message||'worker error');};
  worker.postMessage({type:'start',job});
  bestScore.querySelector('strong').textContent='—';stats.replaceChildren();opponentsBox.hidden=true;
  runStatus.textContent=`Assembling and scoring the first ${job.params.population} warriors against ${list.length} opponents…`;
  setRunning('running');drawChart();
 }
 function message(r,data){
  if(data.type==='started'){r.started=data;runStatus.textContent=`Running: ${data.why}, engine ${data.engine==='exmars'?'exMARS':'pMARS (exMARS can’t run '+data.engineWhy+')'}, ${data.workers} battle worker${data.workers===1?'':'s'}${data.nested?'':' (this browser runs no workers inside workers, so battles share one)'}.`;return;}
  if(data.type==='generation'){
   r.history.push(data.stats);r.last=data;
   if(data.best&&(!r.best||data.best.score!==r.best.score||data.best.source!==r.best.source)){r.best=data.best;showBest(r);}
   lastPopulation={key:r.key,genomes:data.population};
   if(r.best)lastBest={source:r.best.source,score:r.best.score,key:r.key,opponents:r.best.opponents,benchmark:r.job.benchmarkName};
   showStats(r);drawChart();schedulePersist();return;
  }
  if(data.type==='paused'){r.state='paused';setRunning('paused');runStatus.textContent=`Paused after generation ${data.generation}. Continue picks up here.`;return;}
  if(data.type==='done'){r.state='finished';setRunning('finished');runStatus.textContent=data.reason+(r.best?` Best score ${fmt(r.best.score,2)}.`:'');r.worker.terminate();persist();return;}
  if(data.type==='error'){r.state='finished';setRunning('finished');runStatus.textContent='The evolver stopped: '+data.message;r.worker.terminate();}
 }
 function showStats(r){
  const d=r.last,s=d.stats;
  bestScore.querySelector('strong').textContent=fmt(s.best,2);
  const items=[['Generation',String(s.generation)],['Population mean',fmt(s.mean,2)],['Median',fmt(s.median,2)],['Diversity',fmt(s.diversity,2)],
   ['Warriors scored',s.evaluations.toLocaleString('en-US')],['Battles',d.matches.toLocaleString('en-US')],['Elapsed',clock(d.elapsed)],['Per second',fmt(s.evaluations/Math.max(1,d.elapsed/1000),1)],['Engine',d.engines]];
  stats.replaceChildren(...items.flatMap(([k,v])=>[el('dt',{textContent:k}),el('dd',{textContent:v})]));
 }
 function showBest(r){
  const b=r.best;
  bestHead.textContent=`Score ${fmt(b.score,2)}${b.se?` ± ${fmt(b.se,2)}`:''} against ${r.job.benchmarkName} · ${b.length} instruction${b.length===1?'':'s'} · found in generation ${b.generation}.`;
  bestCode.textContent=b.source;
  showOpponents(b.opponents,r.opponents);
 }
 function showOpponents(per,list){
  opponentsBox.hidden=!per?.length;
  opponentsTable.replaceChildren(el('thead',{},el('tr',{},...['Opponent','W','T','L','Score'].map(h=>el('th',{scope:'col',textContent:h})))),
   el('tbody',{},...(per||[]).slice().sort((a,b)=>a.score-b.score).map(o=>el('tr',{},el('td',{textContent:o.name}),...[o.wins,o.ties,o.losses].map(v=>el('td',{className:'num',textContent:String(v)})),el('td',{className:'num',textContent:fmt(o.score,1)})))));
  // The debugger opponent: the one the best warrior does worst against comes first.
  const names=(per||[]).slice().sort((a,b)=>a.score-b.score).map(o=>o.name),all=list||opponents();
  const ordered=[...names.map(n=>all.findIndex(o=>o.name===n)).filter(i=>i>=0),...all.map((_,i)=>i)].filter((v,i,a)=>a.indexOf(v)===i);
  debugOpponent.replaceChildren(new Option('no opponent','-1'),...ordered.map(i=>new Option(all[i].name,String(i))));
  debugOpponent.value=ordered.length?String(ordered[0]):'-1';debugOpponent.list=all;
 }
 start.onclick=()=>{try{begin();}catch(error){runStatus.textContent=error.message;setRunning('finished');}};
 pause.onclick=()=>{if(run?.state!=='running')return;run.state='pausing';run.worker.postMessage({type:'pause'});setRunning('pausing');runStatus.textContent='Pausing after this generation…';};
 stop.onclick=()=>{if(!run||run.state==='finished')return;run.worker.postMessage({type:'stop'});run.state='finished';setRunning('finished');runStatus.textContent='Stopping…';
  const r=run;setTimeout(()=>{if(run===r)r.worker.terminate();if(runStatus.textContent==='Stopping…')runStatus.textContent='Stopped.'+(r.best?' The best warrior is kept below.':'');},1500);};

 // ---- best warrior actions
 const bestSource=()=>run?.best?.source||lastBest?.source||'';
 const bestConfig=()=>run?.best?run.config:(lastBest&&EVOLVER_PRESETS.map(p=>p.config).find(c=>configKey(c)===lastBest.key))||config();
 const bestName=()=>/^\s*;\s*name\s+(.*?)\s*$/im.exec(bestSource())?.[1]||'Evolved';
 const need=()=>{if(bestSource())return true;actionStatus.textContent='No warrior yet: start a run first.';return false;};
 copyBest.onclick=async()=>{if(!need())return;try{await navigator.clipboard.writeText(bestSource());actionStatus.textContent='Copied the best warrior.';}catch{actionStatus.textContent='The browser did not allow copying; select the code and copy it.';}};
 downloadBest.onclick=()=>{if(need())download(bestSource(),warriorFilename(bestName()));};
 addBest.onclick=()=>{if(!need())return;try{addWarrior(bestSource(),warriorFilename(bestName()));actionStatus.textContent=`Added “${bestName()}” to your warriors.`;refreshRoster();}catch(error){actionStatus.textContent=error.message;}};
 editBest.onclick=()=>{if(!need())return;try{openInEditor(bestSource(),warriorFilename(bestName()),bestConfig());}catch(error){actionStatus.textContent=error.message;}};
 debugBest.onclick=async()=>{
  if(!need())return;
  const list=debugOpponent.list||opponents(),o=list[Number(debugOpponent.value)];
  try{await openInDebugger(bestSource(),warriorFilename(bestName()),o?{source:o.source,file:o.file||warriorFilename(o.name)}:null,bestConfig());}catch(error){actionStatus.textContent=error.message;}
 };

 new ResizeObserver(()=>drawChart()).observe(chart);
 function drawChart(){
  if(!chart.clientWidth)return;
  const ratio=devicePixelRatio||1,w=chart.clientWidth,h=180;chart.width=w*ratio;chart.height=h*ratio;
  const ctx=chart.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#101d29';ctx.fillRect(0,0,w,h);
  const pts=run?.history||[],L=40,R=8,T=22,B=20;ctx.font='11px system-ui';ctx.fillStyle='#aec0ce';
  ctx.fillText('Score per generation',L,14);
  if(pts.length<2){ctx.fillText(run?'Waiting for the second generation':'Start a run to see the scores',L,h/2);return;}
  let lo=Infinity,hi=-Infinity;for(const p of pts)for(const v of [p.best,p.mean]){lo=Math.min(lo,v);hi=Math.max(hi,v);}
  lo=Math.max(0,Math.floor(lo/10)*10);hi=Math.ceil(hi/10)*10;if(hi-lo<10)hi=lo+10;
  const n=pts.at(-1).generation,first=pts[0].generation,xs=x=>L+(w-L-R)*(x-first)/Math.max(1,n-first),ys=v=>T+(h-T-B)*(1-(v-lo)/(hi-lo));
  ctx.strokeStyle='#2a3d4d';ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,h-B);ctx.lineTo(w-R,h-B);ctx.stroke();
  ctx.fillText(String(hi),4,T+8);ctx.fillText(String(lo),4,h-B);ctx.fillText(String(first),L,h-6);ctx.fillText(String(n),w-R-ctx.measureText(String(n)).width,h-6);
  for(const [key,color,width] of [['mean','#f9a567',1.5],['best','#54d8df',2]]){
   ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();pts.forEach((p,i)=>{const x=xs(p.generation),y=ys(p[key]);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
  }
  ctx.fillStyle='#54d8df';ctx.fillText('best',w-R-80,14);ctx.fillStyle='#f9a567';ctx.fillText('mean',w-R-44,14);
 }
 showOwn();refreshRoster();showPreset(false);showSeed();
 if(lastBest?.opponents)showOpponents(lastBest.opponents,null);
 if(lastBest)bestHead.textContent=`Best warrior of the last run: score ${fmt(lastBest.score,2)} against ${lastBest.benchmark||'its benchmark'}.`;
 return {show(){refreshRoster();showOpponentCount();drawChart();},hide(){}};
}

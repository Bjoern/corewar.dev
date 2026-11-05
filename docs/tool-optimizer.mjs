// SPDX-License-Identifier: GPL-2.0-or-later
// Constant optimizer view of the Tools tab. Template language: optimizer-template.mjs; search
// methods: optimizer-search.mjs; scoring and the worker pool: optimizer-fitness.mjs.
import {el} from './tools.mjs';
import {parseTemplate,templateConstants,fromMetcalf} from './optimizer-template.mjs';
import {Annealing,Genetic,Exhaustive,ANNEAL_DEFAULTS,GA_DEFAULTS} from './optimizer-search.mjs';
import {Evaluator,WorkerPool,scoringMode,SCORING_DEFAULTS,matchConfig,plannedEngine,engineSummary} from './optimizer-fitness.mjs';
import {examples} from './optimizer-examples.mjs';
import {benchmarkCatalog} from './benchmark-catalog.mjs';
import {readBenchmark} from './benchmarks.mjs';
import {describeSettings} from './tournaments.mjs';
import {sourceId} from './hill-scores.mjs';
import {warriorFilename} from './warrior-files.mjs';

// Template syntax reference: what to write, what it tunes, an example and the values it gives.
const SYNTAX=[
 ['!','any number in the core','dat !, 0','−4000 … 3999 (core 8000)'],
 ['!(a..b)','a range, both ends included','!(1..79)','1, 2, … 79'],
 ['!(a..b, s)','a range with a step','!(4..3996, 4)','4, 8, … 3996'],
 ['![x, y, …]','one of a list: numbers, opcodes, modifiers or modes','mov.![i,f]  ![#,$,<]','mov.i, mov.f · #, $, <'],
 ['?coprime ?odd ?even','keep only some numbers (after a range or !)','!(1..3999)?coprime','steps with mod 1'],
 ['…:v','start value, always last','!(1..79):37','starts at 37'],
 ['!!…','test every value instead of searching: any marker above with a second !','!!(4..3996, 4)','scores all 999 steps'],
];
const RULES=[
 ['Name it with EQU','A marker on an EQU line is named after the label: step equ !(1..79) gives a variable step, and step or step*2 anywhere else follow it. Other markers are named by line:column.'],
 ['Constants in ranges','Ranges may use CORESIZE, MAXLENGTH, MINDISTANCE, MAXPROCESSES, MAXCYCLES and PSPACESIZE with + − * / %, for example !(MINDISTANCE..CORESIZE-MINDISTANCE).'],
 ['Comments are safe','Everything after ; is ignored, so ;name Wow! is fine, and != is never a marker.'],
 ['Start values','Without :v the run starts from a random value. “Use as template” writes the best values back as :v, so you can narrow the ranges and run again.'],
 ['Test every value','A template with !! markers scores every combination of their values, in order and on the same placements, so the scores compare fairly; its ! markers keep their start value. With one !! variable the chart shows the score of each value. The check counts the battles first: two !! variables of 100 values are already 10,000 candidates.'],
];
const EXAMPLE_TEMPLATE='step  equ  !(4..3996, 4):2004    ; mod-4 steps, start at 2004\n      add.ab #step, bomb\n      mov.i  bomb, @bomb\n      jmp    -2\nbomb  dat  ![#,$,<,>]:# 0, #0    ; try four A-modes';
const EXAMPLE_RENDERED='step  equ  2008    ; mod-4 steps, start at 2004\n      add.ab #step, bomb\n      mov.i  bomb, @bomb\n      jmp    -2\nbomb  dat  $ 0, #0    ; try four A-modes';
// Quick start, then topics to open when needed.
const STEPS=[
 'Load an example, or start from one of your warriors.',
 'Replace each number you want tuned with a marker (see Template syntax below the editor). The check under the editor shows the variables as you type.',
 'Pick the opponents: a benchmark for the hill you aim at, or your own warriors.',
 'Press Start. Watch the best score climb; pause, continue or stop at any time.',
 'Check the best on new placements, then add it to your warriors or use it as the next template.'
];
const TOPICS=[
 ['What it does','You keep the strategy; the optimizer tunes the numbers (and, if you like, opcodes, modifiers and modes) for the best score against a set of opponents. It never changes the structure of the code.'],
 ['Scores','Each candidate fights each opponent one on one: 3 points per win, 1 per tie, shown as (3W + T) per round × 100 and averaged over the opponents. 100 means all ties, 300 all wins.'],
 ['Exact and sampled scoring','Small cores without P-space (nano, tiny) are scored exactly: every legal position with both starting orders, so there is no noise. Bigger cores are sampled: all candidates fight on the same seeded positions, candidates clearly behind are dropped early (racing), and the positions change after every 10 improvements so the search cannot overfit them.'],
 ['Check best on new placements','The best score of a search is the best of many noisy samples, so it reads a little high. The check fights the best on 2000 rounds per opponent that the search never saw: compare warriors by that number. With exact scoring the check equals the score.'],
 ['Simulated annealing','The default. It first tries every value of small variables (sweep), then changes one variable at a time, sometimes accepting a worse candidate, more readily the longer it is stuck. When it stalls it restarts from one of its best results.'],
 ['Genetic algorithm','Keeps a population and breeds children from good members, replacing the most similar weaker one. Good at combining values that only pay off together, and at polishing an annealing result: use that result as the template, then run the GA.'],
 ['Engine','Fights run on exMARS, which gives the same results as pMARS round for round and is several times faster; it stays loaded in each worker, so opponents are assembled once. Settings exMARS does not support (ICWS ’88, a P-space size other than core size / 16, a text placement seed) run on pMARS, and the run says so.'],
 ['CPU cores','Each core runs one fight at a time. More cores give more candidates per second; leave one free to keep the browser responsive. The Tournaments tab shares the same processors.'],
 ['Credits','The annealing moves and acceptance rule and the GA’s crowding, BLX-α crossover and immigrants come from John Metcalf’s annealing5.rb and genetic2.rb, used with his permission. Template language, scoring and search are ported from cwopt.']
];
const fmt=(n,d=1)=>n===null||n===undefined||!isFinite(n)?'—':Number(n).toFixed(d);
const big=n=>n<1e6?Math.round(n).toLocaleString('en-US'):n.toExponential(2).replace('e+',' × 10^');
function download(text,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const hashSeed=text=>parseInt(sourceId(String(text)),36)>>>0;

export function mount(root,{roster,addWarrior,readConfig,loadState,saveState,benchmarks,loadBenchmark}){
 const saved=loadState()||{};
 const field=(...nodes)=>el('div',{className:'tool-field'},...nodes);
 const labelled=(id,text,control)=>{control.id=id;return [el('label',{htmlFor:id,textContent:text}),control];};
 // Template
 const editor=el('textarea',{id:'optTemplate',className:'opt-editor',spellcheck:false,value:saved.template??examples[0].source});
 editor.setAttribute('aria-describedby','optCheck');
 const exampleSelect=el('select',{id:'optExample'},new Option('Load example…',''),...examples.map(e=>new Option(e.title,e.id)));
 const rosterSelect=el('select',{id:'optRoster'});
 const convert=el('button',{type:'button',className:'small',textContent:'Convert Metcalf markers',title:'Turn ! into !(0..CORESIZE-1) and !%n into !(0..n-1)'});
 const check=el('div',{id:'optCheck',className:'opt-check',role:'status'});
 const markerTable=el('details',{className:'opt-syntax',open:saved.syntaxOpen??true},el('summary',{textContent:'Template syntax'}),
  el('p',{className:'hint',textContent:'Put a marker where a number (or opcode, modifier or mode) should be tuned.'}),
  el('dl',{className:'opt-syntax-list'},...SYNTAX.flatMap(([m,what,ex,vals])=>[el('dt',{},el('code',{textContent:m})),
   el('dd',{},el('span',{textContent:what}),el('span',{className:'opt-syntax-eg'},'e.g. ',el('code',{textContent:ex}),' → '+vals))])),
  el('div',{className:'opt-syntax-example'},
   el('div',{},el('strong',{textContent:'Template'}),el('pre',{textContent:EXAMPLE_TEMPLATE})),
   el('div',{},el('strong',{textContent:'One candidate'}),el('pre',{textContent:EXAMPLE_RENDERED}))),
  el('dl',{className:'opt-rules'},...RULES.flatMap(([k,v])=>[el('dt',{textContent:k}),el('dd',{textContent:v})])));
 // Opponents and settings
 const suiteSelect=el('select',{id:'optSuite'});
 // The suites of the Tournaments tab's Benchmark mode: built in, then imported or made this session.
 // Without that tab, the built-in catalog.
 const suiteList=()=>{let all=null;try{all=benchmarks?.()??null;}catch{}return all??benchmarkCatalog.map(s=>({id:s.id,name:s.descriptor.name,config:s.descriptor.parameters,builtIn:true}));};
 function fillSuites(){
  const all=suiteList(),own=all.filter(s=>!s.builtIn),before=suiteSelect.value;
  suiteSelect.replaceChildren(...all.filter(s=>s.builtIn).map(s=>new Option(s.name,s.id)),
   ...(own.length?[el('optgroup',{label:'Imported or made this session (Tournaments, Benchmark mode)'},...own.map(s=>new Option(s.name,s.id)))]:[]),
   new Option('Your warriors (roster, Battle settings)','roster'));
  const want=before||saved.suite;
  suiteSelect.value=want&&[...suiteSelect.options].some(o=>o.value===want)?want:examples[0].suite;
  return suiteSelect.value!==before;
 }
 fillSuites();
 const suiteInfo=el('p',{className:'hint'});
 const methodSelect=el('select',{id:'optMethod'},new Option('Simulated annealing','anneal'),new Option('Genetic algorithm','ga'));methodSelect.value=saved.method==='ga'?'ga':'anneal';
 const everyOption=new Option('Every value (!! markers)','every');let searchMethod=methodSelect.value;
 const scoringSelect=el('select',{id:'optScoring'},new Option('Exact when possible','auto'),new Option('Always sampled','sampled'));scoringSelect.value=saved.scoring||'auto';
 const num=(value,attrs={})=>el('input',{type:'number',value:String(value),...attrs});
 const rounds=num(saved.rounds??SCORING_DEFAULTS.rounds,{min:10,max:10000,step:10});
 const minutes=num(saved.minutes??10,{min:0,max:1440,step:1});
 const processors=Math.max(1,navigator.hardwareConcurrency||2);
 const workers=num(saved.workers??Math.max(1,processors-1),{min:1,max:processors,step:1});
 const coreSlider=el('input',{type:'range',min:1,max:processors,step:1,value:workers.value,ariaLabel:'CPU cores slider'});
 const corePresets=[['1',()=>1],['Half',()=>Math.max(1,Math.floor(processors/2))],['All but one',()=>Math.max(1,processors-1)],['All',()=>processors]].map(([label,count])=>{
  const b=el('button',{type:'button',className:'small',textContent:label});b.onclick=()=>{workers.value=count();coreSlider.value=workers.value;workers.dispatchEvent(new Event('change',{bubbles:true}));};return b;});
 workers.addEventListener('input',()=>{coreSlider.value=workers.value;});
 coreSlider.addEventListener('input',()=>{workers.value=coreSlider.value;});
 const seed=el('input',{value:saved.seed??'1',maxLength:40,size:6});
 const race=el('input',{type:'checkbox',checked:saved.race??true});
 const sweep=el('input',{type:'checkbox',checked:saved.sweep??true});
 const sweepLimit=num(saved.sweepLimit??ANNEAL_DEFAULTS.sweepLimit,{min:2,max:10000});
 const restarts=el('input',{type:'checkbox',checked:saved.restarts??true});
 const patience=num(saved.patience??ANNEAL_DEFAULTS.restartPatience,{min:10,max:100000});
 const population=num(saved.population??GA_DEFAULTS.population,{min:10,max:500});
 const immigrants=num(saved.immigrants??GA_DEFAULTS.immigrants,{min:0,max:1,step:0.01});
 const mutation=num(saved.mutation??GA_DEFAULTS.mutation,{min:0.1,max:10,step:0.1});
 const annealOptions=el('div',{className:'opt-method-options'},
  field(el('label',{},sweep,' Sweep every value of domains up to '),sweepLimit,el('span',{className:'hint',textContent:'values first'})),
  field(el('label',{},restarts,' Restart from a top result after '),patience,el('span',{className:'hint',textContent:'steps without a new best'})),
  el('p',{className:'hint',textContent:'With both off this is John Metcalf’s annealing5.rb on corewar.dev’s scoring.'}));
 const gaOptions=el('div',{className:'opt-method-options'},
  field(...labelled('optPopulation','Population',population),...labelled('optImmigrants','Immigrant rate',immigrants),...labelled('optMutation','Mutated genes per child',mutation)),
  el('p',{className:'hint',textContent:'Tournaments of 3 and 1, uniform, single-point or BLX-α crossover, creep mutation on big domains, deterministic crowding. The template’s start values and the current best (when you continue) seed the population.'}));
 const settings=el('div',{className:'tool-form'},
  field(...labelled('optSuite','Opponents',suiteSelect)),suiteInfo,
  field(...labelled('optMethod','Method',methodSelect),...labelled('optScoring','Scoring',scoringSelect),...labelled('optRounds','Sampled rounds per opponent',rounds)),
  field(...labelled('optWorkers','CPU cores',workers),coreSlider,...corePresets),
  el('p',{className:'hint opt-cores-hint',textContent:navigator.hardwareConcurrency?`${processors} logical processors available. Each core runs one fight at a time; the count applies when a run starts.`:'The browser did not report a processor count; using a limit of 2.'}),
  el('details',{className:'opt-advanced',open:!!saved.advancedOpen},el('summary',{textContent:'Method settings'}),annealOptions,gaOptions,
   field(el('label',{},race,' Racing: drop candidates that are clearly behind after a slice')),
   field(...labelled('optSeed','Seed',seed),el('span',{className:'hint',textContent:'same seed, same run'}))),
  field(...labelled('optMinutes','Stop after',minutes),el('span',{className:'hint',textContent:'minutes (0 = until stopped)'})));
 // Run
 const start=el('button',{type:'button',className:'primary',textContent:'▶ Start'});
 const pause=el('button',{type:'button',textContent:'Ⅱ Pause',disabled:true});
 const stop=el('button',{type:'button',textContent:'■ Stop',disabled:true});
 const runStatus=el('p',{className:'opt-status',role:'status'});
 const stats=el('dl',{className:'opt-stats'});
 const chart=el('canvas',{className:'opt-chart',ariaLabel:'Best and current score over evaluations'});
 const log=el('ol',{className:'opt-log'});
 const topTable=el('table',{className:'tool-table opt-top'});
 const topBox=el('div',{className:'opt-top-box',hidden:true},el('h4',{textContent:'Best candidates'}),el('div',{className:'tool-table-wrap'},topTable));
 // Best
 const bestHead=el('p',{className:'hint',textContent:'No result yet.'});
 const bestCode=el('pre',{className:'opt-best'});
 const bestValues=el('table',{className:'tool-table opt-values'});
 const addBest=el('button',{type:'button',textContent:'Add to warriors',disabled:true});
 const downloadBest=el('button',{type:'button',textContent:'Download .red',disabled:true});
 const useTemplate=el('button',{type:'button',textContent:'Use as template',disabled:true,title:'Put the template back into the editor with every start value set to the best value'});
 const copyBest=el('button',{type:'button',textContent:'Copy',disabled:true});
 const validate=el('button',{type:'button',textContent:'Check best on new placements',disabled:true});
 const validation=el('p',{className:'hint',role:'status'});
 const opponentsTable=el('table',{className:'tool-table opt-opponents'});
 const opponentsBox=el('details',{className:'opt-opponents-box',hidden:true},el('summary',{textContent:'Per opponent'}),el('div',{className:'tool-table-wrap'},opponentsTable));
 const help=el('details',{className:'tool-help',open:!saved.helpClosed},el('summary',{textContent:'How to use the optimizer'}),
  el('ol',{className:'tool-steps'},...STEPS.map(s=>el('li',{textContent:s}))),
  el('div',{className:'tool-topics'},...TOPICS.map(([h,body])=>el('details',{},el('summary',{textContent:h}),el('p',{textContent:body})))));
 root.append(help,el('div',{className:'opt-layout'},
  el('div',{className:'opt-main'},
   el('section',{className:'t-card opt-template'},el('h3',{textContent:'Template'}),
    el('div',{className:'tool-form'},field(exampleSelect,rosterSelect,convert)),editor,check,markerTable),
   el('section',{className:'t-card'},el('h3',{textContent:'Best warrior'}),bestHead,bestValues,bestCode,
    el('div',{className:'tool-actions'},addBest,useTemplate,downloadBest,copyBest),el('div',{className:'tool-actions'},validate),validation,opponentsBox)),
  el('section',{className:'t-card opt-run'},el('h3',{textContent:'Run'}),settings,el('div',{className:'tool-actions'},start,pause,stop),runStatus,stats,chart,topBox,log)));

 // ---- state
 let parsed=null,suite=null,run=null,methodShown=null;
 const suites=new Map();
 function persist(){
  saveState({template:editor.value,suite:suiteSelect.value,method:searchMethod,scoring:scoringSelect.value,rounds:rounds.value,minutes:minutes.value,workers:workers.value,seed:seed.value,race:race.checked,
   sweep:sweep.checked,sweepLimit:sweepLimit.value,restarts:restarts.checked,patience:patience.value,population:population.value,immigrants:immigrants.value,mutation:mutation.value,
   helpClosed:!help.open,advancedOpen:settings.querySelector('.opt-advanced').open,syntaxOpen:markerTable.open});
 }
 let persistTimer=null;const schedulePersist=()=>{clearTimeout(persistTimer);persistTimer=setTimeout(persist,300);};
 root.addEventListener('change',schedulePersist);root.addEventListener('toggle',schedulePersist,true);

 function refreshRoster(){
  const list=roster();
  rosterSelect.replaceChildren(new Option(list.length?'Start from a warrior…':'No warriors loaded',''),...list.map((w,i)=>new Option(w.name,String(i))));
  rosterSelect.disabled=!list.length;
 }
 exampleSelect.onchange=()=>{
  const e=examples.find(x=>x.id===exampleSelect.value);exampleSelect.value='';if(!e)return;
  if(run&&!run.finished){runStatus.textContent='Stop the run before loading another template.';return;}
  editor.value=e.source;suiteSelect.value=e.suite;loadSuite();recheck();persist();runStatus.textContent=e.note;
 };
 rosterSelect.onchange=()=>{
  const w=roster()[Number(rosterSelect.value)];rosterSelect.value='';if(!w)return;
  editor.value=w.source;recheck();persist();runStatus.textContent=`Loaded ${w.name}. Replace the numbers you want tuned with ! markers.`;
 };
 convert.onclick=()=>{editor.value=fromMetcalf(editor.value);recheck();persist();};

 // ---- opponents
 function matchSettings(){
  if(suiteSelect.value==='roster'){const c=readConfig();return {...c,warriors:2};}
  return suite?.config??suiteList().find(s=>s.id===suiteSelect.value)?.config??null;
 }
 async function loadSuite(){
  const id=suiteSelect.value;suite=null;
  if(id==='roster'){
   const list=roster();suite={id,name:'Your warriors',config:readConfig(),warriors:list.map((w,i)=>({name:w.name,source:w.source,id:'roster-'+i}))};
   suiteInfo.textContent=`${list.length} warrior${list.length===1?'':'s'} from the roster · ${describeSettings(suite.config)}`;recheck();return suite;
  }
  suiteInfo.textContent='Loading opponents…';
  try{
   if(loadBenchmark){const loaded=await loadBenchmark(id);if(suiteSelect.value!==id)return null;suites.set(id,loaded);}
   const entry=benchmarkCatalog.find(s=>s.id===id);
   if(!suites.has(id)){
    if(!entry)throw new Error('this benchmark is no longer loaded');
    const response=await fetch(new URL(entry.data,import.meta.url));if(!response.ok)throw new Error('HTTP '+response.status);
    const {files,scores}=await response.json();suites.set(id,readBenchmark(entry.descriptor,files,id,scores??null));
   }
   if(suiteSelect.value!==id)return null;
   suite=suites.get(id);
   suiteInfo.textContent=`${suite.warriors.length} opponents · ${describeSettings(suite.config)}`;
   if(suite.config.rules88)suiteInfo.textContent+=' · the template must be valid ’88 Redcode';
  }catch(error){suiteInfo.textContent='Could not load the opponents: '+error.message;}
  recheck();return suite;
 }
 suiteSelect.addEventListener('change',()=>{loadSuite();});

 // ---- live check
 let checkTimer=null;
 editor.addEventListener('input',()=>{clearTimeout(checkTimer);checkTimer=setTimeout(()=>{recheck();schedulePersist();},200);});
 for(const c of [scoringSelect,rounds,methodSelect])c.addEventListener('change',recheck);
 function recheck(){
  const config=matchSettings();
  if(!config){check.replaceChildren(el('p',{className:'hint',textContent:'Choose the opponents to check the template against their core size.'}));parsed=null;return;}
  try{
   parsed=parseTemplate(editor.value,templateConstants({...config,rounds:Number(rounds.value)||250}));
   methodVisibility();
  }catch(error){
   parsed=null;methodVisibility();
   check.replaceChildren(el('p',{className:'opt-error',textContent:error.message}));
   if(error.line)markLine(error.line);
   return;
  }
  const vars=parsed.variables;
  if(!vars.length){check.replaceChildren(el('p',{className:'t-warning',textContent:'No markers yet. Replace a number you want tuned with !, a range such as !(1..79), or a list such as ![#,$].'}));return;}
  const mode=suite?scoringMode(suite.config,[parsed.render(parsed.startIndices().map(v=>v??0)),...suite.warriors.map(w=>w.source)],{mode:scoringSelect.value,rounds:Number(rounds.value)||250}):null;
  check.replaceChildren(
   el('p',{},el('strong',{textContent:`${vars.length} variable${vars.length===1?'':'s'}`}),` · search space ${big(parsed.searchSpace())} candidates`+(mode?` · ${mode.why} · ${engineLabel(suite.config,mode)}`:'')),
   ...gridSummary(vars,mode),
   el('table',{className:'tool-table opt-vars'},el('thead',{},el('tr',{},...['Name','Line','Values','Domain','Start'].map(h=>el('th',{scope:'col',textContent:h})))),
    el('tbody',{},...vars.map(v=>el('tr',{},el('td',{},el('code',{textContent:v.name})),el('td',{className:'num',textContent:String(v.line)}),el('td',{className:'num',textContent:big(v.values.length)}),
     el('td',{},el('code',{textContent:v.values.length<=6?v.values.join(', '):`${v.values.slice(0,3).join(', ')} … ${v.values.slice(-2).join(', ')}`})),
     el('td',{textContent:v.exhaustive?'every value':v.start===null?'random':v.values[v.start]}))))));
 }
 // What a !! run will fight, and what is missing before it can start.
 const LOTS_OF_ROUNDS=2e7;
 function gridSummary(vars,mode){
  if(!gridRun())return [];
  const grid=vars.filter(v=>v.exhaustive),candidates=parsed.gridSize(),opponents=suite?.warriors?.length??0,out=[];
  const matches=candidates*opponents,roundsTotal=mode?matches*mode.rounds:0;
  out.push(el('p',{className:'opt-grid'},el('strong',{textContent:'Every value: '}),
   `${big(candidates)} candidate${candidates===1?'':'s'} (${grid.map(v=>`${v.name} ${big(v.values.length)}`).join(' × ')})`+(opponents?` × ${opponents} opponents = ${big(matches)} matches`+(mode?` of ${mode.rounds} rounds`:''):'')+'. The run shows the time left once it has started.'));
  if(roundsTotal>LOTS_OF_ROUNDS)out.push(el('p',{className:'t-warning',textContent:`That is a lot of battles (${big(roundsTotal)} rounds) and may take hours. Racing (Method settings) skips the rest of a candidate that is clearly behind; Stop after pauses the run, and Continue tests the rest.`}));
  const fixed=vars.filter(v=>!v.exhaustive&&v.start===null);
  if(fixed.length)out.push(el('p',{className:'t-warning',textContent:`In a !! run the ! markers keep their start value. Give ${fixed.map(v=>v.name).join(', ')} a start value with :v, or make ${fixed.length===1?'it':'them'} !! too.`}));
  return out;
 }
 const engineLabel=(config,mode)=>{const e=plannedEngine(config,mode);return e.engine==='exmars'?'engine exMARS':`engine pMARS (exMARS can’t run ${e.why})`;};
 function markLine(line){
  // Select the line with the error so it is easy to find in the textarea.
  if(document.activeElement===editor)return;
  const lines=editor.value.split('\n');let pos=0;for(let i=0;i<line-1&&i<lines.length;i++)pos+=lines[i].length+1;
  editor.setSelectionRange(pos,pos+(lines[line-1]?.length??0));
 }
 // A template with !! markers is always an exhaustive run; the method choice comes back without them.
 const gridRun=()=>!!parsed?.exhaustive.length;
 function methodVisibility(){
  if(gridRun()){if(!everyOption.parentNode)methodSelect.append(everyOption);methodSelect.value='every';methodSelect.disabled=true;}
  else if(everyOption.parentNode){everyOption.remove();methodSelect.value=searchMethod;methodSelect.disabled=!!run&&['running','paused'].includes(run.state);}
  annealOptions.hidden=methodSelect.value!=='anneal';gaOptions.hidden=methodSelect.value!=='ga';
 }
 methodSelect.addEventListener('change',()=>{if(methodSelect.value!=='every')searchMethod=methodSelect.value;methodVisibility();});

 // ---- run
 function setRunning(state){
  start.disabled=state==='running';pause.disabled=state!=='running';stop.disabled=!['running','paused'].includes(state);
  start.textContent=state==='paused'?'▶ Continue':'▶ Start';
  editor.readOnly=['running','paused'].includes(state);
  for(const c of [suiteSelect,methodSelect,scoringSelect,rounds,exampleSelect,rosterSelect,convert,workers,coreSlider,...corePresets,seed])c.disabled=['running','paused'].includes(state);
  if(gridRun())methodSelect.disabled=true;
  validate.disabled=!run?.best||state==='running';
 }
 async function begin(){
  if(run&&run.state==='paused'){run.deadline=Number(minutes.value)>0?Date.now()+Number(minutes.value)*60000:Infinity;run.state='running';setRunning('running');loop();return;}
  if(!suite)await loadSuite();
  recheck();
  if(!parsed||!parsed.variables.length){runStatus.textContent='Fix the template first: it needs at least one valid marker.';return;}
  if(!suite?.warriors?.length){runStatus.textContent='There are no opponents to fight. Choose a benchmark or load warriors.';return;}
  const config=matchConfig(suite.config),template=parsed;
  const mode=scoringMode(config,[template.render(template.startIndices().map(v=>v??0)),...suite.warriors.map(w=>w.source)],{mode:scoringSelect.value,rounds:Math.max(10,Number(rounds.value)||250)});
  const pool=new WorkerPool(Math.max(1,Math.min(processors,Number(workers.value)||1)),new URL('./optimizer-worker.mjs',import.meta.url));
  const evaluator=new Evaluator({runJob:job=>pool.run(job),config,opponents:suite.warriors,options:{},seed:seed.value});
  evaluator.setMode(mode);
  const startX=template.startIndices(),numericSeed=hashSeed(seed.value);
  // Continuing from an earlier best of the same template seeds the GA with it.
  const seeds=run?.best&&run.templateText===editor.value?[run.best.x]:[];
  let method;
  if(template.exhaustive.length){
   try{method=new Exhaustive(template.sizes,startX,template.exhaustive,{race:race.checked});}
   catch(error){pool.terminate();runStatus.textContent=error.message==='missing start values'?'Give every ! marker a start value with :v (or make it !!): a !! run keeps them fixed.':error.message;return;}
  }else method=methodSelect.value==='ga'
   ?new Genetic(template.sizes,startX,numericSeed,{population:Number(population.value)||50,immigrants:Number(immigrants.value),mutation:Number(mutation.value)||1.5,race:race.checked},seeds)
   :new Annealing(template.sizes,startX,numericSeed,{sweepLimit:sweep.checked?Number(sweepLimit.value)||160:0,restartPatience:restarts.checked?Number(patience.value)||400:1e15,race:race.checked});
  run?.pool?.terminate();
  run={state:'running',template,templateText:editor.value,pool,evaluator,method,mode,suiteName:suite.name,config,started:Date.now(),elapsed:0,resumedAt:Date.now(),
   deadline:Number(minutes.value)>0?Date.now()+Number(minutes.value)*60000:Infinity,evaluations:0,improvements:0,samples:[],best:null,bestResult:null,log:[]};
  log.replaceChildren();validation.textContent='';opponentsTable.replaceChildren();opponentsBox.hidden=true;shownBest=null;
  runStatus.textContent=`${method instanceof Exhaustive?`Testing all ${big(method.s.total)} candidates`:`Running ${methodSelect.value==='ga'?'the genetic algorithm':'simulated annealing'}`} against ${suite.warriors.length} opponents (${mode.why}; ${engineLabel(config,mode)}).`;
  setRunning('running');loop();
 }
 async function loop(){
  const r=run;r.resumedAt=Date.now();
  let lastDraw=0;
  while(r.state==='running'&&run===r){
   if(Date.now()>=r.deadline){
    // A !! run pauses at the limit, so Continue tests the rest; a search ends there.
    if(r.method instanceof Exhaustive){const t=r.method.summary();r.elapsed+=Date.now()-r.resumedAt;r.state='paused';setRunning('paused');runStatus.textContent=`Paused at the time limit after ${big(t.tested)} of ${big(t.total)} candidates. Continue tests the rest.`;break;}
    finish(r,'Time limit reached.');break;
   }
   let p,result,events;
   try{p=r.method.propose();if(!p){finish(r,`Every candidate tested (${big(r.method.summary().total)}).`);break;}result=await r.evaluator.evaluate(r.template.render(p.x),{race:p.race});}
   catch(error){finish(r,'Stopped: '+error.message);break;}
   if(r.state==='stopped'||run!==r)break;
   try{events=r.method.observe(p,result);}catch(error){finish(r,'Stopped: '+error.message);break;}
   r.evaluations++;
   for(const e of events){
    if(e.type==='best'){
     r.improvements++;
     const best=r.method.best();r.best=best;r.bestResult=result&&sameX(best.x,p.x)?result:r.bestResult;
     r.log.unshift({at:r.evaluations,score:best.score,se:best.se});
     // New seeds now and then, so the search does not tune itself to one set of placements.
     if(!r.mode.exact&&r.method instanceof Annealing&&r.improvements%SCORING_DEFAULTS.reseedEvery===0){r.evaluator.epoch++;r.method.invalidate();}
    }
    if(e.type==='generation'&&!r.mode.exact){r.evaluator.epoch++;r.method.invalidate();}
   }
   const best=r.method.best();if(best){r.best=best;}
   const cur=r.method instanceof Annealing?r.method.current?.score:result?.score;
   r.samples.push([r.evaluations,best?.score??null,cur??null]);
   if(r.samples.length>4000)r.samples=r.samples.filter((_,i)=>i%2===0);
   if(performance.now()-lastDraw>250){lastDraw=performance.now();draw(r);}
  }
  if(run===r)draw(r);
 }
 const sameX=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 function finish(r,message){
  r.elapsed+=Date.now()-r.resumedAt;r.state='finished';r.finished=true;r.pool.terminate();
  runStatus.textContent=message+(r.best&&!r.mode.exact?' Check the best on new placements before you compare it with other warriors.':r.best?' Scores are exact, so the best score is the warrior’s real score against this benchmark.':'');
  setRunning('finished');draw(r);
 }
 start.onclick=()=>{begin().catch(error=>{runStatus.textContent=error.message;setRunning('idle');});};
 pause.onclick=()=>{if(run?.state!=='running')return;run.state='paused';run.elapsed+=Date.now()-run.resumedAt;setRunning('paused');runStatus.textContent='Paused. The candidate being scored is finished first; Continue picks up exactly here.';draw(run);};
 stop.onclick=()=>{if(!run||run.finished)return;if(run.state==='running')run.elapsed+=Date.now()-run.resumedAt;run.state='stopped';run.finished=true;run.pool.terminate();setRunning('finished');runStatus.textContent='Stopped.'+(run.best?' The best result is kept below.':'');draw(run);};

 // From the rate so far; the first candidates also assemble the opponents, so wait for a few.
 function timeLeft(elapsed,{tested,total}){
  if(tested>=total)return 'done';if(tested<3||elapsed<2)return 'estimating…';
  const left=elapsed/tested*(total-tested),h=Math.floor(left/3600),m=Math.floor(left%3600/60),sec=Math.floor(left%60);
  return h?`about ${h} h ${m} min`:m?`about ${m} min ${sec} s`:`about ${sec} s`;
 }
 function draw(r){
  const elapsed=(r.elapsed+(r.state==='running'?Date.now()-r.resumedAt:0))/1000,ev=r.evaluator,summary=r.method.summary();
  const items=[['Evaluations',r.evaluations.toLocaleString('en-US')],['Per second',fmt(r.evaluations/Math.max(1,elapsed),1)],['Elapsed',`${Math.floor(elapsed/60)}:${String(Math.floor(elapsed%60)).padStart(2,'0')}`],
   ['Best',r.best?fmt(r.best.score,2)+(r.best.se?` ± ${fmt(r.best.se,2)}`:''):'—'],
   ...(r.method instanceof Annealing?[['Current',fmt(summary.current,2)],['Phase',summary.phase],['Restarts',String(summary.restarts)]]
    :r.method instanceof Exhaustive?[['Tested',`${big(summary.tested)} of ${big(summary.total)}`],['Time left',timeLeft(elapsed,summary)]]
    :[['Population median',fmt(summary.median,2)],['Children',String(summary.children)]]),
   ['Engine',engineSummary(ev.engines)],['Raced out',String(ev.raced)],['Invalid',String(ev.invalid)],['Cache hits',String(ev.cached)],...(r.mode.exact?[]:[['Seed set',String(ev.epoch+1)]])];
  stats.replaceChildren(...items.flatMap(([k,v])=>[el('dt',{textContent:k}),el('dd',{textContent:v})]));
  drawChart(r);showTop(r);
  log.replaceChildren(...r.log.slice(0,8).map(e=>el('li',{textContent:`New best after ${e.at} evaluations: ${fmt(e.score,2)}${e.se?' ± '+fmt(e.se,2):''}`})));
  showBest(r);
 }
 let shownBest=null;
 function drawChart(r){
  if(!chart.clientWidth)return;
  const ratio=devicePixelRatio||1,w=chart.clientWidth,h=180;chart.width=w*ratio;chart.height=h*ratio;
  const ctx=chart.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#101d29';ctx.fillRect(0,0,w,h);
  if(r.method instanceof Exhaustive&&r.method.s.scores)return drawValues(r,ctx,w,h);
  const pts=r.samples,L=40,R=8,T=10,B=20;ctx.font='11px system-ui';ctx.fillStyle='#aec0ce';
  if(pts.length<2){ctx.fillText('Waiting for scores',L,h/2);return;}
  let lo=Infinity,hi=-Infinity;for(const [,b,c] of pts)for(const v of [b,c])if(v!==null){lo=Math.min(lo,v);hi=Math.max(hi,v);}
  if(hi-lo<1){hi+=0.5;lo-=0.5;}
  const n=pts.at(-1)[0],xs=x=>L+(w-L-R)*x/Math.max(1,n),ys=v=>T+(h-T-B)*(1-(v-lo)/(hi-lo));
  ctx.strokeStyle='#2a3d4d';ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,h-B);ctx.lineTo(w-R,h-B);ctx.stroke();
  ctx.fillText(fmt(hi,0),4,T+8);ctx.fillText(fmt(lo,0),4,h-B);ctx.fillText('0',L,h-6);ctx.fillText(String(n),w-R-30,h-6);
  // Candidates as dots (they jump around), the current annealing state and the best as lines.
  if(!(r.method instanceof Annealing)){ctx.fillStyle='#f9a56799';for(const p of pts)if(p[2]!==null)ctx.fillRect(xs(p[0])-1,ys(p[2])-1,2,2);}
  for(const [index,color,width] of (r.method instanceof Annealing?[[2,'#f9a567',1],[1,'#54d8df',2]]:[[1,'#54d8df',2]])){
   ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();let started=false;
   for(const p of pts){if(p[index]===null)continue;const x=xs(p[0]),y=ys(p[index]);if(started)ctx.lineTo(x,y);else{ctx.moveTo(x,y);started=true;}}
   ctx.stroke();
  }
  ctx.fillStyle='#54d8df';ctx.fillText('best',w-R-90,T+8);ctx.fillStyle='#f9a567';ctx.fillText(r.method instanceof Annealing?'current':'candidate',w-R-56,T+8);
 }
 // One !! variable: the score of each value, in domain order, with the best marked.
 function drawValues(r,ctx,w,h){
  const scores=r.method.s.scores,v=r.template.variables[r.method.s.grid[0]],L=40,R=8,T=26,B=20;
  ctx.font='11px system-ui';ctx.fillStyle='#aec0ce';
  const known=scores.filter(x=>x!==null);if(!known.length){ctx.fillText('Waiting for scores',L,h/2);return;}
  let lo=Math.min(...known),hi=Math.max(...known);if(hi-lo<1){hi+=0.5;lo-=0.5;}
  const n=scores.length,xs=i=>L+(w-L-R)*(n>1?i/(n-1):0.5),ys=s=>T+(h-T-B)*(1-(s-lo)/(hi-lo));
  ctx.strokeStyle='#2a3d4d';ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,h-B);ctx.lineTo(w-R,h-B);ctx.stroke();
  ctx.fillText(fmt(hi,0),4,T+8);ctx.fillText(fmt(lo,0),4,h-B);ctx.fillText(v.values[0],L,h-6);ctx.fillText(v.values[n-1],w-R-30,h-6);
  ctx.fillText(`Score for each value of ${v.name}`,L,14);
  ctx.strokeStyle='#54d8df';ctx.lineWidth=1.5;ctx.beginPath();let started=false;
  scores.forEach((s,i)=>{if(s===null){started=false;return;}const x=xs(i),y=ys(s);if(started)ctx.lineTo(x,y);else{ctx.moveTo(x,y);started=true;}});ctx.stroke();
  ctx.fillStyle='#54d8df';scores.forEach((s,i)=>{if(s!==null&&n<=200)ctx.fillRect(xs(i)-1.5,ys(s)-1.5,3,3);});
  // The best value, labelled beside its dot (left of it near the right edge, below it at the top).
  const b=r.best;if(b){const i=b.x[r.method.s.grid[0]],x=xs(i),y=ys(b.score),label=`best ${v.values[i]}`,tw=ctx.measureText(label).width;
   ctx.fillStyle='#f1c96b';ctx.beginPath();ctx.arc(x,y,4,0,7);ctx.fill();
   ctx.fillText(label,x+8+tw>w-R?x-8-tw:x+8,y<T+12?y+14:y-6);}
 }
 // The best candidates of a !! run, by score.
 function showTop(r){
  if(!(r.method instanceof Exhaustive)){topBox.hidden=true;return;}
  const grid=r.method.s.grid,vars=r.template.variables,top=r.method.s.top.slice(0,10);
  topBox.hidden=!top.length;
  topTable.replaceChildren(el('thead',{},el('tr',{},el('th',{scope:'col',textContent:'#'}),...grid.map(i=>el('th',{scope:'col'},el('code',{textContent:vars[i].name}))),el('th',{scope:'col',textContent:'Score'}))),
   el('tbody',{},...top.map((t,k)=>el('tr',{},el('td',{className:'num',textContent:String(k+1)}),...grid.map(i=>el('td',{className:'num',textContent:vars[i].values[t.x[i]]})),el('td',{className:'num',textContent:fmt(t.score,2)+(t.se?` ± ${fmt(t.se,2)}`:'')})))));
 }
 function showBest(r){
  const b=r.best;
  for(const c of [addBest,downloadBest,useTemplate,copyBest])c.disabled=!b;
  validate.disabled=!b||r.state==='running';
  if(!b){bestHead.textContent='No result yet.';bestCode.replaceChildren();bestValues.replaceChildren();return;}
  const key=b.x.join(',')+'|'+b.score;if(key===shownBest)return;shownBest=key;
  bestHead.textContent=`Score ${fmt(b.score,2)}${b.se?` ± ${fmt(b.se,2)}`:''}${b.n>1?` (mean of ${b.n} seed sets)`:''} against ${r.suiteName}${r.mode.exact?' · exact':''}. Tuned values are highlighted.`;
  bestCode.replaceChildren(...r.template.segments(b.x).map(s=>s.variable?el('mark',{title:s.variable,textContent:s.text}):document.createTextNode(s.text)));
  const startX=r.template.startIndices();
  bestValues.replaceChildren(el('thead',{},el('tr',{},...['Variable','Start','Best'].map(h=>el('th',{scope:'col',textContent:h})))),
   el('tbody',{},...r.template.variables.map((v,i)=>el('tr',{className:startX[i]!==null&&startX[i]!==b.x[i]?'opt-changed':''},el('td',{},el('code',{textContent:v.name})),el('td',{textContent:startX[i]===null?'random':v.values[startX[i]]}),el('td',{},el('strong',{textContent:v.values[b.x[i]]}))))));
  if(r.bestResult)showOpponents(r.bestResult,'Search score of the best, per opponent');
 }
 function showOpponents(result,caption){
  opponentsBox.hidden=false;opponentsBox.querySelector('summary').textContent=caption;
  opponentsTable.replaceChildren(el('caption',{className:'hint',textContent:caption}),el('thead',{},el('tr',{},...['Opponent','W','T','L','Score'].map(h=>el('th',{scope:'col',textContent:h})))),
   el('tbody',{},...result.opponents.slice().sort((a,b)=>a.score-b.score).map(o=>el('tr',{},el('td',{textContent:o.name}),...[o.wins,o.ties,o.losses].map(v=>el('td',{className:'num',textContent:String(v)})),el('td',{className:'num',textContent:fmt(o.score,1)})))));
 }
 const bestSource=()=>{
  const src=run.template.render(run.best.x);
  return /^\s*;\s*name\b/im.test(src)?src.replace(/^(\s*;\s*name\s+)(.*?)(\s*\(template\))?\s*$/im,(m,a,name)=>`${a}${name.replace(/\s*\(template\)$/,'')} (optimized)`):';name optimized\n'+src;
 };
 const bestName=()=>/^\s*;\s*name\s+(.*?)\s*$/im.exec(bestSource())?.[1]||'optimized';
 addBest.onclick=()=>{try{addWarrior(bestSource(),warriorFilename(bestName()));runStatus.textContent=`Added “${bestName()}” to your warriors.`;refreshRoster();}catch(error){runStatus.textContent=error.message;}};
 downloadBest.onclick=()=>download(bestSource(),warriorFilename(bestName()));
 copyBest.onclick=async()=>{try{await navigator.clipboard.writeText(bestSource());copyBest.textContent='Copied';}catch{copyBest.textContent='Copy failed';}setTimeout(()=>copyBest.textContent='Copy',1200);};
 useTemplate.onclick=()=>{
  if(run.state==='running'){runStatus.textContent='Pause or stop the run first.';return;}
  if(run.state==='paused')stop.onclick();
  editor.value=run.template.writeBack(run.best.x);run.templateText=editor.value;recheck();persist();
  runStatus.textContent='The editor now holds the template with the best values as start values. Narrow the ranges or start again (the GA is seeded with this result).';
 };
 validate.onclick=async()=>{
  const r=run;if(!r?.best||r.state==='running')return;
  validate.disabled=true;
  const pool=r.finished?new WorkerPool(Math.max(1,Math.min(processors,Number(workers.value)||1)),new URL('./optimizer-worker.mjs',import.meta.url)):null;
  const ev=pool?new Evaluator({runJob:job=>pool.run(job),config:r.config,opponents:r.evaluator.opponents,seed:r.evaluator.seed}):r.evaluator;
  ev.setMode(r.mode);
  validation.textContent=r.mode.exact?'Scoring exactly…':`Fighting ${SCORING_DEFAULTS.validateRounds} new rounds per opponent…`;
  try{
   const result=await ev.validate(r.template.render(r.best.x));
   if(!result)throw new Error('the warrior did not assemble');
   validation.textContent=`Held-out score ${fmt(result.score,2)}${result.se?` ± ${fmt(result.se,2)}`:''} on ${result.rounds} new rounds per opponent (search score ${fmt(r.best.score,2)}).`;
   showOpponents(result,'Held-out score of the best, per opponent');
  }catch(error){validation.textContent='Check failed: '+error.message;}
  finally{pool?.terminate();validate.disabled=r.state==='running';}
 };

 new ResizeObserver(()=>{if(run)drawChart(run);}).observe(chart);
 methodVisibility();refreshRoster();loadSuite();
 // Suites imported, made or edited in the Benchmark mode since the last visit show up here.
 const idle=()=>!run||run.finished;
 return {show(){refreshRoster();if(idle()){fillSuites();loadSuite();}if(run)draw(run);},hide(){}};
}

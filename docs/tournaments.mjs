import {suiteFilenames} from './warrior-files.mjs';
import {storeZip} from './benchmark-zip.mjs';
import {pushoff,rankings,koenScore,writeKoenigstuhl} from './pushoff.mjs';
import {benchmarkParameters} from './benchmarks.mjs';
// SPDX-License-Identifier: GPL-2.0-or-later
import {planTournament} from './tournament-plan.mjs';
import {cacheKey,loadCached,saveCached,withCandidate,writeHillScores,defaultHillRounds,permutationRounds,sameParameters,hillParameters} from './hill-scores.mjs';
import {HistoryChart} from './charts.mjs';
import {warriorColor} from './display.mjs';
import {defaults} from './settings.mjs';
import {pairTotals,perRound,renderTable,renderMatrix} from './results-tables.mjs';
const $=id=>document.getElementById(id);
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
// One line for the settings a run uses, including the ones that are easy to miss.
export function describeSettings(c){
 const positions=2*(c.coreSize-2*(c.distance||c.maxLength)+1);
 return `${c.rules88?'ICWS ’88':'ICWS ’94'} · core ${c.coreSize} · cycles ${c.cycles} · processes ${c.tasks} · length ${c.maxLength} · distance ${c.distance||c.maxLength} · ${c.noPspace?'no P-space':`P-space ${c.pspace||'auto'}`}${c.permutate?` · permutation: ${positions} rounds per full pass`:''}${c.formula&&c.formula!==defaults.formula?` · score formula ${c.formula}`:''}`;
}
const authorOf=source=>/^\s*;\s*author\s+(.*?)\s*$/im.exec(source)?.[1]||'Anonymous';
// The suite parameters that picking a suite copies into the match settings (rounds go to Rounds per matchup).
const suiteKeys=benchmarkParameters.filter(k=>k!=='rounds');
const differences=(a,b)=>suiteKeys.filter(k=>String(a[k])!==String(b[k]));
const settingNames={coreSize:'core size',cycles:'cycles',tasks:'processes',maxLength:'length',distance:'distance',pspace:'P-space size',rules88:'ICWS standard',noPspace:'P-space',permutate:'permutation',formula:'score formula'};
// store: the shared benchmark suites (benchmark-store.mjs). onEditSuite(id): open a suite in the
// Benchmarks tool. applyConfig: puts a suite's settings into the match settings, which every run then uses.
export function setupTournaments({roster,readConfig,applyConfig=()=>{},onTab,store,onEditSuite=()=>{},addWarrior=null,loadedSources=()=>[],maxLoaded=36}) {
 const suites=store.suites,loadSuite=suite=>store.load(suite);
 const editLink=id=>{const b=document.createElement('button');b.type='button';b.className='link-button';b.textContent='Edit it in Tools › Benchmarks';b.onclick=()=>onEditSuite(id);return b;};
 let run=null,workers=[],pendingRender=null,displayedSuite=null;
 // Hill scores for the selected suite: shipped with it, cached in this browser, or none yet.
 let hill={id:null,key:null,data:null};
 // The suite (id and settings) whose settings Benchmark mode last put into the match settings.
 let settingsFrom=null;
 const engine=fetch(new URL('./engine-lock.json',import.meta.url)).then(r=>r.json()).then(lock=>lock.commit||'').catch(()=>'');
 const suiteId=suite=>suite.id+'|'+JSON.stringify(suite.config);
 // The match settings, or null while a field holds an invalid value.
 const matchConfig=()=>{try{return readConfig();}catch{return null;}};
 // Hill scores belong to the suite's warriors and the match settings that decide who wins;
 // shipped scores count only while those settings are still the suite's own.
 const hillId=(suite,config)=>suiteId(suite)+'|'+JSON.stringify(hillParameters(config));
 async function lookupHill(suite,config=readConfig()){
  const id=hillId(suite,config);if(hill.id===id&&!hill.pending)return hill;
  if(hill.id===id&&hill.pending)return hill.pending;
  const pending=(async()=>{const key=await cacheKey(suite.warriors,config,await engine),data=(sameParameters(config,suite.config)&&suite.hillScores)||await loadCached(key);if(hill.id===id){hill={id,key,data};refresh();}return hill;})();
  hill={id,key:null,data:null,pending};
  return pending;
 }
 const chart=new HistoryChart($('tournamentChart'),'Average score (points / 100 rounds) · completed matchups');
 let chartWidth=0;
 new ResizeObserver(([entry])=>{const width=entry.contentRect.width;if(width>0&&width!==chartWidth){chartWidth=width;chart.draw();}}).observe($('tournamentChart'));
 const processors=Math.max(1,navigator.hardwareConcurrency||2);
 $('tournamentWorkers').max=processors;$('tournamentWorkers').value=Math.max(1,Math.floor(processors/2));
 $('workerLimit').textContent=navigator.hardwareConcurrency?`${processors} logical processors available (not necessarily physical cores).`:'The browser did not report a processor count. Using a limit of 2 workers.';
 $('workerSlider').max=processors;
 $('tournamentRanking').replaceChildren(...Object.entries(rankings).map(([value,{label}])=>new Option(label,value)));
 function workerPreview(){
  const count=Number($('tournamentWorkers').value);
  $('workerSlider').value=count;
  $('workerSummary').textContent=`of ${processors}`;
 }
 $('tournamentWorkers').addEventListener('input',workerPreview);
 $('workerSlider').oninput=()=>{$('tournamentWorkers').value=$('workerSlider').value;workerPreview();};
 document.querySelectorAll('[data-workers]').forEach(button=>button.onclick=()=>{
  $('tournamentWorkers').value=button.dataset.workers==='one'?1:button.dataset.workers==='half'?Math.max(1,Math.floor(processors/2)):processors;workerPreview();
 });
 workerPreview();
 const workerMore=document.querySelector('.t-worker-more');
 document.addEventListener('click',event=>{if(workerMore.open&&!workerMore.contains(event.target))workerMore.open=false;});
 workerMore.addEventListener('keydown',event=>{if(event.key==='Escape'){workerMore.open=false;workerMore.querySelector('summary').focus();}});
 const modeTabs=[...document.querySelectorAll('[data-mode]')];
 function chooseMode(tab){$('tournamentMode').value=tab.dataset.mode;suiteDefaults();}
 modeTabs.forEach((tab,index)=>{
  tab.onclick=()=>chooseMode(tab);
  tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
   const next=event.key==='Home'?0:event.key==='End'?modeTabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+modeTabs.length)%modeTabs.length;
   chooseMode(modeTabs[next]);modeTabs[next].focus();
  };
 });
 const tabs=[$('emulatorTab'),$('tournamentTab'),$('libraryTab'),$('toolsTab'),$('trialsTab')];
 function selectTab(index){
  tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});
  $('changed').hidden=index!==0;
  onTab(index);if(index===1){refresh();chart.draw();}
 }
 tabs.forEach((tab,index)=>{tab.onclick=()=>selectTab(index);tab.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;selectTab(next);tabs[next].focus();}};});
 // Every mode runs with the match settings; picking a suite copies its settings there (useSuiteSettings).
 const configForRun=()=>readConfig();
 const currentSuite=()=>suites.find(s=>s.id===$('benchmarkSuite').value);
 const benchmarkPushoff=()=>$('tournamentMode').value==='benchmark'&&$('tournamentRanking').value!=='average';
 // Round robin and melee can add a suite's warriors as entrants (Add a benchmark suite).
 const suiteJoins=()=>['round-robin','melee'].includes($('tournamentMode').value)&&$('includeSuite').checked;
 const usesSuite=()=>$('tournamentMode').value==='benchmark'||suiteJoins();
 // Joining suite warriors take the colours after the roster's, so no two entrants share one at first.
 function suiteEntrants(entrants){
  const warriors=currentSuite()?.warriors;if(!warriors||!suiteJoins())return warriors;
  const first=Math.max(-1,...entrants.map((w,i)=>w.colorIndex??i))+1;
  return warriors.map((w,i)=>({...w,colorIndex:first+i,fromSuite:true}));
 }
 function plan(){
  const pushoff=benchmarkPushoff(),entrants=roster();
  return planTournament({mode:$('tournamentMode').value,entrants,opponents:suiteEntrants(entrants),withSuite:suiteJoins(),
  challenger:$('challenger').value,rounds:Number($('tournamentRounds').value),seed:$('tournamentSeed').value,config:configForRun(),selfFights:$('selfFights').checked,
  pushoff,hill:pushoff&&(!hill.data||$('recomputeHill').checked),hillRounds:Number($('hillRounds').value),hillPermutate:$('hillPermutate').checked});
 }
 function refresh(){
  const mode=$('tournamentMode').value;
  modeTabs.forEach(tab=>{const selected=tab.dataset.mode===mode;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
  $('modePanel').setAttribute('aria-labelledby','mode-'+mode);
  $('modeDescription').textContent={'round-robin':'Each selected warrior fights every other selected warrior, one on one.',benchmark:'Test each selected warrior against the opponents in a benchmark suite.',challenge:'One challenger fights each of the other selected warriors, one on one.',melee:'All selected warriors fight together in the same core.'}[mode];
  $('selfFights').disabled=mode==='melee';
  $('benchmarkSetup').hidden=mode!=='benchmark';$('challengeSetup').hidden=mode!=='challenge';
  $('includeSuiteField').hidden=!['round-robin','melee'].includes(mode);$('suiteField').hidden=!usesSuite();
  $('rankingField').hidden=!['round-robin','benchmark'].includes(mode);
  const ranking=$('tournamentRanking').value;$('rankingHint').hidden=$('rankingField').hidden||ranking==='average';
  $('rankingHint').textContent={sequential:'Repeatedly removes the warrior with the lowest total score, self fight included. Turn on Self fights to match the Koenigstuhl scripts.',diversity:'Repeatedly removes the warrior with the lowest average × distance to its most similar warrior (Astolfi).','sd-diversity':'Repeatedly removes the warrior with the lowest average × smallest SD-score to another warrior (Ismael 2025).'}[ranking]||'';
  const old=$('challenger').value;$('challenger').replaceChildren(...roster().map(w=>new Option(w.name,w.id)));if(roster().some(w=>w.id===old))$('challenger').value=old;
  const selected=$('benchmarkSuite').value;$('benchmarkSuite').replaceChildren(...suites.map(s=>new Option(s.name,s.id)));if(suites.some(s=>s.id===selected))$('benchmarkSuite').value=selected;
  const suite=suites.find(s=>s.id===$('benchmarkSuite').value),pending=!suite.warriors;
  if(pending&&usesSuite()&&!suite.loadError)loadSuite(suite).catch(()=>{});
  if(displayedSuite!==suite||pending){
   displayedSuite=suite;
   $('benchmarkDescription').textContent=suite.descriptor.description||'';
   $('benchmarkSummary').textContent=`${pending?suite.loadError||'Loading opponents…':suite.warriors.length+' opponents'} · default ${suite.rounds} rounds · ${store.builtIn(suite)?'built in':'your suite'}`;
   const hillDefault=defaultHillRounds(matchConfig()||suite.config);$('hillRounds').value=hillDefault.rounds;$('hillPermutate').checked=hillDefault.permutate;
  }
  // Benchmark runs use the match settings above, which picking the suite set to the suite's own.
  // A workspace restored in Benchmark mode keeps its saved settings, changes included.
  if(mode==='benchmark'&&settingsFrom===null)settingsFrom=suiteId(suite);
  const config=matchConfig(),changed=usesSuite()&&config?differences(config,suite.config):[];
  // A suite added to round robin or melee keeps the match settings, so a difference gets a warning
  // here: with a shorter length, say, its longer warriors do not assemble.
  $('suiteWarning').hidden=!suiteJoins()||!changed.length;
  $('suiteWarningText').textContent=$('suiteWarning').hidden?'':`The match settings differ from “${suite.name}” in ${changed.map(k=>settingNames[k]).join(', ')}, so its warriors may not assemble or may not fight as on their hill. The suite’s own: ${describeSettings(suite.config)}.`;
  $('suiteSettingsNote').hidden=mode!=='benchmark';
  $('suiteSettingsText').textContent=mode!=='benchmark'?'':changed.length?`The match settings above differ from “${suite.name}” in ${changed.map(k=>settingNames[k]).join(', ')}. Runs use the match settings; the suite’s own are ${describeSettings(suite.config)}.`:`The match settings above are “${suite.name}”’s own. Change them there for your runs; Edit suite changes the suite itself.`;
  $('useSuiteSettings').hidden=!changed.length;
  const pushing=benchmarkPushoff();$('hillStatus').hidden=!pushing;
  if(pushing&&pending){
   $('hillText').textContent=suite.loadError||'Loading the suite…';
   $('recomputeHillField').hidden=$('hillFightSetup').hidden=$('hillWarning').hidden=true;
  }else if(pushing&&!config){
   $('hillText').textContent='Fix the match settings above to look up hill scores.';
   $('recomputeHillField').hidden=$('hillFightSetup').hidden=$('hillWarning').hidden=true;
  }else if(pushing){
   if(hill.id!==hillId(suite,config))lookupHill(suite,config);
   const data=hill.id===hillId(suite,config)&&hill.data,pairs=suite.warriors.length*(suite.warriors.length+1)/2;
   $('hillText').textContent=hill.pending?'Looking for hill scores…':data?`Hill scores ${data.source==='suite'?'shipped with the suite':'cached in this browser'}: ${data.permutate?'every starting position':`${data.rounds.toLocaleString()} rounds per pair`}${data.createdAt?`, ${data.createdAt}`:''}. Only the selected warriors fight.`:`${suite.scoresProblem?suite.scoresProblem+' ':''}No hill scores yet: this run also fights the ${pairs.toLocaleString()} hill pairs and caches the result in this browser.`;
   $('recomputeHillField').hidden=!data;
   const fighting=!hill.pending&&(!data||$('recomputeHill').checked),positions=permutationRounds(config);$('hillFightSetup').hidden=!fighting;
   $('hillPermutateLabel').textContent=`All starting positions (${positions.toLocaleString()} rounds per pair)`;
   if($('hillPermutate').checked)$('hillRounds').value=positions;$('hillRounds').disabled=$('hillPermutate').checked;
   // Hill fights run once and are reused, so more rounds are worth it, within reason for a browser.
   const hillRounds=Number($('hillRounds').value)*pairs;$('hillWarning').hidden=!fighting||!(hillRounds>5e6);
   $('hillWarning').textContent=`That is ${hillRounds.toLocaleString()} rounds of hill fights (${pairs.toLocaleString()} pairs × ${Number($('hillRounds').value).toLocaleString()}). In the browser this can take hours; scripts/precompute-hill.mjs runs it once and ships the result with the suite.`;
  }
  // A hill-scores file ships with the suite, so it must be for the suite's own settings.
  $('downloadHillScores').disabled=!(config&&hill.id===hillId(suite,config)&&hill.data&&sameParameters(config,suite.config));
  const joining=suiteJoins()?`${pending?'all':suite.warriors.length} warriors of “${suite.name}”`:'';
  $('tournamentEntrants').textContent=[roster().map(w=>w.name).join(', '),joining].filter(Boolean).join(' + ')||'Select warriors in the roster above.';
  try {const c=configForRun();$('tournamentRules').textContent=`Match settings · ${describeSettings(c)}`;if(usesSuite()&&pending)throw new Error(suite.loadError||'Loading the suite’s opponents…');const p=plan(),hillJobs=p.jobs.filter(j=>j.kind==='hill').length;$('tournamentWorkload').textContent=`${p.jobs.length.toLocaleString()} matchups${hillJobs?` (${hillJobs.toLocaleString()} between hill warriors)`:''} · ${p.totalRounds.toLocaleString()} rounds`;}
  catch(error){$('tournamentWorkload').textContent=error.message;}
 }
 function dispose(){for(const slot of workers){clearTimeout(slot.timer);slot.worker.terminate();}workers=[];}
 function controls(){
  const busy=run&&['running','pausing','paused'].includes(run.state);
  $('tournamentStart').disabled=!!busy;$('tournamentPause').disabled=!busy;
  $('tournamentPause').textContent=run?.state==='paused'?'Resume':run?.state==='pausing'?'Finishing active matchups…':'Pause';
  $('tournamentPause').disabled=!busy||run.state==='pausing';$('tournamentCancel').disabled=!busy;
  $('tournamentExport').disabled=!run;$('tournamentExportKoen').disabled=!scoreMatrix();
  $('tournamentSetup').disabled=!!busy;$('parallelSetup').disabled=!!busy;
 }
 // An entrant keeps the colour its warrior has in the Battle list when the tournament was planned.
 const entrantColor=i=>warriorColor(run.plan.entrants[i]?.colorIndex??i);
 function resultRows(){
  if(!run)return [];
  const totals=run.plan.entrants.filter(w=>!run.excluded.some(e=>e.source===w.source)).map(w=>({...w,wins:0,ties:0,losses:0,score:0,rounds:0}));
  for(const result of run.results){const job=run.plan.jobs[result.id];if(job.kind==='self'||job.kind==='hill')continue;result.warriors.forEach((w,i)=>{const row=totals.find(t=>t.id===job.warriors[i].id);if(!row)return;for(const key of ['wins','ties','losses','score'])row[key]+=w[key];row.rounds+=result.completed;});}
  return totals;
 }
 // Koenigstuhl score matrix of a complete round robin, or null.
 function scoreMatrix(){
  if(!run||run.state!=='complete'||run.plan.mode!=='round-robin'||run.excluded.length)return null;
  const index=new Map(run.plan.entrants.map((w,i)=>[w.id,i])),n=index.size,v=Array.from({length:n},()=>Array(n).fill(0));
  for(const result of run.results){
   const [a,b]=run.plan.jobs[result.id].warriors.map(w=>index.get(w.id)),[x,y]=result.warriors;
   v[a][b]=koenScore(x.wins,x.ties,result.completed);if(a!==b)v[b][a]=koenScore(y.wins,y.ties,result.completed);
  }
  return v;
 }
 function pushoffResult(){
  if(run?.plan.pushoff)return benchmarkResult();
  const variant=$('tournamentRanking').value,v=variant!=='average'&&scoreMatrix();
  return v?{variant,...pushoff(v,variant)}:null;
 }
 // Hill block of a complete push-off benchmark: from this run's hill fights, or the scores it started with.
 function runHill(){
  if(!run.plan.jobs.some(j=>j.kind==='hill'))return run.hillData?.scores??null;
  const n=run.suite.warriors.length,v=Array.from({length:n},()=>Array(n).fill(null));
  for(const result of run.results){const job=run.plan.jobs[result.id];if(job.kind!=='hill')continue;const [x,y]=result.warriors;v[job.i][job.j]=koenScore(x.wins,x.ties,result.completed);if(job.i!==job.j)v[job.j][job.i]=koenScore(y.wins,y.ties,result.completed);}
  return v;
 }
 // Each candidate is added to the hill on its own and ranked by the push-off.
 function benchmarkResult(){
  if(!run||run.state!=='complete'||!run.plan.pushoff)return null;
  const variant=run.variant,h=runHill();if(!h)return null;
  const out=source=>run.excluded.some(e=>e.source===source);
  const keep=run.suite.warriors.map((w,i)=>i).filter(i=>!out(run.suite.warriors[i].source)&&h[i].every((x,j)=>x!==null||out(run.suite.warriors[j].source)));
  const candidates=run.plan.entrants.filter(w=>!out(w.source)).map(candidate=>{
   const row=[],column=[];let self=0;
   for(const result of run.results){const job=run.plan.jobs[result.id];if(job.warriors[0].id!==candidate.id)continue;const [x,y]=result.warriors;
    if(job.kind==='self')self=koenScore(x.wins,x.ties,result.completed);
    else if(job.kind==='candidate'){row[job.opponent]=koenScore(x.wins,x.ties,result.completed);column[job.opponent]=koenScore(y.wins,y.ties,result.completed);}}
   const names=[...keep.map(i=>run.suite.warriors[i].name),candidate.name],result=pushoff(withCandidate(h,keep,row,column,self),variant),me=keep.length;
   return {id:candidate.id,name:candidate.name,place:result.ranking.indexOf(me)+1,size:names.length,step:result.steps.find(s=>s.removed===me),names,steps:result.steps};
  });
  return {variant,suite:run.suite.name,hill:keep.length,candidates};
 }
 const logLines=(steps,names,diverse)=>steps.map(s=>s.size>1?`${String(s.size).padStart(3)}  ${s.values.map(x=>x.toFixed(3).padStart(diverse?8:7)).join('  ')}  ${names[s.removed]}${diverse?`  (nearest: ${names[s.nearest]})`:''}`:`  1  ${names[s.removed]}`).join('\n');
 function renderBenchmarkPushoff(result){
  const {columns,label}=rankings[result.variant],diverse=result.variant!=='sequential';
  $('pushoffTitle').textContent=`${label} · each warrior added to ${result.suite} (${result.hill} warriors)`;
  $('pushoffHead').replaceChildren(...['Warrior','Place',...columns,...(diverse?['Nearest']:[])].map(text=>{const th=document.createElement('th');th.textContent=text;return th;}));
  $('pushoffStandings').replaceChildren(...[...result.candidates].sort((a,b)=>a.place-b.place).map(c=>{
   const tr=document.createElement('tr'),values=c.step.size>1?c.step.values:[];
   for(const value of [c.name,`${c.place} of ${c.size}`,...columns.map((_,i)=>values[i]===undefined?'—':values[i].toFixed(3)),...(diverse?[c.step.nearest===undefined?'—':c.names[c.step.nearest]]:[])]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
   tr.firstChild.style.color=entrantColor(run.plan.entrants.findIndex(w=>w.id===c.id));return tr;
  }));
  $('pushoffLog').textContent=result.candidates.map(c=>`${c.name} (place ${c.place} of ${c.size})\n`+logLines(c.steps,c.names,diverse)).join('\n\n');
 }
 function renderPushoff(){
  if(run?.plan.pushoff){const result=benchmarkResult();$('pushoffResults').hidden=!result;if(result)renderBenchmarkPushoff(result);return;}
  const result=run?.plan.mode==='round-robin'&&$('tournamentRanking').value!=='average'?pushoffResult():null;
  $('pushoffResults').hidden=!result;if(!result)return;
  const {columns,label}=rankings[result.variant],names=run.plan.entrants.map(w=>w.name),diverse=result.variant!=='sequential';
  $('pushoffTitle').textContent=label;
  $('pushoffHead').replaceChildren(...['#','Warrior',...columns,...(diverse?['Nearest']:[]),'Removed'].map(text=>{const th=document.createElement('th');th.textContent=text;return th;}));
  const steps=[...result.steps].reverse();
  $('pushoffStandings').replaceChildren(...steps.map((step,place)=>{
   const tr=document.createElement('tr');
   for(const [value,cls] of [[place+1,'place'],[names[step.removed]],...columns.map((_,i)=>[step.values[i]===undefined?'—':step.values[i].toFixed(3)]),...(diverse?[[step.nearest===undefined?'—':names[step.nearest]]]:[]),[step.size>1?`at ${step.size}`:'—']]){const td=document.createElement('td');td.textContent=value;if(cls)td.className=cls;tr.append(td);}
   tr.children[1].style.color=entrantColor(step.removed);return tr;
  }));
  $('pushoffLog').textContent=logLines(result.steps,names,diverse);
 }
 // Which simulator ran the matchups: exMARS where it gives pMARS's results, pMARS for the rest (exmars.mjs).
 function engineNote(results){
  const ex=results.filter(r=>r.engine==='exmars').length,pm=results.length-ex;if(!results.length)return '';
  const reasons=[...new Set(results.map(r=>r.fallback).filter(Boolean))].slice(0,2).join('; ');
  if(!pm)return ' · run on exMARS';
  return (ex?` · exMARS ${ex}, pMARS ${pm}`:' · run on pMARS')+(reasons?` (pMARS for ${reasons})`:'');
 }
 // Time spent running matchups: the clock stops while paused and when the run ends.
 const elapsed=()=>run.elapsed+(run.since==null?0:performance.now()-run.since);
 function stopClock(){if(run.since!=null){run.elapsed=elapsed();run.since=null;}}
 const duration=ms=>{const s=ms/1000;if(s<60)return `${s.toFixed(1)} s`;const t=Math.round(s);return t<3600?`${Math.floor(t/60)}:${String(t%60).padStart(2,'0')} min`:`${Math.floor(t/3600)}:${String(Math.floor(t%3600/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')} h`;};
 function render(){
  pendingRender=null;if(!run)return;
  const completed=run.results.length,active=workers.filter(w=>w.job!==null).length;
  $('tournamentProgress').max=run.plan.jobs.length;$('tournamentProgress').value=completed+run.skipped.length;
  $('tournamentStatus').textContent=run.error||`${run.state[0].toUpperCase()+run.state.slice(1)} · ${completed} / ${run.plan.jobs.length} matchups · ${active} active${run.skipped.length?` · ${run.skipped.length} matchups skipped`:""} · ${duration(elapsed())}${engineNote(run.results)}`;
  const exclusions=$('tournamentExclusions');exclusions.hidden=!run.excluded.length;
  exclusions.replaceChildren();
  if(run.excluded.length){const title=document.createElement('strong');title.textContent=`${run.excluded.length} warrior(s) excluded from this benchmark`;exclusions.append(title);
   const list=document.createElement('ul');for(const entry of run.excluded){const li=document.createElement('li');li.textContent=`${entry.name}: ${entry.reason}`;list.append(li);}exclusions.append(list);}
  const rows=resultRows();
  chart.add(completed,rows.map(r=>r.rounds?r.score*100/r.rounds:0));
  renderResultTables(rows);
  $('matchupResults').replaceChildren(...[...run.results].sort((a,b)=>a.id-b.id).map(result=>{
   const row=document.createElement('li');row.textContent=run.plan.jobs[result.id].warriors.map((w,i)=>`${w.name}: ${result.warriors[i].wins} wins, ${result.warriors[i].losses} losses, ${result.warriors[i].ties} ties (${result.warriors[i].score} points)`).join(' / ')+` · ${result.completed} rounds`;return row;
  }));renderPushoff();controls();
 }
 // Sortable standings; with pairs (not melee), the score matrix and the picked warrior's results
 // against each opponent, whose checked opponents can become a new benchmark suite.
 const standingsSort={key:'perRound',dir:'desc'},detailSort={key:'perRound',dir:'asc'};
 let pairs=null,picked=null,detailRows=[];const checked=new Set();
 const count=(key,label)=>({key,label,value:r=>r[key]});
 const totalColumns=[count('rounds','Rounds'),count('wins','Wins'),count('ties','Ties'),count('losses','Losses'),count('score','Points'),
  {key:'perRound',label:'Score',title:'Points per 100 rounds. Points come from the score formula in the match settings: by default 3 for a win and 1 for a tie.',value:perRound,cell:r=>r.rounds?(perRound(r)*100).toFixed(1):'—'}];
 // One warrior's results against each opponent, as on the KOTH hill pages: shares of rounds and
 // points per 100 rounds, both ways. format turns a value (or the column's average) into text.
 const fixed1=x=>x==null?'—':x.toFixed(1);
 const numeric=column=>({...column,cell:r=>column.format(column.value(r))});
 const pairColumns=name=>[
  numeric({key:'rounds',label:'Rounds',value:r=>r.rounds,format:x=>x==null?'—':String(Math.round(x))}),
  ...[['wins','W%','won'],['ties','T%','tied'],['losses','L%','lost']].map(([key,label,verb])=>numeric({key,label,
   title:`Share of rounds ${name} ${verb} against this opponent`,value:r=>r.rounds?r[key]*100/r.rounds:null,format:fixed1,
   cellTitle:r=>`${r[key]} of ${r.rounds} rounds ${verb}`})),
  numeric({key:'perRound',label:'Points taken',title:`Points ${name} scored per 100 rounds. Points come from the score formula in the match settings: by default 3 for a win and 1 for a tie.`,
   value:r=>r.rounds?r.score*100/r.rounds:null,format:fixed1,cellTitle:r=>`${r.score} points in ${r.rounds} rounds`}),
  numeric({key:'given',label:'Points given',title:`Points the opponent scored against ${name} per 100 rounds`,
   value:r=>r.rounds?r.given*100/r.rounds:null,format:fixed1,cellTitle:r=>`${r.given} points in ${r.rounds} rounds`})];
 function pick(id){if(picked!==id){picked=id;checked.clear();$('subsetName').value='';$('subsetStatus').hidden=true;}redrawResults();$('warriorResults').scrollIntoView({block:'nearest',behavior:'smooth'});}
 const redrawResults=()=>renderResultTables(resultRows());
 function renderResultTables(rows){
  pairs=run?pairTotals({plan:run.plan,results:run.results,suite:run.suite,excluded:run.excluded}):null;
  const colored=rows.map((r,i)=>({...r,color:warriorColor(r.colorIndex??i),rowClass:r.id===picked?'picked':''}));
  const nameColumn={key:'name',label:'Warrior',firstDir:'asc',value:r=>r.name,cell:r=>{
   const node=document.createElement(pairs?'button':'span');node.textContent=r.name;node.style.color=r.color;
   if(pairs){node.type='button';node.className='link-button';node.title=`${r.name}: results against each opponent`;node.onclick=()=>pick(r.id);}
   return node;}};
  renderTable($('tournamentStandings'),[nameColumn,...totalColumns],colored,standingsSort,redrawResults);
  $('standingsHint').hidden=!pairs||!rows.length;
  const fought=pairs&&pairs.cells.some(row=>row.some(Boolean));
  $('matrixResults').hidden=!fought||!['round-robin','benchmark'].includes(run.plan.mode);
  if(!$('matrixResults').hidden&&$('matrixResults').open){
   const index=new Map(pairs.rows.map((w,i)=>[w.id,i]));
   const order=[...colored].sort((a,b)=>(perRound(b)??-1)-(perRound(a)??-1)).map(r=>index.get(r.id)).filter(i=>i!==undefined);
   renderMatrix($('scoreMatrix'),pairs,{order,sameOrder:run.plan.mode==='round-robin',onPick:pick});
  }
  const r=pairs?pairs.rows.findIndex(w=>w.id===picked):-1;
  $('warriorResults').hidden=r<0;if(r<0){detailRows=[];return;}
  const name=pairs.rows[r].name;
  $('warriorResultsTitle').textContent=`${name} against each opponent`;
  $('subsetName').placeholder=`Hardest for ${name}`.slice(0,100);
  detailRows=pairs.columns.map((w,c)=>pairs.cells[r][c]&&{...pairs.cells[r][c],id:w.id,name:w.name,warrior:w}).filter(Boolean);
  $('warriorResultsLegend').textContent=`Every column is from ${name}’s side. W%, T% and L% are the share of rounds ${name} won, tied and lost against that opponent. Points taken are the points ${name} scored per 100 rounds; points given, the points the opponent scored against ${name}. The averages weigh each opponent equally.`;
  const box={key:'check',label:'',sortable:false,className:'check',cell:row=>{
   const input=document.createElement('input');input.type='checkbox';input.checked=checked.has(row.id);input.setAttribute('aria-label','Use '+row.name+' in a new benchmark');
   input.onchange=()=>{if(input.checked)checked.add(row.id);else checked.delete(row.id);subsetButton();};return input;}};
  const columns=[box,{key:'name',label:'Opponent',firstDir:'asc',className:'name',value:row=>row.name},...pairColumns(name)];
  const mean=values=>{const v=values.filter(x=>x!=null);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;};
  const foot=columns.map(c=>c.key==='name'?'Averages':c.format?c.format(mean(detailRows.map(c.value))):'');
  renderTable($('warriorResultsTable'),columns,detailRows,detailSort,redrawResults,detailRows.length?foot:null);
  subsetButton();
 }
 function subsetButton(){
  const n=detailRows.filter(row=>checked.has(row.id)).length;
  $('saveSubset').disabled=!n;$('saveSubset').textContent=n?`New benchmark from ${n} checked`:'New benchmark from checked';
  $('addCheckedWarriors').disabled=!n;$('addCheckedWarriors').textContent=n?`Add ${n} checked to warriors`:'Add checked to warriors';
 }
 $('closeWarriorResults').onclick=()=>{picked=null;checked.clear();redrawResults();};
 $('checkAllOpponents').onclick=()=>{for(const row of detailRows)checked.add(row.id);redrawResults();};
 $('checkNoOpponents').onclick=()=>{checked.clear();redrawResults();};
 $('checkLowest').onclick=()=>{
  const n=Math.max(1,Math.floor(Number($('checkLowestCount').value))||1);checked.clear();
  for(const row of [...detailRows].sort((a,b)=>perRound(a)-perRound(b)).slice(0,n))checked.add(row.id);redrawResults();
 };
 $('matrixResults').addEventListener('toggle',()=>{if($('matrixResults').open&&run)redrawResults();});
 $('saveSubset').onclick=()=>{
  const feedback=$('subsetStatus');feedback.hidden=false;
  try{
   const warriors=detailRows.filter(row=>checked.has(row.id)).map(row=>row.warrior);if(!warriors.length)throw new Error('Check the opponents to put in the suite.');
   const name=($('subsetName').value.trim()||$('subsetName').placeholder).slice(0,100),config=run.config;
   const descriptor={version:1,name,parameters:{...Object.fromEntries(benchmarkParameters.filter(k=>k in config&&k!=='rounds').map(k=>[k,config[k]])),rounds:run.plan.rounds},warriors:suiteFilenames(warriors)};
   const suite=store.create(descriptor,Object.fromEntries(warriors.map((w,i)=>[descriptor.warriors[i],w.source])),{from:'tournament'});
   feedback.dataset.result='ok';feedback.replaceChildren(`Created “${name}” with ${warriors.length} opponent${warriors.length===1?'':'s'}. Pick it under Opponent suite in Benchmark mode, or in the evolver’s benchmark list. It is saved with your workspace in this browser. `,editLink(suite.id));
  }catch(error){feedback.dataset.result='failed';feedback.textContent=error.message;}
 };
 // Checked opponents join your warriors, as from the library; ones already loaded (same source) are skipped.
 $('addCheckedWarriors').hidden=!addWarrior;
 $('addCheckedWarriors').onclick=()=>{
  const feedback=$('subsetStatus');feedback.hidden=false;
  const loaded=new Set(loadedSources()),seen=new Set(),todo=[];
  for(const row of detailRows)if(checked.has(row.id)&&!loaded.has(row.warrior.source)&&!seen.has(row.warrior.source)){seen.add(row.warrior.source);todo.push(row.warrior);}
  const plural=n=>n+' warrior'+(n===1?'':'s');
  feedback.dataset.result='ok';
  if(!todo.length){feedback.textContent='The checked opponents are already in your warriors.';return;}
  feedback.dataset.result='failed';
  if(loaded.size+todo.length>maxLoaded){feedback.textContent=`At most ${maxLoaded} warriors can be loaded: ${loaded.size} already loaded and ${todo.length} more checked.`;return;}
  let added=0;
  try{for(const w of todo){addWarrior(w.source,(w.file||'').split('/').pop()||undefined);added++;}
   const skipped=checked.size-added;
   feedback.dataset.result='ok';feedback.textContent=`${plural(added)} added to your warriors${skipped>0?` (${skipped} already there)`:''}. They are selected in the warrior list for your next run.`;}
  catch(error){feedback.textContent=(added?plural(added)+' added. ':'')+error.message;}
 };
 function cacheRunHill(){
  if(!run.plan.pushoff||!run.plan.jobs.some(j=>j.kind==='hill'))return;
  const scores=runHill();if(scores.some(row=>row.includes(null)))return; // an excluded hill warrior leaves gaps
  const data={rounds:run.plan.hillRounds,permutate:run.plan.hillPermutate,seed:run.plan.seed,createdAt:new Date().toISOString().slice(0,10),scores,source:'cache'};
  run.hillData=data;saveCached(run.hillKey,data);if(hill.key===run.hillKey){hill={...hill,data};refresh();}
 }
 function scheduleRender(){if(pendingRender===null)pendingRender=setTimeout(render,100);}
 function fail(message){run.state='failed';run.error=message;stopClock();dispose();render();}
 function dispatch(slot){
  if(!run||run.state!=='running')return;
  while(run.next<run.plan.jobs.length&&run.skipped.includes(run.plan.jobs[run.next].id))run.next++;
  if(run.next>=run.plan.jobs.length)return;
  const job=run.plan.jobs[run.next++];slot.job=job.id;
  slot.timer=setTimeout(()=>fail('Assembly timed out for '+job.warriors.map(w=>w.name).join(' / ')),15000);
  slot.worker.postMessage(job);
 }
 function settle(){
  if(run.results.length+run.skipped.length===run.plan.jobs.length){run.state='complete';stopClock();dispose();cacheRunHill();}
  else if(run.state==='pausing'&&workers.every(w=>w.job===null)){run.state='paused';stopClock();}
  scheduleRender();controls();
 }
 $('tournamentStart').onclick=async()=>{
  try {
   if(usesSuite())await loadSuite(currentSuite());
   if(benchmarkPushoff())await lookupHill(currentSuite(),configForRun());
   const next=plan(),count=Number($('tournamentWorkers').value);
   if(!Number.isInteger(count)||count<1||count>processors)throw new Error(`Choose 1–${processors} workers.`);
   dispose();clearTimeout(pendingRender);pendingRender=null;chart.clear();
   run={plan:next,config:configForRun(),results:[],excluded:[],skipped:[],next:0,state:'running',elapsed:0,since:performance.now(),workers:Math.min(count,next.jobs.length)};
   picked=null;checked.clear();$('subsetStatus').hidden=true;
   if(next.mode==='benchmark')run.suite={name:currentSuite().name,warriors:currentSuite().warriors};
   if(next.pushoff)Object.assign(run,{variant:$('tournamentRanking').value,hillKey:hill.key,hillData:next.jobs.some(j=>j.kind==='hill')?null:hill.data});
   for(let i=0;i<run.workers;i++){
    const worker=new Worker(new URL('./tournament-worker.mjs',import.meta.url),{type:'module'}),slot={worker,job:null,timer:null};workers.push(slot);
    worker.onerror=e=>{if(workers.includes(slot))fail(e.message||'Worker failed.');};
    worker.onmessage=({data})=>{
     if(!workers.includes(slot)||data.id!==slot.job)return;
     clearTimeout(slot.timer);
     if(data.type==='started')return;
     if(data.type==='error'&&run.plan.mode==='benchmark'&&Number.isInteger(data.assemblyWarrior)){
      const warrior=run.plan.jobs[data.id].warriors[data.assemblyWarrior];
      if(!run.excluded.some(e=>e.source===warrior.source)){
       run.excluded.push({...warrior,reason:[data.message,data.diagnostics.trim()].filter(Boolean).join(' — ')});
       chart.clear(); // The remaining series must not inherit another entrant's history.
      }
      for(const job of run.plan.jobs)if(job.warriors.some(w=>w.source===warrior.source)&&!run.skipped.includes(job.id))run.skipped.push(job.id);
      slot.job=null;dispatch(slot);settle();return;
     }
     if(run.skipped.includes(data.id)){slot.job=null;dispatch(slot);settle();return;}
     // pMARS's diagnostics do not say whose source they are about, so name the warrior it was assembling.
     if(data.type==='error'){const job=run.plan.jobs[data.id],failing=job.warriors[data.assemblyWarrior];
      fail('Matchup '+(data.id+1)+' ('+job.warriors.map(w=>w.name).join(' / ')+'): '+(failing?failing.name+' did not assemble. ':'')+data.message+' '+data.diagnostics);return;}
     run.results.push(data);slot.job=null;dispatch(slot);settle();
    };
    dispatch(slot);
   }
   render();
  }catch(error){if(run?.state==='running')fail(error.message);else $('tournamentStatus').textContent=error.message;}
 };
 $('tournamentPause').onclick=()=>{
  if(run.state==='paused'){run.state='running';run.since=performance.now();for(const slot of workers)dispatch(slot);}
  else {run.state='pausing';settle();}render();
 };
 $('tournamentCancel').onclick=()=>{run.state='cancelled';stopClock();dispose();render();};
 $('tournamentExport').onclick=()=>{
  const result=pushoffResult();
  download(new Blob([JSON.stringify({...run,standings:resultRows(),...(result&&{pushoff:result})},null,2)],{type:'application/json'}),'corewar-results.json');
 };
 $('tournamentExportKoen').onclick=()=>{
  const v=scoreMatrix();if(!v)return;
  const format=run.plan.jobs[0]?.config.rules88?'88':'94';
  const {dat,scores}=writeKoenigstuhl(run.plan.entrants.map(w=>({name:w.name,author:authorOf(w.source),file:w.file,format})),v);
  download(storeZip([['hill32.dat',dat],['hill32.scores',scores]]),'corewar-scores.zip');
 };
 $('tournamentRanking').addEventListener('change',()=>{refresh();if(run&&!run.plan.pushoff)render();});
 $('recomputeHill').addEventListener('change',refresh);
 // Unticking all positions restores the round count it replaced.
 $('hillPermutate').addEventListener('change',()=>{const field=$('hillRounds');if($('hillPermutate').checked)field.dataset.previous=field.value;else field.value=field.dataset.previous||1000;refresh();});
 $('hillRounds').addEventListener('input',refresh);
 $('downloadHillScores').onclick=()=>{
  const suite=currentSuite();if(!hill.data)return;
  download(new Blob([JSON.stringify(writeHillScores(suite,hill.data))+'\n'],{type:'application/json'}),'hill-scores.json');
  $('tournamentStatus').textContent='Saved hill-scores.json. Put it next to the suite descriptor and add "scores": "hill-scores.json" to ship it with the suite.';
 };
 // Entering Benchmark mode, or picking, importing or editing a suite in it, puts the suite's settings and
 // rounds into the match settings and Rounds per matchup, where they can still be changed for a run.
 function useSuiteSettings(){
  const suite=currentSuite();if(!suite)return;settingsFrom=suiteId(suite);
  if(!differences(matchConfig()||{},suite.config).length)return;
  applyConfig(Object.fromEntries(suiteKeys.map(k=>[k,suite.config[k]])));
  $('tournamentStatus').textContent=`Match settings set to those of “${suite.name}”. Change them above for your runs.`;
 }
 function suiteDefaults(){
  const suite=currentSuite();
  if($('tournamentMode').value!=='benchmark')settingsFrom=null;
  else if(settingsFrom!==suiteId(suite)){$('tournamentRounds').value=suite.rounds;useSuiteSettings();}
  refresh();
 }
 $('useSuiteSettings').onclick=()=>{useSuiteSettings();refresh();};
 // Outside Benchmark mode, so entering it later still sets the suite's rounds.
 $('useSuiteSettingsHere').onclick=()=>{useSuiteSettings();settingsFrom=null;refresh();};
 $('editSuite').onclick=()=>onEditSuite($('benchmarkSuite').value);
 // A suite shown elsewhere (the Benchmarks tool, a restored workspace) may have changed or gone.
 store.subscribe(change=>{
  if(!suites.some(s=>s.id===$('benchmarkSuite').value))$('benchmarkSuite').value=suites[0].id;
  if(change.type!=='loaded'||change.id===$('benchmarkSuite').value)displayedSuite=null;
  // Editing the suite Benchmark mode runs puts its new settings and rounds into the run, as picking it does.
  if(change.type==='changed'&&change.id===$('benchmarkSuite').value&&$('tournamentMode').value==='benchmark')suiteDefaults();
  else if(displayedSuite===null)refresh();
 });
 $('benchmarkSuite').addEventListener('change',suiteDefaults);
 $('tournamentMode').addEventListener('change',suiteDefaults);
 for(const id of ['tournamentRounds','tournamentSeed','selfFights','includeSuite'])$(id).addEventListener('change',refresh);
 $('challenger').addEventListener('change',()=>{try{$('tournamentWorkload').textContent=`${plan().jobs.length} matchups`;}catch{}});
 refresh();controls();
 // Prefetch the rest when the browser is idle, the selected suite first, unless the visitor asked to save data.
 if(!navigator.connection?.saveData){
  const prefetch=async()=>{for(const suite of [currentSuite(),...suites])if(suite&&!suite.warriors&&!suite.loadError)await loadSuite(suite).catch(()=>{});};
  const idle=()=>window.requestIdleCallback?requestIdleCallback(prefetch,{timeout:5000}):setTimeout(prefetch,1000);
  if(document.readyState==='complete')idle();else addEventListener('load',idle,{once:true});
 }
 // Show a suite in Benchmark mode, its settings put into the match settings.
 function useSuite(id){
  if(!store.get(id))return;
  selectTab(1);$('benchmarkSuite').value=id;
  chooseMode(modeTabs.find(tab=>tab.dataset.mode==='benchmark'));
 }
 // A suite made elsewhere (the library) joins the user's suites and is selected in Benchmark mode.
 function addSuite(descriptor,files){
  const suite=store.create(descriptor,files,{from:'library'});
  useSuite(suite.id);
  $('tournamentStatus').textContent=`Created “${suite.name}” from the library with ${suite.warriors.length} opponent${suite.warriors.length===1?'':'s'}. It is saved with your workspace in this browser.`;
  return suite;
 }
 return {refresh,selectTab,addSuite,useSuite};
}

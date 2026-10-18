import {suiteFilenames} from './warrior-files.mjs';
import {benchmarkZip,storeZip} from './benchmark-zip.mjs';
import {pushoff,rankings,koenScore,writeKoenigstuhl} from './pushoff.mjs';
import {benchmarkCatalog} from './benchmark-catalog.mjs';
import {readBenchmark,importBenchmarkFiles,benchmarkParameters,benchmarkHeader} from './benchmarks.mjs';
// SPDX-License-Identifier: GPL-2.0-or-later
import {planTournament} from './tournament-plan.mjs';
import {cacheKey,loadCached,saveCached,withCandidate,writeHillScores,defaultHillRounds,permutationRounds} from './hill-scores.mjs';
import {HistoryChart} from './charts.mjs';
import {warriorColor} from './display.mjs';
const $=id=>document.getElementById(id);
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
// One line for the settings a run uses, including the ones that are easy to miss.
export function describeSettings(c){
 const positions=2*(c.coreSize-2*(c.distance||c.maxLength)+1);
 return `${c.rules88?'ICWS ’88':'ICWS ’94'} · core ${c.coreSize} · cycles ${c.cycles} · processes ${c.tasks} · length ${c.maxLength} · distance ${c.distance||c.maxLength} · ${c.noPspace?'no P-space':`P-space ${c.pspace||'auto'}`}${c.permutate?` · permutation: ${positions} rounds per full pass`:''}`;
}
const authorOf=source=>/^\s*;\s*author\s+(.*?)\s*$/im.exec(source)?.[1]||'Anonymous';
export function setupTournaments({roster,readConfig,onTab}) {
 // Catalog suites start as their descriptors; warriors and hill scores load on first use.
 const suites=benchmarkCatalog.map(s=>({id:s.id,descriptor:s.descriptor,...benchmarkHeader(s.descriptor),data:s.data,warriors:null}));
 const loading=new Map();
 function loadSuite(suite){
  if(suite.warriors)return Promise.resolve(suite);
  if(!loading.has(suite.id))loading.set(suite.id,(async()=>{
   try{
    const response=await fetch(new URL(suite.data,import.meta.url));if(!response.ok)throw new Error('HTTP '+response.status);
    const {files,scores}=await response.json(),loaded=readBenchmark(suite.descriptor,files,suite.id,scores??null);
    const index=suites.indexOf(suite);if(index>=0)suites[index]=loaded;
    if($('benchmarkSuite').value===suite.id)refresh();
    return loaded;
   }catch(error){loading.delete(suite.id);suite.loadError=`Could not load the opponents (${error.message})`;refresh();throw new Error(suite.loadError);}
  })());
  return loading.get(suite.id);
 }
 let serial=0,run=null,workers=[],pendingRender=null,displayedSuite=null;
 // Hill scores for the selected suite: shipped with it, cached in this browser, or none yet.
 let hill={id:null,key:null,data:null};
 const engine=fetch(new URL('./engine-lock.json',import.meta.url)).then(r=>r.json()).then(lock=>lock.commit||'').catch(()=>'');
 const suiteId=suite=>suite.id+'|'+JSON.stringify(suite.config);
 async function lookupHill(suite){
  const id=suiteId(suite);if(hill.id===id&&!hill.pending)return hill;
  if(hill.id===id&&hill.pending)return hill.pending;
  const pending=(async()=>{const key=await cacheKey(suite.warriors,suite.config,await engine),data=suite.hillScores||await loadCached(key);if(hill.id===id){hill={id,key,data};refresh();}return hill;})();
  hill={id,key:null,data:null,pending};
  return pending;
 }
 const chart=new HistoryChart($('tournamentChart'),'Average points / round · completed matchups');
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
 const tabs=[$('emulatorTab'),$('tournamentTab')];
 function selectTab(index){
  tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});
  $('changed').hidden=index===1;
  onTab(index);if(index===1){refresh();chart.draw();}
 }
 tabs.forEach((tab,index)=>{tab.onclick=()=>selectTab(index);tab.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?1:1-index;selectTab(next);tabs[next].focus();}};});
 function configForRun(){const config=readConfig();const suite=suites.find(s=>s.id===$('benchmarkSuite').value);return $('tournamentMode').value==='benchmark'&&suite?.config?{...config,...suite.config}:config;}
 const currentSuite=()=>suites.find(s=>s.id===$('benchmarkSuite').value);
 const benchmarkPushoff=()=>$('tournamentMode').value==='benchmark'&&$('tournamentRanking').value!=='average';
 function plan(){
  const pushoff=benchmarkPushoff();
  return planTournament({mode:$('tournamentMode').value,entrants:roster(),opponents:currentSuite()?.warriors,
  challenger:$('challenger').value,rounds:Number($('tournamentRounds').value),seed:$('tournamentSeed').value,config:configForRun(),selfFights:$('selfFights').checked,
  pushoff,hill:pushoff&&(!hill.data||$('recomputeHill').checked),hillRounds:Number($('hillRounds').value),hillPermutate:$('hillPermutate').checked});
 }
 function refresh(){
  const mode=$('tournamentMode').value;
  modeTabs.forEach(tab=>{const selected=tab.dataset.mode===mode;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
  $('modePanel').setAttribute('aria-labelledby','mode-'+mode);
  $('modeDescription').textContent={'round-robin':'Each selected warrior fights every other selected warrior, one on one.',benchmark:'Test each selected warrior against the opponents in a benchmark suite.',challenge:'One challenger fights each of the other selected warriors, one on one.',melee:'All selected warriors fight together in the same core.'}[mode];
  $('selfFights').disabled=mode==='melee';
  $('benchmarkSetup').hidden=$('suiteField').hidden=mode!=='benchmark';$('challengeSetup').hidden=mode!=='challenge';
  $('rankingField').hidden=!['round-robin','benchmark'].includes(mode);
  const ranking=$('tournamentRanking').value;$('rankingHint').hidden=$('rankingField').hidden||ranking==='average';
  $('rankingHint').textContent={sequential:'Repeatedly removes the warrior with the lowest total score, self fight included. Turn on Self fights to match the Koenigstuhl scripts.',diversity:'Repeatedly removes the warrior with the lowest average × distance to its most similar warrior (Astolfi).','sd-diversity':'Repeatedly removes the warrior with the lowest average × smallest SD-score to another warrior (Ismael 2025).'}[ranking]||'';
  const old=$('challenger').value;$('challenger').replaceChildren(...roster().map(w=>new Option(w.name,w.id)));if(roster().some(w=>w.id===old))$('challenger').value=old;
  const selected=$('benchmarkSuite').value;$('benchmarkSuite').replaceChildren(...suites.map(s=>new Option(s.name,s.id)));if(suites.some(s=>s.id===selected))$('benchmarkSuite').value=selected;
  const suite=suites.find(s=>s.id===$('benchmarkSuite').value),pending=!suite.warriors;
  if(pending&&mode==='benchmark'&&!suite.loadError)loadSuite(suite).catch(()=>{});
  if(displayedSuite!==suite||pending){
   displayedSuite=suite;
   $('benchmarkDescription').textContent=suite.descriptor.description||'';
   $('benchmarkSummary').textContent=`${suite.name} · ${pending?suite.loadError||'loading opponents…':suite.warriors.length+' opponents'} · default ${suite.rounds} rounds`;
   $('benchmarkMembers').replaceChildren(...(suite.warriors||[]).map(w=>{const li=document.createElement('li');li.textContent=w.name+' ('+w.file+')';return li;}));
   $('benchmarkDescriptor').value=JSON.stringify(suite.descriptor,null,2);
   const hillDefault=defaultHillRounds(suite.config);$('hillRounds').value=hillDefault.rounds;$('hillPermutate').checked=hillDefault.permutate;
  }
  // Benchmark runs use the suite's own settings; the shared match settings do not apply.
  const suiteOwned=mode==='benchmark'&&!!suite;
  $('tournamentSettingsSlot').inert=suiteOwned;$('tournamentSettingsSlot').classList.toggle('suite-owned',suiteOwned);
  $('suiteSettingsNote').hidden=!suiteOwned;
  if(suiteOwned)$('suiteSettingsNote').textContent=`This benchmark uses the settings of “${suite.name}”, not the match settings above: ${describeSettings(suite.config)}. Edit them under Suite details.`;
  const pushing=benchmarkPushoff();$('hillStatus').hidden=!pushing;
  if(pushing&&pending){
   $('hillText').textContent=suite.loadError||'Loading the suite…';
   $('recomputeHillField').hidden=$('hillFightSetup').hidden=$('hillWarning').hidden=true;
  }else if(pushing){
   if(hill.id!==suiteId(suite))lookupHill(suite);
   const data=hill.id===suiteId(suite)&&hill.data,pairs=suite.warriors.length*(suite.warriors.length+1)/2;
   $('hillText').textContent=hill.pending?'Looking for hill scores…':data?`Hill scores ${data.source==='suite'?'shipped with the suite':'cached in this browser'}: ${data.permutate?'every starting position':`${data.rounds.toLocaleString()} rounds per pair`}${data.createdAt?`, ${data.createdAt}`:''}. Only the selected warriors fight.`:`${suite.scoresProblem?suite.scoresProblem+' ':''}No hill scores yet: this run also fights the ${pairs.toLocaleString()} hill pairs and caches the result in this browser.`;
   $('recomputeHillField').hidden=!data;
   const fighting=!hill.pending&&(!data||$('recomputeHill').checked),positions=permutationRounds(suite.config);$('hillFightSetup').hidden=!fighting;
   $('hillPermutateLabel').textContent=`All starting positions (${positions.toLocaleString()} rounds per pair)`;
   if($('hillPermutate').checked)$('hillRounds').value=positions;$('hillRounds').disabled=$('hillPermutate').checked;
   // Hill fights run once and are reused, so more rounds are worth it, within reason for a browser.
   const hillRounds=Number($('hillRounds').value)*pairs;$('hillWarning').hidden=!fighting||!(hillRounds>5e6);
   $('hillWarning').textContent=`That is ${hillRounds.toLocaleString()} rounds of hill fights (${pairs.toLocaleString()} pairs × ${Number($('hillRounds').value).toLocaleString()}). In the browser this can take hours; scripts/precompute-hill.mjs runs it once and ships the result with the suite.`;
  }
  $('downloadHillScores').disabled=!(hill.id===suiteId(suite)&&hill.data);
  $('tournamentEntrants').textContent=roster().map(w=>w.name).join(', ')||'Select warriors in the roster above.';
  try {const c=configForRun();$('tournamentRules').textContent=`${suiteOwned?'Suite settings':'Match settings'} · ${describeSettings(c)}`;if(mode==='benchmark'&&pending)throw new Error(suite.loadError||'Loading the suite’s opponents…');const p=plan(),hillJobs=p.jobs.filter(j=>j.kind==='hill').length;$('tournamentWorkload').textContent=`${p.jobs.length.toLocaleString()} matchups${hillJobs?` (${hillJobs.toLocaleString()} between hill warriors)`:''} · ${p.totalRounds.toLocaleString()} rounds`;}
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
   tr.firstChild.style.color=warriorColor(run.plan.entrants.findIndex(w=>w.id===c.id));return tr;
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
   tr.children[1].style.color=warriorColor(step.removed);return tr;
  }));
  $('pushoffLog').textContent=logLines(result.steps,names,diverse);
 }
 function render(){
  pendingRender=null;if(!run)return;
  const completed=run.results.length,active=workers.filter(w=>w.job!==null).length;
  $('tournamentProgress').max=run.plan.jobs.length;$('tournamentProgress').value=completed+run.skipped.length;
  $('tournamentStatus').textContent=run.error||`${run.state[0].toUpperCase()+run.state.slice(1)} · ${completed} / ${run.plan.jobs.length} matchups · ${active} active${run.skipped.length?` · ${run.skipped.length} matchups skipped`:""}`;
  const exclusions=$('tournamentExclusions');exclusions.hidden=!run.excluded.length;
  exclusions.replaceChildren();
  if(run.excluded.length){const title=document.createElement('strong');title.textContent=`${run.excluded.length} warrior(s) excluded from this benchmark`;exclusions.append(title);
   const list=document.createElement('ul');for(const entry of run.excluded){const li=document.createElement('li');li.textContent=`${entry.name}: ${entry.reason}`;list.append(li);}exclusions.append(list);}
  const rows=resultRows();
  chart.add(completed,rows.map(r=>r.rounds?r.score/r.rounds:0));
  const body=$('tournamentStandings');body.replaceChildren();
  rows.map((r,i)=>({...r,color:warriorColor(i)})).sort((a,b)=>(b.rounds?b.score/b.rounds:0)-(a.rounds?a.score/a.rounds:0)).forEach(r=>{
   const tr=document.createElement('tr');for(const value of [r.name,r.rounds,r.wins,r.ties,r.losses,r.score,r.rounds?(r.score/r.rounds).toFixed(3):'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}tr.firstChild.style.color=r.color;body.append(tr);
  });
  $('matchupResults').replaceChildren(...[...run.results].sort((a,b)=>a.id-b.id).map(result=>{
   const row=document.createElement('li');row.textContent=run.plan.jobs[result.id].warriors.map((w,i)=>`${w.name}: ${result.warriors[i].wins} wins, ${result.warriors[i].losses} losses, ${result.warriors[i].ties} ties (${result.warriors[i].score} points)`).join(' / ')+` · ${result.completed} rounds`;return row;
  }));renderPushoff();controls();
 }
 function cacheRunHill(){
  if(!run.plan.pushoff||!run.plan.jobs.some(j=>j.kind==='hill'))return;
  const scores=runHill();if(scores.some(row=>row.includes(null)))return; // an excluded hill warrior leaves gaps
  const data={rounds:run.plan.hillRounds,permutate:run.plan.hillPermutate,seed:run.plan.seed,createdAt:new Date().toISOString().slice(0,10),scores,source:'cache'};
  run.hillData=data;saveCached(run.hillKey,data);if(hill.key===run.hillKey){hill={...hill,data};refresh();}
 }
 function scheduleRender(){if(pendingRender===null)pendingRender=setTimeout(render,100);}
 function fail(message){run.state='failed';run.error=message;dispose();render();}
 function dispatch(slot){
  if(!run||run.state!=='running')return;
  while(run.next<run.plan.jobs.length&&run.skipped.includes(run.plan.jobs[run.next].id))run.next++;
  if(run.next>=run.plan.jobs.length)return;
  const job=run.plan.jobs[run.next++];slot.job=job.id;
  slot.timer=setTimeout(()=>fail('Assembly timed out for '+job.warriors.map(w=>w.name).join(' / ')),15000);
  slot.worker.postMessage(job);
 }
 function settle(){
  if(run.results.length+run.skipped.length===run.plan.jobs.length){run.state='complete';dispose();cacheRunHill();}
  else if(run.state==='pausing'&&workers.every(w=>w.job===null))run.state='paused';
  scheduleRender();controls();
 }
 $('tournamentStart').onclick=async()=>{
  try {
   if($('tournamentMode').value==='benchmark')await loadSuite(currentSuite());
   if(benchmarkPushoff())await lookupHill(currentSuite());
   const next=plan(),count=Number($('tournamentWorkers').value);
   if(!Number.isInteger(count)||count<1||count>processors)throw new Error(`Choose 1–${processors} workers.`);
   dispose();clearTimeout(pendingRender);pendingRender=null;chart.clear();
   run={plan:next,results:[],excluded:[],skipped:[],next:0,state:'running',workers:Math.min(count,next.jobs.length)};
   if(next.pushoff)Object.assign(run,{variant:$('tournamentRanking').value,suite:{name:currentSuite().name,warriors:currentSuite().warriors},hillKey:hill.key,hillData:next.jobs.some(j=>j.kind==='hill')?null:hill.data});
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
     if(data.type==='error'){fail('Matchup '+(data.id+1)+' ('+run.plan.jobs[data.id].warriors.map(w=>w.name).join(' / ')+'): '+data.message+' '+data.diagnostics);return;}
     run.results.push(data);slot.job=null;dispatch(slot);settle();
    };
    dispatch(slot);
   }
   render();
  }catch(error){if(run?.state==='running')fail(error.message);else $('tournamentStatus').textContent=error.message;}
 };
 $('tournamentPause').onclick=()=>{
  if(run.state==='paused'){run.state='running';for(const slot of workers)dispatch(slot);}
  else {run.state='pausing';settle();}render();
 };
 $('tournamentCancel').onclick=()=>{run.state='cancelled';dispose();render();};
 $('saveBenchmark').onclick=()=>{
  const feedback=$('saveBenchmarkStatus');feedback.hidden=false;
  try {
   const warriors=roster();if(!warriors.length)throw new Error('Select warriors to add to the suite.');
   const name=$('benchmarkName').value.trim();if(!name){$('benchmarkName').focus();throw new Error('Enter a name for the new suite.');}
   const config=readConfig();const id='suite-'+(++serial);
   const descriptor={version:1,name,parameters:Object.fromEntries(benchmarkParameters.filter(k=>k in config).map(k=>[k,config[k]])),warriors:suiteFilenames(warriors)};
   descriptor.parameters.rounds=Number($('tournamentRounds').value);
   suites.push(readBenchmark(descriptor,Object.fromEntries(warriors.map((w,i)=>[descriptor.warriors[i],w.source])),id));
   refresh();$('benchmarkSuite').value=id;refresh();
   feedback.dataset.result='ok';feedback.textContent=`Created “${name}” with ${warriors.length} opponent${warriors.length===1?'':'s'} and selected it in Opponent suite above. Available until you reload or close this page.`;
   $('tournamentStatus').textContent=`Saved “${name}” for this session.`;
  }catch(error){feedback.dataset.result='failed';feedback.textContent=error.message;}
 };
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
 function suiteDefaults(){const suite=suites.find(s=>s.id===$('benchmarkSuite').value);if($('tournamentMode').value==='benchmark')$('tournamentRounds').value=suite.rounds;refresh();}
 for(const id of ['benchmarkFiles','benchmarkFolder'])$(id).onchange=async()=>{
  try{const suite=await importBenchmarkFiles($(id).files,'import-'+(++serial));suites.push(suite);refresh();$('benchmarkSuite').value=suite.id;suiteDefaults();$('tournamentStatus').textContent=`Imported “${suite.name}” (${suite.warriors.length} opponents).`;}
  catch(error){$('tournamentStatus').textContent=error.message;}finally{$(id).value='';}
 };
 $('applyBenchmark').onclick=async()=>{
  try{const text=$('benchmarkDescriptor').value,old=await loadSuite(currentSuite()),updated=readBenchmark(JSON.parse(text),old.files,old.id,old.scoresData);suites[suites.indexOf(old)]=updated;suiteDefaults();$('tournamentStatus').textContent='Benchmark updated for this session.';}
  catch(error){$('tournamentStatus').textContent=error.message;}
 };
 $('downloadBenchmarkZip').onclick=async()=>{
  let suite;try{suite=await loadSuite(currentSuite());}catch(error){$('tournamentStatus').textContent=error.message;return;}
  const a=document.createElement('a'),url=URL.createObjectURL(benchmarkZip(suite));
  a.href=url;a.download=(suite.name.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'benchmark')+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 $('downloadBenchmark').onclick=()=>{
  const suite=suites.find(s=>s.id===$('benchmarkSuite').value),a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(suite.descriptor,null,2)],{type:'application/json'}));a.href=url;a.download='suite.benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 $('benchmarkSuite').addEventListener('change',suiteDefaults);
 $('tournamentMode').addEventListener('change',suiteDefaults);
 for(const id of ['tournamentRounds','tournamentSeed','selfFights'])$(id).addEventListener('change',refresh);
 $('challenger').addEventListener('change',()=>{try{$('tournamentWorkload').textContent=`${plan().jobs.length} matchups`;}catch{}});
 refresh();controls();
 // Prefetch the rest when the browser is idle, the selected suite first, unless the visitor asked to save data.
 if(!navigator.connection?.saveData){
  const prefetch=async()=>{for(const suite of [currentSuite(),...suites])if(suite&&!suite.warriors&&!suite.loadError)await loadSuite(suite).catch(()=>{});};
  const idle=()=>window.requestIdleCallback?requestIdleCallback(prefetch,{timeout:5000}):setTimeout(prefetch,1000);
  if(document.readyState==='complete')idle();else addEventListener('load',idle,{once:true});
 }
 return {refresh};
}

import {benchmarkCatalog} from './benchmark-catalog.mjs';
import {readBenchmark,importBenchmarkFiles,benchmarkParameters} from './benchmarks.mjs';
// SPDX-License-Identifier: GPL-2.0-or-later
import {bundledWarriors} from './demo-warriors.mjs';
import {planTournament} from './tournament-plan.mjs';
import {HistoryChart} from './charts.mjs';
import {warriorColor} from './display.mjs';
const $=id=>document.getElementById(id);
const nameOf=(source,index)=>source.match(/^\s*;name\s+([^\r\n]*)/im)?.[1].trim()||`Warrior ${index+1}`;
export function setupTournaments({roster,readConfig,onTab}) {
 let suites=[{id:'bundled',name:'Bundled examples',warriors:bundledWarriors.map((w,i)=>({id:'demo-'+i,name:nameOf(w.source,i),source:w.source}))}];
 const bundled=suites[0];
 const descriptor={version:1,name:bundled.name,parameters:{rounds:100},warriors:bundled.warriors.map((_,i)=>`example-${i+1}.red`)};
 suites=[readBenchmark(descriptor,Object.fromEntries(bundled.warriors.map((w,i)=>[descriptor.warriors[i],w.source])),'bundled'),...benchmarkCatalog.map(s=>readBenchmark(s.descriptor,s.files,s.id))];
 let serial=0,run=null,workers=[],pendingRender=null,displayedSuite=null;
 const chart=new HistoryChart($('tournamentChart'),'Average points / round · completed matchups');
 let chartWidth=0;
 new ResizeObserver(([entry])=>{const width=entry.contentRect.width;if(width>0&&width!==chartWidth){chartWidth=width;chart.draw();}}).observe($('tournamentChart'));
 const processors=Math.max(1,navigator.hardwareConcurrency||2);
 $('tournamentWorkers').max=processors;$('tournamentWorkers').value=Math.max(1,Math.floor(processors/2));
 $('workerLimit').textContent=`Up to ${processors} parallel workers`;
 const tabs=[$('emulatorTab'),$('tournamentTab')];
 function selectTab(index){
  tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});
  $('emulatorPanel').hidden=index!==0;$('tournamentPanel').hidden=index!==1;
  $('changed').hidden=index===1;
  onTab(index);if(index===1){refresh();chart.draw();}
 }
 tabs.forEach((tab,index)=>{tab.onclick=()=>selectTab(index);tab.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?1:1-index;selectTab(next);tabs[next].focus();}};});
 function configForRun(){const config=readConfig();const suite=suites.find(s=>s.id===$('benchmarkSuite').value);return $('tournamentMode').value==='benchmark'&&suite?.config?{...config,...suite.config}:config;}
 function plan(){return planTournament({mode:$('tournamentMode').value,entrants:roster(),opponents:suites.find(s=>s.id===$('benchmarkSuite').value)?.warriors,
  challenger:$('challenger').value,rounds:Number($('tournamentRounds').value),seed:$('tournamentSeed').value,config:configForRun(),selfFights:$('selfFights').checked});}
 function refresh(){
  const mode=$('tournamentMode').value;
  $('selfFights').disabled=mode==='melee';
  $('benchmarkSetup').hidden=mode!=='benchmark';$('challengeSetup').hidden=mode!=='challenge';
  const old=$('challenger').value;$('challenger').replaceChildren(...roster().map(w=>new Option(w.name,w.id)));if(roster().some(w=>w.id===old))$('challenger').value=old;
  const selected=$('benchmarkSuite').value;$('benchmarkSuite').replaceChildren(...suites.map(s=>new Option(s.name,s.id)));if(suites.some(s=>s.id===selected))$('benchmarkSuite').value=selected;
  const suite=suites.find(s=>s.id===$('benchmarkSuite').value);
  if(displayedSuite!==suite){
   displayedSuite=suite;
   $('benchmarkDescription').textContent=suite.descriptor.description||'';
   $('benchmarkSummary').textContent=`${suite.name} · ${suite.warriors.length} opponents · default ${suite.rounds} rounds`;
   $('benchmarkMembers').replaceChildren(...suite.warriors.map(w=>{const li=document.createElement('li');li.textContent=w.name+' ('+w.file+')';return li;}));
   $('benchmarkDescriptor').value=JSON.stringify(suite.descriptor,null,2);
  }
  $('tournamentEntrants').textContent=roster().map(w=>w.name).join(', ')||'Select warriors in the roster above.';
  try {const c=configForRun();$('tournamentRules').textContent=`${mode==='benchmark'&&suites.find(s=>s.id===$('benchmarkSuite').value)?.config?'Saved suite settings':'Match settings'} · core ${c.coreSize} · cycles ${c.cycles} · processes ${c.tasks} · length ${c.maxLength}${c.permutate?` · permutation: ${2*(c.coreSize-2*(c.distance||c.maxLength)+1)} rounds per full pass`: ""}`;const p=plan();$('tournamentWorkload').textContent=`${p.jobs.length} matchups · ${p.totalRounds.toLocaleString()} rounds`;}
  catch(error){$('tournamentWorkload').textContent=error.message;}
 }
 function dispose(){for(const slot of workers){clearTimeout(slot.timer);slot.worker.terminate();}workers=[];}
 function controls(){
  const busy=run&&['running','pausing','paused'].includes(run.state);
  $('tournamentStart').disabled=!!busy;$('tournamentPause').disabled=!busy;
  $('tournamentPause').textContent=run?.state==='paused'?'Resume':run?.state==='pausing'?'Finishing active matchups…':'Pause';
  $('tournamentPause').disabled=!busy||run.state==='pausing';$('tournamentCancel').disabled=!busy;
  $('tournamentExport').disabled=!run;
  $('tournamentSetup').disabled=!!busy;
 }
 function resultRows(){
  if(!run)return [];
  const totals=run.plan.entrants.map(w=>({...w,wins:0,ties:0,losses:0,score:0,rounds:0}));
  for(const result of run.results){const job=run.plan.jobs[result.id];result.warriors.forEach((w,i)=>{const row=totals.find(t=>t.id===job.warriors[i].id);if(!row)return;for(const key of ['wins','ties','losses','score'])row[key]+=w[key];row.rounds+=result.completed;});}
  return totals;
 }
 function render(){
  pendingRender=null;if(!run)return;
  const completed=run.results.length,active=workers.filter(w=>w.job!==null).length;
  $('tournamentProgress').max=run.plan.jobs.length;$('tournamentProgress').value=completed;
  $('tournamentStatus').textContent=run.error||`${run.state[0].toUpperCase()+run.state.slice(1)} · ${completed} / ${run.plan.jobs.length} matchups · ${active} active`;
  const rows=resultRows();
  chart.add(completed,rows.map(r=>r.rounds?r.score/r.rounds:0));
  const body=$('tournamentStandings');body.replaceChildren();
  rows.map((r,i)=>({...r,color:warriorColor(i)})).sort((a,b)=>(b.rounds?b.score/b.rounds:0)-(a.rounds?a.score/a.rounds:0)).forEach(r=>{
   const tr=document.createElement('tr');for(const value of [r.name,r.rounds,r.wins,r.ties,r.losses,r.score,r.rounds?(r.score/r.rounds).toFixed(3):'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}tr.firstChild.style.color=r.color;body.append(tr);
  });
  $('matchupResults').replaceChildren(...[...run.results].sort((a,b)=>a.id-b.id).map(result=>{
   const row=document.createElement('li');row.textContent=run.plan.jobs[result.id].warriors.map((w,i)=>`${w.name}: ${result.warriors[i].wins} wins, ${result.warriors[i].losses} losses, ${result.warriors[i].ties} ties (${result.warriors[i].score} points)`).join(' / ')+` · ${result.completed} rounds`;return row;
  }));controls();
 }
 function scheduleRender(){if(pendingRender===null)pendingRender=setTimeout(render,100);}
 function fail(message){run.state='failed';run.error=message;dispose();render();}
 function dispatch(slot){
  if(!run||run.state!=='running'||run.next>=run.plan.jobs.length)return;
  const job=run.plan.jobs[run.next++];slot.job=job.id;
  slot.timer=setTimeout(()=>fail('Assembly timed out for '+job.warriors.map(w=>w.name).join(' / ')),15000);
  slot.worker.postMessage(job);
 }
 function settle(){
  if(run.results.length===run.plan.jobs.length){run.state='complete';dispose();}
  else if(run.state==='pausing'&&workers.every(w=>w.job===null))run.state='paused';
  scheduleRender();controls();
 }
 $('tournamentStart').onclick=()=>{
  try {
   const next=plan(),count=Number($('tournamentWorkers').value);
   if(!Number.isInteger(count)||count<1||count>processors)throw new Error(`Choose 1–${processors} workers.`);
   dispose();clearTimeout(pendingRender);pendingRender=null;chart.clear();
   run={plan:next,results:[],next:0,state:'running',workers:Math.min(count,next.jobs.length)};
   for(let i=0;i<run.workers;i++){
    const worker=new Worker(new URL('./tournament-worker.mjs',import.meta.url),{type:'module'}),slot={worker,job:null,timer:null};workers.push(slot);
    worker.onerror=e=>{if(workers.includes(slot))fail(e.message||'Worker failed.');};
    worker.onmessage=({data})=>{
     if(!workers.includes(slot)||data.id!==slot.job)return;
     clearTimeout(slot.timer);
     if(data.type==='started')return;
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
  try {
   const warriors=roster();if(!warriors.length)throw new Error('Select warriors to add to the suite.');
   const name=$('benchmarkName').value.trim();if(!name)throw new Error('Enter a suite name.');
   const config=readConfig();const id='suite-'+(++serial);
   const descriptor={version:1,name,parameters:Object.fromEntries(benchmarkParameters.filter(k=>k in config).map(k=>[k,config[k]])),warriors:warriors.map((_,i)=>`warrior-${i+1}.red`)};
   descriptor.parameters.rounds=Number($('tournamentRounds').value);
   suites.push(readBenchmark(descriptor,Object.fromEntries(warriors.map((w,i)=>[descriptor.warriors[i],w.source])),id));
   refresh();$('benchmarkSuite').value=id;refresh();$('tournamentStatus').textContent=`Saved “${name}” for this session.`;
  }catch(error){$('tournamentStatus').textContent=error.message;}
 };
 $('tournamentExport').onclick=()=>{
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({...run,standings:resultRows()},null,2)],{type:'application/json'}));
  a.href=url;a.download='corewar-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 function suiteDefaults(){const suite=suites.find(s=>s.id===$('benchmarkSuite').value);if($('tournamentMode').value==='benchmark')$('tournamentRounds').value=suite.rounds;refresh();}
 for(const id of ['benchmarkFiles','benchmarkFolder'])$(id).onchange=async()=>{
  try{const suite=await importBenchmarkFiles($(id).files,'import-'+(++serial));suites.push(suite);refresh();$('benchmarkSuite').value=suite.id;suiteDefaults();$('tournamentStatus').textContent=`Imported “${suite.name}” (${suite.warriors.length} opponents).`;}
  catch(error){$('tournamentStatus').textContent=error.message;}finally{$(id).value='';}
 };
 $('applyBenchmark').onclick=()=>{
  try{const old=suites.find(s=>s.id===$('benchmarkSuite').value),updated=readBenchmark(JSON.parse($('benchmarkDescriptor').value),old.files,old.id);suites[suites.indexOf(old)]=updated;suiteDefaults();$('tournamentStatus').textContent='Benchmark updated for this session.';}
  catch(error){$('tournamentStatus').textContent=error.message;}
 };
 $('downloadBenchmark').onclick=()=>{
  const suite=suites.find(s=>s.id===$('benchmarkSuite').value),a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(suite.descriptor,null,2)],{type:'application/json'}));a.href=url;a.download='suite.benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 $('benchmarkSuite').addEventListener('change',suiteDefaults);
 $('tournamentMode').addEventListener('change',suiteDefaults);
 for(const id of ['tournamentRounds','tournamentSeed','selfFights'])$(id).addEventListener('change',refresh);
 $('challenger').addEventListener('change',()=>{try{$('tournamentWorkload').textContent=`${plan().jobs.length} matchups`;}catch{}});
 refresh();controls();return {refresh};
}

import {warriorFilename} from './warrior-files.mjs';
import {setupTournaments} from './tournaments.mjs';
import {bundledWarriors} from './demo-warriors.mjs?v=bd68579c2c000dd9';
import {createEditor} from './dist/editor.mjs?v=bd68579c2c000dd9';
// SPDX-License-Identifier: GPL-2.0-or-later
import {Engine, settings} from './engine.mjs?v=bd68579c2c000dd9';
import {CoreDisplay, warriorColor, battleColor, setBattleSlots, setTheme} from './display.mjs?v=bd68579c2c000dd9';
import {readSettings,setupSettings} from './settings-ui.mjs?v=bd68579c2c000dd9';
import {HistoryChart} from './charts.mjs?v=bd68579c2c000dd9';
const $ = id => document.getElementById(id);
// One entry per mode; adding a mode is a one-line change.
const MODES=[
 {id:'emulatorTab',label:'Battle',panel:'emulatorPanel'},
 {id:'tournamentTab',label:'Tournaments',panel:'tournamentPanel'},
 {id:'toolsTab',label:'Tools',hidden:true},
 {id:'trialsTab',label:'Trials',soon:true}
];
$('modeTabs').replaceChildren(...MODES.filter(m=>!m.hidden).map((m,i)=>{
 const b=document.createElement('button');b.id=m.id;b.type='button';b.setAttribute('role','tab');b.textContent=m.label;
 b.setAttribute('aria-selected',String(i===0));b.tabIndex=i===0?0:-1;
 if(m.panel)b.setAttribute('aria-controls',m.panel);
 if(i===0)b.setAttribute('aria-current','page');
 if(m.soon){b.disabled=true;b.tabIndex=-1;const pill=document.createElement('span');pill.className='soon-pill';pill.textContent='Soon';b.append(' ',pill);}
 return b;
}));
const display = new CoreDisplay($('core'));
let engine = null, worker = null, workerTimer = null, generation = 0;
let state = 'idle', animation = 0, previous = 0, credit = 0, total = 0;
let fastMode = false;
let loadedSlots = [];
let coreView = 'native', inspectionAddress = 0;
const consoles=[];let consoleSerial=0;const commandHistory=[];
let nativeBusy=false,nativeResume=false,nativeOutput='',nativeInput=null,nativeCancelled=false;
let maxSlice = 0, pendingReject = null, latest = null, history = [], combined = [];
let lastText = 0, dirty = false, stepping = false, stepEpoch = 0;
let collapsedEditors=[], scoreViewKey=null, openTabs=[], originals=[], welcomeDismissed=false, pausedByEditor=false, inspectorActive=null;
let sourceEditors=[], compileIssues=[];
const demoSources = [";redcode-94\n;name Imp\n;author A. K. Dewdney\n;assert 1\nmov.i 0, 1\nend\n", ";redcode-94\n;name Dwarf\n;author A. K. Dewdney\n;assert 1\nadd.ab #4, bomb\nmov.i bomb, @bomb\njmp -2\nbomb dat.f #0, #0\nend\n"];
let tournaments=null;
let sources = [], sourceFiles = [];
let excludedWarriors = [];
const selectedIndices = () => sources.map((_,i)=>i).filter(i=>!excludedWarriors[i]);
function rosterCount() {
 const selected=selectedIndices().length;
 $('warriorCount').textContent=`${sources.length} warrior${sources.length===1?'':'s'} loaded`+(sources.length===0?' - upload or create warriors, then run battles and tournaments':selected===sources.length?'':` · ${selected} selected`);
}
let consoleText='',sessionBattles=0,countedCompleted=0,lastScoreSample=-1;
let compileStates=[], compileWorker=null, compileTimer=null, revision=0, chartRound=0;
let validationTimer=null, validationQueue=[];
function cancelAutoValidation(){clearTimeout(validationTimer);validationQueue=[];}
function nextValidation(){
 const index=validationQueue.shift();
 if(index!==undefined)checkWarrior(index,true);
}
function scheduleValidation(){
 cancelAutoValidation();
 validationTimer=setTimeout(()=>{validationQueue=sources.map((_,i)=>i);nextValidation();},1000);
}
function showConsole() {
 $('consoleWindow').open=true;
 $('consoleOutput').textContent=consoleText || 'Validate a warrior or run a battle to see assembly output here.';
 if(activeEditor()<0)activateInspector('output');
}
function refreshCompileButtons() {
 document.querySelectorAll('.compile-warrior').forEach((button,i)=>{
  const result=compileStates[i] || '';
  button.textContent='↻ '+(result==='busy'?'Validating…':result==='ok'?'Valid ✓':result==='failed'?'Invalid — retry':'Validate');
  button.dataset.result=result;button.disabled=result==='busy';
 });
 editorStatus();
}
function editorStatus() {
 const i=activeEditor(),status=$('editorStatus');
 if(i<0){status.textContent='';return;}
 const errors=compileIssues.filter(x=>x.index===i && x.severity==='error').length,warnings=compileIssues.filter(x=>x.index===i && x.severity==='warning').length;
 const result=compileStates[i]||'';
 status.textContent=result==='busy'?'Validating…':result==='ok'?'✓ Assembles'+(warnings?' · '+warnings+' warning'+(warnings===1?'':'s'):''):result==='failed'?(errors||1)+' error'+((errors||1)===1?'':'s'):'';
 status.dataset.result=result;
 $('asmCount').textContent=errors||warnings?errors+' error'+(errors===1?'':'s')+' · '+warnings+' warning'+(warnings===1?'':'s'):'';
}
function cancelCompileCheck() {
 if(compileWorker)compileWorker.terminate();
 compileWorker=null;clearTimeout(compileTimer);
 compileStates=compileStates.map(s=>s==='busy'?'':s);
 refreshCompileButtons();
}
function checkWarrior(index,automatic=false) {
 compileIssues=compileIssues.filter(issue=>issue.index!==index);refreshDiagnostics();
 if(!automatic)cancelAutoValidation();
 cancelCompileCheck();if(!automatic)showConsole();
 let config;
 try {config={...readSettings({warriors:sources.length}),brief:automatic,assembleOnly:true};}
 catch(error){compileStates[index]='failed';refreshCompileButtons();log(error.message);if(automatic)nextValidation();return;}
 const ticket=revision;
 if(!automatic)log('Compiling '+draftName(sources[index],index)+'…','stdout');
 compileStates[index]='busy';refreshCompileButtons();
 const w=compileWorker=new Worker(new URL('./worker.mjs?v=bd68579c2c000dd9',import.meta.url),{type:'module'});
 const finish=(ok,message)=>{
  if(compileWorker!==w)return;
  w.terminate();compileWorker=null;clearTimeout(compileTimer);
  if(ticket!==revision)return;
  compileStates[index]=ok?'ok':'failed';refreshCompileButtons();
  log(message,ok?'stdout':'stderr');if(!automatic)showConsole();
  if(automatic)nextValidation();
 };
 compileTimer=setTimeout(()=>finish(false,'Compilation timed out after 15 seconds.'),15000);
 w.onerror=e=>finish(false,e.message || 'Compiler worker failed.');
 w.onmessage=({data})=>{
  if(compileWorker!==w || ticket!==revision)return;
  if(data.type==='log')log(data.text,data.channel,data.index);
  else if(data.type==='error')finish(false,'Compilation failed: '+data.message);
  else if(data.type==='compiled')finish(true,'Compilation succeeded: '+draftName(sources[index],index));
 };
 w.postMessage({type:'check',index,settings:config,sources:[...sources]});
}
const processChart=new HistoryChart($('processChart'),'');
const scoreChart=new HistoryChart($('scoreChart'),'');
const addressText = n => String(n).padStart(String((engine?.config.coreSize || 8000) - 1).length, '0');
function status(text) {
  $('status').textContent = text;
}
function log(text,channel='stderr',index=null) {
 setTimeout(()=>{if(activeEditor()>=0)$('asmOutput').textContent=consoleText||'Validate the warrior to see assembly output here.';},0);
 if(Number.isInteger(index)){
  for(const match of text.matchAll(/(Error|Warning) in line (\d+):[^\n]*(?:\n[ \t]+[^\n]*)?/g))compileIssues.push({index,line:Number(match[2]),severity:match[1].toLowerCase(),message:match[0]});
  compileIssues=compileIssues.slice(-100);refreshDiagnostics();
 }
 if(nativeBusy)appendNativeOutput(text+'\n');
 consoleText=(consoleText+text+'\n').slice(-262144);
 if($('consoleWindow').open)$('consoleOutput').textContent=consoleText;
 if(channel==='stderr')$('log').textContent=($('log').textContent+text+'\n').slice(-65536);
}
function draftName(source, i) {
  return source.match(/^\s*;name\s+([^\r\n]*)/im)?.[1].trim() || `Warrior ${i + 1}`;
}
function markDirty() {
 tournaments?.refresh();
 compileIssues=[];refreshDiagnostics();
  revision++;cancelCompileCheck();compileStates=[];refreshCompileButtons();scheduleValidation();
  dirty = !!engine || state === 'loading';
  $('changed').textContent = dirty ? 'Changes pending: Run or Reset applies them; Resume keeps the loaded battle.' : '';
}
function legend() {
  const selected=selectedIndices(),loaded=!!(engine && latest);
  const names = loaded ? latest.warriors.map(w => w.name) : selected.map(i=>draftName(sources[i],i));
  $('legendNames').replaceChildren(...names.map((name,i) => {
    const span = document.createElement('span');
    span.style.color = loaded ? battleColor(i) : warriorColor(selected[i]);
    const swatch=document.createElement('span');swatch.className='warrior-swatch';
    const eliminated=document.createElement('span');eliminated.className='eliminated-marker';eliminated.dataset.eliminated=i;
    swatch.append(eliminated);span.append(swatch,` ${name} `);
    const count=document.createElement('span');count.className='process-count';count.dataset.process=i;count.textContent=latest?.warriors[i]?.tasks.toLocaleString()??'—';count.title='Processes';count.setAttribute('aria-label','Processes for '+name);span.append(count);
    return span;
  }));
  if(latest)processIndicators(latest);
}
function editors() {
 sourceEditors.forEach(e=>e.destroy());sourceEditors=[];
 $('editorViews').replaceChildren();
  $('editors').replaceChildren(...sources.map((source, i) => {
    const box = document.createElement('div'), top = document.createElement('div');
    top.className = 'editor-title'; top.style.color = warriorColor(i);
    const swatch=document.createElement('span');swatch.className='warrior-swatch';swatch.setAttribute('aria-hidden','true');
    const label = document.createElement('button');
    label.htmlFor = i === 0 ? 'first' : i === 1 ? 'second' : `warrior-${i}`;
    label.className = 'warrior';
    label.textContent = `${String(i+1).padStart(2,'0')} / ${draftName(source,i)}`;
    label.title='Open in the editor';label.setAttribute('aria-controls',label.htmlFor);
    const remove = document.createElement('button');
    remove.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';remove.title='Remove warrior'; remove.className = 'remove-warrior';
    remove.setAttribute('aria-label', `Remove warrior ${i+1}`);
    remove.onclick = () => removeWarrior(i);
    const save=document.createElement('button');save.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>';save.title='Download warrior';save.className='save-warrior';save.setAttribute('aria-label','Download warrior '+(i+1));save.onclick=()=>saveWarrior(i);
    const compile=document.createElement('button');compile.className='compile-warrior';
    compile.title='Revalidate warrior and show assembly output';compile.setAttribute('aria-label','Validate warrior '+(i+1));compile.onclick=()=>checkWarrior(i);
    label.onclick=()=>openWarrior(i);
    const pencil=document.createElement('button');pencil.className='edit-source';pencil.title='Edit warrior';pencil.setAttribute('aria-label','Edit warrior '+(i+1));pencil.setAttribute('aria-controls',label.htmlFor);
    pencil.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15z"/></svg>';
    pencil.onclick=()=>openWarrior(i);
    const nameGroup=document.createElement('div');nameGroup.className='warrior-name-group';nameGroup.append(label,pencil);
    const include=document.createElement('input');include.type='checkbox';include.className='include-warrior';
    include.checked=!excludedWarriors[i];include.title='Include in next run';include.setAttribute('aria-label','Include warrior '+(i+1)+' in next run');
    include.onchange=safe(async()=>{
      const reload=state==='idle' || state==='loading' || (state==='paused' && total===0);
      excludedWarriors[i]=!include.checked;markDirty();rosterCount();controls();legend();
      if(!reload)return;
      if(selectedIndices().length)await load();
      else {clearBattle();status('Select at least one warrior for the next run.');}
    });
    top.append(include,swatch,nameGroup,compile,save,remove);
    const area=document.createElement('div');area.className='source-editor';
    const editor=createEditor(area,{theme:$('editorTheme').value,syntax:$('editorSyntax').value,value:source,id:label.htmlFor,label:`Warrior ${i+1} source`,onChange:value=>{
      sources[i]=value;
      if(collapsedEditors[i]===false)$('editingName').textContent=draftName(value,i);
      label.textContent=`${String(i+1).padStart(2,'0')} / ${draftName(value,i)}`;
      legend();markDirty();renderCenterTabs();
    }});sourceEditors.push(editor);
    box.append(top);$('editorViews').append(area); return box;
  }));
  if(sources.length)welcomeDismissed=true;
  document.body.dataset.warriors=String(sources.length);
  document.body.dataset.welcome=String(!welcomeDismissed && sources.length===0);
  editorVisibility();refreshCompileButtons();
  rosterCount();tournaments?.refresh();
  $('newWarrior').disabled = sources.length >= 36;

  controls();
  legend();
}
function removeWarrior(i){
 if(nativeBusy)return;
 sources.splice(i,1);sourceFiles.splice(i,1);excludedWarriors.splice(i,1);collapsedEditors.splice(i,1);originals.splice(i,1);openTabs=openTabs.filter(x=>x!==i).map(x=>x>i?x-1:x);
 loadedSlots=loadedSlots.map(x=>x>i?x-1:x);setBattleSlots(loadedSlots);
 markDirty(); if(!sources.length)clearBattle(); editors();
}
function activeEditor(){return collapsedEditors.findIndex(value=>value===false);}
let shownEditor=-1;
// The first centre tab shows the current mode's view; warrior editor tabs are shared by all modes.
let mode='battle';
function editorVisibility(){
 const active=activeEditor();
 openTabs=openTabs.filter(i=>i<sources.length);
 if(active>=0 && !openTabs.includes(active))openTabs.push(active);
 if(active>=0 && shownEditor<0 && state==='running'){pausedByEditor=true;pause();}
 document.querySelectorAll('#editorViews .source-editor').forEach((area,i)=>{
  area.hidden=i!==active;
  const label=document.querySelectorAll('#editors .warrior')[i];
  if(!label)return;
  label.setAttribute('aria-expanded',String(!area.hidden));
  label.parentElement.parentElement.classList.toggle('editing',!area.hidden);
  if(!area.hidden)sourceEditors[i].view.requestMeasure();
 });
 const view=active>=0?'editor':mode==='tournament'?'tournament':'core';
 $('sharedEditor').hidden=active<0;$('coreView').hidden=view!=='core';$('tournamentPanel').hidden=view!=='tournament';
 $('coreInspector').hidden=view!=='core';$('editorInspector').hidden=active<0;
 document.body.dataset.view=view;
 $('runFromEditor').textContent=mode==='tournament'?'▶ Run tournament':'▶ Run battle';
 $('editingName').textContent=active<0?'':draftName(sources[active],active);
 if(active<0 && shownEditor>=0 && mode==='battle'){display.redraw();processChart.draw();scoreChart.draw();}
 shownEditor=active;
 renderCenterTabs();editorStatus();
 if(active>=0)$('asmOutput').textContent=consoleText||'Validate the warrior to see assembly output here.';
}
function openWarrior(i){
 collapsedEditors=sources.map(()=>true);collapsedEditors[i]=false;
 editorVisibility();
 if(!collapsedEditors[i])sourceEditors[i].focus();
}
function showCore(skipResume=false){
 collapsedEditors=sources.map(()=>true);editorVisibility();
 if(!skipResume && mode==='battle' && pausedByEditor && state==='paused' && engine)resume();
 pausedByEditor=false;
}
function renderCenterTabs(){
 const active=activeEditor(),tabs=[];
 const core=document.createElement('button');core.type='button';core.setAttribute('role','tab');core.className='tab core-tab';core.dataset.tab=mode==='tournament'?'tournament':'core';
 core.setAttribute('aria-selected',String(active<0));
 core.innerHTML=mode==='tournament'
  ? '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h4v4H4zM4 15h4v4H4zM8 7h4v10H8M12 12h8"/></svg> '
  : '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></svg> ';
 const coreLabel=document.createElement('span');coreLabel.textContent=mode==='tournament'?'Tournament':'Core';core.append(coreLabel);
 if(mode==='battle' && active>=0 && engine && total>0 && state!=='done'){const paused=document.createElement('span');paused.className='tab-note';paused.textContent=' · paused';core.append(paused);}
 core.onclick=()=>showCore();tabs.push(core);
 for(const i of openTabs){
  if(i>=sources.length)continue;
  const tab=document.createElement('span');tab.className='tab warrior-tab';tab.style.color=warriorColor(i);tab.dataset.tab=String(i);tab.setAttribute('role','presentation');
  const open=document.createElement('button');open.type='button';open.setAttribute('role','tab');open.setAttribute('aria-selected',String(i===active));
  const swatch=document.createElement('span');swatch.className='warrior-swatch';
  const name=document.createElement('span');name.className='tab-name';name.textContent=(sourceFiles[i]||warriorFilename(draftName(sources[i],i)));
  open.append(swatch,' ',name);
  if(originals[i]!==undefined && originals[i]!==sources[i]){const dot=document.createElement('span');dot.className='tab-dot';dot.title='Edited';dot.textContent=' ●';open.append(dot);}
  open.onclick=()=>openWarrior(i);
  const close=document.createElement('button');close.type='button';close.className='tab-close';close.setAttribute('aria-label','Close '+name.textContent);close.textContent='×';
  close.onclick=()=>{openTabs=openTabs.filter(x=>x!==i);if(i===active)showCore();else renderCenterTabs();};
  tab.append(open,close);tabs.push(tab);
 }
 $('centerTabs').replaceChildren(...tabs);
}
$('toggleEditors').onclick=()=>showCore();
$('validateActive').onclick=()=>{const i=activeEditor();if(i>=0)checkWarrior(i);};
$('downloadActive').onclick=()=>{const i=activeEditor();if(i>=0)saveWarrior(i);};
$('removeActive').onclick=()=>{const i=activeEditor();if(i>=0)removeWarrior(i);};
$('clearAsm').onclick=()=>{consoleText='';$('consoleOutput').textContent='';$('asmOutput').textContent='';compileIssues=[];refreshDiagnostics();};
$('runFromEditor').onclick=safe(async()=>{
 if(mode==='tournament'){showCore();$('tournamentStart').click();return;}
 showCore(true);pausedByEditor=false;
 if(state==='running' || state==='series')return;
 await run();
});
function processIndicators(update){
 update.warriors.forEach((w,i)=>{
  const marker=$('legendNames').querySelector('[data-eliminated="'+i+'"]');
  const eliminated=!!engine?.started && w.tasks===0;
  if(marker && marker.dataset.state!==String(eliminated)){
   marker.dataset.state=String(eliminated);marker.textContent=eliminated?'×':'';
   marker.title=eliminated?'Eliminated (no processes)':'';
   marker.setAttribute('aria-label',eliminated?w.name+' eliminated':'');
  }
 });
 if(fastMode || $('pauseViews').checked || $('pauseProcesses').checked)return;
 update.warriors.forEach((w,i)=>{
  const counter=$('legendNames').querySelector('[data-process="'+i+'"]');
  if(counter){const text=w.tasks.toLocaleString();if(counter.textContent!==text)counter.textContent=text;counter.title=w.tasks+' processes';}
 });
}
function refreshDiagnostics(){
 sourceEditors.forEach((editor,index)=>editor.diagnostics(compileIssues.filter(issue=>issue.index===index)));
 $('sourceDiagnostics').replaceChildren(...compileIssues.map(issue=>{
  const button=document.createElement('button');button.type='button';button.className='source-diagnostic';
  button.textContent=draftName(sources[issue.index]||'',issue.index)+' · line '+issue.line+' · '+issue.message;
  button.onclick=()=>{collapsedEditors=sources.map(()=>true);collapsedEditors[issue.index]=false;editorVisibility();sourceEditors[issue.index]?.jump(issue.line);};return button;
 }));
 editorStatus();
}
function seriesActive() { return state.startsWith("series"); }
function controls() {
  const noSelection = selectedIndices().length === 0;
  const empty = noSelection && (!engine || (total===0 && dirty));
  const busy = nativeBusy || state === 'loading' || seriesActive() || stepping;
  $('run').disabled = !nativeBusy && (empty || (busy && !['series','series-paused'].includes(state)) || state==='done');
  const running=['running','series'].includes(state), done=state==='done';
  $('run').innerHTML='<span class="control-icon" aria-hidden="true">'+(nativeBusy?'■':running?'Ⅱ':done?'✓':'▶')+'</span> '+(nativeBusy?'Cancel':running?'Pause':done?'Done':'Run');
  $('debugRun').disabled=empty || busy || state==='done';
  $('fast').disabled=empty || busy || state==='done';
  $('step').disabled = empty || busy || state === 'running' || state === 'done';
  $('reset').disabled = nativeBusy || noSelection || state === 'loading';
  document.querySelectorAll('.remove-warrior,.include-warrior,#removeActive').forEach(b=>b.disabled=nativeBusy);
  renderCenterTabs();
}
function stop() {
  nativeResume=false;nativeOutput='';engine?.setDebugEvents(false);
  setFast(false);
  cancelAutoValidation();cancelCompileCheck();
  generation++; stepEpoch++; stepping = false; cancelAnimationFrame(animation);
  if (worker) worker.terminate();
  worker = null; clearTimeout(workerTimer);
  if (pendingReject) pendingReject(new DOMException('Stopped', 'AbortError'));
  pendingReject = null; engine = null; latest = null;
  history = []; combined = []; coreView='native'; renderTrace(); countedCompleted=0;lastScoreSample=-1;
  processChart.clear();scoreChart.clear();
  state = 'idle'; pausedByEditor=false; $('battleResults').hidden=true;$('lastResult').textContent='No battle run yet.'; dirty = false; $('changed').textContent = ''; $('activeSettings').textContent = ''; legend();
  $('progress').hidden = true; status('Stopped. Ready for another battle.'); controls();
}
function clearBattle() {
  stop();display.configure(display.size);clearHover();
  $('timing').textContent='Cycle —';$('timing').dataset.instructions='0';
  $('scores').textContent='Add warriors or try the demo.';
  for(const panel of consoles)panel.output.textContent='Load a battle to inspect its core.';$('coreViewTitle').textContent='Core listing';


  $('battleTotals').textContent='Warriors · 0 battles this run';
  status('No warriors loaded. Add a warrior, upload files, or try Demo.');
}
function options() { return readSettings({warriors:selectedIndices().length}); }
function work(type, config) {
 const indices=selectedIndices();
 compileIssues=[];refreshDiagnostics();
  cancelAutoValidation();cancelCompileCheck();
  compileStates=sources.map(()=> '');refreshCompileButtons();
  const ticket=revision;
  const assemblyStatus=(index,ok)=>{
    if(ticket!==revision || !Number.isInteger(index))return;
    compileStates[indices[index]]=ok?'ok':'failed';refreshCompileButtons();
  };
  return new Promise((resolve, reject) => {
    pendingReject = reject;
    const w = worker = new Worker(new URL('./worker.mjs?v=bd68579c2c000dd9', import.meta.url), {type:'module'});
    const finish = (error, value) => {
      clearTimeout(workerTimer); w.terminate();
      if (worker === w) worker = null;
      pendingReject = null; error ? reject(error) : resolve(value);
    };
    workerTimer = setTimeout(() => finish(new Error('Assembly timed out after 15 seconds.')),15000);
    w.onerror = event => finish(new Error(event.message || 'Worker failed to load.'));
    w.onmessage = ({data}) => {
      if(worker!==w)return;
      if (data.type === 'log') log(data.text,data.channel,Number.isInteger(data.index)?indices[data.index]:null);
      else if (data.type === 'assembly') assemblyStatus(data.index,data.ok);
      else if (data.type === 'error') {assemblyStatus(data.index,false);showConsole();finish(new Error(data.message));}
      else if (data.type === 'compiled') finish(null,data.banks);
      else if (data.type === 'paused') {
        clearTimeout(workerTimer);state='series-paused';
        $('progress').value=data.update.completed;latest=data.update;scores(data.update);sampleScores(data.update);
        status('Series paused at '+data.update.completed+' completed rounds. Resume series to continue.');controls();
      } else if (data.type === 'progress') {
        clearTimeout(workerTimer);
        $('progress').value = data.update.completed;
        status(`Series: ${data.update.completed} / ${config.rounds} rounds completed.`);
        latest=data.update;scores(data.update); sampleScores(data.update);
      } else if (data.type === 'done') finish(null,data.update);
    };
    w.postMessage({type, settings:config, sources:indices.map(i=>sources[i])});
  });
}
function scores(update) {
  processIndicators(update);
  $('battleResults').hidden=update.completed===0;
  const best=Math.max(...update.warriors.map(w=>w.score));
  const shared=update.warriors.filter(w=>w.score===best).length>1;
  const order=update.warriors.map((w,i)=>({w,i}));
  order.sort((a,b)=>b.w.score-a.w.score);
  const key=JSON.stringify([update.completed,update.done,order.map(({w,i})=>[w.name,w.wins,w.ties,w.losses,w.score,battleColor(i)])]);
  if(key===scoreViewKey)return;
  scoreViewKey=key;
  const single=update.warriors.length===1;
  const table=document.createElement('table');table.className='results-table';
  const head=table.createTHead().insertRow();
  for(const text of ['Warrior',single?'Surv. / Term.':'W / T / L','Score','Result']){const th=document.createElement('th');th.textContent=text;head.append(th);}
  const body=table.createTBody();let summary='';
  for(const {w,i} of order){
    const result=single ? (update.completed===1?(w.losses?'Terminated':'Survived'):'')
      :update.completed===1 ? (w.wins?'Won':w.ties?'Tied':'Lost')
      :update.done ? (w.score===best?(shared?'Tied for first':'Won series'):'Lost series') : '';
    const row=body.insertRow();row.style.color=battleColor(i);
    const name=row.insertCell();const swatch=document.createElement('span');swatch.className='warrior-swatch';name.append(swatch,' '+w.name);
    row.insertCell().textContent=single?`${w.wins} / ${w.losses}`:`${w.wins} / ${w.ties} / ${w.losses}`;
    row.insertCell().textContent=String(w.score);
    row.insertCell().textContent=result;
    if(!summary && result)summary=`${w.name}: ${result.toLowerCase()} · score ${w.score}`;
  }
  $('scores').replaceChildren(table);
  $('lastResult').textContent=summary||(update.completed?'Battle in progress.':'No battle completed yet.');
}
function wrap(n) { const size = engine?.config.coreSize || 8000; return ((n % size) + size) % size; }
function lineCount() { return 10; }
function markBreakpointRow(row,address,active){
  row.setAttribute('aria-pressed',String(active));
  row.title=(active?'Remove':'Set')+' breakpoint at '+addressText(address)+' (click pauses execution)';
  row.setAttribute('aria-label',row.title);
}
function instructionRow(address, instruction, owner = null, suffix = '', listing = false) {
  const row=document.createElement('button');row.type='button';
  row.className='instruction-row'+(listing?' listing-line':'');row.dataset.address=String(address);
  markBreakpointRow(row,address,engine?.breakpoint(address) || false);
  if(owner!==null)row.style.color=battleColor(owner);
  row.textContent=addressText(address)+'  '+instruction+suffix+'\n';
  row.onclick=()=>{
    if(nativeBusy || !engine?.started)return;
    const host=row.closest('.console-output');
    pause();
    const enabled=!engine.breakpoint(address);engine.setBreakpoint(address,enabled);
    if(enabled){$('debugEnabled').checked=true;engine.setDebug(true);}
    textViews();
    // Listings are only rebuilt on explicit inspection, so mark every row already shown for this address.
    document.querySelectorAll('.instruction-row[data-address="'+address+'"]').forEach(other=>markBreakpointRow(other,address,enabled));
    host?.querySelector('[data-address="'+address+'"]')?.focus({preventScroll:true});
  };
  return row;
}
function traceRow(entry) {
  return instructionRow(entry.address,entry.instruction,entry.warrior,'  · '+latest.warriors[entry.warrior].name);
}
function renderListing(host) {
  if(!host){for(const panel of consoles.filter(p=>p.select.value==='cdb'))renderListing(panel.output);return;}
  if (!engine) {host.textContent='Load a battle to inspect its core.';return;}
  const start = inspectionAddress;
  host.replaceChildren(...Array.from({length:lineCount()},(_,i) => {
    const addr=wrap(start+i),owners=latest.warriors.flatMap((w,j)=>w.pc===addr?[j]:[]);
    return instructionRow(addr,engine.inspect(addr),owners[0]??null,
      owners.length?'  ← next: '+owners.map(j=>latest.warriors[j].name).join(', '):'',true);
  }));
}
function inspect() {if(nativeBusy)return;ensureCdbConsole();coreView='inspect';$('coreViewTitle').textContent='Core listing';syncTrace();renderListing();}
function renderCoreView() {
  // Only explicit inspection or cdb commands change this console's contents.
  if(coreView==='native')renderNativeOutput();
}
function showAddress(n) { inspectionAddress=wrap(n); inspect();renderCoreView(); }
function consoleOptions(panel) {
  const selected=panel.select.value || 'cdb';
  const names=latest?.warriors.map(w=>w.name) || sources.map((source,i)=>draftName(source,i));
  panel.select.replaceChildren(new Option('cdb','cdb'),new Option('All warriors','all'),...names.map((name,i)=>new Option(name,'warrior:'+i)));
  panel.select.value=[...panel.select.options].some(o=>o.value===selected)?selected:'cdb';
  renderInspectorTabs();
}
function consoleLabel(panel){
  const v=panel.select.value;
  if(v==='cdb')return 'cdb';
  if(v==='all')return 'Trace';
  return 'Trace · '+(panel.select.selectedOptions[0]?.textContent||'');
}
function renderInspectorTabs(){
 const tabs=[...consoles].sort((a,b)=>(a.select.value==='cdb')-(b.select.value==='cdb')).map(panel=>{
  const b=document.createElement('button');b.type='button';b.setAttribute('role','tab');b.className='console-tab';b.textContent=consoleLabel(panel);
  b.setAttribute('aria-selected',String(inspectorActive===panel));b.onclick=()=>activateInspector(panel);return b;
 });
 for(const old of $('inspectorTabs').querySelectorAll('.console-tab'))old.remove();
 $('inspectorTabs').prepend(...tabs);
 $('outputTab').setAttribute('aria-selected',String(inspectorActive==='output'));
}
function activateInspector(target){
 if(target!=='output' && !consoles.includes(target))target=consoles.find(p=>p.select.value==='cdb')||consoles[0]||'output';
 inspectorActive=target;
 for(const panel of consoles)panel.element.classList.toggle('active',panel===target);
 $('outputPanel').hidden=target!=='output';
 const cdb=target!=='output' && target.select.value==='cdb';
 $('commandWorkspace').hidden=!(cdb || !consoles.some(p=>p.select.value==='cdb'));$('cdbHead').hidden=target==='output';
 $('consolePanel').dataset.tab=target==='output'?'output':cdb?'cdb':'trace';
 renderInspectorTabs();
 if(target!=='output'){renderTrace();if(cdb)renderCoreView();}
}
$('outputTab').onclick=()=>activateInspector('output');
function addConsole(kind='cdb') {
  const id=++consoleSerial,panel={paused:false};
  panel.element=document.createElement('section');panel.element.className='output-console';
  const header=document.createElement('div');header.className='console-toolbar';
  panel.select=document.createElement('select');panel.select.setAttribute('aria-label','Console '+id+' content');
  const pauseButton=document.createElement('button');pauseButton.textContent='Ⅱ';pauseButton.title='Pause console';pauseButton.setAttribute('aria-label','Pause console '+id);pauseButton.setAttribute('aria-pressed','false');
  pauseButton.onclick=()=>{panel.paused=!panel.paused;pauseButton.setAttribute('aria-pressed',String(panel.paused));syncTrace();renderCoreView();renderTrace();};
  const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Remove console '+id);
  close.onclick=()=>{consoles.splice(consoles.indexOf(panel),1);panel.element.remove();syncTrace();activateInspector(inspectorActive===panel?'':inspectorActive);};
  panel.output=document.createElement('pre');panel.output.className='console-output';panel.output.setAttribute('aria-label','Console '+id+' output');
  if(id===1)panel.output.id='instruction';
  header.append(panel.select,pauseButton,close);panel.element.append(header,panel.output);consoles.push(panel);$('execution').append(panel.element);
  consoleOptions(panel);panel.select.value=kind;
  panel.select.onchange=()=>{syncTrace();renderCoreView();renderTrace();activateInspector(panel);};
  syncTrace();renderCoreView();renderTrace();renderInspectorTabs();return panel;
}
function ensureCdbConsole(){if(!consoles.some(p=>p.select.value==='cdb'))addConsole('cdb');if(inspectorActive==='output' || inspectorActive?.select?.value!=='cdb')activateInspector(consoles.find(p=>p.select.value==='cdb'));}
function renderTrace() {
  if(nativeBusy || fastMode || $('pauseViews').checked)return;
  for(const panel of consoles){
    if(panel.paused || panel.select.value==='cdb')continue;
    if(!latest){panel.output.textContent='Load a battle to watch executed instructions.';continue;}
    const index=Number(panel.select.value.split(':')[1]);
    const entries=panel.select.value==='all'?combined:(history[index]||[]);
    panel.output.replaceChildren(...entries.map(e=>panel.select.value==='all'?traceRow(e):instructionRow(e.address,e.instruction,e.warrior)));
    panel.output.scrollTop=panel.output.scrollHeight;
  }
}
function textViews() {
  if(nativeBusy){renderNativeOutput();return;}
  if(latest){scores(latest);renderCoreView();}
  renderTrace();lastText=performance.now();
}
function present(update) {
  latest = update; display.apply(update.events,!fastMode);
  $('activeSettings').textContent = 'Loaded cycle limit: ' + engine.config.cycles.toLocaleString() +
    ' per warrior per round · ' + engine.config.warriors + ' warriors';
  for (const entry of update.trace) {
    if($('pauseViews').checked)continue;
    (history[entry.warrior] ||= []).push(entry);
    if (history[entry.warrior].length > 100) history[entry.warrior].shift();
    combined.push(entry);
  }
  if (combined.length > 300) combined.splice(0,combined.length-300);
  total += update.executed;
  $('timing').dataset.instructions=String(total);

  if(!fastMode)sampleScores(update);
  $('timing').textContent = `Cycle ${update.cycle.toLocaleString()} / ${engine.config.cycles.toLocaleString()} · round ${update.round}`;
  if($('diagnostics').open && !fastMode)$('sliceTiming').textContent='Peak simulation slice: '+maxSlice.toFixed(1)+' ms';
  if(update.debugHit>=0){if(nativeResume){nativeResume=false;setTimeout(()=>nativeCommand(undefined).catch(e=>log(e.message)),0);}pause();status('Debug marker: '+update.warriors[update.debugHit].name+' at '+addressText(update.warriors[update.debugHit].pc)+'. Paused before execution.');}
  if(update.debugEvent && nativeResume){nativeResume=false;pause();setTimeout(()=>nativeCommand(undefined).catch(e=>log(e.message)),0);}
  if (update.done) { setFast(false,true);sampleScores(update);state = 'done'; status('Battle complete. Inspect the core; Reset starts again.'); controls(); }
  if (!fastMode && (state !== 'running' || performance.now()-lastText >= 100)) {
    if(!$('pauseViews').checked && !$('pauseProcesses').checked){
      if(chartRound!==update.round){processChart.clear();chartRound=update.round;}
      processChart.add(update.cycle,update.warriors.map(w=>w.tasks));
    }
    textViews();
  }
}
async function load() {
  if(!selectedIndices().length){status('Select at least one warrior for the next run.');return false;}
  stop(); const token = generation;
  state = 'loading'; controls(); $('log').textContent = ''; consoleText='';$('consoleOutput').textContent='';
  status('Assembling warriors in a background worker…');
  const slots = selectedIndices(), config = options(), banks = await work('compile',config);
  if (token !== generation) return false;
  const next = await Engine.create(config,{log});
  if (token !== generation) return false;
  next.import(banks);
  // Reserve the widest counter for this match so digit changes cannot reflow the toolbar.
  $('timing').style.width = (('Cycle '+config.cycles.toLocaleString()+' / '+config.cycles.toLocaleString()+' · round '+next.config.rounds.toLocaleString()).length)+'ch';
  loadedSlots = slots; setBattleSlots(slots);
  engine = next; total = 0; maxSlice = 0; credit = 0; history = []; combined = [];
  display.configure(config.coreSize);clearHover(); inspectionAddress=0;
  traceControls(banks.map(b=>b.name));engine.setDebug($('debugEnabled').checked);
  const initial=engine.start();present(initial);legend();
  if(initial.done){state='done';status('Assembly complete. No battles run.');controls();return false;}
  state = 'paused'; controls();
  status('Paused before instruction 1. Step or Run battle.');
  return true;
}
function pause() {
  if(nativeBusy){nativeCancelled=true;engine?.cancelDebugger();if(nativeInput){nativeInput(null);nativeInput=null;}return;}
  if(state==='series'){state='series-pausing';worker?.postMessage({type:'pause'});status('Pausing series…');controls();return;}
  if (state !== 'running') return;
  cancelAnimationFrame(animation);setFast(false); state = 'paused'; status('Paused. Step or Resume battle.'); controls(); textViews();
}
function frame(now) {
  if (state !== 'running') return;
  if (document.hidden) { previous = now; animation = requestAnimationFrame(frame); return; }
  const unthrottled = fastMode || Number($('speed').value) > 5;
  const rate = Math.round(10 ** Math.min(5,Number($('speed').value)));
  credit = Math.min(credit + Math.min(now-previous,50)*rate/1000,rate/20+1); previous = now;
  if (unthrottled || credit >= 1) {
    const before = performance.now();
    const update = engine.advance(unthrottled?100000:Math.min(100000,Math.floor(credit)),4);
    maxSlice = Math.max(maxSlice,performance.now()-before);
    if(!unthrottled)credit -= update.executed; present(update);
  }
  if (state === 'running') animation = requestAnimationFrame(frame);
}
function resume() {
  if (!engine || state === 'done') return;
  stepEpoch++; stepping = false;
  syncTrace();
  state = 'running'; previous = performance.now(); controls();
  status('Battle running. Click the core to pause and list instructions.');
  animation = requestAnimationFrame(frame);
}
function safe(action) {
  return async () => {
    try { await action(); }
    catch (error) {
      if (error.name === 'AbortError') return;
      stop(); state = 'error'; controls(); log(error.message); showConsole(); status(error.message);
    }
  };
}
async function step(n = 1) {
  if (stepping || state === 'loading' || seriesActive()) return;
  pause();
  if (!engine && !(await load())) return;
  if (state === 'done') return;
  const token = generation, ticket = ++stepEpoch;
  syncTrace();
  stepping = true;engine.setDebug(false);controls();
  try {
    while (n > 0 && state === 'paused' && token === generation && ticket === stepEpoch) {
      const update = engine.advance(Math.min(n,100000),4);
      n -= update.executed; present(update);
      if (n > 0) await new Promise(resolve => setTimeout(resolve,0));
    }
    if (state === 'paused' && token === generation && ticket === stepEpoch)
      status('Paused after stepping. Step or Resume battle.');
  } finally {
    if (ticket === stepEpoch) {engine?.setDebug($('debugEnabled').checked);stepping = false; controls(); }
  }
}
async function run() {
  if(nativeBusy){pause();return;}
  if(state==='running' || state==='series'){pause();return;}
  if(state==='series-paused'){state='series';worker?.postMessage({type:'resume'});status('Resuming series…');controls();return;}
  if (engine) {
    if (state === 'paused') {
      // Before instruction one, Run applies edits made since Reset/loading.
      // After execution begins, resuming preserves that match's settings.
      if (total === 0 && dirty && !(await load())) return;
      resume();
    }
    return;
  }
  if (await load()) resume();
}
function appendNativeOutput(text) {
  if(text==='(cdb) ')return;
  if(text.includes('\x1b['))text=text.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
  nativeOutput=(nativeOutput+text).slice(-65536);
}
function renderNativeOutput(host) {
  if(!host){for(const panel of consoles.filter(p=>p.select.value==='cdb' && !p.paused))renderNativeOutput(panel.output);return;}
  $('coreViewTitle').textContent='Native pMARS debugger';
  if(nativeBusy)host.textContent=nativeOutput;
  else host.replaceChildren(...nativeOutput.split('\n').map(line=>{
    const match=line.match(/^(\d{5})\s+(.*)$/);
    if(match){
      const address=Number(match[1]);
      const owner=latest?.warriors.findIndex(w=>w.pc===address)??-1;
      return instructionRow(address,match[2],owner>=0?owner:null,'',true);
    }
    return document.createTextNode(line+'\n');
  }));
  host.scrollTop=host.scrollHeight;
}
async function nativeCommand(text) {
  if(nativeBusy){
    if(nativeInput){const resolve=nativeInput;nativeInput=null;resolve(text);return;}
    return 'Debugger busy. Use Cancel to interrupt the command.';
  }
  pause();nativeResume=false;
  if(!engine && !(await load()))return;
  const instance=engine;instance.setDebugEvents(false);
  if(typeof text==='string' && text.trim().toLowerCase()==='cls')nativeOutput='';
  if(nativeOutput && !nativeOutput.endsWith('\n'))appendNativeOutput('\n');
  ensureCdbConsole();
  nativeBusy=true;nativeCancelled=false;coreView='native';$('commandOutput').textContent='Working…';controls();
  const timer=setInterval(renderNativeOutput,100);
  const io={output:appendNativeOutput,command:recordCommand,input:prompt=>{
    if(nativeCancelled)return Promise.resolve(null);
    $('commandOutput').textContent=prompt || 'Enter the requested instruction or expression.';
    $('command').focus();renderNativeOutput();
    return new Promise(resolve=>{nativeInput=resolve;});
  }};
  try{
    let next=text;
    while(!nativeCancelled && engine===instance){
      const result=await instance.debuggerCommand(next,io);next=undefined;
      if(result.cancelled || nativeCancelled)break;
      if(state==='done' && result.action!==3){appendNativeOutput('Battle complete. Reset to execute again.\n');break;}
      if(result.action===2){
        let remaining=result.steps;instance.setDebug(false);
        while(remaining>0 && !nativeCancelled){
          const update=instance.advance(Math.min(100000,remaining),4);remaining-=update.executed;present(update);
          if(update.done){remaining=0;break;}
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        instance.setDebug($('debugEnabled').checked);
        if(state==='done')break;
        continue;
      }
      if(result.action===0 || result.action===1){
        $('debugEnabled').checked=result.action===1;instance.setDebug(result.action===1);
        nativeResume=result.action===1;instance.setDebugEvents(nativeResume);
        nativeBusy=false;resume();return;
      }
      break;
    }
  }finally{
    clearInterval(timer);nativeBusy=false;nativeInput=null;
    for(const button of $('commandHistory').querySelectorAll('button'))button.disabled=false;
    if(engine===instance){
      instance.setDebug($('debugEnabled').checked);
      latest=instance.update(state==='done');latest.events=new Uint32Array();latest.trace=[];latest.executed=0;
      if(state!=='running')coreView='native';
      if(state!=='running')renderNativeOutput();renderTrace();controls();
      $('commandOutput').textContent=nativeCancelled?'Debugger command cancelled.':'Ready.';
    }
  }
}
async function command(text) {
  if(nativeBusy)return nativeCommand(text);
  const verb=text.trim().toLowerCase();
  if(verb==='pause'){pause();return;}
  if(verb==='reset battle'){await load();return;}
  if(/^(f[1-9]|f10|up|down|pgup|pgdn|alive|tproc|mousel|mousem|mouser)$/.test(verb))text='macro '+verb;
  return nativeCommand(text);
}
function setFast(enabled,keepNotice=false){
 const wasFast=fastMode;fastMode=enabled;if(enabled || !keepNotice)$('fastNotice').hidden=!enabled;$('fast').setAttribute('aria-pressed',String(enabled));
 $('speed').disabled=enabled;syncTrace();
 if(!enabled){display.redraw();if(latest){if(wasFast)sampleScores(latest);textViews();}}
}
$('fast').onclick=safe(async()=>{
 const enable=!fastMode;
 if((!engine || (total===0 && dirty)) && !(await load()))return;
 setFast(enable);
 if(enable && state==='paused')resume();
});
$('debugRun').onclick=safe(async()=>{
 $('debugEnabled').checked=true;
 pause();
 if((!engine || (total===0 && dirty)) && !(await load()))return;
 engine.setDebug(true);resume();
});
$('debugEnabled').onchange=()=>{if(!nativeBusy)engine?.setDebug($('debugEnabled').checked);};
$('diagnostics').ontoggle=()=>{if($('diagnostics').open)$('sliceTiming').textContent='Peak simulation slice: '+maxSlice.toFixed(1)+' ms';};
$('run').onclick = safe(run);
$('step').onclick = safe(() => step());
$('reset').onclick = safe(load);
$('speed').oninput = () => {
 const unlimited=Number($('speed').value)>5;
 const label=unlimited?'Unlimited':Math.round(10 ** Number($('speed').value)).toLocaleString();
 $('speedValue').textContent=label;$('speed').closest('label').dataset.unlimited=String(unlimited);
 $('speed').setAttribute('aria-valuetext',unlimited?'Unlimited, with graphics':label+' instructions per second');
 credit=0;
};
$('addConsole').onclick=()=>activateInspector(addConsole(latest?.warriors.length?'warrior:0':'cdb'));
$('arenaLayout').onchange=()=>{
 const layout=$('arenaLayout').value,viewport=document.querySelector('.arena-viewport');
 viewport.dataset.layout=layout;
 viewport.scrollLeft=0;viewport.scrollTop=0;
 viewport.setAttribute('aria-label',{'vertical':'Core arena scrolling vertically','horizontal':'Core arena scrolling horizontally','fill':'Core arena filling vertically','fill-horizontal':'Core arena filling horizontally'}[layout]);
 clearHover();display.redraw();
};
function clearHover(){ $('hoverAddress').textContent='Cell: —'; }
$('cellSize').onchange = () => {document.querySelector('.arena-viewport').dataset.cells=$('cellSize').value==='0'?'auto':'fixed';clearHover();display.setCellSize(Number($('cellSize').value));};
$('core').onpointermove=event=>{
 const address=display.addressAt(event),text=address===null?'Cell: —':'Cell: '+String(address).padStart(String(display.size-1).length,'0');
 if($('hoverAddress').textContent!==text)$('hoverAddress').textContent=text;
};
$('core').onpointerleave=clearHover;
document.querySelector('.arena-viewport').addEventListener('scroll',clearHover);
$('core').onclick = event => { const address=display.addressAt(event);if(address===null)return;pause();showAddress(address); };
$('core').oncontextmenu = event => { event.preventDefault();const address=display.addressAt(event);if(address===null)return;pause();showAddress(address-lineCount()+1); };
$('commandForm').onsubmit = event => {
  event.preventDefault();const text=$('command').value;$('command').value='';
  command(text).catch(error=>{nativeBusy=false;controls();$('commandOutput').textContent=error.message;log(error.message);});
};

document.addEventListener('keydown',event => {
  if (event.target.closest('textarea,input,select,button,[contenteditable]') || event.ctrlKey || event.altKey || event.metaKey) return;
  const key = {F1:'help',F5:'f5',F7:'f7',F8:'f8',F9:'go',ArrowUp:'up',ArrowDown:'down',PageUp:'pgup',PageDown:'pgdn',Escape:'pause'}[event.key];
  if (key) { event.preventDefault(); command(key).catch(error=>log(error.message)); }
});
document.addEventListener('visibilitychange',() => { previous = performance.now(); credit = 0; });

function traceControls() {
 for(const panel of consoles)consoleOptions(panel);
 syncTrace();
}
function syncTrace(){
 if(nativeBusy)return;
 engine?.setTrace(!fastMode && !$('pauseViews').checked && consoles.some(p=>!p.paused && p.select.value!=='cdb'));
}
function recordCommand(text){
 if(!text)return;
 commandHistory.push(text);if(commandHistory.length>100)commandHistory.shift();
 $('commandHistory').replaceChildren(...commandHistory.map(cmd=>{
   const button=document.createElement('button');button.type='button';button.textContent=cmd;button.title='Execute again: '+cmd;
   button.disabled=nativeBusy && !nativeInput;
   button.onclick=()=>{if(nativeBusy)return;command(cmd).catch(e=>{$('commandOutput').textContent=e.message;});};
   return button;
 }));
 $('commandHistory').scrollTop=$('commandHistory').scrollHeight;
}
function battleCount(update){
 sessionBattles += Math.max(0,update.completed-countedCompleted);countedCompleted=update.completed;
 $('battleTotals').textContent='Results · '+update.completed.toLocaleString()+' battle'+(update.completed===1?'':'s')+(update.done?' · complete':' completed');
 $('diagnosticsTitle').textContent='Show diagnostics · '+sessionBattles.toLocaleString()+' battles this session';
}
function sampleScores(update){
 battleCount(update);
 if(!$('pauseViews').checked && !$('pauseScores').checked && update.completed!==lastScoreSample){
  scoreChart.add(update.completed,update.warriors.map(w=>w.score));lastScoreSample=update.completed;
 }
}
function saveWarrior(i){
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([sources[i]],{type:'text/plain;charset=utf-8'}));
 a.href=url;a.download=sourceFiles[i]||warriorFilename(draftName(sources[i],i));
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importFiles(files){
 const list=Array.from(files);
 if(!list.length)return;
 if(sources.length+list.length>36)throw new Error('At most 36 warriors can be loaded. Remove some before importing.');
 if(list.some(f=>f.size>65536))throw new Error('Warrior files must be at most 64 KiB each.');
 const texts=await Promise.all(list.map(f=>f.text()));
 if(sources.length+texts.length>36)throw new Error('Too many warriors after concurrent imports.');
 sources.push(...texts);originals.push(...texts);sourceFiles.push(...list.map(f=>f.name));markDirty();editors();
 status('Imported '+list.length+' warrior files. Select one to edit it, or Reset to load them.');
}
$('newWarrior').onclick=()=>{
 if(sources.length>=36)return;
 sourceFiles.push(null);
 collapsedEditors=sources.map(()=>true);collapsedEditors[sources.length]=false;
 const fresh=';redcode-94\n;name Warrior '+(sources.length+1)+'\n;assert 1\nmov.i 0, 1\nend\n';
 sources.push(fresh);originals.push(fresh);
 markDirty();editors();
};
$('uploadBtn').onclick=()=>$('warriorFiles').click();
async function startDemo(selected){
 if(sources.length && !confirm('Replace the '+sources.length+' loaded warrior'+(sources.length===1?'':'s')+' with this example?'))return;
 sources=[...selected];originals=[...selected];sourceFiles=selected.map(source=>bundledWarriors.find(w=>w.source===source)?.file||null);excludedWarriors=[];collapsedEditors=[];openTabs=[];welcomeDismissed=true;
 $('preset').value='94';$('preset').onchange();
 $('rounds').value='1';$('debugEnabled').checked=false;
 $('speed').value='3';$('speed').oninput();
 markDirty();editors();
 if($('tournamentTab').getAttribute('aria-selected')==='true')return;
 if(await load())resume();
}
$('demo').onclick=safe(()=>startDemo(demoSources));
$('randomDemo').onclick=safe(()=>{
 const pool=[...bundledWarriors];
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 return startDemo(pool.slice(0,2).map(w=>w.source));
});
$('multiDemo').onclick=safe(()=>startDemo(bundledWarriors.map(w=>w.source)));
$('dropZone').onclick=()=>$('warriorFiles').click();
$('dropZone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('warriorFiles').click();}};
$('warriorFiles').onchange=()=>{importFiles($('warriorFiles').files).catch(e=>status(e.message));$('warriorFiles').value='';};
for(const id of ['dropZone']){
 const zone=$(id);
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('dragging');};
 zone.ondragleave=()=>zone.classList.remove('dragging');
 zone.ondrop=e=>{e.preventDefault();e.stopPropagation();zone.classList.remove('dragging');$('dropOverlay').hidden=true;dragDepth=0;importFiles(e.dataTransfer.files).catch(err=>status(err.message));};
}
// The whole page is a drop target.
let dragDepth=0;
const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files');
window.addEventListener('dragenter',e=>{if(!hasFiles(e))return;dragDepth++;$('dropOverlay').hidden=false;});
window.addEventListener('dragleave',e=>{if(!hasFiles(e))return;dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('dropOverlay').hidden=true;});
window.addEventListener('dragover',e=>{if(hasFiles(e))e.preventDefault();});
window.addEventListener('drop',e=>{if(!hasFiles(e))return;e.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;importFiles(e.dataTransfer.files).catch(err=>status(err.message));});
for(const card of document.querySelectorAll('.demo-card'))card.onclick=()=>$(card.dataset.demo).click();
$('theme').onchange=()=>{
 setTheme($('theme').value);
 document.querySelectorAll('#editors .editor-title').forEach((row,i)=>{row.style.color=warriorColor(i);});
 display.redraw();legend();textViews();processChart.draw();scoreChart.draw();renderCenterTabs();scoreViewKey=null;if(latest)scores(latest);
};
$('pauseProcesses').onchange=()=>{if(latest)processIndicators(latest);};
$('pauseViews').onchange=()=>{syncTrace();if(latest)processIndicators(latest);};
$('clearConsole').onclick=event=>{event.preventDefault();event.stopPropagation();consoleText='';$('consoleOutput').textContent='';compileIssues=[];refreshDiagnostics();};
$('consoleWindow').ontoggle=()=>{if($('consoleWindow').open)$('consoleOutput').textContent=consoleText;};
$('consoleWindow').querySelector('summary').addEventListener('click',event=>{if(!event.target.closest('button'))event.preventDefault();});
setupSettings(markDirty);
processChart.clear();scoreChart.clear();

try{const saved=localStorage.getItem('pmars-editor-theme');if(['dark','light','contrast'].includes(saved))$('editorTheme').value=saved;}catch{}
try{const saved=localStorage.getItem('pmars-editor-syntax');if(['ocean','warm','mono'].includes(saved))$('editorSyntax').value=saved;}catch{}
$('editorTheme').onchange=$('editorSyntax').onchange=()=>{
 const name=$('editorTheme').value,syntax=$('editorSyntax').value;
 sourceEditors.forEach(editor=>editor.setTheme(name,syntax));
 try{localStorage.setItem('pmars-editor-theme',name);localStorage.setItem('pmars-editor-syntax',syntax);}catch{}
};
editors(); clearBattle();
function columnSplitter(id,panelId,name,min,max,viewportShare,direction){
 const bar=$(id),panel=$(panelId),key='pmars-'+name,prop='--'+name;
 const limit=width=>{
  const other=$(panelId==='sidebar'?'inspector':'sidebar').getBoundingClientRect().width;
  const room=$('app').clientWidth-other-560;
  return Math.round(Math.max(min,Math.min(max,room,innerWidth*viewportShare,width)));
 };
 const apply=(width,save)=>{
  width=limit(width);document.body.style.setProperty(prop,width+'px');bar.setAttribute('aria-valuenow',String(width));
  if(save)try{localStorage.setItem(key,String(width));}catch{}
  processChart.draw();scoreChart.draw();
 };
 bar.setAttribute('aria-valuemin',String(min));bar.setAttribute('aria-valuemax',String(max));
 try{const saved=Number(localStorage.getItem(key));if(saved)apply(saved,false);}catch{}
 bar.onpointerdown=event=>{
  if(event.button!==0)return;
  event.preventDefault();try{bar.setPointerCapture(event.pointerId);}catch{}
  const startX=event.clientX,start=panel.getBoundingClientRect().width;
  bar.classList.add('dragging');document.body.classList.add('resizing');
  bar.onpointermove=move=>apply(start+direction*(move.clientX-startX),false);
  bar.onpointerup=bar.onpointercancel=()=>{
   bar.onpointermove=bar.onpointerup=bar.onpointercancel=null;
   bar.classList.remove('dragging');document.body.classList.remove('resizing');
   apply(panel.getBoundingClientRect().width,true);
  };
 };
 bar.ondblclick=()=>{document.body.style.removeProperty(prop);try{localStorage.removeItem(key);}catch{}processChart.draw();scoreChart.draw();};
 bar.onkeydown=event=>{
  const step=event.shiftKey?64:16,delta={ArrowLeft:-step,ArrowRight:step}[event.key];
  if(!delta)return;
  event.preventDefault();apply(panel.getBoundingClientRect().width+direction*delta,true);
 };
}
columnSplitter('sidebarSplitter','sidebar','sidebar-w',180,560,.3,1);
columnSplitter('inspectorSplitter','inspector','inspector-w',260,900,.4,-1);

addConsole('cdb');addConsole('all');
activateInspector(consoles[0]);
renderCenterTabs();

// Popovers: one open at a time, closed by outside click or Escape.
const popovers=[['examplesBtn','examplesMenu'],['viewBtn','viewMenu'],['keyBtn','keyMenu'],['debugHelpBtn','debugHelp']];
function closePopovers(except){
 for(const [b,m] of popovers){if(m===except)continue;$(m).hidden=true;$(b).setAttribute('aria-expanded','false');}
 $('helpLinks').classList.remove('open');$('helpBtn').setAttribute('aria-expanded','false');
}
for(const [b,m] of popovers){
 $(b).onclick=event=>{event.stopPropagation();const open=$(m).hidden;closePopovers(m);$(m).hidden=!open;$(b).setAttribute('aria-expanded',String(open));};
 $(m).addEventListener('click',event=>{event.stopPropagation();if(event.target.closest('.menu button'))closePopovers();});
}
$('helpBtn').onclick=event=>{event.stopPropagation();const open=!$('helpLinks').classList.contains('open');closePopovers();$('helpLinks').classList.toggle('open',open);$('helpBtn').setAttribute('aria-expanded',String(open));};
document.addEventListener('click',()=>closePopovers());
// The cell key sits inline under the core when it fits on one line, otherwise behind the "? Cell key" button.
$('cellKeyInline').replaceChildren(...[...$('keyMenu').querySelector('.legend').children].map(node=>node.cloneNode(true)));
function fitCellKey(){
 const inline=$('cellKeyInline');
 inline.hidden=false;
 const fits=inline.clientWidth>0 && inline.scrollWidth<=inline.clientWidth;
 inline.hidden=!fits;$('keyBtn').parentElement.hidden=fits;
 if(fits)$('keyMenu').hidden=true;
}
new ResizeObserver(fitCellKey).observe(document.querySelector('.core-view .arena-foot'));

document.addEventListener('keydown',event=>{if(event.key==='Escape')closePopovers();});

// Phone bottom bar: Core | Code | Debug | Output.
function setPane(name){
 document.body.dataset.pane=name;
 for(const b of document.querySelectorAll('#phoneBar button'))b.setAttribute('aria-pressed',String(b.dataset.pane===name));
 if(name==='code'){if(activeEditor()<0 && sources.length)openWarrior(openTabs[0]??0);}
 else if(activeEditor()>=0)showCore();
 if(name==='debug')activateInspector(consoles.find(p=>p.select.value==='cdb'));
 if(name==='output')activateInspector('output');
 if(name==='core'){display.redraw();}
}
for(const b of document.querySelectorAll('#phoneBar button'))b.onclick=()=>setPane(b.dataset.pane);

tournaments=setupTournaments({
 roster:()=>selectedIndices().map(i=>({id:'roster-'+i,name:draftName(sources[i],i),file:sourceFiles[i]||warriorFilename(draftName(sources[i],i)),source:sources[i]})),
 readConfig:()=>readSettings({warriors:2}),
 onTab:index=>{if(index===1)$('tournamentSettingsSlot').append($('settingsDock'));else $('settingsDock').closest('#tournamentSettingsSlot')&&document.querySelector('.core-view .arena-foot').prepend($('settingsDock'));for(const [i,id] of ['emulatorTab','tournamentTab'].entries()){if(i===index)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');}if(index===1 && state==='running')pause();mode=index===1?'tournament':'battle';document.body.dataset.mode=mode;$('phoneBar').querySelector('[data-pane=core]').textContent=index===1?'Tournament':'Core';if(index===1 && ['debug','output'].includes(document.body.dataset.pane))setPane('core');editorVisibility();if(index===0 && activeEditor()<0){display.redraw();processChart.draw();scoreChart.draw();}}
});

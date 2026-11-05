// SPDX-License-Identifier: GPL-2.0-or-later
// The Trials game page: title screen, Academy map, stage card, editor, core view and Kettle's chat.
import {createEditor} from './dist/editor.mjs';
import {CoreDisplay, battleColor} from './display.mjs';
import {stages, wings, manual} from './trials-stages.mjs';
import {runStage, opponentName} from './trials-check.mjs';
import {kettleSvg, kettleIcon, setMood, setTalking} from './trials-kettle.mjs';

const $ = id => document.getElementById(id);
// Inside corewar.dev's Trials tab (trials.html?embed) the site's header already links the reference and the app.
if (window.parent !== window && new URLSearchParams(location.search).has('embed')) document.documentElement.dataset.embed = '';
$('titleKettle').innerHTML = kettleSvg({label: 'Kettle, the training robot'});
$('chatKettle').innerHTML = kettleSvg();
document.documentElement.style.setProperty('--kettle-icon', kettleIcon());
const avatar = () => $('chatKettle').firstElementChild;
$('titleKettle').addEventListener('click', () => setMood($('titleKettle').firstElementChild, 'happy', 1600));
const KEY = 'corewar-trials';
const byId = Object.fromEntries(stages.map(stage => [stage.id, stage]));

// Saved progress: {current, stages: {id: {cleared, stars, source, briefed, hints}}, chat: [[kind, text]]}.
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
const fresh = () => ({current: stages[0].id, stages: {}, chat: []});
let state = load();

const record = id => (state.stages[id] ??= {});
const unlocked = stage => { const i = stages.indexOf(stage); return i === 0 || !!state.stages[stages[i - 1].id]?.cleared; };
const kindLabel = stage => stage.kind === 'challenge' ? 'Challenge' : stage.kind === 'demo' ? 'Prologue' : 'Drill';

// ---- Kettle's chat ----------------------------------------------------------------------------
const escapeHtml = text => text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const format = text => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const kindOf = text => text.startsWith('▒') ? 'system' : 'kettle';
// Lines up to `flushed` skip the typing pause; clicking the chat or opening another stage flushes what is queued.
let queue = Promise.resolve(), queued = 0, flushed = 0;
function append(kind, text) {
  const li = document.createElement('li');
  li.className = kind; li.innerHTML = format(text);
  $('chatLog').append(li); li.scrollIntoView({block: 'nearest'});
}
function remember(kind, text) { state.chat.push([kind, text]); state.chat = state.chat.slice(-300); save(); }
// Lines arrive one by one, with a short pause that grows with their length. Clicking the chat skips the wait.
function say(lines, vars = {}, mood = '') {
  if (mood) queue = queue.then(() => setMood(avatar(), mood));
  for (const raw of lines) {
    const text = raw.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
    const seq = ++queued;
    queue = queue.then(async () => {
      const kind = kindOf(text);
      if (seq > flushed) {
        const typing = document.createElement('li');
        typing.className = 'typing'; typing.textContent = kind === 'system' ? '▒' : '…';
        $('chatLog').append(typing); typing.scrollIntoView({block: 'nearest'});
        if (kind === 'system') setMood(avatar(), 'static', 900); else setTalking(avatar(), true);
        await new Promise(resolve => setTimeout(resolve, Math.min(1600, 300 + text.length * 14)));
        typing.remove(); setTalking(avatar(), false);
      }
      append(kind, text); remember(kind, text);
    });
  }
  if (mood) queue = queue.then(() => setMood(avatar(), mood, 2500));
  return queue;
}
function divider(text) { queue = queue.then(() => { append('divider', text); remember('divider', text); }); }
$('chatLog').addEventListener('click', () => { flushed = queued; });

// ---- Stars ------------------------------------------------------------------------------------
// One convention for the map and the stage card: ✓ once the stage is cleared, then one star per optional goal,
// ★ when reached and ☆ while not yet. The tooltip spells the goals out.
function badge(stage) {
  const saved = state.stages[stage.id] ?? {}, stars = stage.stars ?? [];
  const title = [saved.cleared ? '✓ Cleared' : 'Not cleared yet',
    ...stars.map((star, i) => `${saved.stars?.[i] ? '★' : '☆'} ${star.text}${saved.stars?.[i] ? '' : ': not yet'}`)].join(' · ');
  const html = `<span class="check${saved.cleared ? '' : ' off'}">✓</span>` +
    stars.map((_, i) => `<span class="${saved.stars?.[i] ? 'on' : 'off'}">${saved.stars?.[i] ? '★' : '☆'}</span>`).join('');
  return {html, title, cleared: !!saved.cleared};
}

// ---- Map --------------------------------------------------------------------------------------
function renderMap() {
  const map = $('map'); map.replaceChildren();
  for (const wing of wings) {
    const section = document.createElement('section');
    section.className = 'wing' + (wing.locked ? ' locked' : '');
    section.innerHTML = `<h3>${escapeHtml(wing.title)}</h3>`;
    const list = document.createElement('ol');
    for (const stage of stages.filter(s => s.wing === wing.id)) {
      const item = document.createElement('li'), button = document.createElement('button');
      const saved = state.stages[stage.id] ?? {};
      button.type = 'button'; button.disabled = !unlocked(stage);
      if (stage.kind === 'challenge') button.classList.add('challenge');
      button.setAttribute('aria-current', String(stage.id === state.current));
      const marks = badge(stage);
      button.innerHTML = `<span class="num">${stage.id}</span><span class="label">${escapeHtml(stage.title)}</span><span class="state stars">${marks.cleared ? marks.html : button.disabled ? '🔒' : ''}</span>`;
      if (marks.cleared) button.title = marks.title;
      button.addEventListener('click', () => { open(stage); $('map').classList.remove('open'); });
      item.append(button); list.append(item);
    }
    if (wing.locked) section.insertAdjacentHTML('beforeend', `<p>${escapeHtml(wing.blurb)}</p>`);
    section.append(list); map.append(section);
  }
}
$('mapToggle').addEventListener('click', () => {
  const open = $('map').classList.toggle('open');
  $('mapToggle').setAttribute('aria-expanded', String(open));
});

// ---- Stage card and editor --------------------------------------------------------------------
let current = null, editor = null, running = null, display = null, marks = [];
function renderStars(stage) {
  const marks = badge(stage);
  $('stageStars').innerHTML = marks.html;
  $('stageStars').title = marks.title;
}
function renderSetups(states = []) {
  const box = $('stageSetups'); box.replaceChildren();
  if (current.setups.length < 2) return;
  current.setups.forEach((setup, i) => {
    const pill = document.createElement('span');
    pill.className = states[i] ?? '';
    pill.textContent = `Setup ${i + 1}: ${opponentName(setup)} at ${setup.label ?? '?'}${states[i] === 'pass' ? ' ✓' : states[i] === 'fail' ? ' ✗' : ''}`;
    box.append(pill);
  });
}
function open(stage) {
  if (running) running.abort = true;
  switchTerminal(current, stage);
  current = stage; state.current = stage.id; save();
  debug.engine = null;
  const saved = record(stage.id);
  $('stageKind').textContent = `${kindLabel(stage)} ${stage.id}`;
  $('stageKind').className = 'kind' + (stage.kind === 'challenge' ? ' challenge' : '');
  $('stageTitle').textContent = stage.title;
  $('stageGoal').textContent = stage.goal;
  const facts = [];
  if (stage.limits?.maxLength) facts.push(`At most ${stage.limits.maxLength} instruction${stage.limits.maxLength === 1 ? '' : 's'}`);
  if (stage.settings.rounds > 1) facts.push(`${stage.settings.rounds} rounds`);
  facts.push(`Core: ${stage.settings.coreSize.toLocaleString('en')} cells`);
  for (const star of stage.stars ?? []) facts.push(`★ ${star.text}`);
  $('stageFacts').innerHTML = facts.map(fact => `<li>${escapeHtml(fact)}</li>`).join('');
  renderStars(stage); renderSetups();
  const known = stages.slice(0, stages.indexOf(stage) + 1).flatMap(s => s.manual ?? []);
  $('manual').hidden = !known.length;
  $('manualList').innerHTML = known.map(key => `<dt>${escapeHtml(manual[key][0])}</dt><dd>${format(manual[key][1])}</dd>`).join('');
  editor?.destroy(); editor = null;
  $('editorBox').hidden = $('resetCode').hidden = $('hint').hidden = stage.kind === 'demo';
  if (stage.kind !== 'demo') {
    editor = createEditor($('editorBox'), {value: saved.source ?? stage.start ?? '', label: `${stage.title} source`, theme: 'dark',
      onChange: value => { record(stage.id).source = value; save(); }});
  }
  updateHintButton();
  $('next').hidden = !saved.cleared || !nextStage();
  $('result').hidden = true; $('progress').textContent = '';
  $('wingName').textContent = wings.find(w => w.id === stage.wing)?.title ?? '';
    display.configure(stage.settings.coreSize);
  showMarks(stage.setups[0]);
  renderMap();
  if (!saved.briefed) {
    flushed = queued; // Lines still typing from the last stage arrive at once.
    divider(`${kindLabel(stage)} ${stage.id} · ${stage.title}`);
    say(stage.briefing ?? []);
    saved.briefed = true; save();
  }
}
const nextStage = () => stages[stages.indexOf(current) + 1];
function updateHintButton() {
  const used = state.stages[current.id]?.hints ?? 0, total = current.hints?.length ?? 0;
  $('hint').disabled = used >= total;
  $('hint').textContent = `Hint ${Math.min(used + 1, total)}/${total}`;
}
$('hint').addEventListener('click', () => {
  const saved = record(current.id), used = saved.hints ?? 0;
  if (used >= (current.hints?.length ?? 0)) return;
  saved.hints = used + 1; save(); updateHintButton();
  say([current.hints[used]]);
});
$('resetCode').addEventListener('click', () => {
  if (!confirm('Replace your code with the starting code for this stage?')) return;
  delete record(current.id).source; save(); open(current);
});
$('next').addEventListener('click', () => { const next = nextStage(); if (next) open(next); });

// ---- Core view ---------------------------------------------------------------------------------
// Pulsing frames on the cells a drill is about: the target cells and where the dummy stands.
function showMarks(setup) {
  marks = [...(current.marks ?? []), ...(setup?.position != null ? [setup.position] : [])];
  placeMarks();
}
function placeMarks() {
  const box = $('marks'); box.replaceChildren();
  if (!display) return;
  const size = display.cellSize, columns = display.columns;
  for (const address of marks) {
    const mark = document.createElement('div');
    mark.className = 'mark';
    Object.assign(mark.style, {left: (address % columns) * size - 2 + 'px', top: Math.floor(address / columns) * size - 2 + 'px', width: size + 4 + 'px', height: size + 4 + 'px'});
    box.append(mark);
  }
}
new ResizeObserver(() => requestAnimationFrame(placeMarks)).observe($('viewport'));

// ---- Running a stage ---------------------------------------------------------------------------
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
// Normal speed starts slow enough to follow the first instructions and speeds up as the round goes on.
async function pace(run) {
  for (;;) {
    if (run.abort) throw new Error('stopped');
    const now = await nextFrame(), speed = $('speed').value;
    if (run.paused) {
      run.last = undefined; run.started += 1000 / 60;  // a pause does not count towards Normal's speed-up
      if (run.steps > 0) { const n = run.steps; run.steps = 0; run.stepped = true; return n; }
      continue;
    }
    if (speed === 'fast') return 100000;
    const elapsed = (now - run.started) / 1000, dt = Math.min(0.1, (now - (run.last ?? now)) / 1000);
    run.last = now;
    const rate = speed === 'slow' ? 6 : Math.min(200000, 12 * Math.pow(1.9, elapsed));
    run.budget = (run.budget ?? 1) + rate * dt;
    if (run.budget >= 1) { const n = Math.floor(run.budget); run.budget -= n; return n; }
  }
}
async function play({paused = false} = {}) {
  if (running) { running.abort = true; return; }
  const stage = current, source = editor ? editor.view.state.doc.toString() : '';
  const run = running = {started: performance.now(), paused, steps: 0};
  syncPause();
  const setupStates = stage.setups.map(() => '');
  let lastIndex = -1;
  $('run').textContent = '■ Stop'; $('result').hidden = true; $('next').hidden = true;
  const frame = async (update, {index, setup, engine}) => {
    if (current !== stage) throw new Error('stopped');  // another stage is open: drop this run, print nothing
    debug.engine = engine; debug.update = update; debug.stage = stage;
    if (index !== lastIndex) {
      if (lastIndex >= 0) setupStates[lastIndex] = 'pass';
      lastIndex = index; setupStates[index] = 'busy'; renderSetups(setupStates);
      display.configure(stage.settings.coreSize); showMarks(setup);
      run.started = performance.now(); run.last = undefined;
      if (stage.setups.length > 1 && $('debug').open) printText(`— Setup ${index + 1}${setup.label ? `: ${opponentName(setup)} at ${setup.label}` : ''} —\n`, 'addr');
    }
    if (update.events.length) display.apply(update.events);
    const rounds = stage.settings.rounds ?? 1;
    $('progress').textContent = [rounds > 1 ? `Round ${Math.min(update.round + 1, rounds)} of ${rounds}` : '',
      `cycle ${update.cycle.toLocaleString('en')}`, stage.setups.length > 1 ? `setup ${index + 1} of ${stage.setups.length}` : ''].filter(Boolean).join(' · ');
    // While paused, the engine records each instruction it runs, so Step can say who ran what.
    if (engine.traced !== !!run.paused) { engine.setTrace(!!run.paused); engine.traced = !!run.paused; }
    if (run.stepped) {
      run.stepped = false;
      for (const entry of update.trace) {
        const who = entry.warrior === 0 ? 'you' : update.warriors[entry.warrior].name;
        print(`<span class="addr">cycle ${update.cycle.toLocaleString('en')} ·</span> <span style="color:${battleColor(entry.warrior)}">${escapeHtml(who)}</span> ran ${String(entry.address).padStart(3, '0')}: ${escapeHtml(entry.instruction.trimEnd())}\n`);
      }
      if (!update.done) listAt(update.warriors[0].pc >= 0 ? update.warriors[0].pc - 2 : 0, 5);
      else printText(`Over at cycle ${update.cycle.toLocaleString('en')}: ${update.warriors[0].wins ? 'you won' : update.warriors[0].losses ? 'you lost' : 'a tie'}.\n`);
    }
    return update.done ? 0 : pace(run);
  };
  try {
    const result = await runStage(stage, source, {frame});
    if (current !== stage) return;
    if (result.passed) setupStates.fill('pass');
    else if (result.reason === 'goal' && lastIndex >= 0) setupStates[lastIndex] = 'fail';
    renderSetups(setupStates);
    finish(stage, result);
  } catch (error) {
    if (error.message !== 'stopped') { showResult(false, 'Something went wrong.', error.message); console.error(error); }
  } finally {
    if (running === run) running = null;
    $('run').textContent = '▶ Run'; syncPause();
  }
}
$('run').addEventListener('click', () => play());

// ---- Debugger ----------------------------------------------------------------------------------
// The panel works on the engine of the current or last run: Pause and Step drive the run, clicking a cell
// lists the core from there, and other commands go to pMARS's own debugger, cdb.
const debug = {engine: null, update: null, stage: null};
// Each stage has its own debugger log, kept while the page is open, so output never leaks between stages.
const terminals = new Map(), TERM_INTRO = $('term').innerHTML;
function switchTerminal(from, to) {
  if (from) terminals.set(from.id, $('term').innerHTML);
  if (from === to) return;
  $('term').innerHTML = terminals.get(to.id) ?? TERM_INTRO;
  $('term').scrollTop = $('term').scrollHeight;
  $('cmd').value = '';
}
const TERM_LIMIT = 64 * 1024;
function print(html) {
  const term = $('term');
  term.insertAdjacentHTML('beforeend', html);
  if (term.innerHTML.length > TERM_LIMIT) term.innerHTML = term.innerHTML.slice(-TERM_LIMIT / 2).replace(/^[^\n]*\n/, '');
  term.scrollTop = term.scrollHeight;
}
const printText = (text, cls = '') => print(cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text));
function syncPause() {
  $('pause').textContent = running?.paused ? 'Resume' : 'Pause';
  $('pause').disabled = !running;
}
function pauseRun() { if (running && !running.paused) { running.paused = true; syncPause(); } }
$('pause').addEventListener('click', () => {
  if (!running) return;
  running.paused = !running.paused; syncPause();
  if (running.paused) printText('Paused at cycle ' + (debug.update?.cycle ?? 0).toLocaleString('en') + '.\n');
});
$('step').addEventListener('click', () => {
  $('debug').open = true;
  if (!running) { play({paused: true}); printText('Loaded. Step again to run the first instruction.\n'); return; }
  pauseRun(); running.steps += 1;
});
syncPause();
$('clearTerm').addEventListener('click', () => { $('term').textContent = ''; });

// The owner colour of a cell is the warrior that wrote it last, as the core view shows it.
function ownerOf(address) {
  for (let q = 0; q < 4; ++q) { const owner = display.cells[address * 4 + q]; if (owner) return owner - 1; }
  return -1;
}
function listAt(start, count = 10) {
  const {engine, update, stage} = debug;
  if (!engine) { printText('Run the stage first, then click the core.\n'); return; }
  const size = stage.settings.coreSize, names = update.warriors.map((w, i) => i === 0 ? 'you' : w.name);
  const lines = [];
  for (let i = 0; i < count; ++i) {
    const address = ((start + i) % size + size) % size, owner = ownerOf(address);
    const pcs = update.warriors.flatMap((w, j) => w.pc === address && w.tasks ? [names[j]] : []);
    const text = escapeHtml(engine.inspect(address).trimEnd());
    const relative = address > size / 2 ? address - size : address;
    lines.push(`<span class="addr">${String(address).padStart(String(size - 1).length, '0')} ${('(' + (relative > 0 ? '+' : '') + relative + ')').padEnd(7)}</span>` +
      (owner >= 0 ? `<span style="color:${battleColor(owner)}">${text}</span>` : text) +
      (pcs.length ? `<span class="pc">  ← next: ${escapeHtml(pcs.join(', '))}</span>` : ''));
  }
  print(lines.join('\n') + '\n');
}
$('core').addEventListener('click', event => {
  const address = display.addressAt(event);
  if (address === null) return;
  $('debug').open = true; pauseRun();
  printText(`list ${address}\n`, 'cmdline'); listAt(address);
});
$('core').addEventListener('mousemove', event => {
  const address = display.addressAt(event);
  $('hoverCell').textContent = address === null ? '' : `cell ${address}`;
});
$('core').addEventListener('mouseleave', () => { $('hoverCell').textContent = ''; });

let cdbBusy = false;
$('cmdForm').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('cmd').value.trim(); $('cmd').value = '';
  if (!text || cdbBusy) return;
  printText(`(cdb) ${text}\n`, 'cmdline');
  const {engine} = debug;
  if (!engine) { printText('Run the stage first. Step loads it without running.\n'); return; }
  pauseRun();
  cdbBusy = true;
  try {
    // cdb prints its own prompt; the panel already shows the command. Paged output ("RET for more") is shown in full.
    const result = await engine.debuggerCommand(text, {output: chunk => printText(chunk.replace(/\(cdb\) /g, '')),
      input: prompt => Promise.resolve(/more/i.test(prompt ?? '') ? 'a' : null)});
    if (result.action === 2) {
      if (running) running.steps += result.steps; else printText('The run is over. Press Step or Run to start again.\n');
    } else if ((result.action === 0 || result.action === 1) && running) { running.paused = false; syncPause(); }
  } catch (error) { printText(error.message + '\n', 'err'); }
  finally { cdbBusy = false; }
});

function showResult(passed, title, detail = '', pre = '') {
  const box = $('result');
  box.className = 'result ' + (passed ? 'pass' : 'fail'); box.hidden = false;
  box.innerHTML = `<strong>${escapeHtml(title)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}${pre ? `<pre>${escapeHtml(pre)}</pre>` : ''}`;
}
const retorts = ['Not quite.', 'Data, not failure.', 'Again.', 'Close. Probably.', 'Hm.'];
function finish(stage, result) {
  const saved = record(stage.id);
  const score = (stage.settings.rounds ?? 1) > 1 ? ` ${result.wins} wins, ${result.ties} ties, ${result.losses} losses.` : '';
  if (!result.passed) {
    saved.fails = (saved.fails ?? 0) + 1; save();
    if (result.reason === 'assembly') {
      showResult(false, 'Kettle could not read that.', 'Check the spelling of each instruction.', result.message);
      say(['My parser choked on that. What it said is under the core.'], {}, 'worried');
    } else {
      showResult(false, result.reason === 'limit' ? 'Too long.' : 'Not yet.', result.message + score);
      const lines = [`${retorts[saved.fails % retorts.length]} ${result.message}`];
      if (saved.fails === 2 && !(saved.hints > 0) && stage.hints?.length) lines.push('If you want a hint, ask. Pride is a fine thing, but it does not compile.');
      say(lines, {}, 'worried');
    }
    return;
  }
  const first = !saved.cleared;
  saved.cleared = true;
  saved.stars = (result.stars ?? []).map((star, i) => star || !!saved.stars?.[i]);
  save();
  const earned = result.stars?.filter(Boolean).length ?? 0, possible = stage.stars?.length ?? 0;
  showResult(true, stage.kind === 'demo' ? 'Handshake complete.' : 'Cleared!',
    stage.kind === 'demo' ? '' : `${result.length} instruction${result.length === 1 ? '' : 's'}.${score}${possible ? ' ' + (stage.stars.map((star, i) => `${result.stars[i] ? '★' : '☆'} ${star.text}${result.stars[i] ? '' : ' (not yet)'}`).join(' · ')) : ''}`);
  renderStars(stage); renderMap();
  $('next').hidden = !nextStage();
  const missed = (stage.stars ?? []).flatMap((star, i) => !result.stars?.[i] && star.missed ? [star.missed] : []);
  if (first) say([...(stage.debrief ?? []), ...missed], result, 'happy').then(() => { if (!nextStage()) say(['▒ END OF THE DRAFT · MORE WINGS SOON ▒']); });
  else say([earned === possible ? 'Cleared again. The logs are getting long.' : 'Cleared again.'], {}, 'happy');
}

// ---- Screens -----------------------------------------------------------------------------------
function startGame() {
  document.body.dataset.screen = 'game';
  $('title').hidden = true; $('game').hidden = false;
  if (!display) { display = new CoreDisplay($('core')); display.setCellSize(0); }
  $('chatLog').replaceChildren();
  for (const [kind, text] of state.chat) append(kind, text);
  open(byId[state.current] ?? stages[0]);
}
function showTitle() {
  if (running) running.abort = true;
  document.body.dataset.screen = 'title';
  $('game').hidden = true; $('title').hidden = false;
  const cont = $('continueGame');
  cont.hidden = !state;
  $('newGame').classList.toggle('primary', !state);
  if (state) cont.textContent = `Continue · ${byId[state.current]?.title ?? ''}`;
}
$('continueGame').addEventListener('click', startGame);
$('newGame').addEventListener('click', () => {
  if (state && Object.keys(state.stages).length && !confirm('Start a new game? Your progress in this browser will be erased.')) return;
  state = fresh(); save(); startGame();
});
$('toTitle').addEventListener('click', showTitle);
showTitle();

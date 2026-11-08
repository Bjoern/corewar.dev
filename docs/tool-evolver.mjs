// SPDX-License-Identifier: GPL-2.0-or-later
// Warrior evolver view of the Tools tab. Genomes and operators: evolver-genome.mjs; the search:
// evolver-run.mjs, run by evolver-worker.mjs off the page's thread; presets and their benchmarks:
// evolver-presets.mjs. Scoring is the constant optimizer's (optimizer-fitness.mjs).
import {el} from './tools.mjs';
import {EVOLVER_PRESETS,CUSTOM_FIELDS,checkCustom,suiteFits,suiteHill,sameHill,splitWarriors} from './evolver-presets.mjs';
import {EVOLVER_DEFAULTS,RESULT_RADIUS,evolvedSource,runNotes} from './evolver-run.mjs';
import {profileDistance} from './population.mjs';
import {matchConfig,scoringMode,plannedEngine} from './optimizer-fitness.mjs';
import {benchmarkCatalog} from './benchmark-catalog.mjs';
import {readBenchmark} from './benchmarks.mjs';
import {describeSettings} from './tournaments.mjs';
import {warriorFilename} from './warrior-files.mjs';
import {genomeRules,renderInstruction,redcodeHeader,nicheGroups} from './evolver-genome.mjs';
import {mapLayout} from './evolver-map.mjs';

const STEPS=[
 'Pick a preset (the nano hill is quick) and the benchmark to challenge. Add your own opponents if you like.',
 'Start from random code, from a Markov chain of the benchmark’s warriors, or seed the population with a warrior of yours.',
 'Press Start. The best score and the chart update after every generation; pause, continue or stop at any time. A strong warrior is often a lucky run, so try several random seeds (see Runs and luck).',
 'Copy the best warrior, open it in the editor, or step through a round against one opponent in the debugger.'
];
const TOPICS=[
 ['What it does','The evolver breeds whole warriors. Each generation, parents chosen by tournament are crossed over (two-point on the instruction lists, or instruction by instruction) and mutated: opcodes, modifiers, addressing modes and fields change, and instructions are inserted, deleted, duplicated or swapped. Parents and children compete for the next generation; the best are always kept, and a few random immigrants keep the population from settling too early.'],
 ['Valid warriors','Every warrior the evolver writes has 1 to the maximum length of instructions, fields inside the core and ICWS ’94 instructions. It leaves out LDP and STP: P-space keeps state between rounds, so a warrior’s result would depend on the order its rounds are played in, and the score would no longer be one clear number to improve.'],
 ['Scores','Each warrior fights each opponent one on one: 3 points per win, 1 per tie, shown as (3W + T) per round × 100 and averaged over the opponents. 100 means all ties, 300 all wins. Small cores (nano, tiny with few positions) are scored exactly, over every legal start position with both starting orders; bigger cores are sampled on seeded positions that change every few generations, so a warrior cannot just fit one set of positions.'],
 ['Mutation settings','Mutations per child is the mean number of point changes (at least one). Structural share is how many of those insert, delete, duplicate or swap instructions or move the start. Crossover is the share of children with two parents. Immigrants are random new warriors per generation.'],
 ['Niching','Without niching, near-copies of the leader soon fill the population and the search narrows to one idea. With niching (clearing), the next generation is filled best first, but a warrior within the niche radius of a better one (0.3: differs in under 30% of opcodes, modifiers, modes and fields, instruction by instruction) only gets in while that niche has fewer than “Warriors per niche”; the others wait at the back and only fill places left over. So the best of each kind of warrior survives even when it scores below the leader’s copies. The elite are always kept. Niches is how many kinds the population holds. A radius of 0 turns it off; a bigger radius or fewer warriors per niche spreads the population wider.'],
 ['Shared fitness and niches by results','Two optional settings for when one kind of warrior takes over. “Selection by: shared score” (results-based fitness sharing) weighs each opponent by how hard the population finds it: points against an opponent most warriors already beat count for little, points against one that hardly anyone scores against count for a lot, and the more copies of one kind there are, the less what they beat is worth. Parents and survivors are picked by that shared value, so a specialist that beats what the rest lose to survives even with a lower plain score. The shared value only means something within one population, so the best score, the chart, the elite and everything you see stay the plain score. Racing is off with it, as a child below the weakest score may still be worth keeping. “Compare warriors by: results” makes niching (and crowding) compare what two warriors score against each opponent instead of their code: two warriors are in one niche when their results are alike, however different the code, and two near-identical programs that beat different opponents are not. The radius is then the mean difference in points per opponent over the most there can be (300): 0.15 means about 45 points per opponent. Sampled scores make even two copies of one warrior differ a little (about 0.08 at 40 rounds per opponent), so more rounds make these niches sharper. The population view then rings and groups niches by results too, while the map still places warriors by code.'],
 ['Compare with known warriors','“Compare with known warriors” checks whether the best warrior is something new or a known engine rebuilt: a Markov chain of the opponents, or a seed, can lead a run back to one, often with new constants, lines in another order and dead code around it, and its score then says little about the evolver. First a short solo run marks which of its instructions actually run; only those are compared, so leftovers that never execute cannot hide a match (the status line says which ran). They are compared with the benchmark, your opponents and warriors, and the library’s hills with the same settings, as assembled code, so labels, EQUs and layout make no difference, and one instruction repeated in a row (DAT filler) counts once. The comparison finds the best-matching block in each known warrior (a local alignment): identical instructions count most, then the same wiring (same opcode, modifier and modes, and the same fields where they point into the warrior, only far constants differing), then the same shape (other fields); a few lines added, removed or moved still align. Covered is the share of the code that runs matched at the same shape or closer. 80% identical is a copy, 80% covered the same design with other constants, half or more a partial match. When several known warriors hold the same code, it is a common engine (many LP papers share one loop), which the status line says. It compares code, not behaviour: a warrior that works like a known one with different code is not found. The Similar warriors tool does the same for any warrior, against every library hill too, and shows the matching code side by side.'],
 ['Self fight','Some hills, Koenigstuhl among them, score a warrior against a copy of itself too. With “Self fight” on, each warrior fights itself as one more opponent, so with 50 benchmark warriors the self fight is 1 of 51 in the average (in the held-out score as well). A self fight has as many wins as losses (exactly so with exact scoring), so its score depends only on the ties: 150 when no round is tied, 100 when every round is, 150 − 50 × the tied share in between. So a warrior whose self fights end decisively gains up to 50 points there over one that ties itself, and selection takes that into account. It is the row “itself (self fight)” in the score per opponent.'],
 ['Breeding and survival','The evolver and the constant optimizer’s genetic algorithm share one population search, each with its own defaults. The evolver breeds whole generations (μ + λ): a child per place, then parents and children compete for the places, by score with niching (clearing). One child at a time (steady state) breeds from the latest population after every warrior instead; it adapts sooner but scores one warrior at a time, so with fewer opponents than CPU cores it leaves cores idle. Crowding (the optimizer’s default) lets a child replace the most similar weaker warrior, so each kind of warrior competes only with its own kind; the niche radius is then not used. With sampled scores, every few generations the warriors fight on new positions: “latest placements” takes the new score, “average over placements” the mean of all positions a warrior fought on, which is steadier and counts a warrior as the best only once it was scored on two sets. Racing stops scoring a child once it is clearly below the weakest warrior (sampled scores only); it saves time but also cuts short children that might have started a new niche.'],
 ['Runs and luck','A blind run (random code, no seed) on the nano hill needs a few thousand generations before it levels off, which is why the nano preset runs 3000: about 300,000 warriors scored at population 100, a quarter of an hour to an hour depending on your CPU cores. Even then a strong warrior is a lucky run. In tests against the nano top 50, about 1 run in 10 found one of the best kinds of warrior; the others settled 10 to 25 points lower, and a larger population did not change that. So rather than one very long run, run several with different random seeds (under More settings) and keep the best; a run that has not improved for a thousand generations seldom does. Stopping at 200 generations leaves a blind nano run about 10 points below where it would end.'],
 ['Seeding','A seed warrior is assembled for the chosen settings (labels, EQU and FOR loops are fine) and joins the first population with mutants of it; the rest is random code. “The last run” continues from the population the last run ended with, for the same settings.'],
 ['Markov chain','“A Markov chain of the opponents” assembles the benchmark’s warriors (and yours) and counts how often each instruction shape (opcode, modifier and both addressing modes) follows the one and two before it, and which shapes start and end a warrior. New warriors are drawn from those odds, each instruction with an A and B field seen on that shape. The chain mostly follows the longest context it knows and now and then forgets one, so it recombines warriors rather than copying them. It writes the first population and the immigrants of every generation.'],
 ['Benchmarks','The benchmark list has the preset’s own picks first, then every other suite of the Tournaments tab’s Benchmark mode with the same core size and a length that fits: built-in suites, and your own: imported, or made from your warriors or the library (saved with your workspace). Under “Other hills” come the suites made for other settings (ICWS ’94 only, as the evolver writes no ’88 code): picking one switches to its settings, to the preset with the same core, processes, cycles, length and distance, or to Custom with its values. When that would replace custom settings of your own, the evolver asks first. Population, generations and rounds then take the new preset’s defaults, as when you pick a preset, unless you changed them from the old preset’s defaults: values of your own are kept. Reset to defaults always sets them. An opponent that does not assemble for the hill’s settings (your own, or one checked in the Battle tab) is left out when the run starts, as in the Tournaments tab, and the Run card lists it with the assembler’s message.'],
 ['Warrior length','The longest warrior the evolver writes, at most the hill’s maximum length (empty: the hill’s). The hill’s length and distance still hold for the matches, so a benchmark of full-length warriors can be fought by short evolved ones: the best 20-instruction warrior against the LP hill, to build on later (add a q-scan by hand, say), or entries for a tournament that caps length below the hill’s. Shorter warriors also mean a much smaller search space. With a Markov chain, the chain learns from the opponents’ first instructions only, up to the warrior length.'],
 ['Diversity','Parents are picked by small tournaments (3 at a time), so weaker warriors still breed; children that copy a warrior already in the population are dropped; niching keeps near-copies of one warrior from crowding out the rest (see Niching); immigrants bring new code every generation; and with sampled scores the positions change every few generations. The Diversity figure is how unlike the population is from its best warrior (0 = clones, 1 = nothing in common): when it falls near 0 the run has converged, and more immigrants, more mutations or a new seed help.'],
 ['Held-out opponents','“Hold out opponents to check for overfitting” sets a share of the opponents aside, picked by the random seed (same seed, same split). They never count for selection or for the Markov chain. Whenever the best warrior changes, it is also scored against them: the Held-out score in the stats, “held out” in the chart and the marked rows of the score per opponent. If the best score keeps rising while the held-out score stays flat or falls, the run is fitting the benchmark’s particular warriors rather than getting stronger in general: broaden the benchmark or start over from the population. Held-out warriors are usually more different from the training set than the hill’s next arrivals, so expect the held-out score to sit below the best.'],
 ['Population view','“Population and niches” shows one generation at a time: the slider steps back through the run (the page keeps a snapshot of every generation, thinning older ones on long runs). On the map, each dot is a warrior and similar code sits close together; the colour is its score, darker is lower, and ringed dots lead a niche. Below, one row per niche: how many warriors it holds, its best and mean score and its leader’s code. Click a row or a dot to see the code. The small chart shows niches and diversity over the whole run. The view only works while it is open, once per generation, and the battles run in other threads, so it does not slow the run.'],
 ['Names and comments','Each warrior the evolver writes is named after its run and generation: <run name>-g<generation>, with -<place> added for one taken from the population view. Set the run name under Evolution; empty, it is the preset and the date and time the run started (nano-20261108-1432). The ;strategy lines, which hills show, say the run, the generation, the score and the held-out score. Plain comments below them record how the warrior was made: when and with which release of corewar.dev, how the run started, the random seed, the hill, the benchmark (opponents, held-out share, scoring) and the search settings, with any that differ from the defaults. A run that continues the last run’s population lists every run before it, with its name, generations and population, so a warrior’s history stays traceable though each run counts generations from 0. Assemblers skip all of these comments.'],
 ['Off the page’s thread','The search runs in a Web Worker, and the battles in one more worker per CPU core, so the page stays responsive. Battles run on exMARS, the engine the constant optimizer uses.'],
];
const fmt=(n,d=1)=>n===null||n===undefined||!isFinite(n)?'—':Number(n).toFixed(d);
const clock=ms=>{const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
function download(text,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const configKey=c=>[c.coreSize,c.cycles,c.tasks,c.maxLength,c.distance].join('/');
// The last population belongs to a hill and a warrior length (the hill's own length keeps the old key).
const populationKey=(c,length)=>configKey(c)+(length<c.maxLength?'/L'+length:'');
const hillText=c=>`core ${c.coreSize} · ${c.tasks} process${c.tasks===1?'':'es'} · ${c.cycles} cycles · length ${c.maxLength} · distance ${c.distance}`;

export function mount(root,{roster,addWarrior,openInEditor,openInDebugger,loadState,saveState,benchmarks,loadBenchmark}){
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
 // The evolved warriors' length: at most the hill's, which still limits the opponents.
 const warriorLength=el('input',{type:'number',min:1,max:1000,step:1,value:saved.warriorLength??'',placeholder:'hill max'});
 const lengthHint=el('span',{className:'hint'});
 const suiteSelect=el('select',{});
 const suiteInfo=el('p',{className:'hint'});
 const useRoster=el('input',{type:'checkbox',checked:!!saved.useRoster});
 // Held-out opponents: set aside by the random seed, never used for selection, to check for overfitting.
 const holdOut=el('input',{type:'checkbox',checked:!!saved.holdOut});
 // Self fight: each warrior also fights a copy of itself, as one more opponent (Koenigstuhl counts it).
 const selfFight=el('input',{type:'checkbox',checked:!!saved.selfFight});
 const holdOutShare=num(saved.holdOutShare??0.2,{min:0.05,max:0.5,step:0.05});
 // Opponents of your own, pasted or loaded from files, kept between visits.
 let own=Array.isArray(saved.own)?saved.own.filter(w=>typeof w?.source==='string').slice(0,50):[];
 const pasteBox=el('textarea',{className:'evo-paste',spellcheck:false,placeholder:';name My opponent\nmov 0, 1\n\nPaste one or more warriors (each starting with ;redcode, or ending with END).'});
 const addPasted=el('button',{type:'button',className:'small',textContent:'Add pasted'});
 const fileInput=el('input',{type:'file',multiple:true,accept:'.red,.txt,.rc,text/plain',hidden:true});
 const addFiles=el('button',{type:'button',className:'small',textContent:'Add files…'});
 const ownList=el('ul',{className:'evo-own'});
 const ownBox=el('details',{className:'opt-advanced',open:!!own.length},el('summary',{textContent:'Your benchmark warriors'}),
  el('p',{className:'hint',textContent:'They fight alongside the benchmark, or alone when the benchmark is “Only your warriors”.'}),
  pasteBox,el('div',{className:'tool-actions'},addPasted,addFiles,fileInput),ownList);
 // Opponents that don't assemble for the hill are left out of the run, listed here.
 const excludedBox=el('div',{className:'tournament-exclusions',role:'alert',hidden:true});
 // ---- seed
 const seedSelect=el('select',{},new Option('Random code','random'),new Option('A warrior from the Battle tab','roster'),new Option('A pasted warrior','paste'),new Option('A Markov chain of the opponents','markov'),new Option('The last run’s population','last'));
 seedSelect.value=saved.seedMode||'random';
 const rosterSeed=el('select',{});
 const seedText=el('textarea',{className:'evo-paste',spellcheck:false,value:saved.seedText||'',placeholder:';name Seed\nspl 0\nmov 0, 1'});
 const seedShare=num(saved.seedShare??EVOLVER_DEFAULTS.seedShare,{min:0,max:1,step:0.05});
 const seedHint=el('p',{className:'hint'});
 // ---- evolution
 const startDefaults=(EVOLVER_PRESETS.find(p=>p.id===presetSelect.value)??EVOLVER_PRESETS[0]).defaults;
 const population=num(saved.population??startDefaults.population,{min:4,max:500,step:1});
 const generations=num(saved.generations??startDefaults.generations,{min:0,max:100000,step:10});
 const mutation=num(saved.mutation??EVOLVER_DEFAULTS.mutation,{min:1,max:10,step:0.1});
 const structural=num(saved.structural??EVOLVER_DEFAULTS.structural,{min:0,max:1,step:0.05});
 const crossoverRate=num(saved.crossover??EVOLVER_DEFAULTS.crossover,{min:0,max:1,step:0.05});
 const immigrants=num(saved.immigrants??EVOLVER_DEFAULTS.immigrants,{min:0,max:0.5,step:0.01});
 const elite=num(saved.elite??EVOLVER_DEFAULTS.elite,{min:0,max:50,step:1});
 const niche=num(saved.niche??EVOLVER_DEFAULTS.niche,{min:0,max:1,step:0.05});
 const nicheSize=num(saved.nicheSize??EVOLVER_DEFAULTS.nicheSize,{min:1,max:50,step:1});
 const choose=(options,value,fallback)=>{const s=el('select',{},...options.map(([v,label])=>new Option(label,v)));s.value=options.some(([v])=>v===value)?value:fallback;return s;};
 const schemeSelect=choose([['generational','Whole generations (μ + λ)'],['steady','One child at a time (steady state)']],saved.scheme,EVOLVER_DEFAULTS.scheme);
 const survivalSelect=choose([['clearing','Niches (clearing)'],['crowding','Crowding: replace the most similar weaker warrior']],saved.survival,EVOLVER_DEFAULTS.survival);
 const memorySelect=choose([['latest','Latest placements'],['mean','Average over placements']],saved.scoreMemory,EVOLVER_DEFAULTS.scoreMemory);
 const race=el('input',{type:'checkbox',checked:saved.race??EVOLVER_DEFAULTS.race});
 const fitnessSelect=choose([['plain','score'],['shared','shared score (fitness sharing)']],saved.fitness,EVOLVER_DEFAULTS.fitness);
 const nicheBySelect=choose([['code','code'],['results','results against each opponent']],saved.nicheBy,EVOLVER_DEFAULTS.nicheBy);
 // Racing compares plain scores, so it is off while selection uses the shared score.
 const showFitness=()=>{race.disabled=fitnessSelect.value==='shared'||!!run&&run.state!=='finished';};
 fitnessSelect.addEventListener('change',showFitness);
 // The radius means something else for each: switching swaps a radius still at the other one's default.
 nicheBySelect.addEventListener('change',()=>{
  const [from,to]=nicheBySelect.value==='results'?[EVOLVER_DEFAULTS.niche,RESULT_RADIUS]:[RESULT_RADIUS,EVOLVER_DEFAULTS.niche];
  if(Number(niche.value)===from)niche.value=to;
 });
 const scoringSelect=el('select',{},new Option('Exact when possible','auto'),new Option('Always sampled','sampled'));scoringSelect.value=saved.scoring||'auto';
 const rounds=num(saved.rounds??startDefaults.rounds??100,{min:10,max:5000,step:10});
 const processors=Math.max(1,navigator.hardwareConcurrency||2);
 const workers=num(saved.workers??Math.max(1,processors-1),{min:1,max:processors,step:1});
 const seed=el('input',{value:saved.seed??'1',maxLength:40,size:6});
 // The run's name, which the warriors' names start with; empty: the preset and the start time.
 const runName=el('input',{value:saved.runName??'',maxLength:40,size:16,placeholder:'preset-date-time'});
 const nicheFields=field(...labelled('evoNiche','Niche radius',niche),...labelled('evoNicheSize','Warriors per niche',nicheSize),el('span',{className:'hint',textContent:'radius 0 = no niching'}));
 const showNiche=()=>{nicheFields.hidden=survivalSelect.value!=='clearing';};survivalSelect.addEventListener('change',showNiche);showNiche();
 const params=el('div',{className:'tool-form'},
  field(...labelled('evoPopulation','Population',population),...labelled('evoGenerations','Generations',generations),el('span',{className:'hint',textContent:'0 = until stopped'})),
  field(...labelled('evoMutation','Mutations per child',mutation),...labelled('evoCrossover','Crossover rate',crossoverRate)),
  el('details',{className:'opt-advanced',open:!!saved.advancedOpen},el('summary',{textContent:'More settings'}),
   el('div',{className:'tool-form'},
    field(...labelled('evoStructural','Structural share',structural),...labelled('evoImmigrants','Immigrants',immigrants),...labelled('evoElite','Elite',elite)),
    field(...labelled('evoScheme','Breeding',schemeSelect),...labelled('evoSurvival','Survival',survivalSelect)),
    nicheFields,
    field(...labelled('evoFitness','Selection by',fitnessSelect),...labelled('evoNicheBy','Compare warriors by',nicheBySelect)),
    field(...labelled('evoScoring','Scoring',scoringSelect),...labelled('evoRounds','Sampled rounds per opponent',rounds)),
    field(...labelled('evoMemory','Scores on new placements',memorySelect),el('label',{},race,' Racing: drop children clearly below the weakest')),
    field(...labelled('evoSeed','Random seed',seed),el('span',{className:'hint',textContent:'same seed, same run'})))),
  field(...labelled('evoWorkers','CPU cores',workers),el('span',{className:'hint',textContent:`of ${processors}; each runs one battle at a time`})),
  field(...labelled('evoRunName','Run name',runName),el('span',{className:'hint',textContent:'warriors are named <run name>-g<generation>'})));
 // Back to the defaults: this card's settings, with population, generations and rounds from the preset.
 const resetEvolution=el('button',{type:'button',className:'small',textContent:'Reset to defaults'});
 params.append(el('div',{className:'tool-actions'},resetEvolution));
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
 const checkBest=el('button',{type:'button',textContent:'Compare with known warriors'});
 const similarStatus=el('p',{className:'hint',role:'status'});
 const similarTable=el('table',{className:'tool-table'});
 const similarBox=el('details',{className:'opt-opponents-box',hidden:true,open:true},el('summary',{textContent:'Closest known warriors'}),el('div',{className:'tool-table-wrap'},similarTable));
 // ---- population view
 const popSlider=el('input',{type:'range',min:'0',max:'0',value:'0',step:'1',ariaLabel:'Generation shown'});
 const popLatest=el('button',{type:'button',className:'small',textContent:'Latest'});
 const popLabel=el('p',{className:'hint',role:'status',textContent:'Start a run to see its population.'});
 const popMap=el('canvas',{className:'evo-map',ariaLabel:'Map of the population: similar warriors sit close together'});
 const popHistory=el('canvas',{className:'evo-history',ariaLabel:'Niches and diversity per generation'});
 const nicheTable=el('table',{className:'tool-table evo-niches'});
 const popCode=el('pre',{className:'evo-pop-code',hidden:true});
 const popEdit=el('button',{type:'button',className:'small',textContent:'Open in editor',hidden:true});
 const popBox=el('details',{className:'opt-advanced evo-population',open:!!saved.populationOpen},el('summary',{textContent:'Population and niches'}),
  el('div',{className:'tool-actions'},popSlider,popLatest),popLabel,popMap,
  el('p',{className:'hint',textContent:'Each dot is a warrior; similar code sits close together. Colour: score (darker is lower). Ringed: niche leaders. Click a dot or a row for its code.'}),
  popHistory,el('div',{className:'tool-table-wrap'},nicheTable),popCode,popEdit);
 const help=el('details',{className:'tool-help',open:!saved.helpClosed},el('summary',{textContent:'How to use the evolver'}),
  el('ol',{className:'tool-steps'},...STEPS.map(s=>el('li',{textContent:s}))),
  el('div',{className:'tool-topics'},...TOPICS.map(([h,body])=>el('details',{},el('summary',{textContent:h}),el('p',{textContent:body})))));
 root.append(help,el('div',{className:'opt-layout'},
  el('div',{className:'opt-main'},
   el('section',{className:'t-card'},el('h3',{textContent:'Settings and benchmark'}),
    el('div',{className:'tool-form'},field(...labelled('evoPreset','Preset',presetSelect)),presetNote,customBox,customCheck,
     field(...labelled('evoLength','Warrior length',warriorLength),lengthHint),
     field(...labelled('evoSuite','Benchmark',suiteSelect)),
     field(el('label',{},useRoster,' Also fight the warriors checked in the Battle tab')),suiteInfo,
     field(el('label',{},holdOut,' Hold out opponents to check for overfitting'),...labelled('evoHoldOut','Share',holdOutShare)),
     field(el('label',{},selfFight,' Self fight: each warrior also fights itself, as on hills that count it (Koenigstuhl)'))),ownBox),
   el('section',{className:'t-card'},el('h3',{textContent:'Start from'}),
    el('div',{className:'tool-form'},field(...labelled('evoSeedMode','Seed',seedSelect),rosterSeed),seedText,
     field(...labelled('evoSeedShare','Share of mutants of the seed',seedShare)),seedHint)),
   el('section',{className:'t-card'},el('h3',{textContent:'Evolution'}),params)),
  el('div',{className:'opt-main'},
   el('section',{className:'t-card opt-run'},el('h3',{textContent:'Run'}),el('div',{className:'tool-actions'},start,pause,stop),runStatus,excludedBox,bestScore,stats,chart,popBox),
   el('section',{className:'t-card'},el('h3',{textContent:'Best warrior'}),bestHead,bestCode,
    el('div',{className:'tool-actions'},copyBest,editBest,addBest,downloadBest),
    el('div',{className:'tool-actions'},debugBest,el('label',{className:'hint',textContent:'against'}),debugOpponent),actionStatus,opponentsBox,
    el('div',{className:'tool-actions'},checkBest),similarStatus,similarBox))));

 // ---- state
 let otherHills=new Map(),shownSuite='',shownPreset=presetSelect.value,kept=[];
 let run=null,suite=null,lastBest=saved.lastBest||null,lastPopulation=saved.lastPopulation||null;
 showFitness();
 const suites=new Map();
 const preset=()=>EVOLVER_PRESETS.find(p=>p.id===presetSelect.value);
 function config(){
  const p=preset();if(p.id!=='custom')return {...p.config};
  const c={...p.config};for(const [key] of CUSTOM_FIELDS)c[key]=Number(customInputs[key].value);
  c.pspace=0; // pMARS's default size; the evolver writes no P-space instructions.
  return c;
 }
 // The length the evolver writes: the field's value, at most the hill's maximum; empty means the hill's.
 const lengthFor=c=>{const v=Math.trunc(Number(warriorLength.value));return v>=1?Math.min(v,c.maxLength):c.maxLength;};
 function showLength(){
  const c=config(),v=Math.trunc(Number(warriorLength.value)),n=lengthFor(c);
  lengthHint.textContent=!(v>=1)?`up to ${c.maxLength} instructions, the hill’s maximum`:v>c.maxLength?`this hill allows at most ${c.maxLength}, so ${n} is used`:`up to ${n} instructions; opponents may have up to ${c.maxLength}`;
 }
 warriorLength.addEventListener('input',()=>{showLength();showSeed();});
 function persist(){
  saveState({preset:presetSelect.value,warriorLength:warriorLength.value,custom:Object.fromEntries(CUSTOM_FIELDS.map(([k])=>[k,Number(customInputs[k].value)])),suites:{...(saved.suites||{}),[presetSelect.value]:suiteSelect.value},
   own,useRoster:useRoster.checked,selfFight:selfFight.checked,holdOut:holdOut.checked,holdOutShare:holdOutShare.value,seedMode:seedSelect.value,seedText:seedText.value,seedShare:seedShare.value,population:population.value,generations:generations.value,mutation:mutation.value,
   structural:structural.value,crossover:crossoverRate.value,immigrants:immigrants.value,elite:elite.value,niche:niche.value,nicheSize:nicheSize.value,scheme:schemeSelect.value,survival:survivalSelect.value,scoreMemory:memorySelect.value,race:race.checked,fitness:fitnessSelect.value,nicheBy:nicheBySelect.value,scoring:scoringSelect.value,rounds:rounds.value,workers:workers.value,seed:seed.value,runName:runName.value,
   helpClosed:!help.open,populationOpen:popBox.open,advancedOpen:params.querySelector('.opt-advanced').open,lastBest,lastPopulation});
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
  const {suggested,others,elsewhere}=suiteChoices(p,c),option=s=>new Option(s.name,s.id);
  const previous=suiteSelect.value;
  otherHills=new Map(elsewhere.map(s=>[s.id,s]));
  suiteSelect.replaceChildren(...suggested.map(option),
   ...(others.length?[el('optgroup',{label:(suggested.length?'More benchmarks that fit':'Benchmarks that fit')+' (Tournaments, Benchmark mode)'},...others.map(option))]:[]),
   new Option('Only your warriors','none'),
   ...(elsewhere.length?[el('optgroup',{label:'Other hills (switches the settings)'},...elsewhere.map(s=>new Option(`${s.name} · ${hillText(s.hill)}`,s.id)))]:[]));
  const want=saved.suites?.[p.id];
  suiteSelect.value=[...suiteSelect.options].some(o=>o.value===want)?want:[...suiteSelect.options].some(o=>o.value===previous)&&!applyDefaults?previous:suiteSelect.options[0].value;
  // Population, generations and rounds follow the new preset, unless you changed them from the old one's defaults.
  kept=[];
  if(applyDefaults){
   const old=EVOLVER_PRESETS.find(x=>x.id===shownPreset);
   for(const [input,key,label] of [[population,'population','population'],[generations,'generations','generations'],[rounds,'rounds','rounds']]){
    const was=old?(old.defaults[key]??100):null,now=p.defaults[key]??100;
    if(old&&Number(input.value)!==was&&input.value!==''){if(Number(input.value)!==now)kept.push(`${label} ${input.value}`);}else input.value=now;
   }
  }
  shownPreset=p.id;
  shownSuite=suiteSelect.value;showLength();
  loadSuite();
 }
 // A benchmark made for another hill: take its settings, as a preset when one matches, else as Custom
 // (asking first when that replaces custom settings of your own).
 function switchHill(s){
  const target=s.hill,match=EVOLVER_PRESETS.find(p=>p.id!=='custom'&&sameHill(p.config,target));
  if(!match){
   const current=Object.fromEntries(CUSTOM_FIELDS.map(([k])=>[k,Number(customInputs[k].value)])),fresh=EVOLVER_PRESETS.find(p=>p.id==='custom').config;
   const own=!sameHill(current,fresh)&&!sameHill(current,target);
   if(own&&!confirm(`“${s.name}” is for ${hillText(target)}.\n\nReplace your custom settings (${hillText(current)}) with these?`)){suiteSelect.value=shownSuite;return;}
   for(const [k] of CUSTOM_FIELDS)customInputs[k].value=target[k];
  }
  const p=match??EVOLVER_PRESETS.find(p=>p.id==='custom');
  saved.suites={...(saved.suites||{}),[p.id]:s.id};presetSelect.value=p.id;
  showPreset(true);showSeed();persist();
  runStatus.textContent=`Switched to the ${p.id==='custom'?'custom settings':p.title} (${hillText(target)}) for “${s.name}”; ${kept.length?`kept your ${kept.join(', ')}`:'population, generations and rounds are the preset’s defaults'}.`;
 }
 // Every suite of the Tournaments tab's Benchmark mode (built in, or the user's own: imported or made) whose
 // core and length fit; the preset's own picks first; then those of other hills the evolver can switch to
 // ('94 rules). Without that tab, the built-in catalog.
 function suiteChoices(p,c){
  let all=null;try{all=benchmarks?.()??null;}catch{}
  all??=benchmarkCatalog.map(s=>({id:s.id,name:s.descriptor.name,config:s.descriptor.parameters}));
  const suggested=p.benchmarks.map(id=>all.find(s=>s.id===id)).filter(Boolean);
  const others=all.filter(s=>!suggested.includes(s)&&s.config&&suiteFits(s.config,c));
  const elsewhere=all.filter(s=>!suggested.includes(s)&&!others.includes(s)).map(s=>({...s,hill:suiteHill(s.config)})).filter(s=>s.hill)
   .sort((a,b)=>a.hill.coreSize-b.hill.coreSize||a.hill.maxLength-b.hill.maxLength||a.name.localeCompare(b.name));
  return {suggested,others,elsewhere};
 }
 async function loadSuite(){
  const id=suiteSelect.value;suite=null;
  if(id==='none'){suiteInfo.textContent='Only your benchmark warriors'+(useRoster.checked?' and the warriors checked in the Battle tab':'')+'.';showOpponentCount();return;}
  suiteInfo.textContent='Loading the benchmark…';
  try{
   if(loadBenchmark){const loaded=await loadBenchmark(id);if(suiteSelect.value!==id)return;suite=loaded;showOpponentCount();return;}
   const entry=benchmarkCatalog.find(s=>s.id===id);if(!entry)return;
   if(!suites.has(id)){
    const response=await fetch(new URL(entry.data,import.meta.url));if(!response.ok)throw new Error('HTTP '+response.status);
    const {files,scores}=await response.json();suites.set(id,readBenchmark(entry.descriptor,files,id,scores??null));
   }
   if(suiteSelect.value!==id)return;
   suite=suites.get(id);showOpponentCount();
  }catch(error){suiteInfo.textContent='Could not load the benchmark: '+error.message;}
 }
 function opponents(){
  const list=[...(suite?.warriors??[]).map(w=>({name:w.name,source:w.source,file:w.file})),...own.map(w=>({name:w.name,source:w.source,file:warriorFilename(w.name),own:true}))];
  if(useRoster.checked)list.push(...roster().filter(w=>w.checked).map(w=>({name:w.name,source:w.source,file:warriorFilename(w.name),own:true})));
  return list;
 }
 function showOpponentCount(){
  const n=opponents().length,c=config();
  const parts=[`${n} opponent${n===1?'':'s'}`+(suite?` (${suite.warriors.length} from ${suite.name}${n>suite.warriors.length?', '+(n-suite.warriors.length)+' of yours':''})`:'')];
  if(n&&!checkCustom(c)){const mode=scoringMode(matchConfig(c),opponents().map(o=>o.source),{mode:scoringSelect.value,rounds:Number(rounds.value)||100});const e=plannedEngine(matchConfig(c),mode);
   parts.push(mode.why,e.engine==='exmars'?'engine exMARS':`engine pMARS (exMARS can’t run ${e.why})`);}
  if(holdOut.checked&&n>1){const k=Math.min(n-1,Math.max(1,Math.round(n*(Number(holdOutShare.value)||0.2))));parts.push(`${k} held out to check for overfitting, ${n-k} to train on`);}
  if(selfFight.checked&&n)parts.push('plus a self fight');
  suiteInfo.textContent=parts.join(' · ');
  if(seedSelect.value==='markov')showSeed();
 }
 presetSelect.addEventListener('change',()=>{showPreset(true);showSeed();});
 for(const input of Object.values(customInputs))input.addEventListener('change',()=>{showPreset(false);showSeed();});
 suiteSelect.addEventListener('change',()=>{const s=otherHills.get(suiteSelect.value);if(s){switchHill(s);return;}shownSuite=suiteSelect.value;loadSuite();});
 for(const c of [useRoster,selfFight,scoringSelect,rounds,holdOut,holdOutShare])c.addEventListener('change',showOpponentCount);
 holdOutShare.disabled=!holdOut.checked;holdOut.addEventListener('change',()=>{holdOutShare.disabled=!holdOut.checked;});
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
  seedShare.parentNode.hidden=m==='random'||m==='last'||m==='markov';
  const c=config(),n=lengthFor(c);
  seedHint.textContent=m==='random'?`Every warrior of the first population is random code of 1 to ${n} instructions.`
   :m==='markov'?`New warriors, and the immigrants of every generation, are drawn from a Markov chain of the ${opponents().length} opponents’ instructions (1 to ${n} instructions${n<c.maxLength?'; it learns from their first '+n:''}).`
   :m==='last'?(lastPopulation?.key===populationKey(c,n)?`Continues from the ${lastPopulation.genomes.length} warriors the last run ended with.`:'No earlier run with these settings; a run with these settings saves its population here.')
   :`The seed must assemble with at most ${n} instructions. Mutants of it fill the share above; random code fills the rest.`;
 }
 seedSelect.addEventListener('change',showSeed);

 // ---- run
 resetEvolution.onclick=()=>{
  const p=preset(),d=EVOLVER_DEFAULTS;
  population.value=p.defaults.population;generations.value=p.defaults.generations;rounds.value=p.defaults.rounds??100;
  mutation.value=d.mutation;structural.value=d.structural;crossoverRate.value=d.crossover;immigrants.value=d.immigrants;elite.value=d.elite;
  niche.value=d.niche;nicheSize.value=d.nicheSize;schemeSelect.value=d.scheme;survivalSelect.value=d.survival;memorySelect.value=d.scoreMemory;race.checked=d.race;fitnessSelect.value=d.fitness;nicheBySelect.value=d.nicheBy;showNiche();showFitness();scoringSelect.value='auto';seed.value='1';workers.value=Math.max(1,processors-1);
  persist();showOpponentCount();runStatus.textContent=`Evolution settings reset to the defaults for the ${p.title}.`;
 };
 function setRunning(state){
  const active=state==='running'||state==='paused'||state==='pausing';
  start.disabled=state==='running'||state==='pausing';pause.disabled=state!=='running';stop.disabled=!active;
  start.textContent=state==='paused'?'▶ Continue':'▶ Start';
  for(const c of [presetSelect,suiteSelect,...Object.values(customInputs),seedSelect,rosterSeed,seedText,seedShare,warriorLength,selfFight,population,mutation,structural,crossoverRate,immigrants,elite,niche,nicheSize,schemeSelect,survivalSelect,memorySelect,race,fitnessSelect,nicheBySelect,scoringSelect,rounds,workers,seed,runName,useRoster,holdOut,holdOutShare,addPasted,addFiles,resetEvolution])c.disabled=active;
  if(!active){holdOutShare.disabled=!holdOut.checked;race.disabled=fitnessSelect.value==='shared';}
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
  if(seedSelect.value==='paste'){if(!seedText.value.trim()){runStatus.textContent='Paste the seed warrior first.';return;}seedSources.push({name:/^\s*;\s*name\s+(.*?)\s*$/im.exec(seedText.value)?.[1]||'the pasted warrior',source:seedText.value});}
  const length=lengthFor(c);
  if(seedSelect.value==='last'){if(lastPopulation?.key!==populationKey(c,length)){runStatus.textContent='There is no earlier population for these settings.';return;}seedGenomes.push(...lastPopulation.genomes);}
  const p=preset(),now=new Date(),two=n=>String(n).padStart(2,'0');
  const day=`${now.getFullYear()}${two(now.getMonth()+1)}${two(now.getDate())}`,time=`${two(now.getHours())}${two(now.getMinutes())}`;
  const name=runName.value.trim().replace(/\s+/g,' ')||`${p.id}-${day}-${time}`;
  // Continuing the last population: the runs before it, oldest first (older saves have no names).
  const lineage=seedSelect.value==='last'?[...(lastPopulation.lineage||[]),{run:lastPopulation.run??null,generations:lastPopulation.generation??null,population:lastPopulation.genomes.length}].slice(-20):[];
  const job={config:{...c,warriorLength:length},opponents:list.map(({name,source,own})=>({name,source,own:!!own})),benchmarkName:suite?.name||'your warriors',name,lineage,
   before:lineage.every(x=>x.generations!=null)?lineage.reduce((t,x)=>t+x.generations,0):0,
   seed:seed.value,workers:Math.max(1,Math.min(processors,Number(workers.value)||1)),scoring:{mode:scoringSelect.value,rounds:Math.max(10,Number(rounds.value)||100)},seedSources,seedGenomes,
   markov:seedSelect.value==='markov',selfFight:selfFight.checked,holdOut:holdOut.checked?Math.min(0.5,Math.max(0.05,Number(holdOutShare.value)||0.2)):0,
   params:{population:Math.max(4,Number(population.value)||40),generations:Math.max(0,Number(generations.value)||0),mutation:Math.max(1,Number(mutation.value)||1.5),
    structural:Math.min(1,Math.max(0,Number(structural.value))),crossover:Math.min(1,Math.max(0,Number(crossoverRate.value))),immigrants:Math.min(0.5,Math.max(0,Number(immigrants.value))),
    elite:Math.max(0,Number(elite.value)|0),niche:Math.min(1,Math.max(0,Number(niche.value)||0)),nicheSize:Math.max(1,Number(nicheSize.value)|0||1),
    scheme:schemeSelect.value,survival:survivalSelect.value,scoreMemory:memorySelect.value,race:race.checked&&fitnessSelect.value!=='shared',fitness:fitnessSelect.value,nicheBy:nicheBySelect.value,seedShare:seedSources.length?Math.min(1,Math.max(0,Number(seedShare.value))):0}};
  const held=job.holdOut&&list.length>1?Math.min(list.length-1,Math.max(1,Math.round(list.length*job.holdOut))):0;
  const mode=scoringMode(matchConfig(c),list.map(o=>o.source),job.scoring);
  // The worker writes the notes once it knows which opponents assemble.
  job.noteInput={when:`${now.getFullYear()}-${two(now.getMonth()+1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`,
   release:new URL(import.meta.url).searchParams.get('v'),seed:job.seed,hill:(p.id==='custom'?'':p.title+', ')+hillText(c),length,params:job.params,selfFight:job.selfFight,lineage,
   start:{mode:seedSources.length?'seeds':seedSelect.value==='last'?'last':job.markov?'markov':'random',seeds:seedSources.map(s=>s.name)},
   benchmark:{name:job.benchmarkName,opponents:list.length,own:list.length-(suite?.warriors.length??0),heldOut:held,share:job.holdOut},scoring:{exact:mode.exact,rounds:mode.rounds}};
  job.notes=runNotes(job.noteInput);
  run?.worker.terminate();
  const worker=new Worker(new URL('./evolver-worker.mjs',import.meta.url),{type:'module'});
  const r={worker,state:'running',job,opponents:list,history:[],snapshots:[],best:null,started:Date.now(),config:c,key:configKey(c),populationKey:populationKey(c,length),length};run=r;
  worker.onmessage=({data})=>{if(run===r)message(r,data);};
  worker.onerror=event=>{if(run!==r)return;r.state='finished';setRunning('finished');runStatus.textContent='The evolver stopped: '+(event.message||'worker error');};
  worker.postMessage({type:'start',job});
  bestScore.querySelector('strong').textContent='—';stats.replaceChildren();opponentsBox.hidden=true;showExcluded([]);
  runStatus.textContent=`Assembling the ${list.length} opponents and scoring the first ${job.params.population} warriors against them…`;
  setRunning('running');drawChart();popSlider.max='0';popSlider.value='0';selected=null;showPopulation(true);
 }
 function showExcluded(list){
  excludedBox.hidden=!list.length;
  excludedBox.replaceChildren(...(list.length?[el('strong',{textContent:`${list.length} opponent${list.length===1?'':'s'} left out: ${list.length===1?'it does':'they do'} not assemble for these settings`}),
   el('ul',{},...list.map(e=>el('li',{textContent:`${e.name}: ${e.reason}`})))]:[]));
 }
 function message(r,data){
  if(data.excluded)showExcluded(data.excluded);
  if(data.type==='started'){r.started=data;
   // The debugger's opponents are the ones the run uses.
   if(data.excluded?.length){const out=new Set(data.excluded.map(e=>e.index));r.opponents=r.opponents.filter((_,i)=>!out.has(i));}runStatus.textContent=`Running: ${data.why}, engine ${data.engine==='exmars'?'exMARS':'pMARS (exMARS can’t run '+data.engineWhy+')'}, ${data.workers} battle worker${data.workers===1?'':'s'}${data.nested?'':' (this browser runs no workers inside workers, so battles share one)'}${data.markov?`; Markov chain of ${data.markov.instructions} instructions from ${data.markov.warriors} warriors, ${data.markov.shapes} instruction shapes${data.markov.skipped?` (${data.markov.skipped} did not assemble)`:''}`:''}${data.heldOut?.length?`; ${data.heldOut.length} opponents held out: ${data.heldOut.join(', ')}`:''}.`;return;}
  if(data.type==='generation'){
   r.history.push(data.stats);r.last=data;keepSnapshot(r,data);
   if(data.best&&(!r.best||data.best.score!==r.best.score||data.best.source!==r.best.source)){r.best=data.best;showBest(r);}
   lastPopulation={key:r.populationKey,genomes:data.population,run:r.job.name,generation:data.stats.generation,lineage:r.job.lineage};
   if(r.best)lastBest={source:r.best.source,score:r.best.score,key:r.key,opponents:heldRows(r.best),heldOut:r.best.heldOut?.score??null,benchmark:r.job.benchmarkName};
   showStats(r);drawChart();showPopulation(false);schedulePersist();return;
  }
  if(data.type==='paused'){r.state='paused';setRunning('paused');runStatus.textContent=`Paused after generation ${data.generation}. Continue picks up here.`;return;}
  if(data.type==='done'){r.state='finished';setRunning('finished');runStatus.textContent=data.reason+(r.best?` Best score ${fmt(r.best.score,2)}.`:'');r.worker.terminate();persist();return;}
  if(data.type==='error'){r.state='finished';setRunning('finished');runStatus.textContent='The evolver stopped: '+data.message;r.worker.terminate();}
 }
 function showStats(r){
  const d=r.last,s=d.stats;
  bestScore.querySelector('strong').textContent=fmt(s.best,2);
  const items=[['Generation',String(s.generation)],['Population mean',fmt(s.mean,2)],['Median',fmt(s.median,2)],...(s.heldOut==null?[]:[['Held-out score',fmt(s.heldOut,2)]]),['Diversity',fmt(s.diversity,2)],...(s.niches==null?[]:[['Niches',String(s.niches)]]),
   ['Warriors scored',s.evaluations.toLocaleString('en-US')],['Battles',d.matches.toLocaleString('en-US')],['Elapsed',clock(d.elapsed)],['Per second',fmt(s.evaluations/Math.max(1,d.elapsed/1000),1)],['Engine',d.engines]];
  stats.replaceChildren(...items.flatMap(([k,v])=>[el('dt',{textContent:k}),el('dd',{textContent:v})]));
 }
 function showBest(r){
  const b=r.best;
  similarBox.hidden=true;similarStatus.textContent='';
  bestHead.textContent=`Score ${fmt(b.score,2)}${b.se?` ± ${fmt(b.se,2)}`:''} against ${r.job.benchmarkName}${b.heldOut?` · held out ${fmt(b.heldOut.score,2)}`:''} · ${b.length} instruction${b.length===1?'':'s'} · found in generation ${b.generation}.`;
  bestCode.textContent=b.source;
  showOpponents(heldRows(b),r.opponents);
 }
 // Training and held-out results in one table, the held-out ones marked.
 const heldRows=b=>[...(b.opponents||[]),...(b.heldOut?.opponents||[]).map(o=>({...o,held:true}))];
 function showOpponents(per,list){
  opponentsBox.hidden=!per?.length;
  opponentsTable.replaceChildren(el('thead',{},el('tr',{},...['Opponent','W','T','L','Score'].map(h=>el('th',{scope:'col',textContent:h})))),
   el('tbody',{},...(per||[]).slice().sort((a,b)=>a.score-b.score).map(o=>el('tr',{className:o.held?'evo-held':''},el('td',{textContent:o.name+(o.held?' · held out':'')}),...[o.wins,o.ties,o.losses].map(v=>el('td',{className:'num',textContent:String(v)})),el('td',{className:'num',textContent:fmt(o.score,1)})))));
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

 // ---- closeness to known warriors (evolver-similar.mjs): the benchmark, your opponents and warriors,
 // and the library's hills with the same settings, assembled once per hill settings and source.
 const assembled=new Map();
 async function knownWarriors(c){
  const {libraryHills,libraryWarriors,assembleKnown}=await import('./evolver-similar.mjs');
  const list=[...(suite?.warriors??[]).map(w=>({name:w.name,source:w.source,from:suite.name})),...own.map(w=>({name:w.name,source:w.source,from:'your opponents'})),
   ...roster().map(w=>({name:w.name,source:w.source,from:'your warriors'}))].map(w=>({...w,hill:c}));
  let libraryNote='';
  try{for(const h of await libraryHills()){const fits=suiteHill(h.parameters);if(fits&&sameHill(fits,c))list.push(...await libraryWarriors(h));}}
  catch{libraryNote=' (the library could not be loaded)';}
  const {known,failed}=await assembleKnown(list,{cache:assembled,progress:(i,n)=>{similarStatus.textContent=`Assembling known warriors… ${i} of ${n}`;}});
  return {known,failed,libraryNote};
 }
 checkBest.onclick=async()=>{
  if(!need())return;
  const source=bestSource(),c=bestConfig();checkBest.disabled=true;similarStatus.textContent='Finding the code that runs…';
  try{
   const {assemble}=await import('./dist/exmars/fighter-client.mjs'),{hillOf}=await import('./exmars.mjs');
   const mine=await assemble(source,hillOf({...c,distance:c.distance||c.maxLength}));
   if(!mine.ok)throw new Error('The best warrior did not assemble: '+mine.errors);
   const {closest,prepare,traceExecuted,summary}=await import('./evolver-similar.mjs');
   // The code that runs, from a short solo run; all of it if the trace fails.
   let ran=null,traceNote='';
   try{ran=await traceExecuted(source,c,mine.start,mine.instructions.length);}catch(error){traceNote=` (the solo run failed, so all its code was compared: ${error.message})`;}
   const yours=prepare({code:mine.instructions},c.coreSize,{keep:ran,near:c.maxLength});
   similarStatus.textContent='Loading known warriors…';
   const {known,failed,libraryNote}=await knownWarriors(c);
   // The best warrior itself, once added to your warriors, is not a match.
   const found=closest(yours,known.filter(k=>k.source!==source),c.coreSize,15),{rows}=found;
   const label={copy:' · copy',known:' · same design',partial:' · partly'};
   similarBox.hidden=!rows.length;
   similarTable.replaceChildren(el('thead',{},el('tr',{},...[['Warrior'],['From'],['Length','instructions, a run of one instruction counted once'],['Covered','share of the code that runs aligned to the same shape or closer'],['Identical','instructions identical, fields and all'],['Same wiring','same shape, and the fields that point into the warrior the same'],['Score','local alignment score']].map(([h,title])=>el('th',{scope:'col',textContent:h,title:title||''})))),
    el('tbody',{},...rows.map(r=>el('tr',{className:r.verdict?'evo-held':''},el('td',{textContent:r.name+(label[r.verdict]??'')}),el('td',{textContent:r.from}),
     ...[String(r.length),Math.round(100*r.share)+'%',String(r.identical),String(r.wiring),fmt(r.score,1)].map(v=>el('td',{className:'num',textContent:v}))))));
   const checked=`${known.length} known warrior${known.length===1?'':'s'}${failed?` (${failed} did not assemble for these settings)`:''}${libraryNote}${traceNote}`;
   similarStatus.textContent=summary(found,{yours,ran,total:mine.instructions.length,checked})+(rows.length?' The Similar warriors tool shows the code side by side.':'');
  }catch(error){similarStatus.textContent=error.message;similarBox.hidden=true;}
  finally{checkBest.disabled=false;}
 };

 // ---- population view: snapshots of every generation, thinned to a budget of instructions.
 const SNAPSHOT_BUDGET=1500000;let selected=null;
 function keepSnapshot(r,data){
  if(!data.ranked)return;
  const following=Number(popSlider.value)>=r.snapshots.length-1;
  r.snapshots.push({generation:data.stats.generation,genomes:data.ranked,scores:data.scores,radius:data.radius,profiles:data.profiles||null});
  const size=()=>r.snapshots.reduce((t,x)=>t+x.genomes.reduce((u,g)=>u+g.code.length,0),0);
  // Over budget: drop every other older snapshot, keeping the first and the latest.
  while(r.snapshots.length>2&&size()>SNAPSHOT_BUDGET)r.snapshots=r.snapshots.filter((x,i,a)=>i===0||i===a.length-1||i%2===0);
  popSlider.max=String(r.snapshots.length-1);
  if(following)popSlider.value=popSlider.max;
 }
 function snapshotShown(){const list=run?.snapshots;if(!list?.length)return null;return list[Math.min(list.length-1,Number(popSlider.value)||0)];}
 // Niches and map positions are worked out once per snapshot, when it is first shown.
 function analyse(snap){
  if(!snap.groups){const {group,leaders}=snap.profiles?nicheGroups(snap.profiles,snap.radius,profileDistance):nicheGroups(snap.genomes,snap.radius);snap.groups=group;snap.leaders=leaders;}
  if(!snap.coords)snap.coords=mapLayout(snap.genomes);
  return snap;
 }
 function showPopulation(reset){
  if(reset){nicheTable.replaceChildren();popCode.hidden=popEdit.hidden=true;popLabel.textContent=run?'Waiting for the first generation…':'Start a run to see its population.';}
  if(!popBox.open)return;
  const snap=snapshotShown();
  drawHistory();
  if(!snap){drawMap(null);return;}
  analyse(snap);
  const latest=snap===run.snapshots.at(-1),n=snap.genomes.length;
  popLabel.textContent=`Generation ${snap.generation}${latest?' (latest)':''} · ${n} warriors · ${snap.leaders.length} niche${snap.leaders.length===1?'':'s'} (${snap.profiles?'by results, ':''}radius ${snap.radius}) · best ${fmt(snap.scores[0],2)}`;
  if(selected&&selected.snap!==snap)selected=null;
  drawMap(snap);showNiches(snap);showSelected(snap);
 }
 function nicheStats(snap){
  return snap.leaders.map((leader,k)=>{const members=[];snap.groups.forEach((g,i)=>{if(g===k)members.push(i);});
   const scores=members.map(i=>snap.scores[i]);return {k,leader,members,best:Math.max(...scores),mean:scores.reduce((a,b)=>a+b,0)/scores.length};});
 }
 function oneLine(g){
  const parts=g.code.slice(0,6).map(ins=>renderInstruction(ins,run.config.coreSize).replace(/\s+/g,' '));
  return parts.join(' / ')+(g.code.length>6?` / … (${g.code.length})`:'');
 }
 function showNiches(snap){
  const rows=nicheStats(snap),shown=rows.slice(0,40);
  nicheTable.replaceChildren(el('thead',{},el('tr',{},...['Niche','Warriors','Best','Mean','Leader'].map(h=>el('th',{scope:'col',textContent:h})))),
   el('tbody',{},...shown.map(row=>{
    const tr=el('tr',{className:selected?.niche===row.k?'selected':''},el('td',{className:'num',textContent:String(row.k+1)}),el('td',{className:'num',textContent:String(row.members.length)}),
     el('td',{className:'num',textContent:fmt(row.best,1)}),el('td',{className:'num',textContent:fmt(row.mean,1)}),el('td',{},el('code',{textContent:oneLine(snap.genomes[row.leader])})));
    tr.tabIndex=0;tr.onclick=tr.onkeydown=event=>{if(event.type==='keydown'&&event.key!=='Enter')return;select(snap,row.leader);};
    return tr;
   }),...(rows.length>shown.length?[el('tr',{},el('td',{colSpan:5,className:'hint',textContent:`… and ${rows.length-shown.length} more niches`}))]:[])));
 }
 function select(snap,index){selected={snap,index,niche:snap.groups[index]};showPopulation(false);}
 function warriorSource(snap,index){
  const rules=genomeRules(run.config);
  return evolvedSource(snap.genomes[index],rules,{run:run.job.name,generation:snap.generation,before:run.job.before,index:index+1,score:snap.scores[index],benchmark:run.job.benchmarkName,header:redcodeHeader(run.config),notes:run.job.notes});
 }
 function showSelected(snap){
  if(!selected){popCode.hidden=popEdit.hidden=true;return;}
  popCode.hidden=popEdit.hidden=false;popCode.textContent=warriorSource(snap,selected.index);
 }
 popEdit.onclick=()=>{const snap=snapshotShown();if(!snap||!selected)return;const source=warriorSource(snap,selected.index);
  try{openInEditor(source,warriorFilename(`${run.job.name}-g${snap.generation}-${selected.index+1}`),run.config);}catch(error){actionStatus.textContent=error.message;}};
 popSlider.addEventListener('input',()=>showPopulation(false));
 popLatest.onclick=()=>{popSlider.value=popSlider.max;showPopulation(false);};
 popBox.addEventListener('toggle',()=>showPopulation(false));
 const scoreColour=t=>{const a=[47,74,95],b=[127,240,245];return `rgb(${a.map((x,i)=>Math.round(x+(b[i]-x)*t)).join(',')})`;};
 let mapPoints=[];
 function drawMap(snap){
  if(!popMap.clientWidth)return;
  const ratio=devicePixelRatio||1,w=popMap.clientWidth,h=popMap.clientHeight||260;popMap.width=w*ratio;popMap.height=h*ratio;
  const ctx=popMap.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#101d29';ctx.fillRect(0,0,w,h);
  mapPoints=[];
  if(!snap){ctx.font='11px system-ui';ctx.fillStyle='#aec0ce';ctx.fillText(run?'Waiting for the first generation':'Start a run to see the population',12,h/2);return;}
  const c=snap.coords,pad=14;let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const [x,y] of c){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  const span=Math.max(x1-x0,y1-y0,1e-9),k=Math.min((w-2*pad)/Math.max(x1-x0,span*0.2),(h-2*pad)/Math.max(y1-y0,span*0.2));
  const cx=(x0+x1)/2,cy=(y0+y1)/2,lo=Math.min(...snap.scores),hi=Math.max(...snap.scores);
  const leaders=new Set(snap.leaders),r=snap.genomes.length>150?3:4;
  // Worst first, so the best are drawn on top.
  for(let i=snap.genomes.length-1;i>=0;i--){
   const px=w/2+(c[i][0]-cx)*k,py=h/2-(c[i][1]-cy)*k;mapPoints.push([px,py,i]);
   const dim=selected&&snap.groups[i]!==selected.niche;
   ctx.globalAlpha=dim?0.25:1;ctx.fillStyle=scoreColour(hi>lo?(snap.scores[i]-lo)/(hi-lo):1);
   ctx.beginPath();ctx.arc(px,py,r,0,2*Math.PI);ctx.fill();
   if(leaders.has(i)){ctx.strokeStyle='#f9a567';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(px,py,r+2.5,0,2*Math.PI);ctx.stroke();}
   if(selected?.index===i){ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(px,py,r+5,0,2*Math.PI);ctx.stroke();}
  }
  ctx.globalAlpha=1;ctx.font='11px system-ui';ctx.fillStyle='#aec0ce';ctx.fillText(`score ${fmt(lo,0)} … ${fmt(hi,0)}`,8,h-6);
 }
 popMap.addEventListener('click',event=>{
  const snap=snapshotShown();if(!snap)return;const box=popMap.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;
  let best=null,bd=144;for(const [px,py,i] of mapPoints){const d=(px-x)**2+(py-y)**2;if(d<bd){bd=d;best=i;}}
  if(best===null){selected=null;showPopulation(false);}else select(snap,best);
 });
 function drawHistory(){
  if(!popHistory.clientWidth)return;
  const ratio=devicePixelRatio||1,w=popHistory.clientWidth,h=120;popHistory.width=w*ratio;popHistory.height=h*ratio;
  const ctx=popHistory.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#101d29';ctx.fillRect(0,0,w,h);
  const pts=(run?.history||[]).filter(p=>p.niches!=null),L=34,R=34,T=18,B=16;ctx.font='11px system-ui';
  ctx.fillStyle='#f9a567';ctx.fillText('niches',L,12);ctx.fillStyle='#54d8df';ctx.fillText('diversity',L+48,12);
  if(pts.length<2)return;
  const first=pts[0].generation,last=pts.at(-1).generation,top=Math.max(2,...pts.map(p=>p.niches));
  const xs=g=>L+(w-L-R)*(g-first)/Math.max(1,last-first);
  ctx.strokeStyle='#2a3d4d';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,h-B);ctx.lineTo(w-R,h-B);ctx.lineTo(w-R,T);ctx.stroke();
  ctx.fillStyle='#aec0ce';ctx.fillText(String(top),4,T+8);ctx.fillText('0',4,h-B);ctx.fillText('1',w-R+6,T+8);ctx.fillText('0',w-R+6,h-B);
  for(const [key,color,scale] of [['niches','#f9a567',top],['diversity','#54d8df',1]]){
   ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();pts.forEach((p,i)=>{const x=xs(p.generation),y=T+(h-T-B)*(1-p[key]/scale);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
  }
  const snap=snapshotShown();if(snap){ctx.strokeStyle='#ffffff55';ctx.beginPath();ctx.moveTo(xs(snap.generation),T);ctx.lineTo(xs(snap.generation),h-B);ctx.stroke();}
 }
 new ResizeObserver(()=>{if(popBox.open)showPopulation(false);}).observe(popMap);
 new ResizeObserver(()=>drawChart()).observe(chart);
 function drawChart(){
  if(!chart.clientWidth)return;
  const ratio=devicePixelRatio||1,w=chart.clientWidth,h=180;chart.width=w*ratio;chart.height=h*ratio;
  const ctx=chart.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#101d29';ctx.fillRect(0,0,w,h);
  const pts=run?.history||[],L=40,R=8,T=22,B=20;ctx.font='11px system-ui';ctx.fillStyle='#aec0ce';
  ctx.fillText('Score per generation',L,14);
  if(pts.length<2){ctx.fillText(run?'Waiting for the second generation':'Start a run to see the scores',L,h/2);return;}
  let lo=Infinity,hi=-Infinity;for(const p of pts)for(const v of [p.best,p.mean,p.heldOut])if(v!=null){lo=Math.min(lo,v);hi=Math.max(hi,v);}
  lo=Math.max(0,Math.floor(lo/10)*10);hi=Math.ceil(hi/10)*10;if(hi-lo<10)hi=lo+10;
  const n=pts.at(-1).generation,first=pts[0].generation,xs=x=>L+(w-L-R)*(x-first)/Math.max(1,n-first),ys=v=>T+(h-T-B)*(1-(v-lo)/(hi-lo));
  ctx.strokeStyle='#2a3d4d';ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,h-B);ctx.lineTo(w-R,h-B);ctx.stroke();
  ctx.fillText(String(hi),4,T+8);ctx.fillText(String(lo),4,h-B);ctx.fillText(String(first),L,h-6);ctx.fillText(String(n),w-R-ctx.measureText(String(n)).width,h-6);
  const held=pts.some(p=>p.heldOut!=null);
  for(const [key,color,width,dash] of [['mean','#f9a567',1.5,[]],['best','#54d8df',2,[]],...(held?[['heldOut','#c792ea',2,[5,3]]]:[])]){
   ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();let on=false;
   for(const p of pts){if(p[key]==null){on=false;continue;}const x=xs(p.generation),y=ys(p[key]);on?ctx.lineTo(x,y):ctx.moveTo(x,y);on=true;}
   ctx.stroke();ctx.setLineDash([]);
  }
  ctx.fillStyle='#54d8df';ctx.fillText('best',w-R-80,14);ctx.fillStyle='#f9a567';ctx.fillText('mean',w-R-44,14);
  if(held){ctx.fillStyle='#c792ea';ctx.fillText('held out',w-R-140,14);}
  // Readout of the generation nearest the pointer.
  if(chartHover==null||chartHover<L||chartHover>w-R)return;
  let p=pts[0];for(const q of pts)if(Math.abs(xs(q.generation)-chartHover)<Math.abs(xs(p.generation)-chartHover))p=q;
  const x=xs(p.generation);
  ctx.strokeStyle='#ffffff55';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,T);ctx.lineTo(x,h-B);ctx.stroke();
  const rows=[[`Generation ${p.generation}`,'#ffffff']];
  for(const [key,label,color] of [['best','best','#54d8df'],['mean','mean','#f9a567'],['heldOut','held out','#c792ea']]){
   if(p[key]==null)continue;rows.push([`${label} ${fmt(p[key],2)}`,color]);
   ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,ys(p[key]),3,0,2*Math.PI);ctx.fill();
  }
  const bw=Math.max(...rows.map(([t])=>ctx.measureText(t).width))+12,bh=rows.length*14+6;
  const bx=x+8+bw<=w-R?x+8:x-8-bw,by=T+2;
  ctx.fillStyle='#101d29e6';ctx.strokeStyle='#2a3d4d';ctx.fillRect(bx,by,bw,bh);ctx.strokeRect(bx,by,bw,bh);
  rows.forEach(([t,color],i)=>{ctx.fillStyle=color;ctx.fillText(t,bx+6,by+15+i*14);});
 }
 let chartHover=null;
 chart.addEventListener('pointermove',event=>{chartHover=event.clientX-chart.getBoundingClientRect().left;drawChart();});
 chart.addEventListener('pointerleave',()=>{chartHover=null;drawChart();});
 showOwn();refreshRoster();showPreset(false);showSeed();
 if(lastBest?.opponents)showOpponents(lastBest.opponents,null);
 if(lastBest)bestHead.textContent=`Best warrior of the last run: score ${fmt(lastBest.score,2)} against ${lastBest.benchmark||'its benchmark'}${lastBest.heldOut!=null?`, held out ${fmt(lastBest.heldOut,2)}`:''}.`;
 // Suites imported, made or edited in the Benchmark mode since the last visit show up here.
 return {show(){refreshRoster();if(!run||run.state==='finished')showPreset(false);else showOpponentCount();drawChart();},hide(){}};
}

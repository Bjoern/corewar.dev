// SPDX-License-Identifier: GPL-2.0-or-later
// The evolver's search: a population of whole warriors (evolver-genome.mjs), scored against a
// benchmark by the constant optimizer's Evaluator (optimizer-fitness.mjs: 3 per win, 1 per tie,
// (3W + T) / rounds × 100 averaged over opponents; exact on small cores, sampled otherwise).
// The population itself is population.mjs, shared with the constant optimizer's genetic algorithm;
// this module supplies the warrior operators and the run around it (scoring, best, history).
// Defaults: generational (μ + λ): each generation breeds a child per slot from tournament-selected
// parents (crossover, then point and structural mutations), and parents and children compete for
// the next generation with clearing (niching): survivors are taken best first, but a warrior within
// `niche` of a better one whose niche already holds `nicheSize` warriors goes to the back of the
// line, so near-copies of the leader give way to the best of other kinds. The best `elite` are always
// kept and a few random immigrants added. With a Markov chain of the benchmark's warriors
// (markovModel), new code is drawn from the chain instead. population.mjs lists the other choices
// (steady state, deterministic crowding, mean scores over seed sets, racing, and results-based
// fitness sharing and niching: fitness 'shared', nicheBy 'results').
import {rng,genomeRules,randomGenome,markovGenome,normalize,mutate,crossover,genomeKey,renderGenome,redcodeHeader,distance,nicheGroups,
 structureOf,hasStructure,structuredGenome,mutateStructured,crossoverStructured} from './evolver-genome.mjs';
import {Population,POPULATION_DEFAULTS,profileDistance} from './population.mjs';

// niche: the clearing radius (genome distance 0 … 1, 0 = no niching); nicheSize: warriors a niche keeps.
// Held-out opponents: a share of the opponents (at least one, and one left to train on) set aside
// by the run's seed, never used for selection; scoring the best warrior on them shows whether a
// run learns to fight warriors in general or only the ones it is scored against.
export function splitHoldOut(opponents,share,seed){
 const n=opponents.length,k=share>0&&n>1?Math.min(n-1,Math.max(1,Math.round(n*share))):0;
 if(!k)return {training:opponents.slice(),heldOut:[]};
 const r=rng('holdout:'+seed),order=opponents.map((_,i)=>i);
 for(let i=n-1;i>0;i--){const j=r.int(i+1);[order[i],order[j]]=[order[j],order[i]];}
 const out=new Set(order.slice(0,k));
 return {training:opponents.filter((_,i)=>!out.has(i)),heldOut:opponents.filter((_,i)=>out.has(i))};
}
// The niche radius that suits results (per-opponent points, profileDistance) rather than code.
export const RESULT_RADIUS=0.15;
export const EVOLVER_DEFAULTS={...POPULATION_DEFAULTS,population:40,generations:200,scheme:'generational',survival:'clearing',elite:2,tournament:3,mateTournament:3,
 crossover:0.5,mutation:1.5,structural:0.3,immigrants:0.05,seedShare:0.5,reseedEvery:5,niche:0.3,nicheSize:2,scoreMemory:'latest',rescore:0,race:false,keepStructure:false,
 // Soup mode (scheme 'soup', evolver-soup.mjs): the grid and the rounds of a duel between neighbours.
 soupWidth:20,soupHeight:12,duelRounds:100};
// Screened scoring (scoringMode 'screen'): every generation new placements, the leaders scored again
// on them and their scores averaged, so a lucky few rounds do not keep a warrior on top for long
// (corewar-rl evo.py: 8 rounds, the top 10 rescored, matched exact scoring at equal time).
export const SCREEN_PARAMS={scoreMemory:'mean',rescore:10,reseedEvery:1,race:false};
// The leaders whose exact score is checked each generation, with screened scoring.
const JUDGED=3;

// Where an evolved warrior comes from. Named <run>-g<generation> (plus -<place> for one taken from
// the population view). The ;strategy lines say the basics: run, generation (and how many came
// before it in the runs it continues), score, held-out score. The run's settings follow as plain
// comments (runNotes), so a hill's listing stays short.
export function evolvedSource(g,rules,{run='Evolved',generation=0,before=0,index=null,score=null,heldOut=null,benchmark='',header=';redcode-94',notes=[]}={}){
 const strategy=[`Evolved by the corewar.dev evolver: run ${run}, generation ${generation}${before?` (${before+generation} counting the runs it continues)`:''}${index!=null?`, number ${index} of its population`:''}`];
 if(score!=null)strategy.push(`Score ${score.toFixed(2)}${benchmark?' against '+benchmark:''}`);
 if(heldOut!=null)strategy.push(`Held-out score ${heldOut.toFixed(2)}`);
 return renderGenome(g,rules,{name:`${run}-g${generation}${index!=null?'-'+index:''}`,header,strategy,comments:notes});
}
const ON=v=>v?'on':'off';
// Settings that are only written when they differ from EVOLVER_DEFAULTS.
const OTHER_SETTINGS=[['elite',v=>`elite ${v}`],['scheme',v=>v==='steady'?'one child at a time (steady state)':`breeding ${v}`],
 ['scoreMemory',v=>v==='mean'?'scores averaged over placements':`scores ${v}`],['race',v=>`racing ${ON(v)}`],['fitness',v=>v==='shared'?'selection by shared score':`selection by ${v}`],
 ['nicheBy',v=>v==='results'?'warriors compared by results':`warriors compared by ${v}`],['tournament',v=>`tournament ${v}`],['mateTournament',v=>`mate tournament ${v}`],
 ['reseedEvery',v=>v===1?'new placements every generation':`new placements every ${v} generations`],['rescore',v=>`rescore ${v}`]];
// The run's settings as short comment lines, one fact each. o: when, release (the site's build, or
// none for a copy run from the sources), start {mode: random|markov|seeds|last, seeds: names},
// lineage (earlier runs, oldest first: {run, generations, population}), seed, hill (text),
// benchmark {name, opponents, own, heldOut, share}, scoring {exact, rounds, judge: exact rounds when
// screened}, selfFight, length, params, structure (the kept structure as text, with keepStructure).
export function runNotes(o){
 const p={...EVOLVER_DEFAULTS,...o.params},b=o.benchmark||{},s=o.start||{mode:'random'},lineage=o.lineage||[];
 const runText=x=>x?.run?'run '+x.run:'an earlier run';
 const lines=[`When: ${o.when}, corewar.dev ${o.release?'release '+o.release:'development copy'}`];
 lines.push('Start: '+(s.mode==='markov'?'a Markov chain of the training opponents'
  :s.mode==='seeds'?`seed warrior${s.seeds.length===1?'':'s'} ${s.seeds.join(', ')}, ${Math.round(100*p.seedShare)}% mutants`
  :s.mode==='last'?`the last population of ${runText(lineage.at(-1))}`:'random code'));
 for(const x of lineage)lines.push(`Continues ${runText(x)}${x.generations!=null?`, ${x.generations} generation${x.generations===1?'':'s'}`:''}${x.population?`, population ${x.population}`:''}`);
 if(lineage.length&&lineage.every(x=>x.generations!=null))lines.push(`Generations before this run: ${lineage.reduce((t,x)=>t+x.generations,0)}`);
 lines.push(`Random seed: ${o.seed}`);
 if(o.hill)lines.push(`Hill: ${o.hill}`);
 lines.push(`Benchmark: ${b.name}, ${b.opponents} opponent${b.opponents===1?'':'s'}${b.own?` (${b.own} of them yours)`:''}`);
 if(b.heldOut)lines.push(`Held out: ${b.heldOut} opponent${b.heldOut===1?'':'s'} (share ${b.share})`);
 if(o.scoring)lines.push(o.scoring.judge?`Scoring: screened, ${o.scoring.rounds} random placements per opponent for selection, exact (all ${o.scoring.judge}) for the best`
  :o.scoring.exact?`Scoring: exact, all ${o.scoring.rounds} placements per opponent`:`Scoring: sampled, ${o.scoring.rounds} rounds per opponent`);
 if(o.selfFight)lines.push('Self fight: on');
 if(p.keepStructure)lines.push(`Structure: the seed's, kept (length and opcodes in order fixed)${o.structure?': '+o.structure:''}`);
 if(p.scheme==='soup'){
  lines.push(`Breeding: soup, a ${p.soupWidth} × ${p.soupHeight} grid, neighbours duel ${p.duelRounds} rounds, the loser replaced by a mutant of the winner`,
   `Warrior length: ${o.length}`,'Mutation: yabevolver’s rates per line','Strength: a hall of fame of harvested warriors, scored against the benchmark');
  return lines;
 }
 lines.push(`Population: ${p.population}`,`Warrior length: ${o.length}`,`Mutations per child: ${p.mutation}`,`Structural share: ${p.structural}`,`Crossover rate: ${p.crossover}`,`Immigrants: ${p.immigrants}`);
 lines.push('Niching: '+(p.survival==='crowding'?'crowding':p.niche>0?`radius ${p.niche}, ${p.nicheSize} per niche`:'off'));
 const other=OTHER_SETTINGS.filter(([k])=>p[k]!==EVOLVER_DEFAULTS[k]).map(([k,f])=>f(p[k]));
 if(other.length)lines.push(`Other settings: ${other.join(', ')}`);
 return lines;
}

export class Evolution{
 // evaluator: an Evaluator with its mode set. judge: with screened scoring, an Evaluator in exact mode
 // that scores the leaders: the best warrior is the best exact score among them, while selection
 // uses the evaluator's few-round scores. seeds: genomes (or assembled warriors) to start from.
 // model: a Markov chain (markovModel) that new code is drawn from, or none for random code.
 // name: the run's name; notes: comment lines on its settings (runNotes); before: generations of
 // the earlier runs it continues. params.keepStructure: every warrior keeps the first seed's length and
 // opcodes in order (structureOf), for tuning a warrior without the evolver rewriting its design;
 // new code is random code with those opcodes, crossover goes line by line, and a Markov chain is not used.
 constructor({evaluator,judge=null,config,params={},seeds=[],seed='1',name='Evolved',model=null,notes=[],before=0}){
  this.evaluator=evaluator;this.judge=judge;this.config=config;this.rules=genomeRules(config);this.name=name;this.model=model;this.notes=notes;this.before=before;
  const rules=this.rules;
  this.ops={
   random:r=>this.model?markovGenome(r.fn(),this.model,rules):randomGenome(r.fn(),rules),
   mutate:(g,r)=>mutate(g,r.fn(),rules,{rate:this.params.mutation,structural:this.params.structural}),
   crossover:(a,b,r)=>crossover(a,b,r.fn(),rules),
   key:genomeKey,distance,size:g=>g.code.length};
  const all={...EVOLVER_DEFAULTS,...params,...(judge?SCREEN_PARAMS:{})},start=seeds.map(s=>normalize(s,rules));
  this.structure=null;
  if(all.keepStructure){
   if(!start.length)throw new Error('Keeping the seed’s structure needs a seed warrior.');
   const s=this.structure=structureOf(start[0]);
   if(!start.every(g=>hasStructure(g,s)))throw new Error('The seed warriors differ in length or opcodes, so there is no one structure to keep.');
   Object.assign(this.ops,{random:r=>structuredGenome(r.fn(),rules,s),
    mutate:(g,r)=>mutateStructured(g,r.fn(),rules,s,{rate:this.params.mutation,structural:this.params.structural}),
    crossover:(a,b,r)=>crossoverStructured(a,b,r.fn())});
  }
  this.engine=new Population(this.ops,{params:all,seeds:start,seed:'evolve:'+seed});
  this.best=null;this.history=[];this.evaluations=0;this.header=redcodeHeader(config);this.reseed=false;
 }
 get params(){return this.engine.params;}
 get generation(){return this.engine.generation;}
 // The population best first.
 get population(){return this.engine.ranked();}
 source(g,extra=[]){return renderGenome(g,this.rules,{name:this.name,header:this.header,strategy:extra});}
 // Score one batch in parallel and hand it to the population.
 async run(batch){
  const results=await Promise.all(batch.map(c=>this.evaluator.evaluate(this.source(c.genome),{race:c.race})));
  this.evaluations+=batch.length;
  for(const e of this.engine.tell(batch,results))if(e.type==='generation'&&e.reseed)this.reseed=true;
 }
 // The first population: the seeds, mutants of them, and new code (random or from the chain).
 async init(){
  while(this.engine.initializing)await this.run(this.engine.ask());
  await this.record();return this.stats();
 }
 survivors(list,n){return this.engine.survivors(list,n);}
 async step(){
  // Sampled scores: new placements now and then, so the population does not overfit one set.
  if(this.reseed&&!this.evaluator.mode.exact){this.reseed=false;this.evaluator.epoch++;this.engine.invalidate();await this.run(this.engine.ask());if(!this.judge)this.best=null;}
  this.reseed=false;
  const g=this.engine.generation;
  while(this.engine.generation===g)await this.run(this.engine.ask());
  await this.record();return this.stats();
 }
 // The best of the population as a candidate for the run's best: its score and result, or with a
 // judge the best exact score among the leaders (those scored on two placement sets first).
 async leader(ranked){
  const top={...ranked[0],result:this.engine.result(ranked[0].key)};
  if(!this.judge)return top;
  const trusted=ranked.filter(m=>m.n>=2),list=[...trusted,...ranked.filter(m=>!(m.n>=2))].slice(0,JUDGED);
  const judged=await Promise.all(list.map(m=>this.judge.evaluate(this.source(m.genome))));
  let best=null;
  list.forEach((m,i)=>{const r=judged[i];if(r&&(!best||r.score>best.score))best={...m,score:r.score,se:0,result:r,sampled:m.score};});
  return best??top;
 }
 async record(){
  const ranked=this.engine.ranked(),top=ranked[0],lead=await this.leader(ranked);
  if(!this.best||lead.score>this.best.score||(lead.score===this.best.score&&lead.key!==this.best.key&&lead.genome.code.length<this.best.genome.code.length))this.best={...lead,generation:this.generation};
  const scores=ranked.map(m=>m.score),mean=scores.reduce((a,b)=>a+b,0)/scores.length;
  const sorted=scores.slice().sort((a,b)=>a-b),median=sorted[sorted.length>>1];
  const div=ranked.reduce((s,m)=>s+distance(m.genome,top.genome),0)/ranked.length;
  // Niches are counted the way survival sees them (by code or by results), with the clearing radius,
  // or the default radius of that kind when niching is off, so runs compare.
  const profiles=this.profiles(ranked);
  const niches=(profiles?nicheGroups(profiles,this.nicheRadius,profileDistance):nicheGroups(ranked.map(m=>m.genome),this.nicheRadius)).leaders.length;
  this.history.push({generation:this.generation,best:this.best.score,top:top.score,mean,median,diversity:div,niches});
 }
 // The per-opponent results of `list` when niches are by results and every member has them, else null.
 profiles(list=this.ranked()){
  if(this.params.nicheBy!=='results')return null;
  const k=list[0]?.vec?.length;
  return k&&list.every(m=>m.vec?.length===k)?list.map(m=>m.vec):null;
 }
 get nicheRadius(){return this.params.survival==='clearing'&&this.params.niche>0?this.params.niche:this.params.nicheBy==='results'?RESULT_RADIUS:0.3;}
 stats(){return {...this.history.at(-1),evaluations:this.evaluations};}
 ranked(){return this.engine.ranked();}
 bestSource(benchmark='',{heldOut=null}={}){
  const b=this.best;if(!b)return '';
  return evolvedSource(b.genome,this.rules,{run:this.name,generation:b.generation,before:this.before,score:b.score,heldOut,benchmark,header:this.header,notes:this.notes});
 }
 snapshot(){return this.engine.members.map(m=>m.genome);}
 // The population with scores, best first, for the population view.
 view(){return this.ranked().map(m=>({genome:m.genome,score:m.score,fit:m.fit??m.score}));}
}

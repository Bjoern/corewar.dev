// SPDX-License-Identifier: GPL-2.0-or-later
// Soup mode, the evolver's third way to breed (after Terry Newton's MEVO and yabevolver; corewar-rl
// soup.py and EVOLVER_SURVEY.md). The warriors live on a grid whose edges wrap around (a torus).
// Again and again a random cell and one of its eight neighbours fight a short duel, and the loser's
// cell gets a copy of the winner, mutated now and then and sometimes crossed with a neighbour of the
// loser. A tie changes nothing. There is no benchmark in the loop: a warrior only has to beat its
// neighbours, so a lineage can pass through weak forms on its way to a strong one, and different
// kinds hold their own corners of the grid. To see how strong the soup is, one random cell is scored
// against the benchmark every so often (the evolver's Evaluator, exact on nano) and kept in a hall of
// fame of the best ones found; the run's best warrior is the best of the hall.
//
// Duels are run in rounds of disjoint pairs, so they can go to the worker pool together. A
// generation is as many duels as there are cells. Mutation is yabevolver's: a rate per line and per
// kind of change, so about half of all copies are exact, with its weights for new instructions (MOV,
// SPL and DJN most, no DAT or NOP) and for the A- and B-field modes.
import {Evolution} from './evolver-run.mjs';
import {Rng} from './population.mjs';
import {OPCODES,genomeKey,distance,structureOf,structureText,hasStructure} from './evolver-genome.mjs';

// The hall of fame keeps this many of the best harvested warriors. The grid, the duel rounds and the
// seeds come from the params (EVOLVER_DEFAULTS: soupWidth, soupHeight, duelRounds).
const HALL=20;
// yabevolver's tables. Opcodes the hill does not allow are left out.
const SOUP_OPS={mov:10,spl:6,djn:5,add:1,sub:1,mod:1,mul:1,div:1,jmp:1,jmz:1,jmn:1,seq:1,sne:1};
const MOD_W=[3,1,4,1,1,1,8];                 // F A B AB BA X I
const A_W=[5,6,0.5,3,4,0.5,2,2],B_W=[4,0.5,0.5,6,4,0.5,5,3]; // $ # @ < > * { }
const RATES={number:0.04,mode:0.03,modifier:0.02,instruction:0.015,crossover:0.02,swap:0.005,duplicate:0.005,replace:0.005,insert:0.005,delete:0.005,start:0.01};
const NEIGHBOURS=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const mod=(v,n)=>((v%n)+n)%n;

function opTable(rules){
 const ops=rules.opcodes.filter(op=>SOUP_OPS[OPCODES[op]]);
 return ops.length?{ops,weights:ops.map(op=>SOUP_OPS[OPCODES[op]])}:{ops:rules.opcodes,weights:rules.opWeights};
}
// Near values (within ±10 on nano, a couple of warrior lengths on bigger cores) half the time.
const localSpan=rules=>Math.min(rules.coreSize>>1,Math.max(10,2*rules.distance));
function soupValue(r,rules){const s=localSpan(rules);return r()<0.5?mod(r.int(2*s+1)-s,rules.coreSize):r.int(rules.coreSize);}
// r: a genome-style random function (r(), r.int, r.pick, r.weighted).
export function soupInstruction(r,rules,op=null){
 const t=opTable(rules);
 return [op??t.ops[r.weighted(t.weights)],r.weighted(MOD_W),r.weighted(A_W),soupValue(r,rules),r.weighted(B_W),soupValue(r,rules)];
}
export function soupGenome(r,rules){
 const n=1+r.int(rules.maxLength),code=Array.from({length:n},()=>soupInstruction(r,rules));
 return {code,start:r.int(n)};
}
// A copy of g with yabevolver's changes, line by line; mate: a neighbour of the same length that
// lines may come from. locked: keep the structure (no opcode changes, inserts or deletes; swaps only
// between lines with the same opcode).
export function soupMutate(g,r,rules,{mate=null,locked=false}={}){
 const code=g.code.map(i=>i.slice());let start=g.start;
 for(const x of code){
  for(const k of [3,5])if(r()<RATES.number){const u=r();x[k]=u<0.4?mod(x[k]+(r()<0.5?-1:1),rules.coreSize):u<0.9?mod(r.int(21)-10,rules.coreSize):r.int(rules.coreSize);}
  if(r()<RATES.mode){if(r()<0.5)x[2]=r.weighted(A_W);else x[4]=r.weighted(B_W);}
  if(r()<RATES.modifier)x[1]=r.weighted(MOD_W);
  if(!locked&&r()<RATES.instruction){const t=opTable(rules);x[0]=t.ops[r.weighted(t.weights)];}
 }
 if(mate&&mate.code.length===code.length&&(!locked||hasStructure(mate,structureOf(g))))for(let i=0;i<code.length;i++)if(r()<RATES.crossover)code[i]=mate.code[i].slice();
 // Structural changes, each at its rate per line of the original length.
 for(let k=0,lines=code.length;k<lines;k++){
  const n=code.length,u=r();let cut=RATES.swap;
  if(u<cut){const i=r.int(n),j=r.int(n);if(!locked||code[i][0]===code[j][0]){[code[i],code[j]]=[code[j],code[i]];}continue;}
  if(locked)continue;
  if(u<(cut+=RATES.duplicate)){if(n<rules.maxLength){const at=r.int(n+1);code.splice(at,0,code[r.int(n)].slice());if(at<=start)start++;}}
  else if(u<(cut+=RATES.replace))code[r.int(n)]=soupInstruction(r,rules);
  else if(u<(cut+=RATES.insert)){if(n<rules.maxLength){const at=r.int(n+1);code.splice(at,0,soupInstruction(r,rules));if(at<=start)start++;}}
  else if(u<cut+RATES.delete&&n>1){const i=r.int(n);code.splice(i,1);if(i<start)start--;}
 }
 if(r()<RATES.start)start=r.int(code.length);
 return {code,start:Math.max(0,Math.min(code.length-1,start))};
}

// duel(pairs, rounds) → Promise of one result per pair [a, b]: {wins, ties, losses} of a, or {error}.
// evaluator: scores the harvested warriors against the benchmark (exact on nano). layout: the seeds
// are a soup's cells in order, for a grid of this size (continuing the last run's soup): they keep
// their places instead of being scattered.
export class SoupEvolution extends Evolution{
 constructor(options){
  super(options);
  const p=this.params,rules=this.rules;
  this.duel=options.duel;this.width=Math.max(3,p.soupWidth|0);this.height=Math.max(3,p.soupHeight|0);this.duelRounds=Math.max(1,p.duelRounds|0);
  const n=this.width*this.height;
  this.rand=new Rng('soup:'+(options.seed??'1'));
  const r=this.rand.fn(),locked=!!this.structure,seeds=this.engine.s.seeds;
  // New code: yabevolver's tables, or the run's own (a Markov chain, or the kept structure).
  const fresh=()=>this.model||locked?this.ops.random(this.rand):soupGenome(r,rules);
  this.mutant=(g,mate)=>soupMutate(g,r,rules,{mate,locked});
  // Seeds: the seeds themselves and seedShare of the grid as mutants of them, scattered.
  const mutants=seeds.length?Math.max(seeds.length,Math.floor(n*p.seedShare)):0,order=Array.from({length:n},(_,i)=>i);
  const layout=options.layout&&options.layout.width===this.width&&options.layout.height===this.height&&seeds.length===n;
  if(!layout)for(let i=n-1;i>0;i--){const j=r.int(i+1);[order[i],order[j]]=[order[j],order[i]];}
  this.cells=new Array(n);
  order.forEach((c,k)=>{this.cells[c]=k<seeds.length?seeds[k]:k<mutants?this.ops.mutate(seeds[k%seeds.length],this.rand):fresh();});
  this.born=new Array(n).fill(this.before);this.sources=this.cells.map(g=>this.source(g));
  this.battles=0;this.duels=0;this.hall=[];this.scored=new Map();this.harvested=[];
  // One harvest per 250 duels, at least one per generation.
  this.harvestEvery=Math.max(1,Math.min(n,250));
  this.batch=Math.max(1,Math.min(256,Math.floor(n/4)));
 }
 get grid(){return {width:this.width,height:this.height};}
 // Counted on from the runs this one continues (before).
 get generation(){return this.before+Math.floor(this.battles/this.cells.length);}
 neighbour(c){const w=this.width,h=this.height,x=c%w,y=(c-x)/w,[dx,dy]=this.rand.choice(NEIGHBOURS);return mod(y+dy,h)*w+mod(x+dx,w);}
 // Up to `count` duels between neighbours, no cell in two of them.
 pairs(count){
  const used=new Set(),out=[],n=this.cells.length;
  for(let t=0;t<count*3&&out.length<count;t++){
   const c=this.rand.below(n),d=this.neighbour(c);
   if(c===d||used.has(c)||used.has(d))continue;
   used.add(c);used.add(d);out.push([c,d]);
  }
  return out;
 }
 async round(){
  const list=this.pairs(this.batch);
  const results=await this.duel(list.map(([c,d])=>[this.sources[c],this.sources[d]]),this.duelRounds,this.rand);
  const g=this.generation;
  list.forEach(([c,d],i)=>{
   const r=results[i];if(!r||r.error)return;
   const pc=3*r.wins+r.ties,pd=3*r.losses+r.ties;if(pc===pd)return;
   const [win,lose]=pc>pd?[c,d]:[d,c],mate=this.cells[this.neighbour(lose)];
   this.cells[lose]=this.mutant(this.cells[win],mate);this.sources[lose]=this.source(this.cells[lose]);this.born[lose]=g;
  });
  const before=this.battles;this.battles+=list.length;this.duels+=list.length;
  for(let k=Math.floor(before/this.harvestEvery);k<Math.floor(this.battles/this.harvestEvery);k++)await this.harvest(this.rand.below(this.cells.length));
 }
 // Score one cell's warrior against the benchmark; the hall of fame keeps the best HALL.
 async harvest(c){
  const g=this.cells[c],key=genomeKey(g);
  if(this.scored.has(key)){this.harvested.push(this.scored.get(key));return;}
  const r=await this.evaluator.evaluate(this.sources[c]);this.evaluations++;
  if(!r)return;
  this.scored.set(key,r.score);this.harvested.push(r.score);
  if(this.scored.size>20000)this.scored.delete(this.scored.keys().next().value);
  const m={genome:{code:g.code.map(i=>i.slice()),start:g.start},key,score:r.score,se:r.se,result:r,generation:this.generation};
  this.hall.push(m);this.hall.sort((a,b)=>b.score-a.score||a.genome.code.length-b.genome.code.length);this.hall.length=Math.min(this.hall.length,HALL);
 }
 async init(){await this.harvest(this.rand.below(this.cells.length));this.record();return this.stats();}
 async step(){const g=this.generation;while(this.generation===g)await this.round();this.record();return this.stats();}
 record(){
  const top=this.hall[0];
  if(top&&(!this.best||top.score>this.best.score))this.best={...top};
  const scores=this.harvested.length?this.harvested:this.hall.map(m=>m.score);this.harvested=[];
  const mean=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null,sorted=scores.slice().sort((a,b)=>a-b),median=sorted.length?sorted[sorted.length>>1]:null;
  const ref=this.best?.genome??this.cells[0],div=this.cells.reduce((s,g)=>s+distance(g,ref),0)/this.cells.length;
  this.history.push({generation:this.generation,best:this.best?.score??null,top:top?.score??null,mean,median,diversity:div,niches:this.kinds().length});
 }
 // The kinds of warrior in the grid: cells grouped by their opcodes in order, most cells first.
 kinds(){
  const by=new Map();
  this.cells.forEach((g,i)=>{const k=structureText(structureOf(g));let e=by.get(k);if(!e)by.set(k,e={structure:k,cells:[]});e.cells.push(i);});
  return [...by.values()].sort((a,b)=>b.cells.length-a.cells.length);
 }
 get population(){return this.view();}
 ranked(){return this.view();}
 snapshot(){return this.cells.map(g=>({code:g.code.map(i=>i.slice()),start:g.start}));}
 // The grid in cell order (row by row), with the benchmark score of warriors that were harvested.
 view(){return this.cells.map(g=>{const s=this.scored.get(genomeKey(g));return {genome:g,score:s??null,fit:s??null};});}
 profiles(){return null;}
 get nicheRadius(){return 0;}
}

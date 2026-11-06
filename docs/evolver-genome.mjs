// SPDX-License-Identifier: GPL-2.0-or-later
// Whole-warrior genomes for the evolver: random code, mutation, crossover and Redcode output.
// A genome is {code:[[op,mod,aMode,a,bMode,b], …], start}, with exMARS's numbering for opcodes,
// modifiers and modes (insn.h) so an assembled warrior (fighter-client assemble()) is a genome
// as it is. Fields are kept in 0 … coreSize−1 and written signed. Every operator returns a
// genome that is valid for its rules: 1 … maxLength instructions, a start inside the code, and
// only ICWS '94 instructions the hill allows (no LDP/STP on a no-P-space hill).
export const OPCODES=['dat','spl','mov','djn','add','jmz','sub','seq','sne','slt','jmn','jmp','nop','mul','mod','div','ldp','stp'];
export const MODIFIERS=['f','a','b','ab','ba','x','i'];
export const MODES=['$','#','@','<','>','*','{','}'];
const OP=Object.fromEntries(OPCODES.map((o,i)=>[o,i])),MOD=Object.fromEntries(MODIFIERS.map((m,i)=>[m,i]));
const IMMEDIATE=1;
// How often each opcode is drawn for new code: the ones small warriors are made of come first.
const OP_WEIGHTS={dat:6,spl:7,mov:12,djn:5,add:5,jmz:3,sub:2,seq:2,sne:2,slt:1,jmn:3,jmp:5,nop:1,mul:1,mod:1,div:1,ldp:1,stp:1};
const MODE_WEIGHTS=[8,6,4,3,4,2,3,4];

// Seeded random numbers, so the same seed gives the same run.
export function rng(seed){
 let h=1779033703^String(seed).length;
 for(const c of String(seed)){h=Math.imul(h^c.charCodeAt(0),3432918353);h=h<<13|h>>>19;}
 let a=h>>>0;
 const next=()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
 next.int=n=>Math.floor(next()*n);
 next.pick=list=>list[next.int(list.length)];
 next.weighted=weights=>{let total=0;for(const w of weights)total+=w;let r=next()*total;for(let i=0;i<weights.length;i++){r-=weights[i];if(r<0)return i;}return weights.length-1;};
 next.state=()=>a;next.restore=s=>{a=s|0;};
 return next;
}

// What the evolver may write for these settings. warriorLength (optional) caps the evolved warriors
// below the hill's maxLength, which still holds for the opponents: a 20-instruction warrior for the LP hill.
export function genomeRules(config){
 const coreSize=config.coreSize,maxLength=Math.max(1,Math.min(config.warriorLength>0?config.warriorLength:config.maxLength,config.maxLength,coreSize));
 // LDP and STP stay out: P-space keeps state between rounds, so a score would depend on the round order.
 const opcodes=OPCODES.map((_,i)=>i).filter(i=>i<OP.ldp);
 return {coreSize,maxLength,opcodes,opWeights:opcodes.map(i=>OP_WEIGHTS[OPCODES[i]]),distance:config.distance||config.maxLength};
}
const mod=(v,n)=>((v%n)+n)%n;
export const signed=(v,n)=>{v=mod(v,n);return v>n/2?v-n:v===n/2&&n%2===0?-v:v;};
// The usual modifier for an opcode and its modes (ICWS '94 defaults), drawn most of the time.
export function defaultModifier(op,am,bm){
 const o=OPCODES[op];
 if(o==='dat'||o==='nop')return MOD.f;
 if(['jmp','jmz','jmn','djn','spl'].includes(o))return MOD.b;
 if(am===IMMEDIATE)return MOD.ab;
 if(bm===IMMEDIATE)return MOD.b;
 if(o==='mov'||o==='seq'||o==='sne')return MOD.i;
 if(o==='slt')return MOD.b;
 return MOD.f;
}
// A field value: small offsets (inside or near the warrior) half the time, anywhere in the core otherwise.
function randomField(r,rules){
 const span=Math.min(rules.coreSize>>1,Math.max(4,rules.distance*2));
 return r()<0.5?mod(r.int(2*span+1)-span,rules.coreSize):r.int(rules.coreSize);
}
export function randomInstruction(r,rules){
 const op=rules.opcodes[r.weighted(rules.opWeights)],am=r.weighted(MODE_WEIGHTS),bm=r.weighted(MODE_WEIGHTS);
 const m=r()<0.7?defaultModifier(op,am,bm):r.int(MODIFIERS.length);
 return [op,m,am,randomField(r,rules),bm,randomField(r,rules)];
}
export function randomGenome(r,rules,length=1+r.int(rules.maxLength)){
 const code=Array.from({length:Math.max(1,Math.min(rules.maxLength,length))},()=>randomInstruction(r,rules));
 return {code,start:r.int(code.length)};
}
// Clamp anything (an assembled seed, a saved genome) into the rules.
export function normalize(g,rules){
 let code=(g.code||[]).slice(0,rules.maxLength).map(i=>{
  let [op,m,am,a,bm,b]=i.map(x=>Math.trunc(Number(x)||0));
  if(!rules.opcodes.includes(op))op=OP.dat;
  m=mod(m,MODIFIERS.length);am=mod(am,MODES.length);bm=mod(bm,MODES.length);
  return [op,m,am,mod(a,rules.coreSize),bm,mod(b,rules.coreSize)];
 });
 if(!code.length)code=[[OP.dat,MOD.f,IMMEDIATE,0,IMMEDIATE,0]];
 const start=Math.trunc(Number(g.start)||0);
 return {code,start:start>=0&&start<code.length?start:0};
}
export const genomeKey=g=>g.start+':'+g.code.map(i=>i.join(',')).join(';');
const clone=g=>({code:g.code.map(i=>i.slice()),start:g.start});

// One point mutation. kind picks among field, opcode, modifier, mode, insert, delete, duplicate, swap, start.
export const MUTATIONS=['field','opcode','modifier','mode','insert','delete','duplicate','swap','start'];
export function mutateOnce(g,r,rules,{structural=0.3}={}){
 const c=clone(g),n=c.code.length,i=r.int(n);
 const kind=r()<structural?r.pick(['insert','delete','duplicate','swap','start']):r.pick(['field','field','field','opcode','modifier','mode','mode']);
 const ins=c.code[i];
 switch(kind){
  case 'field':{
   const k=r()<0.5?3:5;
   // Creep by a little (steps and offsets are tuned this way), or a new value.
   ins[k]=r()<0.5?mod(ins[k]+(r()<0.5?-1:1)*(1+r.int(3)),rules.coreSize):randomField(r,rules);break;
  }
  case 'opcode':{ins[0]=rules.opcodes[r.weighted(rules.opWeights)];if(r()<0.7)ins[1]=defaultModifier(ins[0],ins[2],ins[4]);break;}
  case 'modifier':ins[1]=r()<0.4?defaultModifier(ins[0],ins[2],ins[4]):r.int(MODIFIERS.length);break;
  case 'mode':{const k=r()<0.5?2:4;ins[k]=r.weighted(MODE_WEIGHTS);break;}
  case 'insert':
   if(n<rules.maxLength){const at=r.int(n+1);c.code.splice(at,0,randomInstruction(r,rules));if(at<=c.start&&n>0)c.start++;}
   else c.code[i]=randomInstruction(r,rules);
   break;
  case 'delete':if(n>1){c.code.splice(i,1);if(i<c.start)c.start--;}break;
  case 'duplicate':{
   const copy=ins.slice();
   if(n<rules.maxLength){const at=r.int(n+1);c.code.splice(at,0,copy);if(at<=c.start)c.start++;}
   else c.code[r.int(n)]=copy;
   break;
  }
  case 'swap':{const j=r.int(n);[c.code[i],c.code[j]]=[c.code[j],c.code[i]];break;}
  case 'start':c.start=r.int(n);break;
 }
 if(c.start>=c.code.length)c.start=c.code.length-1;
 if(c.start<0)c.start=0;
 return c;
}
// rate: the mean number of point mutations per child (at least one, so a child differs).
export function mutate(g,r,rules,{rate=1.5,structural=0.3}={}){
 let c=g,count=1;
 // Geometric count with mean `rate`.
 const p=1/Math.max(1,rate);while(r()>p&&count<20)count++;
 for(let k=0;k<count;k++)c=mutateOnce(c,r,rules,{structural});
 return c;
}
// Crossover: two-point on the instruction lists (lengths may differ) or uniform per instruction.
export function crossover(a,b,r,rules){
 if(r()<0.5&&a.code.length===b.code.length){
  const code=a.code.map((ins,i)=>(r()<0.5?ins:b.code[i]).slice());
  return {code,start:r()<0.5?a.start:b.start};
 }
 const i=r.int(a.code.length+1),j=r.int(b.code.length+1),k=Math.min(a.code.length,i+r.int(a.code.length-i+1)),l=Math.min(b.code.length,j+r.int(b.code.length-j+1));
 let code=[...a.code.slice(0,i),...b.code.slice(j,l),...a.code.slice(k)].map(x=>x.slice());
 if(!code.length)code=[a.code[0].slice()];
 if(code.length>rules.maxLength)code=code.slice(0,rules.maxLength);
 const start=a.start<i?a.start:Math.min(code.length-1,Math.max(0,a.start-(k-i)+(l-j)));
 return {code,start:start>=0&&start<code.length?start:0};
}
// A Markov chain of instructions learnt from warriors (genomes): how often each instruction shape
// (opcode, modifier and both modes) follows the one, two, … before it, with "^" before the first
// and "$" after the last, so the chain also learns lengths. Fields come with the shape: an A/B pair
// seen on that shape, or else on that opcode. Shapes the rules leave out (LDP, STP) are dropped.
const shapeOf=ins=>ins[0]+'.'+ins[1]+'.'+ins[2]+'.'+ins[4];
export function markovModel(genomes,rules,order=2){
 const contexts=new Map(),fields=new Map(),opFields=new Map(),starts=[];let warriors=0,instructions=0;
 const count=(key,next)=>{let m=contexts.get(key);if(!m)contexts.set(key,m=new Map());m.set(next,(m.get(next)||0)+1);};
 const push=(map,key,value)=>{let list=map.get(key);if(!list)map.set(key,list=[]);list.push(value);};
 for(const g of genomes){
  const code=(g.code||[]).filter(i=>rules.opcodes.includes(i[0])).slice(0,rules.maxLength);
  if(!code.length)continue;
  warriors++;instructions+=code.length;starts.push(Math.min(g.start|0,code.length-1)/code.length);
  const seq=['^',...code.map(shapeOf),'$'];
  for(let i=1;i<seq.length;i++)for(let k=0;k<=order&&k<=i;k++)count(k+'|'+seq.slice(i-k,i).join(' '),seq[i]);
  for(const ins of code){const pair=[((ins[3]%rules.coreSize)+rules.coreSize)%rules.coreSize,((ins[5]%rules.coreSize)+rules.coreSize)%rules.coreSize];push(fields,shapeOf(ins),pair);push(opFields,ins[0],pair);}
 }
 // Tables as arrays, so drawing is a weighted pick.
 const table=new Map([...contexts].map(([key,m])=>[key,{next:[...m.keys()],weights:[...m.values()]}]));
 return {order,contexts:table,fields,opFields,starts,warriors,instructions,shapes:fields.size};
}
// A warrior drawn from the chain: the longest context it knows, backing off to a shorter one now
// and then (backoff), so it recombines what it learnt instead of copying whole warriors.
export function markovGenome(r,model,rules,{backoff=0.25}={}){
 if(!model?.warriors)return randomGenome(r,rules);
 const history=['^'],code=[];
 for(let guard=0;code.length<rules.maxLength&&guard<rules.maxLength*4;guard++){
  const key=k=>k+'|'+history.slice(history.length-k).join(' ');
  let k=Math.min(model.order,history.length);
  while(k>0&&(r()<backoff||!model.contexts.has(key(k))))k--;
  const t=model.contexts.get(key(k)),next=t.next[r.weighted(t.weights)];
  if(next==='$'){if(code.length)break;continue;}
  const [op,m,am,bm]=next.split('.').map(Number);
  const pairs=model.fields.get(next)??model.opFields.get(op);
  const [a,b]=pairs?r.pick(pairs):[randomField(r,rules),randomField(r,rules)];
  code.push([op,m,am,a,bm,b]);history.push(next);
 }
 if(!code.length)return randomGenome(r,rules);
 return {code,start:Math.min(code.length-1,Math.floor(r.pick(model.starts)*code.length))};
}
// How unlike two genomes are, 0 … 1 (for the population's diversity).
export function distance(a,b){
 const n=Math.max(a.code.length,b.code.length);let d=0;
 for(let i=0;i<n;i++){const x=a.code[i],y=b.code[i];if(!x||!y){d+=1;continue;}let s=0;for(let k=0;k<6;k++)if(x[k]!==y[k])s++;d+=s/6;}
 return d/n;
}
// Niches of a population, best first: each warrior joins the first better leader within `radius`,
// or leads a new niche. Returns the niche index of every warrior and the leaders' indices.
export function nicheGroups(genomes,radius){
 const leaders=[],group=genomes.map((g,i)=>{
  const k=leaders.findIndex(l=>distance(g,genomes[l])<radius);
  if(k>=0)return k;leaders.push(i);return leaders.length-1;
 });
 return {group,leaders};
}
// Redcode that pMARS and exMARS both assemble to exactly this genome.
export function renderInstruction(ins,coreSize){
 const [op,m,am,a,bm,b]=ins;
 return `${OPCODES[op]}.${MODIFIERS[m]}`.padEnd(7)+` ${MODES[am]}${signed(a,coreSize)}, ${MODES[bm]}${signed(b,coreSize)}`;
}
export function renderGenome(g,rules,{name='Evolved',author='corewar.dev evolver',strategy=[],header=';redcode-94'}={}){
 const lines=[header,`;name ${name}`,`;author ${author}`,...strategy.map(s=>`;strategy ${s}`),';assert 1'];
 g.code.forEach((ins,i)=>lines.push((i===g.start?'start':'').padEnd(7)+renderInstruction(ins,rules.coreSize)));
 lines.push('       end start');
 return lines.join('\n')+'\n';
}
// The hill header line pMARS hills expect (;redcode-nano, ;redcode-tiny, …).
export function redcodeHeader(config){
 if(config.coreSize===80&&config.maxLength===5)return ';redcode-nano';
 if(config.coreSize===800&&config.maxLength===20)return ';redcode-tiny';
 if(config.coreSize===8000&&config.maxLength===200&&config.tasks===8)return ';redcode-lp';
 if(config.coreSize===8000&&config.maxLength===100)return config.noPspace?';redcode-94nop':';redcode-94';
 return ';redcode-94';
}

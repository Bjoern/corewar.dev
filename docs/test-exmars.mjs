// SPDX-License-Identifier: GPL-2.0-or-later
// exMARS (docs/exmars.mjs) against pMARS (docs/engine.mjs): the same wins, ties, losses and
// scores on every hill it runs, and pMARS for everything it must not run.
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {Engine,settings} from './engine.mjs';
import {ExmarsRunner,exmarsBlocker,permutationRoundsOf,separationOf} from './exmars.mjs';
import {runMatch,plannedEngine,engineSummary} from './optimizer-fitness.mjs';
import {evaluateFormula,formulaTable,plainFormula,scoreFrom} from './score-formula.mjs';

const root=new URL('../warriors_public/',import.meta.url);
const collection=(name,sub='')=>{const dir=new URL(name+'/'+(sub?sub+'/':''),root);return readdirSync(dir).filter(f=>/\.red$/i.test(f)).sort().map(f=>({name:f,source:readFileSync(new URL(f,dir),'latin1')}));};
const suite=name=>JSON.parse(readFileSync(new URL(name+'/suite.benchmark.json',root),'utf8')).parameters;
async function pmars(config,sources){
 const engine=await Engine.create(config,{visual:false});
 engine.compile(sources);engine.setDebug(false);engine.setTrace(false);engine.start();
 let done=0;while(!done){done=engine.module._web_advance(100000,8);if(done<0)throw new Error('pMARS advance failed');}
 const u=engine.update(true);
 return {completed:u.completed,warriors:u.warriors.map(({wins,ties,losses,score})=>({wins,ties,losses,score}))};
}
const runner=new ExmarsRunner();
const strip=r=>({completed:r.completed,warriors:r.warriors.map(({wins,ties,losses,score})=>({wins,ties,losses,score}))});
// Deterministic pair picks (a small LCG) so a failure can be reproduced.
let state=12345;const pick=list=>list[(state=(state*1103515245+12345)>>>0)%list.length];
let compared=0;
async function same(label,config,...warriors){
 const c=settings({...config,warriors:warriors.length,brief:true,verbose:false,sort:false,fixedSeries:false,assembleOnly:false});
 const sources=warriors.map(w=>w.source),names=warriors.map(w=>w.name).join(' vs ');
 const ex=await runner.run(c,sources);
 assert.ok(!ex.fallback,`${label}: exMARS fell back (${ex.fallback}) for ${names}`);
 assert.equal(ex.engine,'exmars');
 assert.deepEqual(strip(ex),await pmars(c,sources),`${label}: ${names}`);
 compared++;
}
const hills=[
 ['nano exact (permutation)',{...suite('nanobm07'),permutate:true,rounds:142},collection('nanobm07'),10,()=>''],
 ['nano sampled',{...suite('nanobm07'),permutate:false,rounds:250},collection('nanobm07'),10,i=>String(10+i*7)],
 ['tiny',suite('tinybm04'),collection('tinybm04'),8,i=>String(100+i*61)],
 ['94nop (P-space size 1)',{...suite('94top50'),pspace:1},collection('94top50','HILL32'),5,i=>String(150+i*997)],
 ['standard with P-space',suite('psptop50'),collection('psptop50','HILL32'),5,i=>String(4000+i*13)],
 ['lp',suite('lp_koenigstuhl'),collection('lp_koenigstuhl','HILL32'),3,i=>String(300+i*1009)],
];
for(const [label,config,warriors,count,position] of hills){
 for(let i=0;i<count;i++){const a=pick(warriors),b=i===0?a:pick(warriors);await same(label,{...config,fixedPosition:position(i)},a,b);}
}
assert.equal(permutationRoundsOf({coreSize:80,distance:5,maxLength:5}),142);
const pairs=compared;

// Melee: 3 to 10 warriors with seeds, on every hill above (distance 0 too).
const melees=[
 ['nano',{...suite('nanobm07'),permutate:false,rounds:200},collection('nanobm07'),[3,4,6,10]],
 ['tiny',{...suite('tinybm04'),rounds:120},collection('tinybm04'),[3,5,8]],
 ['tiny, distance 0',{...suite('tinybm04'),distance:0,rounds:60},collection('tinybm04'),[4]],
 ['94nop',{...suite('94top50'),pspace:1,rounds:30},collection('94top50','HILL32'),[3,6]],
 ['standard with P-space',{...suite('psptop50'),rounds:30},collection('psptop50','HILL32'),[3,5]],
 ['lp',{...suite('lp_koenigstuhl'),rounds:30},collection('lp_koenigstuhl','HILL32'),[3]],
];
for(const [label,config,warriors,sizes] of melees)for(const [k,n] of sizes.entries()){
 const list=Array.from({length:n},()=>pick(warriors));
 await same(`${label} melee of ${n}`,{...config,fixedPosition:String(separationOf(config)+7+k*31)},...list);
}
// Without a seed placements are random, so only the shape is checked: each row adds up to the rounds.
{const c=settings({...suite('nanobm07'),permutate:false,warriors:5,rounds:100,fixedPosition:''}),list=collection('nanobm07').slice(0,5);
 const r=await runner.run(c,list.map(w=>w.source));assert.equal(r.engine,'exmars');
 for(const w of r.warriors)assert.equal(w.wins+w.ties+w.losses,100);}
// Custom formulas, scored from exMARS's survivor counts as pMARS scores them.
for(const formula of ['10*W-S','(S==1)*W*W+(S>1&&S<W)*(W-S)%3-!S','W/S*2-(S>2)','S*S%W'])for(const n of [2,4]){
 const list=Array.from({length:n},()=>pick(collection('tinybm04')));
 await same(`formula ${formula}, ${n} warriors`,{...suite('tinybm04'),formula,rounds:50,fixedPosition:'333'},...list);
}
const melee=compared-pairs;

// Settings exMARS must leave to pMARS.
const base=settings({...suite('tinybm04'),warriors:2});
for(const [change,reason] of [[{rules88:true},/’88/],[{formula:'X*2'},/formula/],[{formula:'S=2'},/formula/],[{formula:'W/(S-1)'},/formula/],[{warriors:1},/single/],[{fixedPosition:'k1'},/seed/],
 [{permutate:true,rounds:100},/permutation/],[{pspace:7},/P-space size/],[{coreSize:65536,distance:100,maxLength:100},/65535/],[{distance:10},/distance/]])
 assert.match(exmarsBlocker({...base,...change})??'',reason,JSON.stringify(change));
assert.equal(exmarsBlocker(base),null);
// Decided after assembly: a permutation with P-space, P-space on a no-P-space hill, and assembly errors.
const pspaceWarrior=collection('psptop50','HILL32').find(w=>/^[^;]*\b(ldp|stp)\b/im.test(w.source));
const tinyPspace=';redcode\n;name reader\nldp.ab #0, #1\nspl 0\njmp -1\nend\n';
assert.match((await runner.run({...base,permutate:true,rounds:permutationRoundsOf(base)},[tinyPspace,tinyPspace])).fallback,/permutation with P-space/);
assert.match((await runner.run(settings({...suite('94top50'),warriors:2}),[pspaceWarrior.source,pspaceWarrior.source])).fallback,/no-P-space/);
assert.equal((await runner.run(base,['mov 0, 1\nbogus 1, 2\n','mov 0, 1\n'])).fallback,'assembly');
// After all that the same runner still agrees with pMARS.
const tiny=collection('tinybm04');await same('tiny after fallbacks',{...suite('tinybm04'),fixedPosition:'321'},tiny[0],tiny[1]);
// The optimizer's runMatch: the same result with and without exMARS, and it says which engine ran.
const nano=collection('nanobm07'),nanoConfig=suite('nanobm07');
for(const job of [{config:nanoConfig,a:nano[3].source,b:nano[9].source,rounds:142,permutate:true},{config:nanoConfig,a:nano[5].source,b:nano[1].source,rounds:100,position:'37'}]){
 const ex=await runMatch(job),pm=await runMatch(job,{useExmars:false});
 assert.equal(ex.engine,'exmars');assert.equal(pm.engine,'pmars');
 assert.deepEqual([ex.wins,ex.ties,ex.losses],[pm.wins,pm.ties,pm.losses]);
}
assert.equal((await runMatch({config:{...nanoConfig,rules88:true},a:'mov 0, 1\n',b:'mov 0, 1\n',rounds:10,position:'40'})).fallback,'ICWS ’88 rules');
assert.deepEqual(plannedEngine(nanoConfig,{exact:true,rounds:142}),{engine:'exmars',why:''});
assert.equal(plannedEngine({...nanoConfig,formula:'X'},{exact:false,rounds:250}).engine,'pmars');
assert.equal(engineSummary({exmars:97,pmars:3}),'exMARS 97% · pMARS 3%');
// The formula port: pMARS's precedence, C division, 32-bit overflow and errors.
for(const [text,value] of [['1+2*3',7],['(1+2)*3',9],['7/2',3],['-7/2',-3],['-7%3',-1],['2<3==1',1],['1||0&&0',1],['!0+!5',1],['- -3',3],
 ['2147483647',2147483647],['-2147483648',-2147483648],['2147483647+1',null],['2147483648',null],['65536*32768',null],['1/0',null],['5%0',null],['(1',null],['1 2',null],['',null]])
 assert.equal(evaluateFormula(text,{W:2,S:1}),value,text);
assert.equal(plainFormula('(W*W-1)/S'),true);assert.equal(plainFormula('X+1'),false);assert.equal(plainFormula('S==1'),true);assert.equal(plainFormula('W=3'),false);
assert.deepEqual(formulaTable('(W*W-1)/S',2),[3,1]);assert.equal(scoreFrom([5,10,7],[3,1]),37);
console.log(`PASS: exMARS equals pMARS on ${compared} matches (${compared-melee} pairs: nano exact and sampled, tiny, 94nop, P-space, lp; ${melee} melees of 3–10 warriors and custom formulas); settings and warriors it must not run go to pMARS.`);

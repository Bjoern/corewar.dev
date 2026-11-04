// SPDX-License-Identifier: GPL-2.0-or-later
// Constant optimizer: template parser (ported from cwopt's tests/test_template.py), search
// determinism and resume, and exact scoring on the pMARS engine.
import assert from 'node:assert/strict';
import {parseTemplate,TemplateError,signed,templateConstants,fromMetcalf} from './optimizer-template.mjs';
import {Annealing,Genetic,restoreMethod} from './optimizer-search.mjs';
import {Evaluator,runMatch,scoringMode} from './optimizer-fitness.mjs';
import {examples} from './optimizer-examples.mjs';
const NANO=templateConstants({coreSize:80,maxLength:5,distance:5,tasks:80,cycles:800,pspace:5});
const STD=templateConstants({coreSize:8000,maxLength:100,distance:100,tasks:8000,cycles:80000,pspace:500});
const parse=(text,c=NANO)=>parseTemplate(text,c);
const values=t=>t.variables.map(v=>v.values);
// Markers
{const v=parse('dat !, 0\n').variables[0];assert.equal(v.values.length,80);assert.equal(v.values[0],'-40');assert.equal(v.values.at(-1),'39');assert.equal(v.name,'1:5');}
assert.deepEqual(parse('dat !(1..10), 0').variables[0].values,Array.from({length:10},(_,i)=>String(i+1)));
assert.deepEqual(parse('dat !(1..10, 3), 0').variables[0].values,['1','4','7','10']);
assert.deepEqual(parse('dat !( 2 .. 8 , 2 ), 0').variables[0].values,['2','4','6','8']);
assert.deepEqual(parse('dat !(75..79), 0').variables[0].values,['-5','-4','-3','-2','-1']);
assert.equal(signed(77,80),-3);assert.equal(signed(40,80),-40);assert.equal(signed(39,80),39);
{const t=parse('spl.![a,b,f] ![#,$]!(1..10), ![<,{]5');assert.deepEqual(values(t),[['a','b','f'],['#','$'],Array.from({length:10},(_,i)=>String(i+1)),['<','{']]);assert.equal(t.render([2,1,0,1]),'spl.f $1, {5');}
assert.deepEqual(parse('![mov, djn] 0, 1').variables[0].values,['mov','djn']);
assert.equal(parse('dat !(1..79)?coprime, 0').variables[0].values.length,32);
assert.deepEqual(parse('dat !(1..9)?odd, 0').variables[0].values,['1','3','5','7','9']);
assert.deepEqual(parse('dat !(1..20)?odd?coprime, 0').variables[0].values,['1','3','7','9','11','13','17','19']);
assert(parse('dat !(-5..-1)?coprime, 0').variables[0].values.includes('-3'));
assert.throws(()=>parse('![mov,djn]?odd 0, 1'),TemplateError);
{const t=parse('step equ !(1..79)?coprime:37\ndat ![<,{]:{, !:-3\n');assert.deepEqual(t.variables.map(v=>v.values[v.start]),['37','{','-3']);}
{const v=parse('dat !:77, 0').variables[0];assert.equal(v.values[v.start],'-3');}
assert.throws(()=>parse('step equ !(1..79)?coprime:38'),/not in the domain/);
assert.equal(parse('dat !(1..5), 0').variables[0].start,null);
{const v=parseTemplate('dat !(MINDISTANCE..CORESIZE/2 - 1, (2+1)*1), 0',STD).variables[0];assert.deepEqual([v.values[0],v.values[1],v.values.at(-1)],['100','103','3997']);}
{const v=parse('dat !(-CORESIZE/4..PSPACESIZE % 3), 0').variables[0];assert.deepEqual([v.values[0],v.values.at(-1)],['-20','2']);}
assert.deepEqual(parse('step  equ !(1..79)\ngap EQU !(1..3)+!(1..2)\n  dat !, 0\n').variables.map(v=>v.name),['step','gap','gap#2','3:7']);
{const t=parse(';name Wow!\n;assert CORESIZE != 80 || 1\nx equ 5 ; tune! later\nfor x != 3\ndat !, 0\nrof\n');assert.equal(t.variables.length,1);assert.equal(t.variables[0].line,5);}
assert.equal(parse('  if (CORESIZE!=80)\n  dat !=0\n  endif\n').variables.length,0);
for(const [text,[line,col]] of Object.entries({'dat 0, 0\ndat !(1..5, 0\n':[2,5],'dat !(5..1), 0':[1,6],'dat !(1..100), 0':[1,6],'dat !(0..80, 80), 0':[1,5],'dat !?prime, 0':[1,6],'dat !(1..FOO), 0':[1,7],'dat ![mov,,djn], 0':[1,6],'dat !:, 0':[1,6]})){
 try{parse(text);assert.fail('no error for '+text);}catch(e){assert(e instanceof TemplateError,text);assert.deepEqual([e.line,e.col],[line,col],text+': '+e.message);}
}
assert.equal(parse('dat 0-!(-3..-1), 1+ !(-2..2)').render([0,0]),'dat 0-(-3), 1+ (-2)');
{const text=';redcode-nano\n;name t!\nstep equ !(1..79)?coprime:37\ngap equ !(-10..10)\nspl #0, ![<,{]gap\nmov.![i,f] 0, @1\n![jmp,djn] -1, !\n';
 const t=parse(text),idx=[5,3,1,0,1,70],back=t.writeBack(idx),t2=parse(back);
 assert.deepEqual(values(t2),values(t));assert.deepEqual(t2.variables.map(v=>v.name),t.variables.map(v=>v.name));
 assert.deepEqual(t2.startIndices(),idx);assert.equal(t2.render(idx),t.render(idx));assert(back.includes('!(1..79)?coprime:'));assert.equal(parse(t2.writeBack(idx)).writeBack(idx),back);}
{const t=parse('a equ !(1..5):2\ndat ![#,$]:$a, 0\n'),segs=t.segments(t.startIndices());assert.equal(segs.map(s=>s.text).join(''),t.render(t.startIndices()));assert.deepEqual(segs.filter(s=>s.variable).map(s=>s.text),['2','$']);}
assert.equal(fromMetcalf('step equ !\nmov !%10, 1 ; wow!\n'),'step equ !(0..CORESIZE-1)\nmov !(0..9), 1 ; wow!\n');
// Search: a smooth synthetic score; seeded runs repeat, and a saved state continues exactly.
const target=[17,3,61],sizes=[80,5,79];
const fake=x=>({score:300-x.reduce((d,v,i)=>d+Math.abs(v-target[i]),0),se:0,complete:true});
function drive(method,steps){for(let i=0;i<steps;i++){const p=method.propose();method.observe(p,fake(p.x));}return method;}
for(const make of [()=>new Annealing(sizes,[null,null,null],7),()=>new Genetic(sizes,[null,null,null],7,{population:20})]){
 const a=drive(make(),600),b=drive(make(),600);assert.deepEqual(a.best(),b.best());
 const c=drive(make(),300),resumed=drive(restoreMethod(JSON.parse(JSON.stringify(c.state()))),300);assert.deepEqual(resumed.best(),a.best());
 assert(a.best().score>=290,a.constructor.name+' finds the optimum region: '+a.best().score);
}
{const sa=drive(new Annealing(sizes,[0,0,0],1),200);assert.deepEqual(sa.best().x,target,'sweep finds the separable optimum');}
// Scoring on pMARS: exact nano mode is one permutation match per opponent.
const template=examples.find(e=>e.id==='alcoholism').source;
const nano={coreSize:80,cycles:800,tasks:80,maxLength:5,distance:5,pspace:5,rules88:false,noPspace:false};
const t=parseTemplate(template,templateConstants(nano));
assert.deepEqual(t.variables.map(v=>v.name),['step','6:12']);
const imp={name:'Imp',source:';redcode\n;name Imp\nmov.i 0, 1\n'},dwarf={name:'Dwarf',source:';redcode\n;name Dwarf\nadd #4, 3\nmov 2, @2\njmp -2\ndat 0, 0\n'};
const mode=scoringMode(nano,[template,imp.source,dwarf.source]);assert(mode.exact);assert.equal(mode.rounds,142);
const ev=new Evaluator({runJob:runMatch,config:nano,opponents:[imp,dwarf]});ev.setMode(mode);
const start=await ev.evaluate(t.render(t.startIndices()));
assert(start.complete&&start.se===0);assert.equal(start.opponents.length,2);
for(const o of start.opponents)assert.equal(o.wins+o.ties+o.losses,142);
assert.deepEqual(await ev.evaluate(t.render(t.startIndices())),start,'cached');assert.equal(ev.cached,1);
assert.equal(await ev.evaluate('mov 0, junk\n'),null,'invalid candidate');
// Sampled mode with seeded slices repeats.
const sampled={exact:false,rounds:50};
const e1=new Evaluator({runJob:runMatch,config:nano,opponents:[imp,dwarf],options:{slices:5}}),e2=new Evaluator({runJob:runMatch,config:nano,opponents:[imp,dwarf],options:{slices:5}});
e1.setMode(sampled);e2.setMode(sampled);
const s1=await e1.evaluate(t.render(t.startIndices())),s2=await e2.evaluate(t.render(t.startIndices()));
assert.deepEqual(s1,s2);assert.equal(s1.rounds,50);
// Every example parses for its benchmark's core.
for(const e of examples){const c=e.id==='alcoholism'?nano:{coreSize:8000,maxLength:100,distance:100,tasks:8000,cycles:80000,pspace:500};assert(parseTemplate(e.source,templateConstants(c)).variables.length>0,e.id);}
console.log(`PASS: optimizer template parser, search determinism and resume, exact and sampled scoring (start ${start.score.toFixed(1)}).`);

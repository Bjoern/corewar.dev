// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import {Engine, stepAddressHint} from './engine.mjs';
const e=await Engine.create({warriors:1,cycles:1000});
e.compile([';redcode\n;assert 1\njmp 0\n']);e.start();
let output='';const io={output:t=>output+=t};
async function cmd(text,input){output='';return e.debuggerCommand(text,{...io,...(input?{input}: {})});}
await cmd('calc x=7~calc x*6');assert(output.includes('42'));
await cmd('fill 10,12~mov.i 0,1');assert.match(e.inspect(10),/MOV.I/);assert.match(e.inspect(12),/MOV.I/);
await cmd('edit 13',()=>Promise.resolve('dat 7,9'));assert.match(e.inspect(13),/#?\s*7,/);
e.setBreakpoint(10,false);await cmd('trace 10');assert(e.breakpoint(10));await cmd('untrace 10');assert(!e.breakpoint(10));
await cmd('macro alive');assert(/1\n/.test(output));
await cmd('macro tproc');assert(/1\n/.test(output));assert(!output.includes('Bad argument'));
await cmd('calc x=0~!!~calc x=x+1~!5~calc x');assert(output.includes('5'));
let r=await cmd('macro f5');let executed=0;
while(r.action===2){e.setDebug(false);let left=r.steps;while(left>0){const u=e.advance(Math.min(left,100000),4);left-=u.executed;executed+=u.executed;}r=await e.debuggerCommand(undefined,io);}
assert.equal(executed,2,'Real f5 macro steps twice');
let lines=['custom=calc 123','.'];await cmd('macro , user',()=>Promise.resolve(lines.shift()??'a'));await cmd('macro custom');assert(output.includes('123'));
let pulses=0;const timer=setInterval(()=>{pulses++;if(pulses>=3)e.cancelDebugger();},10);
r=await cmd('calc 1~!');clearInterval(timer);assert(r.cancelled);assert(pulses>=3);
await cmd('calc 6*7');assert(output.includes('42'));
await cmd('shell');assert(output.includes('unavailable'));
r=await cmd('step 23');assert.equal(r.action,2);assert.equal(e.update(false).warriors[0].pc,23);
{ // Dwarf vs Imp: plain `s` runs each warrior's own next instruction; `s 1` moves the
  // current warrior's PC to address 1 first (native pMARS: s,s,s 1,s 1 leaves both at 2).
  const d=await Engine.create({warriors:2,cycles:80000,rounds:1});
  d.compile([';redcode-94\n;name Imp\n;assert 1\nmov.i 0, 1\nend\n',';redcode-94\n;name Dwarf\n;assert 1\nadd.ab #4, bomb\nmov.i bomb, @bomb\njmp -2\nbomb dat.f #0, #0\nend\n']);
  let u=d.start();d.setTrace(true);const dwarf=u.warriors[1].pc;
  const step=async text=>{const r=await d.debuggerCommand(text,{});assert.equal(r.action,2);u=d.advance(r.steps,4);assert.equal(u.trace.length,1);return u.trace[0];};
  u=d.advance(2,4);assert.deepEqual(u.warriors.map(w=>w.pc),[1,dwarf+1]);
  let t=await step('s');assert.equal(t.warrior,0);assert.equal(t.address,1);
  t=await step('s');assert.equal(t.warrior,1);assert.equal(t.address,dwarf+1);assert.match(t.instruction,/^MOV\.I\s+\$\s+2, @\s+2/);
  assert.deepEqual(u.warriors.map(w=>w.pc),[2,dwarf+2]);
  t=await step('s 1');assert.equal(t.warrior,0);assert.equal(t.address,1);
  t=await step('s 1');assert.equal(t.warrior,1);assert.equal(t.address,1,'step <address> jumps the current warrior to that address');
  assert.deepEqual(u.warriors.map(w=>w.pc),[2,2]);
}
console.log('PASS: two-warrior step attribution, native expressions, variables, fill/edit input, trace/untrace integration, mw.mac, finite loops, real f5, user-defined macros, cancellable infinite loop and native step address semantics.');
assert.match(stepAddressHint('s 1'),/`s 1` moves the PC to address 1/);
assert.match(stepAddressHint('calc 2~STEP 10'),/address 10/);
assert.match(stepAddressHint('g 10'),/address 10, then runs to the next breakpoint/);assert.equal(stepAddressHint('g'),null);
assert.match(stepAddressHint('th 5'),/address 5/);
for (const text of ['s','step','step~!10','skip 9','stop 1','search mov',' s ',undefined]) assert.equal(stepAddressHint(text),null,String(text));
console.log('PASS: step/thread address hint.');

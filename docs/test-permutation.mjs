import assert from 'node:assert/strict';
import {Engine} from './engine.mjs';
const engine=await Engine.create({warriors:2,coreSize:80,cycles:1,tasks:80,maxLength:5,distance:5,rounds:284,permutate:true,fixedPosition:'permutation-test'},{visual:false,log:()=>{}});
engine.compile([';redcode\n;name A\n;assert 1\njmp 0',';redcode\n;name B\n;assert 1\njmp 0']);engine.setTrace(true);
let update=engine.start(),trace=[];
while(!update.done){update=engine.advance(1,8);trace.push(...update.trace);}
assert.equal(update.completed,284);assert.equal(trace.length,568);
const placements=[];
for(let i=0;i<trace.length;i+=2){
 const pair=trace.slice(i,i+2);assert.notEqual(pair[0].warrior,pair[1].warrior);
 const position=pair.find(t=>t.warrior===1).address;assert(position>=5&&position<=75);
 placements.push(position+':'+pair[0].warrior);
}
assert.equal(new Set(placements.slice(0,142)).size,142);
assert.equal(new Set(placements.slice(142)).size,142);
console.log('PASS: two complete permutation passes, every legal Nano position and both starting orders exactly once per pass.');

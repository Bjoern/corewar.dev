import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pushoff,readKoenigstuhl,writeKoenigstuhl,koenScore} from './pushoff.mjs';
const fixture=new URL('../resources/fixture5/',import.meta.url);
const read=name=>readFile(new URL(name,fixture));
const {warriors,matrix}=readKoenigstuhl(await read('hill32.dat').then(String),await read('hill32.scores'));
assert.deepEqual(warriors.map(w=>w.name),['A','B','C','D','E']);
assert.equal(matrix[0][1],2000000);assert.equal(matrix[1][0],500000); // A beats B 2.0 to 0.5 points per round

// Reproduce the Ruby scripts' output lines (resources/pushoff.rb, diversity.rb).
const f=(x,width)=>x.toFixed(3).padStart(width);
const who=i=>`"${warriors[i].name}" by ${warriors[i].author}`;
const lines=(variant,format)=>pushoff(matrix,variant).steps.map(format);
const sequential=s=>s.size>1?`${s.size}  ${f(s.values[0],0)}  ${who(s.removed)}`:`1  .......  ${who(s.removed)}`;
const diversity=s=>s.size>1?`${s.size}  ${s.values.map(x=>f(x,7)).join('  ')}  ${who(s.removed)}`:`1${' '.repeat(29)}${who(s.removed)}`;
const expected=async name=>String(await read(name)).trim().split(/\r?\n/);
assert.deepEqual(lines('sequential',sequential),await expected('pushoff.expected'));
assert.deepEqual(lines('diversity',diversity),await expected('diversity.expected'));
// No Ruby original exists for the SD-score variant; these lines come from resources/fixture5/port.py.
assert.deepEqual(lines('sd-diversity',diversity),[
 '5   92.246    0.724  127.500  "B" by authorB','4  130.109    1.259  103.333  "C" by authorC',
 '3  139.575    1.396  100.000  "E" by authorE','2  240.000    2.000  120.000  "D" by authorD','1                             "A" by authorA']);
assert.deepEqual(pushoff(matrix,'sd-diversity').ranking,[0,3,4,2,1]);

// Σσ is shared by every pair in a step, so the SD variant removes in L1-diversity order.
function l1Order(v){
 v=v.map((r,i)=>r.map((x,j)=>i===j?0:x));const ids=[...v.keys()],order=[];
 while(ids.length>1){
  const keys=ids.map((a,i)=>{const d=Math.min(...ids.filter(b=>b!==a).map(b=>ids.reduce((t,k)=>t+Math.abs(v[a][k]-v[b][k]),0)));const s=Math.floor(ids.reduce((t,k)=>t+v[a][k],0)/(ids.length-1));return [d*s,i];});
  keys.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);order.push(ids.splice(keys[0][1],1)[0]);
 }
 return order;
}
let seed=7;const random=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
for(let trial=0;trial<20;trial++){
 const n=4+trial%7,v=Array.from({length:n},()=>Array.from({length:n},()=>koenScore(Math.floor(random()*60),Math.floor(random()*40),100)));
 assert.deepEqual(pushoff(v,'sd-diversity').steps.slice(0,-1).map(s=>s.removed),l1Order(v),'trial '+trial);
}

// Clones 0 and 1 tie each other at 100 and match elsewhere. Over common opponents they are
// at distance 0 and go first. Over all columns (the scripts' rule) the zeroed self scores sit
// opposite each other's 100, so they stay apart and the weak warrior 3 goes first instead.
const clones=[[100,100,200,250],[100,100,200,250],[50,50,150,300],[90,90,0,150]].map(r=>r.map(x=>x*1e4));
for(const variant of ['diversity','sd-diversity']){
 const all=pushoff(clones,variant).steps[0],common=pushoff(clones,variant,{distanceOver:'common'}).steps[0];
 assert.equal(all.removed,3,variant);assert(all.values[0]>0);
 assert([0,1].includes(common.removed),variant);assert.equal(common.values[0],0);assert.equal(common.nearest,1-common.removed);
}

// Ties fall to the earliest remaining warrior, like Ruby's each_with_index.min.
assert.deepEqual(pushoff([[0,100],[100,0]],'sequential').ranking,[1,0]);
assert.deepEqual(pushoff([[0,100,100],[100,0,100],[100,100,0]],'diversity').ranking,[2,1,0]);
assert.deepEqual(pushoff([[5]],'sequential').ranking,[0]);
assert.throws(()=>pushoff([[0,1]],'diversity'),/square/);
assert.throws(()=>pushoff(matrix,'average'),/Unknown/);

// "common" leaves the pair's own columns out of the distance.
assert.notDeepEqual(pushoff(matrix,'diversity',{distanceOver:'common'}).steps[0].values,pushoff(matrix,'diversity').steps[0].values);

// Writing and reading back keeps orientation and metadata.
const written=writeKoenigstuhl(warriors,matrix),again=readKoenigstuhl(written.dat,written.scores);
assert.deepEqual(again,{warriors,matrix});
assert.deepEqual(Buffer.from(written.scores),await read('hill32.scores'));
assert.throws(()=>readKoenigstuhl('2\na\nb\nc\n94\n',new Uint8Array(16)),/fewer than 2/);
assert.throws(()=>readKoenigstuhl(written.dat,new Uint8Array(8)),/100 bytes/);
assert.equal(koenScore(10,5,100),350000);assert.equal(koenScore(1,0,3),1000000);
console.log('push-off tests passed');

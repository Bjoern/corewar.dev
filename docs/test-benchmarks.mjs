import assert from 'node:assert/strict';
import {readBenchmark,importBenchmarkFiles} from './benchmarks.mjs';
import {benchmarkCatalog} from '../_site/benchmark-catalog.mjs';
import {readFileSync} from 'node:fs';
const descriptor={version:1,name:'Nano example',parameters:{coreSize:80,maxLength:5,distance:5,tasks:80,cycles:800,rounds:7},warriors:['loop.red']};
const source=';redcode\n;name Loop\n;assert 1\njmp 0';
assert.equal(readBenchmark(descriptor,{'loop.red':source}).rounds,7);
assert.equal(readBenchmark(descriptor,{'loop.red':source}).config.coreSize,80);
assert.throws(()=>readBenchmark(descriptor,{}),/Missing warrior/);
assert.throws(()=>readBenchmark({...descriptor,warriors:['../outside.red']},{}),/Invalid benchmark/);
assert.throws(()=>readBenchmark({...descriptor,parameters:{coresize:80}},{}),/Unknown/);
assert.throws(()=>readBenchmark({...descriptor,parameters:{rounds:0}},{}),/positive/);
const suite=await importBenchmarkFiles([new File([JSON.stringify(descriptor)],'suite.benchmark.json'),new File([source],'loop.red')],'upload');
assert.equal(suite.warriors[0].name,'Loop');
await assert.rejects(()=>importBenchmarkFiles([new File([JSON.stringify(descriptor)],'suite.json')]),/Missing warrior/);
for(const entry of benchmarkCatalog){assert.match(entry.data,/^benchmarks\/[0-9a-f]{16}\.json$/);const {files,scores}=JSON.parse(readFileSync(new URL('../_site/'+entry.data,import.meta.url),'utf8'));const suite=readBenchmark(entry.descriptor,files,entry.id,scores);assert(!suite.scoresProblem,entry.id+": "+suite.scoresProblem);assert.equal(!!suite.hillScores,!!entry.descriptor.scores);}
console.log(`PASS: benchmark validation, missing/unsafe paths, upload resolution, and ${benchmarkCatalog.length} catalog descriptors.`);

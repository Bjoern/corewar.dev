import assert from 'node:assert/strict';
import {readBenchmark} from './benchmarks.mjs';
import {readHillScores,writeHillScores,withCandidate,cacheKey,sourceId,hillParameters,loadCached,saveCached,defaultHillRounds,permutationRounds} from './hill-scores.mjs';
import {hillJobs} from './tournament-plan.mjs';
const files={'a.red':';name A\njmp 0','b.red':';name B\nmov 0,1'};
const descriptor={version:1,name:'Pair',parameters:{coreSize:800,cycles:8000,tasks:800,maxLength:20,distance:20,rounds:50},warriors:['a.red','b.red']};
const suite=readBenchmark(descriptor,files,'pair');
const shipped={version:1,rounds:500,seed:'s',createdAt:'2026-10-18',parameters:hillParameters(suite.config),warriors:['a.red','b.red'],scores:[[1000000,0],[3000000,1000000]]};

// A suite can carry its hill scores; stale or mismatched files are reported, not fatal.
const withScores=readBenchmark({...descriptor,scores:'hill-scores.json'},files,'pair',shipped);
assert.deepEqual(withScores.hillScores,{rounds:500,permutate:false,seed:'s',createdAt:'2026-10-18',engine:'',scores:shipped.scores,source:'suite'});
assert.throws(()=>readBenchmark({...descriptor,scores:'hill-scores.json'},files,'pair'),/Missing hill scores/);
const edited=readBenchmark({...descriptor,parameters:{...descriptor.parameters,cycles:9000},scores:'hill-scores.json'},files,'pair',shipped);
assert.equal(edited.hillScores,null);assert.match(edited.scoresProblem,/different match settings/);
assert.throws(()=>readHillScores({...shipped,warriors:['b.red','a.red']},suite),/different warriors/);
assert.throws(()=>readHillScores({...shipped,scores:[[1,2],[3]]},suite),/2×2/);
assert.throws(()=>readHillScores({...shipped,scores:[[1,2],[3,4e6]]},suite),/0 to 3000000/);
// Rounds and seed do not invalidate scores: they are per-round averages.
assert.equal(readBenchmark({...descriptor,parameters:{...descriptor.parameters,rounds:7},scores:'x.json'},files,'p',shipped).hillScores.rounds,500);
assert.deepEqual(readHillScores(writeHillScores(suite,withScores.hillScores),suite).scores,shipped.scores);

// The candidate becomes the last row and column; dropped hill warriors disappear.
const h=[[10,11,12],[20,21,22],[30,31,32]];
assert.deepEqual(withCandidate(h,[0,2],[40,41,42],[13,23,33],44),[[10,12,13],[30,32,33],[40,42,44]]);

// Cache keys change with sources and match settings, not with rounds.
const key=await cacheKey(suite.warriors,suite.config,'engine');
assert.equal(key,await cacheKey(suite.warriors,{...suite.config,rounds:9},'engine'));
assert.notEqual(key,await cacheKey(suite.warriors,{...suite.config,rules88:true},'engine'));
assert.equal(key,await cacheKey(suite.warriors,{...suite.config,permutate:true},'engine')); // permutation only changes sampling
assert.notEqual(key,await cacheKey([...suite.warriors].reverse(),suite.config,'engine'));
assert.notEqual(key,await cacheKey(suite.warriors,suite.config,'other engine'));
assert.equal(sourceId('jmp 0'),sourceId('jmp 0'));assert.notEqual(sourceId('jmp 0'),sourceId('jmp 1'));
// Without IndexedDB (Node) the cache still works in memory.
assert.equal(await loadCached(key),null);await saveCached(key,{rounds:1});assert.deepEqual(await loadCached(key),{rounds:1});
// Hill fights: 1000 rounds on large cores, every starting position on small ones.
assert.deepEqual(defaultHillRounds({coreSize:8000,maxLength:100,distance:100}),{rounds:1000,permutate:false});
assert.deepEqual(defaultHillRounds({coreSize:800,maxLength:20,distance:20}),{rounds:1522,permutate:true});
assert.equal(permutationRounds({coreSize:80,maxLength:5,distance:5}),142);
const jobs=hillJobs(suite.warriors,{seed:'s',config:suite.config,rounds:permutationRounds(suite.config),permutate:true});
assert.deepEqual(jobs.map(j=>[j.i,j.j]),[[0,0],[0,1],[1,1]]);assert(jobs.every(j=>j.config.permutate&&j.config.rounds===1522));
assert.throws(()=>hillJobs(suite.warriors,{seed:'s',config:suite.config,rounds:0}),/Hill rounds/);
console.log('PASS: hill scores validation, stale detection, candidate assembly, cache keys and memory cache.');

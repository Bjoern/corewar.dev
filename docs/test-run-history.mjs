import assert from 'node:assert/strict';
import {planTournament} from './tournament-plan.mjs';
import {snapshotRun,restoreRun,replan,summarize,createRunHistory} from './run-history.mjs';

const warrior=(id,code)=>({id,name:id,file:id+'.red',source:';name '+id+'\n'+code,colorIndex:0});
const entrants=[warrior('roster-0','jmp 0'),warrior('roster-1','mov 0,1')];
const hill=['X','Y','Z'].map(id=>warrior(id,'dat 0,0'));
const done=(job,id)=>({type:'done',id,engine:'exmars',completed:10,warriors:job.warriors.map(()=>({name:'?',wins:4,ties:2,losses:4,score:14}))});
const finish=(plan,extra={})=>({plan,config:{coreSize:80,maxLength:5,distance:5},results:plan.jobs.map(done),excluded:[],skipped:[],state:'complete',elapsed:1234,...extra});
const setup={selfFights:false,withSuite:false,challenger:null,ranking:'average',suiteId:'nano',suiteName:'Nano'};

// A benchmark run comes back with the same plan and results, without storing the jobs.
const plan=planTournament({mode:'benchmark',entrants,opponents:hill,rounds:10,seed:'s',config:{coreSize:80,maxLength:5,distance:5}});
const record=snapshotRun(finish(plan,{suite:{name:'Nano',warriors:hill}}),{id:'a',savedAt:'2026-11-11T10:00:00.000Z',setup,samples:[{x:1,values:[1,2]}]});
assert(!('jobs' in record)&&!JSON.stringify(record).includes('"config":{"coreSize":80,"maxLength":5,"distance":5,"warriors"'));
const back=restoreRun(record);
assert.deepEqual(back.plan.jobs,plan.jobs);
assert.deepEqual(back.results.map(r=>r.id),plan.jobs.map(j=>j.id));
assert.equal(back.suite.name,'Nano');assert.equal(back.suite.warriors.length,3);assert.equal(back.state,'complete');
assert.equal(back.restored.id,'a');
assert.deepEqual(record.samples,[{x:1,values:[1,2]}]);

// Round robin with a suite: the suite warriors are kept as opponents and join again when planned.
const joined=planTournament({mode:'round-robin',entrants,opponents:hill.map((w,i)=>({...w,colorIndex:2+i,fromSuite:true})),withSuite:true,rounds:5,seed:'t',config:{coreSize:80,maxLength:5,distance:5}});
const joinedRecord=snapshotRun(finish(joined),{id:'b',setup:{...setup,withSuite:true}});
assert.equal(joinedRecord.entrants.length,2);assert.equal(joinedRecord.opponents.length,3);
assert.deepEqual(replan(joinedRecord).jobs,joined.jobs);

// Challenge keeps its challenger.
const challenge=planTournament({mode:'challenge',entrants,challenger:'roster-1',rounds:5,seed:'c',config:{coreSize:80,maxLength:5,distance:5}});
assert.deepEqual(replan(snapshotRun(finish(challenge),{id:'c',setup:{...setup,challenger:'roster-1'}})).jobs,challenge.jobs);

// A push-off benchmark leaves out the hill fights and keeps their scores instead.
const pushed=planTournament({mode:'benchmark',entrants,opponents:hill,rounds:10,seed:'p',config:{coreSize:80,maxLength:5,distance:5},pushoff:true,hill:true,hillRounds:20});
const scores=[[1,2,3],[4,5,6],[7,8,9]];
const pushRecord=snapshotRun(finish(pushed,{suite:{name:'H',warriors:hill},variant:'sequential',hillData:{rounds:20,scores}}),{id:'d',setup});
assert(pushRecord.results.every(r=>pushed.jobs[r.id].kind!=='hill'));
assert.deepEqual(pushRecord.hillData.scores,scores);
const pushBack=restoreRun(pushRecord);
assert(!pushBack.plan.jobs.some(j=>j.kind==='hill'));assert.equal(pushBack.plan.hillRounds,20);
assert.deepEqual(pushBack.plan.jobs,pushed.jobs.filter(j=>j.kind!=='hill'));
assert.equal(replan(pushRecord,{hill:true}).jobs.filter(j=>j.kind==='hill').length,6);

// The store keeps the newest runs up to its limit, replaces by id and deletes.
const store=createRunHistory({limit:2,storage:null});
const at=(id,savedAt)=>({...record,id,savedAt});
for(const [id,time] of [['1','2026-11-11T10:00:00Z'],['2','2026-11-11T11:00:00Z']])await store.save(at(id,time),summarize(at(id,time)));
assert.deepEqual(await store.save(at('3','2026-11-11T12:00:00Z'),summarize(at('3','2026-11-11T12:00:00Z'))),['1']);
assert.deepEqual((await store.list()).map(s=>s.id),['3','2']);
await store.save(at('2','2026-11-11T13:00:00Z'),summarize(at('2','2026-11-11T13:00:00Z')));
assert.deepEqual((await store.list()).map(s=>s.id),['2','3']);
assert.equal((await store.get('2')).savedAt,'2026-11-11T13:00:00Z');
await store.remove('3');assert.deepEqual((await store.list()).map(s=>s.id),['2']);assert.equal(await store.get('3'),null);
const summary=summarize(record,{top:[{name:'roster-0',score:140}],settings:'core 80'});
assert.equal(summary.suiteName,'Nano');assert.deepEqual(summary.entrants,['roster-0','roster-1']);assert.equal(summary.matchups,6);
console.log('run history tests passed');

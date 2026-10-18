import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const file=(name,text)=>({name,mimeType:'text/plain',buffer:Buffer.from(text)});
const descriptor={version:1,name:'Nano upload',parameters:{coreSize:80,maxLength:5,distance:5,tasks:80,cycles:800,rounds:7},warriors:['loop.red','dead.red']};
try{
 await page.goto(process.env.PMARS_URL||'http://127.0.0.1:8766/');
 await page.locator('#warriorFiles').setInputFiles(file('candidate.red',';redcode\n;name Candidate\n;assert 1\njmp 0'));
 await page.waitForFunction(()=>document.querySelectorAll('.include-warrior').length===1);
 await page.locator('#tournamentTab').click();await page.locator('#mode-benchmark').click();
 const {benchmarkCatalog}=await import('../_site/benchmark-catalog.mjs');
 for(const entry of benchmarkCatalog){
  await page.locator('#benchmarkSuite').selectOption(entry.id);
  assert.equal(await page.locator('#tournamentRounds').inputValue(),String(entry.descriptor.parameters.rounds));
 }
 const nano=benchmarkCatalog.find(e=>e.id.includes('/nanobm07/')||e.id.startsWith('public-nanobm07/'));
 if(nano){
  await page.locator('#benchmarkSuite').selectOption(nano.id);await page.locator('#tournamentRounds').fill('1');await page.locator('#tournamentStart').click();
  await page.waitForFunction(()=>document.querySelector('#tournamentStatus').textContent.startsWith('Complete'));
  assert.match(await page.locator('#tournamentStatus').textContent(),/50 \/ 50/);
  assert.equal(await page.locator('.include-warrior').count(),1);
 }
 await page.locator('#benchmarkFiles').setInputFiles([file('suite.benchmark.json',JSON.stringify(descriptor)),file('loop.red',';redcode\n;name Loop\n;assert 1\njmp 0'),file('dead.red',';redcode\n;name Dead\n;assert 1\ndat 0,0')]);
 await page.waitForFunction(()=>document.querySelector('#tournamentStatus').textContent.startsWith('Imported'));
 assert.equal(await page.locator('.include-warrior').count(),1);
 assert.equal(await page.locator('#tournamentRounds').inputValue(),'7');
 await page.locator('#benchmarkDetails summary').click();assert.equal(await page.locator('#benchmarkMembers li').count(),2);
 const zipDownload=page.waitForEvent('download');await page.locator('#downloadBenchmarkZip').click();const zip=await zipDownload;assert.match(zip.suggestedFilename(),/\.zip$/);await zip.saveAs('docs/test-output/benchmark-export.zip');
 await page.locator('#tournamentRounds').fill('3');await page.locator('#tournamentStart').click();
 await page.waitForFunction(()=>document.querySelector('#tournamentStatus').textContent.startsWith('Complete'));
 const download=page.waitForEvent('download');await page.locator('#tournamentExport').click();const result=JSON.parse(await readFile(await (await download).path(),'utf8'));
 assert.equal(result.plan.jobs[0].config.coreSize,80);assert.equal(result.results[0].completed,3);
 const matchups=await page.locator('#matchupResults li').allTextContents();
 assert.match(matchups[0],/Candidate: 0 wins, 0 losses, 3 ties/);
 assert.match(matchups[1],/Candidate: 3 wins, 0 losses, 0 ties/);
 assert.match(matchups[1],/Dead: 0 wins, 3 losses, 0 ties/);
 await page.locator('#benchmarkDescriptor').fill(JSON.stringify({...descriptor,name:'Edited suite',parameters:{...descriptor.parameters,rounds:9}}));await page.locator('#applyBenchmark').click();assert.equal(await page.locator('#tournamentRounds').inputValue(),'9');
 const count=await page.locator('#benchmarkSuite option').count();
 await page.locator('#benchmarkFiles').setInputFiles(file('missing.benchmark.json',JSON.stringify(descriptor)));
 await page.waitForFunction(()=>document.querySelector('#tournamentStatus').textContent.includes('Missing warrior'));
 assert.equal(await page.locator('#benchmarkSuite option').count(),count);assert.equal(await page.locator('.include-warrior').count(),1);
 // Push-off benchmark: the first run fights the hill pairs and caches them; later runs only fight the candidate.
 const opponents=[file('loop.red',';redcode\n;name Loop\n;assert 1\njmp 0'),file('dead.red',';redcode\n;name Dead\n;assert 1\ndat 0,0')];
 const pushSuite={...descriptor,name:'Nano push-off',parameters:{...descriptor.parameters,rounds:5}};
 const imported=async(label)=>{await page.waitForFunction(text=>document.querySelector('#tournamentStatus').textContent.includes(text),label);};
 await page.locator('#benchmarkFiles').setInputFiles([file('push.benchmark.json',JSON.stringify(pushSuite)),...opponents]);await imported('Nano push-off');
 assert(await page.locator('#tournamentSettingsSlot').evaluate(e=>e.inert));assert.match(await page.locator('#suiteSettingsNote').textContent(),/core 80 · cycles 800/);
 await page.locator('#tournamentRanking').selectOption('sd-diversity');
 await page.waitForFunction(()=>document.querySelector('#hillText').textContent.startsWith('No hill scores'));
 assert.match(await page.locator('#tournamentWorkload').textContent(),/^6 matchups \(3 between hill warriors\)/);
 const finished=()=>page.waitForFunction(()=>document.querySelector('#tournamentStatus').textContent.startsWith('Complete'));
 await page.locator('#tournamentStart').click();await finished();
 assert.match(await page.locator('#pushoffStandings tr').first().textContent(),/Candidate\d of 3/);
 const firstPlace=await page.locator('#pushoffStandings tr').first().textContent();
 await page.waitForFunction(()=>document.querySelector('#hillText').textContent.startsWith('Hill scores cached'));
 assert.match(await page.locator('#tournamentWorkload').textContent(),/^3 matchups ·/);
 await page.locator('#tournamentStart').click();await finished();
 assert.equal(await page.locator('#pushoffStandings tr').first().textContent(),firstPlace); // pair-keyed placement reproduces the run
 await page.locator('#recomputeHill').check();assert.match(await page.locator('#tournamentWorkload').textContent(),/^6 matchups/);await page.locator('#recomputeHill').uncheck();
 // Downloaded hill scores can ship with the suite.
 await page.locator('#benchmarkDetails').evaluate(d=>{d.open=true;});
 const hillDownload=page.waitForEvent('download');await page.locator('#downloadHillScores').click();const scores=await readFile(await (await hillDownload).path(),'utf8');
 assert.deepEqual(JSON.parse(scores).warriors,['loop.red','dead.red']);
 await page.locator('#benchmarkFiles').setInputFiles([file('shipped.benchmark.json',JSON.stringify({...pushSuite,name:'Nano shipped',scores:'hill-scores.json'})),file('hill-scores.json',scores),...opponents]);await imported('Nano shipped');
 await page.waitForFunction(()=>document.querySelector('#hillText').textContent.includes('shipped with the suite'));
 assert.match(await page.locator('#tournamentWorkload').textContent(),/^3 matchups ·/);
 await page.locator('#mode-round-robin').click();assert(!(await page.locator('#tournamentSettingsSlot').evaluate(e=>e.inert)));assert(await page.locator('#suiteSettingsNote').isHidden());
 assert.deepEqual(errors,[]);
 console.log('PASS: separate benchmark upload, descriptor editing, defaults and rounds override, missing-file recovery, unchanged roster, suite-owned settings, push-off hill caching and shipped hill scores.');
}finally{await browser.close();}

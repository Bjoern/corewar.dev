import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {bundledWarriors} from './demo-warriors.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>Object.defineProperty(navigator,'hardwareConcurrency',{value:4}));
const file=(name,text)=>({name,mimeType:'text/plain',buffer:Buffer.from(text)});
const red=(name,code)=>`;redcode\n;name ${name}\n;assert 1\n${code}\n`;
const complete=()=>page.waitForFunction(()=>document.querySelector('#tournamentStatus').textContent.startsWith('Complete'));
const exported=async()=>{const d=page.waitForEvent('download');await page.locator('#tournamentExport').click();return JSON.parse(await readFile(await(await d).path(),'utf8'));};
try{
 await page.goto(process.env.PMARS_URL||'http://127.0.0.1:8766/');
 await page.locator('#warriorFiles').setInputFiles([file('a.red',red('Candidate A','jmp 0')),file('b.red',red('Candidate B','mov 0,1')),file('sunset.red',bundledWarriors.find(w=>w.file==='sunset.red').source)]);
 await page.locator('#tournamentTab').click();await page.locator('#tournamentMode').selectOption('benchmark');
 const descriptor={version:1,name:'Exclusion test',parameters:{noPspace:true,cycles:100,rounds:2},warriors:['loop.red','dead.red','pspace.red']};
 await page.locator('#benchmarkFiles').setInputFiles([file('suite.benchmark.json',JSON.stringify(descriptor)),file('loop.red',red('Opponent loop','jmp 0,1')),file('dead.red',red('Opponent dead','dat 0,0')),file('pspace.red',red('Pspace opponent','ldp.a #0,1'))]);
 await page.waitForFunction(()=>document.querySelector('#tournamentStatus').textContent.startsWith('Imported'));
 for(const workers of ['1','3']){
  await page.locator('#tournamentWorkers').fill(workers);await page.locator('#tournamentStart').click();await complete();
  const result=await exported();assert.equal(result.results.length,4);assert.equal(result.skipped.length,5);assert.equal(result.excluded.length,2);assert.equal(result.standings.length,2);
  assert(result.standings.every(w=>w.rounds===4));
  assert.match(await page.locator('#tournamentExclusions').textContent(),/Sunset.*forbids LDP\/STP/s);
  assert.equal(await page.locator('#tournamentProgress').evaluate(e=>e.value===e.max),true);
 }
 // A run with no compatible entrants must also finish and explain its exclusions.
 await page.locator('.include-warrior').nth(0).uncheck();await page.locator('.include-warrior').nth(1).uncheck();
 await page.locator('#tournamentStart').click();await complete();const empty=await exported();assert.equal(empty.results.length,0);assert.equal(empty.standings.length,0);assert.equal(empty.skipped.length,3);
 // A new compatible run clears the old warning.
 await page.locator('.include-warrior').nth(0).check();await page.locator('.include-warrior').nth(1).check();
 await page.locator('#benchmarkDetails summary').click();descriptor.parameters.noPspace=false;
 await page.locator('#benchmarkDescriptor').fill(JSON.stringify(descriptor));await page.locator('#applyBenchmark').click();
 await page.locator('#tournamentStart').click();await complete();assert.equal((await exported()).results.length,9);assert(await page.locator('#tournamentExclusions').isHidden());
 assert.deepEqual(errors,[]);console.log('PASS: serial/parallel exclusions, incompatible opponents, all-excluded run, exports and clean restart.');
}finally{await browser.close();}

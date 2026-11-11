import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
// Past runs in Tournaments: kept after each run, shown again, run again, loaded into the setup,
// replaced, deleted, and still there after a reload.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const status=page.locator('#tournamentStatus');
const complete=()=>page.waitForFunction(()=>/^Complete/.test(document.querySelector('#tournamentStatus').textContent)&&!document.querySelector('#tournamentStart').disabled);
const exportRun=async()=>{const d=page.waitForEvent('download');await page.locator('#tournamentExport').click();return JSON.parse(await readFile(await (await d).path(),'utf8'));};
const count=n=>page.waitForFunction(n=>document.querySelector('#historyCount').textContent===(n?`(${n})`:''),n);
const rows=page.locator('#historyTable tbody tr');
const scores=run=>[...run.results].sort((a,b)=>a.id-b.id).map(r=>r.warriors.map(({wins,ties,losses,score})=>({wins,ties,losses,score})));
try {
 await page.goto(process.env.PMARS_URL||'http://127.0.0.1:8766/');
 await page.locator('#warriorFiles').setInputFiles(['Imp','Dwarf','Loop'].map((name,i)=>({name:name+'.red',mimeType:'text/plain',buffer:Buffer.from(';redcode\n;name '+name+'\n;assert 1\n'+['mov 0,1','add.ab #4,3\nmov.i 2,@2\njmp -2\ndat 0,0','jmp 0'][i]+'\n')})));
 await page.locator('#tournamentTab').click();
 assert(await page.locator('#historyEmpty').isVisible()||!(await page.locator('#runHistory').evaluate(d=>d.open)));
 await page.locator('#runHistory summary').click();assert(await page.locator('#historyEmpty').isVisible());
 await page.locator('#tournamentRounds').fill('5');await page.locator('#tournamentWorkers').fill('2');
 await page.locator('#tournamentStart').click();await complete();await count(1);const first=await exportRun();
 await page.locator('#mode-challenge').click();await page.locator('#challenger').selectOption('roster-1');await page.locator('#tournamentRounds').fill('7');
 await page.locator('#tournamentStart').click();await complete();await count(2);
 assert.match(await rows.first().textContent(),/Challenge/);assert.match(await rows.nth(1).textContent(),/Round robin.*Imp, Dwarf, Loop/);
 assert.equal(await rows.first().locator('input').isChecked(),true);
 // Show results: the round robin's standings come back as they were.
 await rows.nth(1).click();await page.locator('#historyShow').click();
 await page.waitForFunction(()=>document.querySelector('#tournamentStatus').textContent.includes('past run of'));
 const shown=await exportRun();assert.deepEqual(scores(shown),scores(first));assert.deepEqual(shown.standings,first.standings);
 assert.equal(await page.locator('#tournamentStandings tbody tr').count(),3);
 // Run again: the same warriors as then, even with one deselected now; a new entry.
 await page.locator('.include-warrior').nth(2).uncheck();
 await page.locator('#historyRerun').click();await complete();await count(3);
 const again=await exportRun();assert.deepEqual(scores(again),scores(first));
 assert(await page.locator('#replaceRunField').isVisible());
 // Load setup: mode, rounds, warriors (Loop selected again; Dwarf added again after removal) come back.
 await page.locator('#mode-melee').click();await page.locator('#tournamentRounds').fill('3');
 await page.locator('.remove-warrior').nth(1).click();await page.waitForFunction(()=>document.querySelectorAll('.include-warrior').length===2);
 await rows.nth(2).click();await page.locator('#historyLoad').click();
 await page.waitForFunction(()=>document.querySelectorAll('.include-warrior').length===3);
 assert.equal(await page.locator('#mode-round-robin').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#tournamentRounds').inputValue(),'5');
 assert.equal(await page.locator('.include-warrior:checked').count(),3);assert.match(await page.locator('#tournamentEntrants').textContent(),/Imp.*Loop.*Dwarf|Imp.*Dwarf.*Loop/);
 assert.match(await page.locator('#replaceRunText').textContent(),/^Replace the past run of/);
 // Change it and replace the old entry: still three, and the newest holds 6 rounds.
 await page.locator('#tournamentRounds').fill('6');await page.locator('#replaceRun').check();
 const oldest=await rows.nth(2).getAttribute('data-id');
 await page.locator('#tournamentStart').click();await complete();await page.waitForFunction(id=>document.querySelector('#historyTable tbody tr').dataset.id===id,oldest);
 assert.equal(await rows.count(),3);assert.match(await rows.first().textContent(),/6 · seed/);assert(!(await page.locator('#replaceRun').isChecked()));
 // Delete takes a second click; the first only asks.
 await page.locator('#historyDelete').click();assert.equal(await rows.count(),3);assert.match(await page.locator('#historyDelete').textContent(),/^Click again/);
 await page.locator('#historyDelete').click();await count(2);assert.equal(await page.locator('#historyDelete').textContent(),'Delete');
 // Kept in this browser across a reload.
 await page.reload();await page.locator('#tournamentTab').click();await count(2);
 await page.locator('#runHistory summary').click();assert(await page.locator('#historyStorage').isHidden());
 await page.locator('#historyShow').click();await page.waitForFunction(()=>document.querySelector('#tournamentStatus').textContent.includes('past run of'));
 assert.equal(await page.locator('#tournamentStandings tbody tr').count(),3);
 // A push-off benchmark keeps its hill scores, so its ranking shows again; loading its setup after the
 // suite was removed makes the suite again from the kept opponents.
 await page.locator('#toolsTab').click();await page.locator('.tools-nav-item[data-tool="benchmarks"]').click();await page.locator('#bmNewSuite').click();
 await page.locator('#bmUse').click();assert.equal(await page.locator('#mode-benchmark').getAttribute('aria-selected'),'true');
 await page.locator('.include-warrior').nth(1).uncheck();await page.locator('.include-warrior').nth(2).uncheck();
 await page.locator('#tournamentRanking').selectOption('sequential');await page.locator('#tournamentStart').click();await complete();await count(3);
 assert.equal(await page.locator('#pushoffStandings tr').count(),1);const pushed=await page.locator('#pushoffStandings').textContent();
 assert.match(await rows.first().textContent(),/Benchmark · .*New suite \(3\).*Imp: \d of 4/);
 await rows.nth(1).click();await page.locator('#historyShow').click();await page.waitForFunction(()=>!document.querySelector('#pushoffTitle').textContent.includes('each warrior added'));
 await rows.first().click();await page.locator('#historyShow').click();await page.waitForFunction(()=>document.querySelector('#pushoffTitle').textContent.includes('each warrior added'));
 assert.equal(await page.locator('#pushoffStandings').textContent(),pushed);
 await page.locator('#toolsTab').click();await page.locator('button:has-text("Remove suite")').click();await page.locator('button:has-text("Click again to remove")').click();
 await page.locator('#tournamentTab').click();await page.locator('#mode-round-robin').click();
 await page.locator('#historyLoad').click();await page.waitForFunction(()=>document.querySelector('#historyStatus').textContent.includes('made again'));
 assert.equal(await page.locator('#mode-benchmark').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#benchmarkSuite option:checked').textContent(),'New suite');
 assert.equal(await page.locator('#tournamentRanking').inputValue(),'sequential');assert.equal(await page.locator('.include-warrior:checked').count(),1);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 console.log('PASS: past runs are kept, shown, run again, loaded, replaced, deleted and survive a reload.');
}finally{await browser.close();}

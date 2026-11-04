// SPDX-License-Identifier: GPL-2.0-or-later
// The warrior library: hill chips, reset, selection with group actions, and benchmarks made from a selection.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const context=await browser.newContext({acceptDownloads:true});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const pressed=async()=>page.locator('#libraryHills .lib-hill[aria-pressed=true]').allTextContents();
const chip=name=>page.locator('#libraryHills .lib-hill',{hasText:new RegExp('^'+name+' ')});
const count=()=>page.locator('#libraryCount').textContent();
try{
 await page.goto(process.env.PMARS_URL || 'http://127.0.0.1:8765/docs/');
 await page.evaluate(()=>localStorage.removeItem('corewar-library'));await page.reload();
 await page.locator('#libraryTab').click();
 const hills=await page.evaluate(async()=>(await import('./library-catalog.mjs')).libraryCatalog.map(h=>({id:h.id,count:h.count,parameters:h.parameters})));
 assert(hills.length>=2,'needs at least two hills');
 const total=hills.reduce((n,h)=>n+h.count,0),[a,b]=hills;

 // A fresh library searches every hill; choosing hills narrows it and turning the last one off widens it again.
 await page.waitForFunction(()=>/warriors/.test(document.querySelector('#libraryCount').textContent));
 assert.deepEqual(await pressed(),['All hills']);
 assert(await page.locator('#centerTabs').isHidden(),'no workspace tab strip without an open editor');
 assert.equal(await count(),total.toLocaleString('en-US')+' warriors');
 assert(await page.locator('#libraryReset').isHidden());
 await chip(a.id).click();await page.waitForFunction(n=>document.querySelector('#libraryCount').textContent===n,a.count.toLocaleString('en-US')+' warriors');
 await chip(b.id).click();assert.equal((await pressed()).length,2);
 await chip(b.id).click();await chip(a.id).click();assert.deepEqual(await pressed(),['All hills']);
 await chip(a.id).click();await page.locator('#libraryHills .lib-hill',{hasText:'All hills'}).click();assert.deepEqual(await pressed(),['All hills']);

 // Reset clears the query, filters and hill choice.
 await chip(a.id).click();await page.locator('#librarySearch').fill('zzzz-no-such-warrior');
 await page.waitForFunction(()=>document.querySelector('#libraryCount').textContent.startsWith('0 of'));
 assert(await page.locator('#libraryReset').isVisible());
 await page.locator('#libraryReset').click();
 await page.waitForFunction(n=>document.querySelector('#libraryCount').textContent===n,total.toLocaleString('en-US')+' warriors');
 assert.equal(await page.locator('#librarySearch').inputValue(),'');assert.deepEqual(await pressed(),['All hills']);
 assert(await page.locator('#libraryReset').isHidden());

 // Single warrior: download and copy sit with the source in the opened row.
 await chip(a.id).click();await page.waitForFunction(n=>document.querySelector('#libraryCount').textContent===n,a.count.toLocaleString('en-US')+' warriors');
 const first=page.locator('.lib-row').first();
 await first.locator('.lib-toggle').click();
 await page.waitForFunction(()=>!document.querySelector('.lib-source').textContent.startsWith('Loading'));
 const [single]=await Promise.all([page.waitForEvent('download'),first.locator('.lib-file-actions button',{hasText:'Download'}).click()]);
 assert.match(single.suggestedFilename(),/\.red$/i);

 // Selection: the header checkbox selects all matches; the action bar follows the selection.
 assert(await page.locator('#librarySelection').isHidden());
 const rows=page.locator('.lib-row .lib-check');
 await rows.nth(0).check();await rows.nth(1).check();await rows.nth(2).check();
 assert.equal(await page.locator('#librarySelected').textContent(),'3 warriors selected');
 assert.equal(await page.locator('#librarySelectAll').evaluate(e=>e.indeterminate),true);
 await page.locator('#librarySelectedOnly').check();
 await page.waitForFunction(()=>document.querySelector('#libraryCount').textContent==='Showing the 3 selected warriors');
 assert.equal(await page.locator('.lib-row').count(),3);
 await page.locator('#librarySelectedOnly').uncheck();
 await page.locator('#librarySelectAll').check();
 assert.equal(await page.locator('#librarySelected').textContent(),a.count.toLocaleString('en-US')+' warriors selected');
 await page.locator('#librarySelectAll').uncheck();assert(await page.locator('#librarySelection').isHidden());

 // Group actions: add, zip download, benchmark.
 for(let i=0;i<3;i++)await rows.nth(i).check();
 await page.locator('#libraryAddSelected').click();
 await page.waitForFunction(()=>/3 warriors added/.test(document.querySelector('#libraryNotice').textContent));
 assert.equal(await page.locator('.lib-row .lib-add[disabled]').count(),3);
 // Opening a warrior's editor brings back the tab strip, with the Library tab as the way back.
 await page.locator('.edit-source').first().click();assert(await page.locator('#centerTabs').isVisible());
 await page.locator('#centerTabs .tab-close').first().click();assert(await page.locator('#centerTabs').isHidden());
 const [zip]=await Promise.all([page.waitForEvent('download'),page.locator('#libraryZip').click()]);
 assert.equal(zip.suggestedFilename(),'koenigstuhl-'+a.id+'-3.zip');

 await page.locator('#libraryBenchmark').click();
 assert(await page.locator('#libraryBenchmarkDialog').isVisible());
 assert.equal(await page.locator('#libraryBenchmarkHill').inputValue(),a.id);
 assert.equal(await page.locator('#libraryBenchmarkRounds').inputValue(),String(a.parameters.rounds));
 assert(await page.locator('#libraryBenchmarkWarning').isHidden());
 // Settings of a hill with other rules warn that the warriors were made for different rules.
 const other=hills.find(h=>h.parameters&&h.parameters.coreSize!==a.parameters.coreSize);
 if(other){await page.locator('#libraryBenchmarkHill').selectOption(other.id);assert(await page.locator('#libraryBenchmarkWarning').isVisible());await page.locator('#libraryBenchmarkHill').selectOption(a.id);}
 await page.locator('#libraryBenchmarkRounds').fill('25');
 const [suiteZip]=await Promise.all([page.waitForEvent('download'),page.locator('#libraryBenchmarkZip').click()]);
 assert.match(suiteZip.suggestedFilename(),/\.zip$/);
 await page.locator('#libraryBenchmarkName').fill('Library test suite');
 await page.locator('#libraryBenchmarkUse').click();
 await page.waitForFunction(()=>document.querySelector('#tournamentTab').getAttribute('aria-selected')==='true');
 assert(await page.locator('#libraryBenchmarkDialog').isHidden());
 assert.equal(await page.locator('#mode-benchmark').getAttribute('aria-selected'),'true');
 assert(await page.locator('#centerTabs').isHidden(),'Tournaments shows no workspace tab strip without an open editor');
 assert.equal(await page.locator('#benchmarkSuite option:checked').textContent(),'Library test suite');
 assert.equal(await page.locator('#tournamentRounds').inputValue(),'25');
 assert.match(await page.locator('#tournamentStatus').textContent(),/from the library with 3 opponents/);

 // Phone width: no horizontal scroll with the action bar shown.
 await page.locator('#libraryTab').click();await page.setViewportSize({width:390,height:844});
 assert(await page.locator('#librarySelection').isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 console.log('library tests passed');
}finally{await browser.close();}

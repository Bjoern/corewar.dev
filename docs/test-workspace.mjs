// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage({acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const url=process.env.PMARS_URL||'http://127.0.0.1:8766/';
const count=()=>page.locator('#warriorCount').textContent();
const saved=()=>page.evaluate(()=>localStorage.getItem('corewar-workspace'));
const menu=async id=>{await page.locator('#workspaceBtn').click();await page.locator('#'+id).click();};
try{
 await page.goto(url);
 assert.equal(await saved(),null);assert.equal(await page.locator('#editors .warrior').count(),0);
 await page.locator('#warriorFiles').setInputFiles(['Alpha','Beta'].map(name=>({name:name+'.red',mimeType:'text/plain',buffer:Buffer.from(`;redcode\n;name ${name}\n;assert 1\njmp 0`)})));
 await page.locator('#editors .warrior').first().click();
 await page.locator('#first').fill(';redcode\n;name Edited Alpha\n;assert 1\nmov 0,1');
 await page.locator('.include-warrior').nth(1).uncheck();
 await page.locator('#toggleEditors').click();await page.locator('#rounds').fill('7');
 await page.locator('#tournamentTab').click();await page.locator('#tournamentSeed').fill('seed-x');
 // The debounced autosave lands without any reload.
 await page.waitForFunction(()=>(localStorage.getItem('corewar-workspace')||'').includes('seed-x'));
 await page.locator('#tournamentSeed').fill('seed-y');
 await page.reload();// pagehide flushes the pending save
 assert.equal(await count(),'2 warriors loaded · 1 selected');
 assert.match(await page.locator('#editors').textContent(),/Edited Alpha/);
 assert.match(await page.locator('#first').textContent(),/Edited Alpha/);
 assert.equal(await page.locator('#rounds').inputValue(),'7');assert.equal(await page.locator('#preset').inputValue(),'custom');
 assert.equal(await page.locator('#tournamentSeed').inputValue(),'seed-y');
 assert.equal(await page.locator('#tournamentTab').getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('.warrior-tab .tab-dot').count(),1);
 assert.equal(await page.locator('#timing').getAttribute('data-instructions'),'0');
 const download=page.waitForEvent('download');await menu('exportWorkspace');
 const exported=await download;assert.equal(exported.suggestedFilename(),'corewar-workspace.json');
 const file=await readFile(await exported.path());const snapshot=JSON.parse(file);
 assert.equal(snapshot.version,1);assert.deepEqual(snapshot.warriors.map(w=>w.excluded),[false,true]);
 // Cancel keeps everything; confirming reloads into the welcome state.
 await menu('startClean');assert.match(await page.locator('#workspaceDialogText').textContent(),/Start clean\? This discards all 2 warriors/);
 await page.locator('#workspaceDialogCancel').click();await page.waitForTimeout(100);assert.equal(await count(),'2 warriors loaded · 1 selected');assert.notEqual(await saved(),null);
 const reloaded=page.waitForEvent('load');await menu('startClean');await page.locator('#workspaceDialogOk').click();await reloaded;
 assert.equal(await page.locator('#editors .warrior').count(),0);assert.equal(await page.locator('body').getAttribute('data-welcome'),'true');
 assert.equal(await page.locator('#rounds').inputValue(),'1');assert.equal(await page.locator('#emulatorTab').getAttribute('aria-selected'),'true');
 await page.locator('#workspaceFile').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{"format":"corewar.dev-workspace","version":99,"warriors":[]}')});
 await page.locator('#workspaceDialog').waitFor();
 assert.match(await page.locator('#workspaceDialogText').textContent(),/version 99 is not supported/);assert(await page.locator('#workspaceDialogCancel').isHidden());
 await page.locator('#workspaceDialogOk').click();assert.equal(await page.locator('#editors .warrior').count(),0);
 await page.locator('#workspaceFile').setInputFiles({name:'corewar-workspace.json',mimeType:'application/json',buffer:file});
 await page.waitForFunction(()=>document.querySelector('#warriorCount').textContent==='2 warriors loaded · 1 selected');
 assert.match(await page.locator('#editors').textContent(),/Edited Alpha/);assert.equal(await page.locator('#tournamentSeed').inputValue(),'seed-y');
 assert.match(await saved(),/Edited Alpha/);
 // Unreadable or unknown snapshots are discarded instead of breaking startup.
 for(const value of ['{not json','{"format":"corewar.dev-workspace","version":2,"warriors":[]}']){
  await page.evaluate(value=>localStorage.setItem('corewar-workspace',value),value);await page.reload();
  assert.equal(await page.locator('#editors .warrior').count(),0);assert.equal(await saved(),null);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: workspace autosave, reload restore, export, start clean, import validation and discarded snapshots.');
}finally{await browser.close();}

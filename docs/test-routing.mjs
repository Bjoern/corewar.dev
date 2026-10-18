// SPDX-License-Identifier: GPL-2.0-or-later
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=new URL(process.env.PMARS_URL || 'http://127.0.0.1:8765/docs/');
const hash=()=>page.evaluate(()=>location.hash);
let start=0;const length=async()=>await page.evaluate(()=>history.length)-start; // Entries added since the app loaded.
const shown=()=>page.evaluate(()=>[document.querySelector('#tournamentTab').getAttribute('aria-selected')==='true'?'tournaments':'battle',!document.querySelector('#referenceView').hidden]);
const settle=()=>page.waitForTimeout(250);
const back=async()=>{await page.evaluate(()=>history.back());await settle();};
try{
 await page.goto(base.href);
 start=await page.evaluate(()=>history.length)-1;assert.equal(await hash(),'');assert.deepEqual(await shown(),['battle',false]);
 // Switching back and forth keeps one entry per mode.
 await page.locator('#tournamentTab').click();await settle();assert.equal(await hash(),'#tournaments');assert.equal(await length(),2);
 await page.locator('#emulatorTab').click();await settle();assert.equal(await hash(),'');assert.equal(await length(),2);
 await page.locator('#tournamentTab').click();await settle();await page.locator('#tournamentTab').click();await settle();assert.equal(await length(),2);
 // Choosing a mode over the reference closes it and records the mode once.
 await page.locator('#referenceLink').click();await settle();assert.deepEqual(await shown(),['tournaments',true]);assert.equal(await length(),3);
 await page.locator('#emulatorTab').click();await settle();assert.deepEqual(await shown(),['battle',false]);assert.equal(await hash(),'');
 await page.locator('#tournamentTab').click();await settle();await page.locator('#aboutLink').click();await settle();
 await page.locator('#closeReference').click();await settle();assert.equal(await hash(),'#tournaments');assert.deepEqual(await shown(),['tournaments',false]);
 await back();assert.deepEqual(await shown(),['battle',false]);
 await page.evaluate(()=>history.forward());await settle();assert.deepEqual(await shown(),['tournaments',false]);
 // An address opens its mode and wins over the saved mode; a bare address shows the saved mode.
 await page.goto(new URL('?r=1#battle',base).href);await settle();assert.deepEqual(await shown(),['battle',false]);
 await page.goto(new URL('?r=2#tournaments',base).href);await settle();assert.deepEqual(await shown(),['tournaments',false]);
 await page.locator('#emulatorTab').click();await settle();assert.equal(await hash(),'#battle');
 await page.locator('#tournamentTab').click();await settle();assert.equal(await hash(),'#tournaments');
 await page.waitForTimeout(700);await page.goto(new URL('?r=3',base).href);await settle();assert.equal(await hash(),'#tournaments');assert.deepEqual(await shown(),['tournaments',false]);
 // A reference opened by address closes to the mode underneath it.
 await page.goto(new URL('?r=4#reference',base).href);await settle();assert.deepEqual(await shown(),['tournaments',true]);
 await page.locator('#emulatorTab').click();await settle();assert.deepEqual(await shown(),['battle',false]);assert.equal(await hash(),'#battle');
 assert.deepEqual(errors,[]);
 console.log('PASS: mode addresses, one history entry per mode, Back/Forward, reference overlay closing, saved and addressed modes.');
}finally{await browser.close();}

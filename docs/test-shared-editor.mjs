import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(process.env.PMARS_URL||'http://127.0.0.1:8766/');
 assert(await page.locator('#sharedEditor').isHidden());
 assert(await page.locator('#examplesBtn').isVisible());
 await page.locator('#warriorFiles').setInputFiles(['Alpha','Beta'].map(name=>({name:name+'.red',mimeType:'text/plain',buffer:Buffer.from(`;redcode\n;name ${name}\n;assert 1\njmp 0`)})));
 await page.locator('#editors .warrior').first().click();
 const first=page.locator('#first');await first.fill(';redcode\n;name Edited Alpha\n;assert 1\nmov 0,1');
 await page.locator('#editors .warrior').nth(1).click();
 assert.equal(await page.locator('.source-editor:visible').count(),1);
 await page.locator('#editors .warrior').first().click();assert.match(await first.textContent(),/Edited Alpha/);
 await first.press('Control+z');assert.match(await first.textContent(),/;name Alpha/);
 await first.press('Control+y');assert.match(await first.textContent(),/Edited Alpha/);
 await page.locator('#editorTheme').selectOption('light');
 // Choosing a mode steps out of the editor; reopening it keeps the edits, and its run button follows the mode.
 await page.locator('#tournamentTab').click();assert(await first.isHidden());
 await page.locator('#editors .warrior').first().click();assert(await first.isVisible());assert.match(await first.textContent(),/Edited Alpha/);assert.equal(await page.locator('#runFromEditor').textContent(),'▶ Run tournament');
 await page.locator('#emulatorTab').click();assert(await first.isHidden());
 await page.locator('#editors .warrior').first().click();assert(await first.isVisible());assert.equal(await page.locator('#runFromEditor').textContent(),'▶ Run battle');
 await page.locator('#newWarrior').click();assert.equal(await page.locator('.source-editor:visible').count(),1);
 const download=page.waitForEvent('download');await page.locator('.save-warrior').last().click();assert.equal((await download).suggestedFilename(),'Warrior 3.red');
 const uploaded=page.waitForEvent('download');await page.locator('.save-warrior').first().click();assert.equal((await uploaded).suggestedFilename(),'Alpha.red');
 await page.locator('#editors .warrior').first().click();assert.match(await first.textContent(),/Edited Alpha/);
 assert.equal(await page.locator('.widen-editor').count(),0);
 await page.locator('#toggleEditors').click();assert(await page.locator('#editorTheme').isHidden());
 await page.locator('#editors .warrior').first().click();
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'docs/test-output/shared-editor-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'docs/test-output/shared-editor-desktop.png',fullPage:true});
 await page.locator('#editors .warrior').last().click();await page.locator('#removeActive').click();
 assert.equal(await page.locator('#editors .warrior').count(),2);assert(await page.locator('#sharedEditor').isHidden());
 assert(await page.evaluate(()=>[...document.querySelectorAll('#editors .remove-warrior')].every(b=>b.getBoundingClientRect().right<=document.querySelector('#editors').getBoundingClientRect().right)));
 const sideWidth=()=>page.locator('#sidebar').evaluate(e=>e.getBoundingClientRect().width);
 const bar=await page.locator('#sidebarSplitter').boundingBox(),startWidth=await sideWidth();
 await page.mouse.move(bar.x+2,bar.y+100);await page.mouse.down();await page.mouse.move(bar.x+52,bar.y+100,{steps:4});await page.mouse.up();
 assert(Math.abs(await sideWidth()-startWidth-50)<=2);
 await page.reload();await page.waitForSelector('#sidebarSplitter');assert(Math.abs(await sideWidth()-startWidth-50)<=2);
 await page.locator('#sidebarSplitter').dblclick();assert(Math.abs(await sideWidth()-startWidth)<=2);
 assert.deepEqual(errors,[]);console.log('PASS: shared editor, preserved edits and undo across switches, new warrior, delete from editor, resizable columns, themes, both tabs and mobile layout.');
}finally{await browser.close();}


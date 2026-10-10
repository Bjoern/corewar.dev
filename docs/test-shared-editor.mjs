import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(process.env.PMARS_URL||'http://127.0.0.1:8766/');
 assert(await page.locator('#sharedEditor').isHidden());
 assert(await page.evaluate(()=>!!(document.querySelector('#demos').compareDocumentPosition(document.querySelector('.workspace-tabs'))&Node.DOCUMENT_POSITION_FOLLOWING)));
 await page.locator('#warriorFiles').setInputFiles(['Alpha','Beta'].map(name=>({name:name+'.red',mimeType:'text/plain',buffer:Buffer.from(`;redcode\n;name ${name}\n;assert 1\njmp 0`)})));
 await page.locator('#editors .warrior').first().click();
 const first=page.locator('#first');await first.fill(';redcode\n;name Edited Alpha\n;assert 1\nmov 0,1');
 await page.locator('#editors .warrior').nth(1).click();
 assert.equal(await page.locator('.source-editor:visible').count(),1);
 await page.locator('#editors .warrior').first().click();assert.match(await first.textContent(),/Edited Alpha/);
 await first.press('Control+z');assert.match(await first.textContent(),/;name Alpha/);
 await first.press('Control+y');assert.match(await first.textContent(),/Edited Alpha/);
 await page.locator('#editorTheme').selectOption('light');
 await page.locator('#tournamentTab').click();assert(await first.isVisible());
 await page.locator('#newWarrior').click();assert.equal(await page.locator('.source-editor:visible').count(),1);
 await page.locator('#editors .warrior').first().click();assert.match(await first.textContent(),/Edited Alpha/);
 assert.equal(await page.locator('.widen-editor').count(),0);
 await page.locator('#toggleEditors').click();assert(await page.locator('#editorTheme').isHidden());
 await page.locator('#editors .warrior').first().click();
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'docs/test-output/shared-editor-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'docs/test-output/shared-editor-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: shared editor, preserved edits and undo across switches, new warrior, themes, both tabs and mobile layout.');
}finally{await browser.close();}


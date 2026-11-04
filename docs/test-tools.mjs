// SPDX-License-Identifier: GPL-2.0-or-later
// Browser checks for the Tools tab: addresses and history, the step finder and a short optimizer run.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=new URL(process.env.PMARS_URL || 'http://127.0.0.1:8765/docs/');
const hash=()=>page.evaluate(()=>location.hash);
const settle=()=>page.waitForTimeout(250);
const visibleTool=()=>page.evaluate(()=>{
 const panel=document.querySelector('#toolsPanel');if(panel.hidden)return null;
 if(!panel.querySelector('.tools-overview').hidden)return '';
 return [...panel.querySelectorAll('.tool-view')].find(v=>!v.hidden)?.dataset.tool??null;
});
try{
 // Addresses: the tab opens the overview, a card opens a tool and #tools/<id> opens it directly.
 await page.goto(base.href);
 await page.locator('#toolsTab').click();await settle();
 assert.equal(await hash(),'#tools');assert.equal(await visibleTool(),'');
 assert.equal(await page.locator('.tools-card[data-tool]').count(),2);
 await page.locator('.tools-card[data-tool="step-finder"]').click();await settle();
 assert.equal(await hash(),'#tools/step-finder');assert.equal(await visibleTool(),'step-finder');
 await page.locator('.tools-nav-item[data-tool="optimizer"]').click();await settle();
 assert.equal(await hash(),'#tools/optimizer');assert.equal(await visibleTool(),'optimizer');
 assert.equal(await page.locator('.tools-nav-item[aria-current="page"]').getAttribute('data-tool'),'optimizer');
 await page.locator('#emulatorTab').click();await settle();assert.equal(await visibleTool(),null);
 await page.evaluate(()=>history.forward());await settle();assert.equal(await visibleTool(),'optimizer'); // Forward returns to the last tool.
 assert.equal(await hash(),'#tools/optimizer');
 await page.goto(new URL('?r=1#tools/step-finder',base).href);await settle();assert.equal(await visibleTool(),'step-finder');
 await page.goto(new URL('?r=2#tools',base).href);await settle();assert.equal(await visibleTool(),'step-finder'); // The last tool is remembered.

 // Step finder: scan a tiny core, sort, pick a row, see the detail and the EQU line.
 await page.fill('#sfCore','800');await page.locator('#sfCore').dispatchEvent('change');
 await page.fill('#sfMod','');await page.locator('#sfMod').dispatchEvent('change');
 await page.getByRole('button',{name:'Scan steps'}).click();
 await page.waitForFunction(()=>/steps scanned/.test(document.querySelector('.sf-layout [role=status]').textContent),null,{timeout:30000});
 const rows=await page.locator('.sf-table tbody tr').count();assert.ok(rows>0&&rows<=50,`rows ${rows}`);
 assert.match(await page.locator('.sf-table caption').textContent(),/^400 steps, top 50 shown/);
 // Sorting by step, then the other way round.
 await page.locator('.sf-sort',{hasText:/^Step/}).click();
 assert.equal(await page.locator('.sf-table tbody tr').first().getAttribute('data-step'),'1');
 await page.locator('.sf-sort',{hasText:/^Step/}).click();
 assert.equal(await page.locator('.sf-table tbody tr').first().getAttribute('data-step'),'400');
 await page.locator('.sf-table tbody tr[data-step="399"]').click();
 assert.equal(await page.inputValue('#sfStep'),'399');
 assert.equal(await page.locator('.sf-snippet').textContent(),'step    equ 399');
 await page.selectOption('#sfSign','-1');assert.equal(await page.locator('.sf-snippet').textContent(),'step    equ -399');
 assert.ok(await page.locator('.sf-sequence .sf-term').count()>0);
 // A mod that does not divide the core size is refused.
 await page.fill('#sfMod','3');await page.locator('#sfMod').dispatchEvent('change');
 await page.getByRole('button',{name:'Scan steps'}).click();
 assert.match(await page.locator('.sf-layout [role=status]').textContent(),/does not divide 800/);
 await page.fill('#sfMod','');await page.locator('#sfMod').dispatchEvent('change');

 // Optimizer: the nano example scores exactly; run it briefly, stop, and use the best.
 await page.locator('.tools-nav-item[data-tool="optimizer"]').click();await settle();
 await page.selectOption('#optExample','alcoholism');
 await page.waitForFunction(()=>/opponents/.test(document.querySelector('.opt-run .tool-form .hint').textContent),null,{timeout:30000});
 await page.waitForFunction(()=>/variable/.test(document.querySelector('#optCheck').textContent),null,{timeout:10000});
 assert.match(await page.locator('#optCheck').textContent(),/exact/i);
 // A broken marker is reported under the editor.
 const example=await page.inputValue('#optTemplate');
 await page.fill('#optTemplate',example+'\n dat !(5..1), 0');
 await page.waitForSelector('#optCheck .opt-error');
 await page.fill('#optTemplate',example);
 await page.waitForFunction(()=>!document.querySelector('#optCheck .opt-error')&&/variable/.test(document.querySelector('#optCheck').textContent));
 await page.fill('#optWorkers','2');await page.locator('#optWorkers').dispatchEvent('change');
 await page.getByRole('button',{name:'▶ Start'}).click();
 await page.waitForFunction(()=>/^Score /.test(document.querySelector('.opt-best')?.previousElementSibling?.previousElementSibling?.textContent||''),null,{timeout:60000});
 assert.equal(await page.isDisabled('#optTemplate'),false);assert.equal(await page.locator('#optTemplate').evaluate(e=>e.readOnly),true);
 await page.getByRole('button',{name:'Ⅱ Pause'}).click();
 await page.waitForFunction(()=>/Continue/.test([...document.querySelectorAll('.opt-run button.primary')].map(b=>b.textContent).join()));
 await page.getByRole('button',{name:'■ Stop'}).click();
 assert.match(await page.locator('.opt-status').textContent(),/^Stopped\./);
 const evaluations=Number((await page.locator('.opt-stats dd').first().textContent()).replace(/,/g,''));assert.ok(evaluations>0);
 assert.ok(await page.locator('.opt-best mark').count()>0,'tuned values are marked');
 await page.getByRole('button',{name:'Use as template'}).click();
 assert.match(await page.inputValue('#optTemplate'),/:[^\s,)]+/);
 const before=await page.evaluate(()=>document.querySelectorAll('#optRoster option').length);
 await page.getByRole('button',{name:'Add to warriors'}).click();
 assert.match(await page.locator('.opt-status').textContent(),/^Added .*optimized/);
 assert.equal(await page.evaluate(()=>document.querySelectorAll('#optRoster option').length),Math.max(2,before+1));
 // With exact scoring the held-out check equals the search score.
 await page.getByRole('button',{name:'Check best on new placements'}).click();
 await page.waitForFunction(()=>/Held-out score|Check failed/.test(document.querySelector('.opt-best').parentElement.querySelector('[role=status]').textContent),null,{timeout:60000});
 const held=await page.locator('.opt-best ~ [role=status]').textContent();
 const m=/Held-out score ([\d.]+).*search score ([\d.]+)/.exec(held);assert.ok(m,held);assert.equal(m[1],m[2]);

 // Phone width: no horizontal page scroll on either tool.
 await page.setViewportSize({width:390,height:844});
 for(const id of ['optimizer','step-finder']){
  await page.locator(`.tools-nav-item[data-tool="${id}"]`).click();await settle();
  const [scroll,client]=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  assert.ok(scroll<=client+1,`${id}: page scrolls sideways (${scroll} > ${client})`);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: tools addresses and history, step finder scan/sort/detail, optimizer run/pause/stop/use/add/check, phone width.');
}finally{await browser.close();}

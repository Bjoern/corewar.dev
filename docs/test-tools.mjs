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
 assert.equal(await page.locator('.tools-card[data-tool]').count(),5);
 assert.equal((await page.locator('.core-tab').first().textContent()).trim(),'Tools'); // The view tab beside the editors names the mode.
 await page.locator('.tools-card[data-tool="step-finder"]').click();await settle();
 assert.equal(await hash(),'#tools/step-finder');assert.equal(await visibleTool(),'step-finder');
 await page.locator('.tools-nav-item[data-tool="optimizer"]').click();await settle();
 assert.equal(await hash(),'#tools/optimizer');assert.equal(await visibleTool(),'optimizer');
 assert.equal(await page.locator('.tools-nav-item[aria-selected="true"]').getAttribute('data-tool'),'optimizer');
 // The tool switcher is the Tournaments mode control, with the same keys.
 assert.equal(await page.locator('#toolsPanel .mode-tabs[role=tablist] [role=tab]').count(),6); // Overview and the five tools.
 await page.locator('.tools-nav-item[data-tool="optimizer"]').press('ArrowRight');await settle();
 assert.equal(await hash(),'#tools/evolver');assert.equal(await page.evaluate(()=>document.activeElement.dataset.tool),'evolver');
 await page.locator('.tools-nav-item[data-tool="evolver"]').press('Home');await settle();assert.equal(await visibleTool(),'');
 await page.locator('.tools-nav-item[data-tool=""]').press('End');await settle();assert.equal(await visibleTool(),'step-finder');
 await page.locator('.tools-nav-item[data-tool="optimizer"]').click();await settle();
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
 assert.match(await page.locator('#optCheck').textContent(),/engine exMARS/);
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
 assert.equal(await page.locator('.opt-stats dt',{hasText:'Engine'}).locator('xpath=following-sibling::dd[1]').textContent(),'exMARS');
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

 // !! markers: every value is scored, the method is fixed, and the run ends when all are tested.
 const scan=';redcode-94\n;name scan\nstep equ !!(1..24)\nfar  equ !(10..30)\n add.ab #step, 2\n mov.i 1, @1\n jmp -2\n';
 await page.fill('#optTemplate',scan);
 await page.waitForFunction(()=>/In a !! run the ! markers keep their start value/.test(document.querySelector('#optCheck').textContent));
 assert.equal(await page.inputValue('#optMethod'),'every');assert.equal(await page.isDisabled('#optMethod'),true);
 await page.fill('#optTemplate',scan.replace('!(10..30)','!(10..30):20'));
 await page.waitForFunction(()=>!/keep their start value/.test(document.querySelector('#optCheck').textContent));
 assert.match(await page.locator('#optCheck').textContent(),/Every value: 24 candidates \(step 24\) × \d+ opponents = [\d,]+ matches of 142 rounds/);
 await page.getByRole('button',{name:'▶ Start'}).click();
 await page.waitForFunction(()=>/^Every candidate tested \(24\)\./.test(document.querySelector('.opt-status').textContent),null,{timeout:120000});
 assert.equal(await page.locator('.opt-stats dt',{hasText:'Tested'}).locator('xpath=following-sibling::dd[1]').textContent(),'24 of 24');
 assert.ok(await page.locator('.opt-top tbody tr').count()>0);
 const topScore=Number((await page.locator('.opt-top tbody tr').first().locator('td').last().textContent()));
 assert.match(await page.locator('.opt-best').evaluate(e=>e.parentElement.textContent),new RegExp('Score '+topScore.toFixed(2)));
 // Without !! markers the method choice comes back.
 await page.fill('#optTemplate',example);
 await page.waitForFunction(()=>!document.querySelector('#optMethod').disabled&&document.querySelector('#optMethod').value!=='every');
 assert.equal(await page.locator('#optMethod option[value=every]').count(),0);

 // Evolver: a short nano run against the nano benchmark, in a worker; the best opens in the editor.
 await page.locator('.tools-nav-item[data-tool="evolver"]').click();await settle();
 assert.equal(await page.inputValue('#evoPreset'),'nano');
 await page.waitForFunction(()=>/50 opponents .*exact: all 142 placements.*engine exMARS/.test(document.querySelector('#evoSuite').closest('.tool-form').textContent),null,{timeout:30000});
 await page.fill('#evoPopulation','16');await page.fill('#evoGenerations','4');await page.fill('#evoRunName','test run');await page.fill('#evoWorkers','2');
 await page.locator('#evoWorkers').dispatchEvent('change');
 await page.locator('.tool-view[data-tool=evolver] button.primary').click();
 assert.equal(await page.isDisabled('#evoPreset'),true);
 await page.waitForFunction(()=>/^Finished 4 generations\./.test(document.querySelector('.tool-view[data-tool=evolver] .opt-status').textContent),null,{timeout:120000});
 assert.ok(Number(await page.locator('.evo-best-score strong').textContent())>0);
 assert.match(await page.locator('.evo-code').textContent(),/^;redcode-nano\n;name test run-g\d+\n;author corewar.dev evolver\n;strategy Evolved by the corewar.dev evolver: run test run, generation \d+\n;strategy Score [\d.]+ against [^\n]+\n;assert 1\n; When: [^\n]+\n; Start: random code\n[\s\S]*; Population: 16\n[\s\S]*end start/);
 assert.equal(await page.locator('.tool-view[data-tool=evolver] .opt-stats dt',{hasText:'Generation'}).locator('xpath=following-sibling::dd[1]').textContent(),'4');
 assert.equal(await page.isDisabled('#evoPreset'),false);
 // Presets switch the benchmark; custom settings are checked.
 await page.selectOption('#evoPreset','tiny');assert.equal(await page.inputValue('#evoSuite'),'public-tinybm04/suite.benchmark.json');
 await page.selectOption('#evoPreset','custom');await page.fill('#evo-distance','10');await page.locator('#evo-distance').dispatchEvent('change');
 assert.match(await page.locator('.tool-view[data-tool=evolver] .opt-error').textContent(),/distance must be at least/);
 await page.fill('#evo-distance','20');await page.locator('#evo-distance').dispatchEvent('change');
 await page.selectOption('#evoPreset','nano');
 await page.getByRole('button',{name:'Open in editor'}).click();await settle();
 assert.equal(await hash(),'#battle');assert.equal(await page.inputValue('#coreSize'),'80');
 assert.match(await page.locator('#editorViews').textContent(),/test run-g\d+/);
 await page.locator('#toolsTab').click();await settle();assert.equal(await visibleTool(),'evolver');
 assert.match(await page.evaluate(()=>[...document.querySelectorAll('#evoSeedMode + select option')].map(o=>o.textContent).join('|')),/test run-g\d+/); // It can seed the next run.

 // Phone width: no horizontal page scroll on either tool.
 await page.setViewportSize({width:390,height:844});
 for(const id of ['optimizer','evolver','step-finder']){
  await page.locator(`.tools-nav-item[data-tool="${id}"]`).click();await settle();
  const [scroll,client]=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  assert.ok(scroll<=client+1,`${id}: page scrolls sideways (${scroll} > ${client})`);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: tools addresses and history, step finder scan/sort/detail, optimizer run/pause/stop/use/add/check, !! scan, evolver nano run and editor hand-off, phone width.');
}finally{await browser.close();}

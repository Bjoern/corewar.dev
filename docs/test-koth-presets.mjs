// SPDX-License-Identifier: GPL-2.0-or-later
// Compare every dropdown preset with the independently parsed pMARS option files.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {defaults} from './settings.mjs';
import {presets} from '../_site/presets.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage();
const fields=['coreSize','cycles','tasks','maxLength','distance','pspace','rounds','rules88','noPspace','fixedSeries','formula'];
const flagKeys={s:'coreSize',c:'cycles',p:'tasks',l:'maxLength',S:'pspace',d:'distance',r:'rounds'};
const signatures=new Set();
try {
 await page.goto(process.env.PMARS_URL || 'http://127.0.0.1:8766/');
 assert.equal(await page.locator('#preset').inputValue(),'94');
 await page.locator('#editSettings').click();
 assert.equal(await page.locator('#preset option').count(),presets.length+1);
 assert.equal(await page.locator('#preset option[value="standard"]').count(),0);
 const files=(await readdir(new URL('./config/',import.meta.url))).filter(f=>f.endsWith('.opt')).sort();
 assert.deepEqual(presets.flatMap(p=>p.files).sort(),files,'every option file represented once');
 for(const preset of presets) {
  await page.locator('#fixedSeries').check();
  await page.locator('#noPspace').check();
  await page.locator('#preset').selectOption(preset.id);
  const actual=await page.evaluate(fields=>Object.fromEntries(fields.map(id=>{
   const e=document.getElementById(id);return [id,e.type==='checkbox'?e.checked:e.type==='number'?Number(e.value):e.value];
  })),fields);
  for(const file of preset.files) {
   const expected={...defaults};
   const source=await readFile(new URL('./config/'+file,import.meta.url),'utf8');
   for(const line of source.split(/\r?\n/)) {
    const option=line.split(';')[0].trim();if(!option)continue;
    const [,flag,value]=option.match(/^-(\S)\s*(.*)$/);
    if(flag==='8')expected.rules88=true;
    else if(flag==='=')expected.formula=value;
    else {assert(flagKeys[flag],flag);expected[flagKeys[flag]]=Number(value);}
   }
   assert.deepEqual(actual,Object.fromEntries(fields.map(f=>[f,expected[f]])),file);
   const link=page.locator('#presetSource a').filter({hasText:file});
   const response=await page.request.get(new URL(await link.getAttribute('href'),page.url()).href);
   assert(response.ok(),file+' deployed');assert.equal(await response.text(),source);
  }
  const signature=JSON.stringify(actual);
  assert(!signatures.has(signature),'duplicate preset '+preset.id);signatures.add(signature);
 }
 await page.locator('#preset').selectOption('tinylp');
 for(const [id,value] of Object.entries({coreSize:800,tasks:8,cycles:8000,maxLength:50,distance:50,pspace:50,rounds:250}))
  assert.equal(await page.locator('#'+id).inputValue(),String(value),'published Tiny LP '+id);
 await page.locator('#preset').selectOption('94nop');
 await page.locator('#maxLength').fill('50');
 assert.equal(await page.locator('#preset').inputValue(),'custom');
 assert.equal(await page.locator('#distance').inputValue(),'0','distance follows length by default');
 assert.equal(await page.locator('#presetSource').textContent(),'');
 console.log('PASS: all option files represented, no duplicate presets, exact options, deployed sources, defaults and custom edits.');
} finally {await browser.close();}

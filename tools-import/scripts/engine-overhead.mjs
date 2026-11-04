// SPDX-License-Identifier: GPL-2.0-or-later
import {readFileSync} from 'node:fs';
// Per-match startup vs per-round cost: corewar.dev's pMARS Wasm vs exMARS Wasm.
// node engine-overhead.mjs <corewar.dev checkout> <exMARS checkout> <nano bench dir> <'94 bench dir>
// Uses ALCOHOLI.RED vs 8C094799.RED (nanobm07) and Carmilla_3.red vs arvon.red (top20mix).
const [, , site, exm, nb0, tb0] = process.argv;
const {Engine} = await import(site + '/docs/engine.mjs');
const {runMatch} = await import(exm + '/dist/wasm/client.mjs');
const nb = nb0 + '/';
const tb = tb0 + '/';
const hills = {
  nano: {a: readFileSync(nb+'ALCOHOLI.RED','utf8'), b: readFileSync(nb+'8C094799.RED','utf8'),
         site: {coreSize:80,cycles:800,tasks:80,maxLength:5,distance:5}, ex:{coreSize:80,cycles:800,processes:80,maxLength:5,minDistance:5}, pos:40},
  standard: {a: readFileSync(tb+'Carmilla_3.red','utf8'), b: readFileSync(tb+'arvon.red','utf8'),
         site: {coreSize:8000,cycles:80000,tasks:8000,maxLength:100,distance:100}, ex:{coreSize:8000,cycles:80000,processes:8000,maxLength:100,minDistance:100}, pos:4000},
};
async function siteMatch(h, rounds) {
  const e = await Engine.create({...h.site, rounds, warriors:2, fixedPosition:String(h.pos)}, {visual:false});
  e.compile([h.a, h.b]); e.setDebug(false); e.setTrace(false); e.start();
  let d=0; while(!d){d=e.module._web_advance(100000,8);}
  return e.update(true).warriors[0];
}
async function time(f, n) { await f(); const t=performance.now(); for (let i=0;i<n;i++) await f(); return (performance.now()-t)/n; }
for (const [name, h] of Object.entries(hills)) {
  const big = name==='nano' ? 2000 : 200;
  const s1 = await time(()=>siteMatch(h,1), 100), sN = await time(()=>siteMatch(h,big), 3);
  const x1 = await time(()=>runMatch([h.a,h.b],{...h.ex,rounds:1,position:h.pos}), 100), xN = await time(()=>runMatch([h.a,h.b],{...h.ex,rounds:big,position:h.pos}), 3);
  const sr=(sN-s1)/(big-1), xr=(xN-x1)/(big-1);
  console.log(`${name}: pMARS(site) 1-round match ${s1.toFixed(2)} ms, per extra round ${(sr*1000).toFixed(1)} us; exMARS 1-round match ${x1.toFixed(2)} ms, per extra round ${(xr*1000).toFixed(1)} us`);
}

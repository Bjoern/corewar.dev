// SPDX-License-Identifier: GPL-2.0-or-later
// Step finder view of the Tools tab. The math is in stepfinder.mjs; scans run in stepfinder-worker.mjs.
import {el} from './tools.mjs';
import {profile,findxFrom,findxLowerBound,gapSequence,gapRatios,euclidCount,hitPositions,rankValue,modOf} from './stepfinder.mjs';

const HELP=[
 ['What it measures','A bomber or scanner with step s visits 0, s, 2s, … around the core. This tool counts how many of those hits it takes until no stretch of x unbombed cells is left, so a warrior x instructions long can no longer hide. That is find-x. It is computed exactly for every step, not sampled.'],
 ['mod','gcd(step, core size). The full run makes core size ÷ mod hits and ends with a hit every mod cells, so it is the final guarantee: anything at least mod long is hit by the end. A mod-4 step can never find a 3-cell warrior.'],
 ['find-x and the lower bound','n hits leave n gaps, so at least ⌈core size ÷ x⌉ hits are needed before every gap is shorter than x. The table shows find-x and how far above that bound it is: +5% is close to ideal, +60% means the step wastes a lot of bombs before small targets are safe to count on.'],
 ['Judge mainly on small x','Real bodies are small (often 5–8 instructions, usually under 15); only the boot code is long. During the first few dozen hits any reasonable step does about the same, so the difference between steps is how fast the gaps drop below 20, 15 and 10. Avoid degenerate steps such as 1001 for 8000, which lays bombs 8 apart for hundreds of hits.'],
 ['Gap sequence and ratios','By the three-gap theorem the gaps between hits never take more than three sizes. The gap sequence lists the gap sizes in the order they get filled, with the sign showing the side. A ratio of 2–3 between neighbours is cheap. A ratio above about 4 is a long, slow phase where many hits only shave one gap size, and is flagged.'],
 ['Classic score and Euclid count','For comparison with older tools: the classic optima score (Nándor) adds, for each hit, the distance to the nearest earlier hit (higher is better). The Euclid count (Andy Pierce) is the number of steps of Euclid’s algorithm on step and core size (higher is more Fibonacci-like).'],
 ['How to use it','Set the core size and, if your warrior needs one, a mod (for example 4 for a body that is safe from its own mod-4 bombs). Pick the target sizes that match your warrior and the opponents you fear, then Scan. Sort by any column, click a row to see its profile, and copy the EQU line. s and core size − s give mirror-image patterns, so only steps up to half the core are listed; choose the sign in the detail view.']
];
const fmt=n=>n===null||n===undefined?'—':Number(n).toLocaleString('en-US');
const parseList=text=>text.split(/[\s,;]+/).filter(Boolean).map(Number);

export function mount(root,{loadState,saveState}){
 const saved=loadState()||{};
 const input=(id,label,value,attrs={})=>{const i=el('input',{id,value:String(value),...attrs});return [el('label',{htmlFor:id,textContent:label}),i];};
 const [coreLabel,core]=input('sfCore','Core size',saved.coreSize??8000,{type:'number',min:2,max:65536,step:1});
 const [modLabel,mod]=input('sfMod','Mod',saved.mod??'',{type:'number',min:1,max:65536,step:1,placeholder:'any'});
 const [fromLabel,from]=input('sfFrom','Steps from',saved.from??1,{type:'number',min:1,step:1});
 const [toLabel,to]=input('sfTo','to',saved.to??'',{type:'number',min:1,step:1,placeholder:'N/2'});
 const [targetsLabel,targets]=input('sfTargets','Target sizes x',saved.targets??'100, 20, 15, 10',{spellcheck:false});
 const ranking=el('select',{id:'sfRanking'});
 const [weightsLabel,weights]=input('sfWeights','Weights',saved.weights??'1, 1, 1, 1',{spellcheck:false});
 const [ratioLabel,ratio]=input('sfRatio','Hide ratios above',saved.ratio??'',{type:'number',min:1,step:0.5,placeholder:'off'});
 const [topLabel,top]=input('sfTop','Show',saved.top??50,{type:'number',min:1,max:2000,step:1});
 const scan=el('button',{type:'button',className:'primary',textContent:'Scan steps'});
 const progress=el('progress',{max:1,value:0,hidden:true});
 const status=el('p',{className:'hint',role:'status'});
 const field=(...nodes)=>el('div',{className:'tool-field'},...nodes);
 const form=el('div',{className:'tool-form'},
  field(coreLabel,core,el('span',{className:'tool-presets'},...[[80,'nano'],[800,'tiny'],[8000,'standard'],[55440,'X']].map(([n,name])=>{const b=el('button',{type:'button',className:'small',textContent:name,title:'Core size '+n});b.onclick=()=>{core.value=n;to.value='';changed();};return b;}))),
  field(modLabel,mod),field(fromLabel,from,toLabel,to),field(targetsLabel,targets),
  field(el('label',{htmlFor:'sfRanking',textContent:'Rank by'}),ranking,weightsLabel,weights),field(ratioLabel,ratio),field(topLabel,top,el('span',{className:'hint',textContent:'rows'})),
  el('div',{className:'tool-actions'},scan,progress,status));
 const table=el('table',{className:'tool-table sf-table'});
 const tableWrap=el('div',{className:'tool-table-wrap'},table);
 // Detail view
 const [detailLabel,detailStep]=input('sfStep','Step',saved.detail??3364,{type:'number',min:1,step:1});
 const sign=el('select',{id:'sfSign'},new Option('+ (forward)','1'),new Option('− (backward)','-1'));
 const snippet=el('code',{className:'sf-snippet'});
 const copy=el('button',{type:'button',className:'small',textContent:'Copy'});
 const facts=el('div',{className:'sf-facts'});
 const sequence=el('div',{className:'sf-sequence'});
 const chart=el('canvas',{className:'sf-chart',ariaLabel:'Longest empty run against number of hits'});
 const [hitsLabel,hits]=input('sfHits','Hits shown',1,{type:'range',min:1,max:1,step:1});
 const hitsOut=el('output',{htmlFor:'sfHits'});
 const strip=el('canvas',{className:'sf-strip',ariaLabel:'Core cells bombed after the chosen number of hits'});
 const detail=el('section',{className:'t-card sf-detail'},el('h3',{textContent:'Step detail'}),
  el('div',{className:'tool-form'},field(detailLabel,detailStep,el('label',{htmlFor:'sfSign',textContent:'Sign'}),sign),field(snippet,copy)),
  facts,el('h4',{textContent:'Gap sequence'}),sequence,
  el('h4',{textContent:'Longest empty run after n hits'}),
  el('p',{className:'hint',textContent:'Log scale. The dashed line is the ideal N/n; the horizontal lines are your target sizes, with a dot where the step gets below them.'}),chart,
  el('h4',{textContent:'Core after n hits'}),field(hitsLabel,hits,hitsOut),strip,
  el('p',{className:'hint',textContent:'Each square is one cell, in rows from address 0. Bombed cells are bright; the longest empty run is outlined in orange.'}));
 const help=el('details',{className:'tool-help',open:!saved.helpClosed},el('summary',{textContent:'How to read this'}),...HELP.map(([h,t])=>el('div',{},el('strong',{textContent:h}),el('p',{textContent:t}))));
 help.addEventListener('toggle',persist);
 root.append(el('div',{className:'sf-layout'},el('section',{className:'t-card'},el('h3',{textContent:'Scan'}),form,tableWrap),detail),help);

 let rows=[],sortKey='rank',sortDir=1,worker=null,scanned=null;
 const coreSize=()=>Math.max(2,Math.min(65536,Math.floor(Number(core.value)||8000)));
 const targetList=()=>{const list=parseList(targets.value).filter(x=>Number.isInteger(x)&&x>=1);return list.length?list.slice(0,8):[100,20,15,10];};
 function fillRanking(){
  const keep=ranking.value||saved.ranking||'weighted',list=targetList();
  ranking.replaceChildren(new Option('Weighted sum of find-x ÷ bound','weighted'),...list.map((x,i)=>new Option('find-'+x,'x:'+i)));
  ranking.value=[...ranking.options].some(o=>o.value===keep)?keep:'weighted';
  weights.disabled=ranking.value!=='weighted';
 }
 function persist(){saveState({coreSize:core.value,mod:mod.value,from:from.value,to:to.value,targets:targets.value,ranking:ranking.value,weights:weights.value,ratio:ratio.value,top:top.value,detail:detailStep.value,helpClosed:!help.open});}
 function changed(){fillRanking();persist();if(scanned)status.textContent='Settings changed. Scan again to update the table.';}
 for(const i of [core,mod,from,to,targets])i.addEventListener('change',changed);
 for(const i of [ranking,weights,ratio,top])i.addEventListener('change',()=>{fillRanking();persist();render();});
 fillRanking();

 function runScan(){
  worker?.terminate();
  const N=coreSize(),list=targetList(),m=Math.floor(Number(mod.value))||0,lo=Math.max(1,Math.floor(Number(from.value))||1),hi=Math.min(N-1,Math.floor(Number(to.value))||Math.floor(N/2));
  if(m&&N%m){status.textContent=`No step has mod ${m}: it does not divide ${N}.`;return;}
  scanned={coreSize:N,targets:list};rows=[];render();
  progress.hidden=false;progress.value=0;status.textContent='Scanning…';scan.textContent='Cancel';
  worker=new Worker(new URL('./stepfinder-worker.mjs',import.meta.url),{type:'module'});
  const started=performance.now();
  worker.onmessage=({data})=>{
   if(data.type==='progress'){progress.value=data.done/data.total;status.textContent=`Scanning… ${fmt(data.done)} of ${fmt(data.total)} steps`;return;}
   rows=data.rows;worker.terminate();worker=null;progress.hidden=true;scan.textContent='Scan steps';
   status.textContent=`${fmt(rows.length)} steps scanned in ${((performance.now()-started)/1000).toFixed(1)} s.`;
   render();if(rows.length&&!detailShown)showDetail(sorted()[0]?.step??rows[0].step);
  };
  worker.onerror=e=>{status.textContent='Scan failed: '+e.message;progress.hidden=true;scan.textContent='Scan steps';worker=null;};
  worker.postMessage({coreSize:N,from:lo,to:hi,mod:m,targets:list});
 }
 scan.onclick=()=>{if(worker){worker.terminate();worker=null;progress.hidden=true;scan.textContent='Scan steps';status.textContent='Scan cancelled.';}else runScan();};

 const rankOptions=()=>({coreSize:scanned.coreSize,targets:scanned.targets,ranking:ranking.value,weights:parseList(weights.value)});
 function sorted(){
  if(!scanned)return [];
  const limit=Number(ratio.value)||Infinity,opts=rankOptions();
  const list=rows.filter(r=>r.maxRatio<=limit).map(r=>({...r,rank:rankValue(r,opts)}));
  const key=r=>sortKey==='rank'?r.rank:sortKey.startsWith('x')?r.findx[Number(sortKey.slice(1))]??Infinity:r[sortKey];
  // Higher is better for the classic score and the Euclid count.
  const dir=['score','euclid'].includes(sortKey)?-sortDir:sortDir;
  return list.sort((a,b)=>(key(a)-key(b))*dir||a.step-b.step);
 }
 function render(){
  if(!scanned){table.replaceChildren(el('caption',{className:'hint',textContent:'Scan to rank steps.'}));return;}
  const cols=[['rank','#'],['step','Step'],['mod','Mod'],...scanned.targets.map((x,i)=>['x'+i,'find-'+x]),['score','Classic'],['euclid','Euclid'],['seq','Gap sequence']];
  const head=el('tr',{},...cols.map(([key,label])=>{
   const th=el('th',{scope:'col'});
   if(key==='seq'){th.textContent=label;return th;}
   const b=el('button',{type:'button',className:'sf-sort',textContent:label+(sortKey===key?(sortDir>0?' ▲':' ▼'):'')});
   b.title=key==='rank'?'Rank by the chosen ranking':key.startsWith('x')?'Hits until no empty run of this size remains (lower is better)':key==='score'?'Classic optima score (higher is better)':key==='euclid'?'Euclid step count (higher is more Fibonacci-like)':'';
   b.onclick=()=>{if(sortKey===key)sortDir=-sortDir;else{sortKey=key;sortDir=1;}render();};
   if(sortKey===key)th.setAttribute('aria-sort',sortDir>0?'ascending':'descending');
   th.append(b);return th;
  }));
  const list=sorted(),limit=Math.max(1,Math.floor(Number(top.value))||50);
  const body=el('tbody',{},...list.slice(0,limit).map((r,i)=>{
   const tr=el('tr',{tabIndex:0});tr.dataset.step=r.step;
   if(r.step===Number(detailStep.value))tr.setAttribute('aria-selected','true');
   tr.append(el('td',{textContent:String(i+1)}),el('td',{},el('strong',{textContent:String(r.step)})),el('td',{textContent:String(r.mod)}),
    ...scanned.targets.map((x,j)=>{const v=r.findx[j],bound=findxLowerBound(scanned.coreSize,x);return el('td',{className:'num'},v===null?el('span',{className:'hint',textContent:'never',title:`Mod ${r.mod} leaves gaps of ${r.mod-1}`}):fmt(v),v===null?null:el('small',{textContent:' +'+Math.round((v/bound-1)*100)+'%'}));}),
    el('td',{className:'num',textContent:fmt(r.score)}),el('td',{className:'num',textContent:String(r.euclid)}),el('td',{className:'sf-seq'+(r.maxRatio>4?' sf-warn':''),textContent:shortSeq(r.seq),title:r.maxRatio>4?`Largest ratio ${r.maxRatio.toFixed(1)}: a slow phase`:''}));
   return tr;
  }));
  body.onclick=e=>{const tr=e.target.closest('tr[data-step]');if(tr)showDetail(Number(tr.dataset.step));};
  body.onkeydown=e=>{if(e.key==='Enter'){const tr=e.target.closest('tr[data-step]');if(tr)showDetail(Number(tr.dataset.step));}};
  table.replaceChildren(el('caption',{className:'hint',textContent:`${fmt(list.length)} steps${list.length>limit?`, top ${limit} shown`:''}. Click a row for details.`}),el('thead',{},head),body);
 }
 const shortSeq=seq=>seq.length<=7?seq.join(', '):seq.slice(0,5).join(', ')+', …, '+seq.at(-1);

 let detailShown=false,current=null;
 function showDetail(step){
  detailShown=true;detailStep.value=step;persist();
  for(const tr of table.querySelectorAll('tr[data-step]'))tr.toggleAttribute('aria-selected',Number(tr.dataset.step)===step);
  drawDetail();
 }
 function drawDetail(){
  const N=scanned?.coreSize??coreSize(),list=scanned?.targets??targetList();
  let s=Math.floor(Number(detailStep.value))||1;s=((s%N)+N)%N||1;
  const p=profile(s,N),seq=gapSequence(Math.min(s,N-s),N),ratios=gapRatios(seq);
  current={N,s,p,targets:list};
  const signed=Number(sign.value)<0?-s:s;
  snippet.textContent=`step    equ ${signed}`;
  facts.replaceChildren(el('dl',{},
   ...[['Mod',String(p.mod)],['Hits in a full run',fmt(p.hits)],['Final spacing',`every ${p.mod} cell${p.mod===1?'':'s'}`],['Classic score',fmt(p.score)],['Euclid count',String(euclidCount(Math.min(s,N-s),N))],
    ...list.map(x=>{const v=findxFrom(p.maxRun,p.hits,x),b=findxLowerBound(N,x);return ['find-'+x,v===null?`never (mod ${p.mod})`:`${fmt(v)} hits · bound ${fmt(b)} · +${Math.round((v/b-1)*100)}%`];})
   ].flatMap(([k,v])=>[el('dt',{textContent:k}),el('dd',{textContent:v})])));
  sequence.replaceChildren(...seq.flatMap((v,i)=>{
   const out=[el('span',{className:'sf-term',textContent:String(v)})];
   if(i<ratios.length){const r=ratios[i];out.push(el('span',{className:'sf-ratio'+(r>4?' sf-warn':''),textContent:'×'+r.toFixed(1),title:r>4?'Large ratio: a long, slow phase':'Ratio to the next term'}));}
   return out;
  }));
  if(Math.min(s,N-s)!==s)sequence.append(el('p',{className:'hint',textContent:`Shown for ${N-s}, the mirror image of ${s}.`}));
  hits.max=String(p.hits);if(Number(hits.value)>p.hits||!hits.dataset.touched)hits.value=String(Math.min(p.hits,Math.max(1,findxFrom(p.maxRun,p.hits,list.at(-1))??Math.ceil(p.hits/4))));
  drawChart();drawStrip();
 }
 // Update as the step is typed, not only when the field loses focus.
 let typing=0;
 const typedStep=()=>{clearTimeout(typing);const v=Math.floor(Number(detailStep.value));if(v>=1)showDetail(v);};
 detailStep.addEventListener('input',()=>{clearTimeout(typing);typing=setTimeout(typedStep,250);});
 detailStep.addEventListener('change',typedStep);
 sign.onchange=drawDetail;
 hits.addEventListener('input',()=>{hits.dataset.touched='1';drawStrip();});
 copy.onclick=async()=>{try{await navigator.clipboard.writeText(snippet.textContent);copy.textContent='Copied';}catch{copy.textContent='Copy failed';}setTimeout(()=>copy.textContent='Copy',1200);};

 const css=name=>getComputedStyle(root).getPropertyValue(name).trim();
 function canvasSize(c,h){const r=devicePixelRatio||1,w=Math.max(200,c.clientWidth);c.width=w*r;c.height=h*r;const ctx=c.getContext('2d');ctx.scale(r,r);return [ctx,w,h];}
 function drawChart(){
  if(!current||!chart.isConnected||!chart.clientWidth)return;
  const {N,p,targets:list}=current,[ctx,w,h]=canvasSize(chart,240),L=44,R=10,T=10,B=26;
  ctx.fillStyle=css('--panel')||'#101d29';ctx.fillRect(0,0,w,h);
  const xs=n=>L+(w-L-R)*Math.log(n)/Math.log(p.hits||2),ymax=Math.log(N),ys=v=>T+(h-T-B)*(1-Math.log(Math.max(1,v))/ymax);
  ctx.font='11px system-ui';ctx.fillStyle=css('--muted')||'#aec0ce';ctx.strokeStyle='#2a3d4d';ctx.lineWidth=1;
  for(let v=1;v<=N;v*=10){ctx.beginPath();ctx.moveTo(L,ys(v));ctx.lineTo(w-R,ys(v));ctx.stroke();ctx.fillText(fmt(v),4,ys(v)+4);}
  for(let n=1;n<=p.hits;n*=10){ctx.fillText(fmt(n),xs(n)-4,h-8);}
  ctx.fillText('longest empty run · hits on a log scale',L+6,T+10);
  // Ideal N/n
  ctx.setLineDash([4,4]);ctx.strokeStyle='#5f7a8e';ctx.beginPath();for(let n=1;n<=p.hits;n=Math.ceil(n*1.05)+0){const x=xs(n),y=ys(N/n);n===1?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle=css('--accent')||'#54d8df';ctx.lineWidth=1.6;ctx.beginPath();
  for(let n=1;n<=p.hits;n++){const x=xs(n),y=ys(p.maxRun[n]);n===1?ctx.moveTo(x,y):ctx.lineTo(x,y);}
  ctx.stroke();
  list.forEach(x=>{
   const y=ys(x);ctx.strokeStyle='#d68a24';ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();ctx.setLineDash([]);
   ctx.fillStyle='#f1c96b';ctx.fillText('x='+x,w-R-40,y-3);
   const n=findxFrom(p.maxRun,p.hits,x);if(n!==null){ctx.beginPath();ctx.arc(xs(n),ys(p.maxRun[n]),3.5,0,7);ctx.fill();}
  });
 }
 function drawStrip(){
  if(!current||!strip.isConnected||!strip.clientWidth)return;
  const {N,s,p}=current,n=Math.max(1,Math.min(p.hits,Math.floor(Number(hits.value))||1));
  const step=Number(sign.value)<0?N-s:s;
  hitsOut.textContent=`${fmt(n)} of ${fmt(p.hits)} · longest empty run ${fmt(p.maxRun[n])}`;
  const width=Math.max(200,strip.clientWidth),cols=Math.min(N,Math.max(10,Math.floor(width/4)>=100?100:Math.floor(width/4))),rowsN=Math.ceil(N/cols),cell=Math.max(1,Math.min(8,Math.floor(width/cols)));
  const [ctx]=canvasSize(strip,Math.min(640,rowsN*cell+2));
  ctx.fillStyle='#0b1620';ctx.fillRect(0,0,width,rowsN*cell+2);
  const bombed=new Uint8Array(N);for(const pos of hitPositions(step,N,n))bombed[pos]=1;
  ctx.fillStyle='#16283a';for(let i=0;i<N;i++)if(!bombed[i])ctx.fillRect((i%cols)*cell,Math.floor(i/cols)*cell,cell-(cell>2),cell-(cell>2));
  ctx.fillStyle=css('--accent')||'#54d8df';for(let i=0;i<N;i++)if(bombed[i])ctx.fillRect((i%cols)*cell,Math.floor(i/cols)*cell,cell-(cell>2),cell-(cell>2));
  // Outline the longest empty run (circular).
  let best=0,start=0;const firstHit=bombed.indexOf(1);
  for(let i=firstHit,run=0;i<firstHit+N;i++){if(bombed[i%N]){run=0;}else{run++;if(run>best){best=run;start=i-run+1;}}}
  ctx.fillStyle='#f9a56799';for(let k=0;k<best;k++){const i=(start+k)%N;ctx.fillRect((i%cols)*cell,Math.floor(i/cols)*cell,cell,cell);}
 }
 new ResizeObserver(()=>{drawChart();drawStrip();}).observe(detail);
 render();drawDetail();
 return {show(){drawChart();drawStrip();},hide(){}};
}

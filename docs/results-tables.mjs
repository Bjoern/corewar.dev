// SPDX-License-Identifier: GPL-2.0-or-later
// Tournament and benchmark results as sortable tables and a score matrix (like the KOTH hill pages).

// Per-pair totals of a run. Rows are the entrants; columns are their opponents: the entrants
// again, or the suite's warriors in Benchmark mode. cells[r][c] holds what row r scored against
// column c ({wins,ties,losses,score,rounds}, plus given: what c scored against r), or null where
// they did not fight. Melee has no pairs.
export function pairTotals({plan,results,suite=null,excluded=[]}){
 if(plan.mode==='melee')return null;
 const out=w=>excluded.some(e=>e.source===w.source);
 const rows=plan.entrants.filter(w=>!out(w));
 const benchmark=plan.mode==='benchmark';
 const columns=benchmark?(suite?.warriors||[]).filter(w=>!out(w)):rows;
 const rowIndex=new Map(rows.map((w,i)=>[w.id,i]));
 const columnIndex=benchmark?new Map((suite?.warriors||[]).map((w,o)=>[o,columns.indexOf(w)])):rowIndex;
 const cells=rows.map(()=>columns.map(()=>null));
 const add=(r,c,w,rounds,other)=>{
  if(r===undefined||c===undefined||r<0||c<0)return;
  const cell=cells[r][c]??={wins:0,ties:0,losses:0,score:0,given:0,rounds:0};
  for(const key of ['wins','ties','losses','score'])cell[key]+=w[key];cell.given+=other.score;cell.rounds+=rounds;
 };
 for(const result of results){
  const job=plan.jobs[result.id];
  if(job.kind==='self'||job.kind==='hill')continue;
  const [x,y]=result.warriors,a=rowIndex.get(job.warriors[0].id);
  if(benchmark){add(a,columnIndex.get(job.opponent),x,result.completed,y);continue;}
  const b=rowIndex.get(job.warriors[1].id);
  add(a,b,x,result.completed,y);
  if(a!==b)add(b,a,y,result.completed,x);
 }
 return {rows,columns,cells};
}

export const perRound=cell=>cell&&cell.rounds?cell.score/cell.rounds:null;

// Sort a copy of rows by a column's value; empty values (null) always go last.
export function sortRows(rows,columns,{key,dir}){
 const column=columns.find(c=>c.key===key);if(!column)return [...rows];
 const value=column.sort||column.value,sign=dir==='asc'?1:-1;
 return [...rows].sort((a,b)=>{
  const x=value(a),y=value(b);
  if(x==null||y==null)return x==null&&y==null?0:x==null?1:-1;
  return sign*(typeof x==='string'||typeof y==='string'?String(x).localeCompare(String(y)):x-y);
 });
}

// Fill a <table> with sortable headers. columns: {key,label,value(row),cell?(row)→string|Node,
// cellTitle?(row),firstDir?,title?}. state {key,dir} is updated in place on a header click, then
// onSort() runs. foot: optional cell contents, one per column, for a summary row below the rows.
export function renderTable(table,columns,rows,state,onSort,foot=null){
 const head=document.createElement('thead'),tr=document.createElement('tr');
 for(const column of columns){
  const th=document.createElement('th');th.scope='col';
  if(column.sortable===false){th.textContent=column.label;if(column.className)th.className=column.className;tr.append(th);continue;}
  const sorted=state.key===column.key,button=document.createElement('button');
  button.type='button';button.className='sort-button';
  button.textContent=column.label+(sorted?(state.dir==='asc'?' ▲':' ▼'):'');
  if(column.title)button.title=column.title;
  button.onclick=()=>{if(sorted)state.dir=state.dir==='asc'?'desc':'asc';else{state.key=column.key;state.dir=column.firstDir||'desc';}onSort();};
  th.setAttribute('aria-sort',sorted?(state.dir==='asc'?'ascending':'descending'):'none');
  th.append(button);tr.append(th);
 }
 head.append(tr);
 const body=document.createElement('tbody');
 for(const row of sortRows(rows,columns,state)){
  const tr=document.createElement('tr');
  for(const column of columns){
   const td=document.createElement('td'),content=column.cell?column.cell(row):column.value(row);
   if(column.className)td.className=column.className;
   if(column.cellTitle)td.title=column.cellTitle(row);
   if(content instanceof Node)td.append(content);else td.textContent=content==null?'—':String(content);
   tr.append(td);
  }
  if(row.rowClass)tr.className=row.rowClass;
  body.append(tr);
 }
 if(!foot)return table.replaceChildren(head,body);
 const tfoot=document.createElement('tfoot'),last=document.createElement('tr');
 for(const [i,content] of foot.entries()){const td=document.createElement('td');if(columns[i]?.className)td.className=columns[i].className;td.textContent=content??'';last.append(td);}
 tfoot.append(last);table.replaceChildren(head,body,tfoot);
}

// Cell colour from wins minus losses over rounds (−1 … 1): red for a loss, green for a win,
// the panel colour for an even pair or a tie-out, so it reads the same whatever the score formula.
const PANEL=[19,40,58],RED=[178,50,56],GREEN=[35,122,69];
export function marginColor(cell){
 if(!cell||!cell.rounds)return null;
 const t=Math.max(-1,Math.min(1,(cell.wins-cell.losses)/cell.rounds)),to=t<0?RED:GREEN,k=Math.min(1,Math.abs(t)*1.4);
 return `rgb(${PANEL.map((p,i)=>Math.round(p+(to[i]-p)*k)).join(',')})`;
}
const per100=cell=>cell&&cell.rounds?Math.round(cell.score*100/cell.rounds):null;
const average=values=>{const v=values.filter(x=>x!=null);return v.length?Math.round(v.reduce((s,x)=>s+x,0)/v.length):null;};

// The score matrix: points per 100 rounds that each row warrior scored against each column
// warrior; the right column averages a row, the bottom row what the column warriors conceded.
// order: row indexes in display order (round robin: the columns follow the same order).
export function renderMatrix(container,{rows,columns,cells},{order,sameOrder,onPick}){
 const columnOrder=sameOrder?order:columns.map((_,i)=>i);
 const table=document.createElement('table');table.className='score-matrix';
 const head=document.createElement('tr');head.append(document.createElement('th'));
 for(const c of columnOrder){const th=document.createElement('th');th.scope='col';th.className='m-col';const span=document.createElement('span');span.textContent=columns[c].name;th.title=columns[c].name;th.append(span);head.append(th);}
 const avgHead=document.createElement('th');avgHead.scope='col';avgHead.className='m-col';avgHead.innerHTML='<span>Average</span>';head.append(avgHead);
 const thead=document.createElement('thead');thead.append(head);
 const body=document.createElement('tbody');
 for(const r of order){
  const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';
  const pick=document.createElement('button');pick.type='button';pick.className='link-button';pick.textContent=rows[r].name;pick.title=`${rows[r].name}: results against each opponent`;pick.onclick=()=>onPick(rows[r].id);
  th.append(pick);tr.append(th);
  for(const c of columnOrder){
   const td=document.createElement('td'),cell=cells[r][c],value=per100(cell);
   td.textContent=value??'';const color=marginColor(cell);if(color)td.style.background=color;
   if(cell)td.title=`${rows[r].name} vs ${columns[c].name}: ${cell.wins} wins, ${cell.ties} ties, ${cell.losses} losses in ${cell.rounds} rounds`;
   tr.append(td);
  }
  const avg=document.createElement('td');avg.className='m-avg';avg.textContent=average(columnOrder.map(c=>per100(cells[r][c])))??'';tr.append(avg);
  body.append(tr);
 }
 const foot=document.createElement('tr'),label=document.createElement('th');label.scope='row';label.textContent='Conceded';label.title='Average that the row warriors scored against this warrior';foot.append(label);
 for(const c of columnOrder){const td=document.createElement('td');td.className='m-avg';td.textContent=average(order.map(r=>per100(cells[r][c])))??'';foot.append(td);}
 foot.append(document.createElement('td'));
 const tfoot=document.createElement('tfoot');tfoot.append(foot);
 table.append(thead,body,tfoot);container.replaceChildren(table);
}

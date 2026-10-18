// SPDX-License-Identifier: GPL-2.0-or-later
// Push-off rankings over a Koenigstuhl-style score matrix (see PUSHOFF.md).
// v[i][j] is warrior i's score against warrior j as stored by John Metcalf's
// scheduler: floor((3*wins + ties) * 1e6 / rounds), i.e. KOTH percent × 1e4.
// The arithmetic mirrors resources/pushoff.rb and resources/diversity.rb,
// including Ruby's integer divisions, so logs match the scripts digit for digit.

export const rankings={
 average:{label:'Points per round',columns:[]},
 sequential:{label:'Sequential push-off',columns:['Score']},
 diversity:{label:'Diversity push-off (Astolfi)',columns:['Discriminant','Distance','Score']},
 'sd-diversity':{label:'SD-score diversity push-off',columns:['Discriminant','SD-score','Score']},
};

export function koenScore(wins,ties,rounds){return Math.floor((3*wins+ties)*1e6/rounds);}

const compare=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return 0;};
const idiv=(a,b)=>Math.floor(a/b); // Ruby Integer#/ for the non-negative values used here

// Returns {ranking, steps}. ranking lists original indices, winner first.
// Each step records the pool size before removal, the removed index, the
// variant's displayed values, and (for diversity variants) the nearest warrior.
export function pushoff(matrix,variant,{distanceOver='all'}={}){
 if(!rankings[variant]||variant==='average')throw new Error('Unknown push-off variant: '+variant);
 const n=matrix.length;
 if(matrix.some(row=>row.length!==n))throw new Error('Score matrix must be square.');
 if(!['all','common'].includes(distanceOver))throw new Error('distanceOver must be "all" or "common".');
 const v=matrix.map((row,i)=>row.map((x,j)=>variant!=='sequential'&&i===j?0:x));
 const ids=[...v.keys()],steps=[];
 while(ids.length>1){
  const size=ids.length,w=size-1;let best=null;
  if(variant==='sequential'){
   ids.forEach((id,i)=>{const sum=ids.reduce((t,k)=>t+v[id][k],0),key=[sum,i];if(!best||compare(key,best.key)<0)best={key,i,values:[sum/1e4/w]};});
  }else{
   const sigma=variant==='sd-diversity'?ids.map(k=>{const col=ids.map(r=>v[r][k]),mean=col.reduce((a,b)=>a+b,0)/size;return Math.sqrt(col.reduce((t,x)=>t+(x-mean)**2,0)/size);}):null;
   ids.forEach((a,i)=>{
    let nearest=Infinity,near=-1;
    ids.forEach((b,j)=>{
     if(i===j)return;
     let d=0,denominator=0,used=0;
     ids.forEach((k,c)=>{
      if(distanceOver==='common'&&(c===i||c===j))return;
      const diff=v[a][k]-v[b][k];d+=variant==='sd-diversity'?Math.abs(diff):diff*diff;
      if(sigma)denominator+=sigma[c];used++;
     });
     if(variant==='sd-diversity')d=denominator>0?d/denominator:d===0?0:Infinity;
     else d=used?idiv(d,distanceOver==='common'?used:w):0;
     if(d<nearest){nearest=d;near=b;}
    });
    const distance=variant==='sd-diversity'?nearest:Math.sqrt(nearest)/3e6;
    const score=idiv(ids.reduce((t,k)=>t+v[a][k],0),w)/1e4,key=[distance*score,distance,score,i];
    if(!best||compare(key,best.key)<0)best={key,i,values:key.slice(0,3),nearest:near};
   });
  }
  const removed=ids[best.i];
  steps.push({size,removed,values:best.values,...(best.nearest!==undefined&&{nearest:best.nearest})});
  ids.splice(best.i,1);
 }
 if(ids.length)steps.push({size:1,removed:ids[0],values:[]});
 return {ranking:steps.map(s=>s.removed).reverse(),steps};
}

// Koenigstuhl hill32.dat / hill32.scores (resources/koenformat.txt).
// The file stores [row][col] = column warrior's score against the row warrior,
// so it is the transpose of v.
export function readKoenigstuhl(datText,scoresBytes){
 const lines=datText.split(/\r?\n/),count=Number(lines.shift());
 if(!Number.isInteger(count)||count<1)throw new Error('The .dat file must start with the number of warriors.');
 if(lines.length<count*4)throw new Error(`The .dat file lists fewer than ${count} warriors.`);
 const warriors=Array.from({length:count},(_,i)=>{const [name,author,file,format]=lines.slice(i*4,i*4+4);return {name,author,file,format};});
 const bytes=scoresBytes instanceof ArrayBuffer?new Uint8Array(scoresBytes):scoresBytes;
 if(bytes.length!==count*count*4)throw new Error(`The .scores file must hold ${count}×${count} 32-bit values (${count*count*4} bytes), not ${bytes.length}.`);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const matrix=Array.from({length:count},(_,i)=>Array.from({length:count},(_,j)=>view.getInt32((j*count+i)*4,true)));
 return {warriors,matrix};
}

export function writeKoenigstuhl(warriors,matrix){
 const n=warriors.length,bytes=new Uint8Array(n*n*4),view=new DataView(bytes.buffer);
 for(let row=0;row<n;row++)for(let col=0;col<n;col++)view.setUint32((row*n+col)*4,matrix[col][row],true);
 const dat=`${n}\n`+warriors.map(w=>[w.name,w.author||'Anonymous',w.file,w.format||'94'].join('\n')+'\n').join('');
 return {dat,scores:bytes};
}

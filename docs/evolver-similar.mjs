// SPDX-License-Identifier: GPL-2.0-or-later
// How close an evolved warrior is to known ones (the benchmark, your warriors, the library): did a run
// find something of its own, or rebuild a warrior it was scored against or drew its code from (a
// Markov chain of the opponents can)? Warriors are compared as assembled code (genomes:
// [op, modifier, A mode, A field, B mode, B field], fields modulo the core size), instruction by
// instruction in order, so labels, comments, EQUs and layout make no difference:
//   identical  instructions the two have in common in the same order (longest common subsequence,
//              whole instructions with their fields);
//   shape      the same with only opcode, modifier and modes compared: the same design with other constants;
//   run        the longest block of identical instructions in a row: a copied loop or bomb shows here.
// Gaps are allowed in identical and shape, so a copy with a few instructions changed, added or removed
// still scores high. Repeats of one instruction in a row count once (see prepare()).

const mod=(x,n)=>((Math.trunc(x)%n)+n)%n;
const whole=(ins,cs)=>`${ins[0]}.${ins[1]}.${ins[2]}.${mod(ins[3],cs)}.${ins[4]}.${mod(ins[5],cs)}`;
const shapeOf=ins=>`${ins[0]}.${ins[1]}.${ins[2]}.${ins[4]}`;

// Longest common subsequence of two lists, by length.
export function lcs(a,b){
 if(!a.length||!b.length)return 0;
 let prev=new Uint16Array(b.length+1),row=new Uint16Array(b.length+1);
 for(let i=1;i<=a.length;i++){
  for(let j=1;j<=b.length;j++)row[j]=a[i-1]===b[j-1]?prev[j-1]+1:Math.max(prev[j],row[j-1]);
  [prev,row]=[row,prev];
 }
 return prev[b.length];
}
// Longest common block (substring) of two lists, by length.
export function longestRun(a,b){
 let prev=new Uint16Array(b.length+1),row=new Uint16Array(b.length+1),best=0;
 for(let i=1;i<=a.length;i++){
  for(let j=1;j<=b.length;j++){row[j]=a[i-1]===b[j-1]?prev[j-1]+1:0;if(row[j]>best)best=row[j];}
  [prev,row]=[row,prev];
 }
 return best;
}
// One warrior's code in the two forms compared; known warriors are prepared once. A run of the same
// instruction counts once: many warriors fill up to the length limit with DAT 0, 0 or a decoy
// repeated, and two of those would otherwise look alike for their filler alone. `length` is the
// instruction count after that.
export function prepare(genome,coreSize){
 const code=(genome.code||[]).filter((ins,i,all)=>!i||whole(ins,coreSize)!==whole(all[i-1],coreSize));
 return {length:code.length,whole:code.map(i=>whole(i,coreSize)),shape:code.map(shapeOf)};
}
// The counts for one pair, and the shares: of yours (`a`, the evolved warrior) and of the longer one.
export function similarity(a,b){
 const identical=lcs(a.whole,b.whole),shape=lcs(a.shape,b.shape),run=longestRun(a.whole,b.whole),n=Math.max(1,a.length),longer=Math.max(1,a.length,b.length);
 return {identical,shape,run,length:b.length,ofYours:identical/n,shapeOfYours:shape/n,overall:identical/longer};
}
// What a pair amounts to: 'copy' (nearly the same warrior), 'contains' (most of yours is in theirs,
// in order), or null.
export function verdict(s,yours){
 if(s.overall>=0.8)return 'copy';
 if(yours>=3&&s.ofYours>=0.6)return 'contains';
 return null;
}
// The known warriors ({name, genome, from}) closest to `genome`, closest first: by the share of yours
// they hold identically, then by how much of the longer one that is, then by shape.
export function closest(genome,known,coreSize,limit=10){
 const a=prepare(genome,coreSize);
 return known.map(k=>{const s=similarity(a,k.prepared??prepare(k.genome,coreSize));return {name:k.name,from:k.from,...s,verdict:verdict(s,a.length)};})
  .sort((x,y)=>y.ofYours-x.ofYours||y.overall-x.overall||y.shapeOfYours-x.shapeOfYours||y.run-x.run)
  .slice(0,limit);
}

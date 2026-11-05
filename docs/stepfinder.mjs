// SPDX-License-Identifier: GPL-2.0-or-later
// Step finder math (resources/step-finder-spec.md). Pure functions, no DOM: the Tools tab,
// its worker and the Node tests share them. A bomber or scanner with step s visits
// 0, s, 2s, … (mod N); hit n (1-based) lands on (n-1)·s mod N.

export const gcd=(a,b)=>{a=Math.abs(a);b=Math.abs(b);while(b){[a,b]=[b,a%b];}return a;};
export const modOf=(step,coreSize)=>gcd(step,coreSize);

// Signed nearest-remainder Euclid (the author's algorithm). Each term is the step at which the
// previous gap size gets filled; the last term's absolute value is the mod.
export function gapSequence(step,coreSize){
 let s=step,dir=1,M=coreSize;
 const seq=[s];
 if(s<=0)return seq;
 while(M%s!==0){
  const f=Math.floor(M/s),next=((f+1)*s)%M;
  dir*=next>s-next?-1:1;
  const old=s;
  s=Math.min(next,s-next);
  seq.push(dir*s);
  M=old;
 }
 return seq;
}
// |a_i| / |a_{i+1}|: around 2–3 is cheap; large ratios mean a long, slow phase.
export const gapRatios=seq=>seq.slice(1).map((v,i)=>Math.abs(seq[i])/Math.abs(v));

// Andy Pierce's Euclid step count: higher is more Fibonacci-like splitting.
export function euclidCount(step,coreSize){let a=step,b=coreSize,n=0;while(a){[a,b]=[b%a,a];n++;}return n;}

// Lower bound on hits before no empty run of x cells remains: n hits leave n gaps in N cells.
export const findxLowerBound=(coreSize,x)=>Math.ceil(coreSize/x);

// One pass in reverse hit order over a circular linked list of the hits in position order.
// Removing a hit merges two gaps, so the largest empty run only grows going backwards.
// Returns maxRun[n] = longest run of unbombed cells after the first n hits (n = 1..K),
// and the classic optima score: the sum over hits of the distance to the nearest earlier hit.
// buffers lets a caller that scans many steps reuse its arrays.
export function profile(step,coreSize,buffers=null){
 const N=coreSize,m=modOf(step,N)||N,K=N/m;
 const need=K+1;
 let b=buffers;
 if(!b||b.size<need){b={size:need,prev:new Int32Array(need),next:new Int32Array(need),maxRun:new Int32Array(need)};}
 const {prev,next,maxRun}=b;
 // Hits are exactly the multiples of m, so slot j of the sorted list is position j·m.
 for(let j=0;j<K;j++){prev[j]=(j+K-1)%K;next[j]=(j+1)%K;}
 maxRun[K]=m-1;
 let run=m-1,score=0;
 const s=((step%N)+N)%N;
 // Position of hit n (0-based) is n·s mod N; walk backwards with a subtraction.
 let pos=Number((BigInt(K-1)*BigInt(s))%BigInt(N));
 for(let n=K-1;n>=1;n--){
  const j=pos/m,p=prev[j],q=next[j];
  const left=((j-p+K)%K)*m,right=((q-j+K)%K)*m;
  score+=Math.min(left,right);
  next[p]=q;prev[q]=p;
  const merged=left+right-1;
  if(merged>run)run=merged;
  maxRun[n]=run;
  pos-=s;if(pos<0)pos+=N;
 }
 maxRun[1]=N-1;
 return {mod:m,hits:K,maxRun,score,buffers:b};
}
// Hits until no run of >= x unbombed cells remains (null if never: x below the mod).
export function findxFrom(maxRun,hits,x){
 if(!(x>=1)||maxRun[hits]>=x)return null;
 let lo=1,hi=hits;
 while(lo<hi){const mid=(lo+hi)>>1;if(maxRun[mid]<x)hi=mid;else lo=mid+1;}
 return lo;
}
export function findx(step,coreSize,x){const p=profile(step,coreSize);return findxFrom(p.maxRun,p.hits,x);}

// The plain O(N²) version, for tests on small cores.
export function findxNaive(step,coreSize,x){
 const N=coreSize,hit=new Uint8Array(N),K=N/modOf(step,N);
 for(let n=1;n<=K;n++){
  hit[((n-1)*step)%N]=1;
  let best=0,run=0,first=-1;
  for(let i=0;i<2*N;i++){if(hit[i%N]){if(first<0)first=i;run=0;}else if(first>=0&&i<first+N){run++;if(run>best)best=run;}}
  if(best<x)return n;
 }
 return null;
}
export function classicScoreNaive(step,coreSize){
 const N=coreSize,K=N/modOf(step,N),hits=[];let score=0;
 for(let n=0;n<K;n++){
  const p=(n*step)%N;
  if(hits.length){let d=N;for(const h of hits){const a=Math.abs(p-h);d=Math.min(d,a,N-a);}score+=d;}
  hits.push(p);
 }
 return score;
}

// Everything the results table shows for one step.
export function analyzeStep(step,coreSize,targets,buffers=null){
 const p=profile(step,coreSize,buffers),seq=gapSequence(step,coreSize),ratios=gapRatios(seq);
 return {step,mod:p.mod,hits:p.hits,
  findx:targets.map(x=>findxFrom(p.maxRun,p.hits,x)),
  score:p.score,euclid:euclidCount(step,coreSize),seq,maxRatio:ratios.length?Math.max(...ratios):0,buffers:p.buffers};
}
// Lower is better. 'x:<i>' ranks by one target; 'weighted' by Σ w·findx/lowerBound.
// A target that is never reached ranks a step last.
export function rankValue(row,{coreSize,targets,ranking,weights}){
 if(ranking.startsWith('x:')){const i=Number(ranking.slice(2));return row.findx[i]??Infinity;}
 let sum=0,total=0;
 targets.forEach((x,i)=>{const w=weights[i]??1;if(!w)return;total+=w;sum+=row.findx[i]===null?Infinity:w*row.findx[i]/findxLowerBound(coreSize,x);});
 return total?sum/total:Infinity;
}
// Positions bombed after the first n hits, for the core strip.
export function hitPositions(step,coreSize,n){const out=new Int32Array(n);for(let i=0;i<n;i++)out[i]=Number((BigInt(i)*BigInt(step))%BigInt(coreSize));return out;}
// Steps to scan: 1..N/2 by default; mod 0 means any.
export function candidateSteps({coreSize,from=1,to=Math.floor(coreSize/2),mod=0}){
 const out=[];
 for(let s=Math.max(1,from);s<=Math.min(to,coreSize-1);s++)if(!mod||modOf(s,coreSize)===mod)out.push(s);
 return out;
}

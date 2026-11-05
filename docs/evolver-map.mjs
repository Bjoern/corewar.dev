// SPDX-License-Identifier: GPL-2.0-or-later
// A 2-D map of a population for the evolver's population view: classical multidimensional
// scaling of the genome distance (evolver-genome.mjs), so warriors with similar code sit close
// together. Deterministic, and the best warrior (index 0) always lands right of and above the
// middle, so the map does not flip between generations.
import {distance} from './evolver-genome.mjs';

export function mapLayout(genomes,{iterations=120}={}){
 const n=genomes.length;
 if(n<3)return genomes.map((_,i)=>[i,0]);
 // Squared distances, double-centred: B = -½ J D² J.
 const B=new Float64Array(n*n),row=new Float64Array(n);let all=0;
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const d=distance(genomes[i],genomes[j]),d2=d*d;B[i*n+j]=B[j*n+i]=d2;row[i]+=d2;row[j]+=d2;all+=2*d2;}
 for(let i=0;i<n;i++)row[i]/=n;all/=n*n;
 for(let i=0;i<n;i++)for(let j=0;j<n;j++)B[i*n+j]=-0.5*(B[i*n+j]-row[i]-row[j]+all);
 // The distance is not Euclidean, so B can have negative eigenvalues: shift by a bound on
 // them, so power iteration finds the largest ones, not the largest in size.
 let shift=0;for(let i=0;i<n;i++){let s=0;for(let j=0;j<n;j++)s+=Math.abs(B[i*n+j]);shift=Math.max(shift,s);}
 const axes=[];
 for(let a=0;a<2;a++){
  let v=new Float64Array(n);for(let i=0;i<n;i++)v[i]=Math.sin(1+i*(a+1.7));
  let lambda=0;
  for(let it=0;it<iterations;it++){
   const w=new Float64Array(n);
   for(let i=0;i<n;i++){let s=shift*v[i];const o=i*n;for(let j=0;j<n;j++)s+=B[o+j]*v[j];w[i]=s;}
   for(const u of axes){let dot=0;for(let i=0;i<n;i++)dot+=w[i]*u.v[i];for(let i=0;i<n;i++)w[i]-=dot*u.v[i];}
   let norm=0;for(let i=0;i<n;i++)norm+=w[i]*w[i];norm=Math.sqrt(norm);
   if(!(norm>1e-12))break;
   for(let i=0;i<n;i++)w[i]/=norm;v=w;lambda=norm-shift;
  }
  axes.push({v,scale:Math.sqrt(Math.max(0,lambda))});
 }
 const coords=genomes.map((_,i)=>axes.map(u=>u.v[i]*u.scale));
 for(let a=0;a<2;a++)if(coords[0][a]<0)for(const c of coords)c[a]=-c[a];
 return coords;
}

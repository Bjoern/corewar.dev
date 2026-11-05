// SPDX-License-Identifier: GPL-2.0-or-later
// Scans many steps off the main thread and reports progress (resources/step-finder-spec.md).
import {analyzeStep,candidateSteps} from './stepfinder.mjs';
self.onmessage=({data})=>{
 const {coreSize,from,to,mod,targets}=data,steps=candidateSteps({coreSize,from,to,mod}),rows=[];
 let buffers=null,last=performance.now();
 for(let i=0;i<steps.length;i++){
  const r=analyzeStep(steps[i],coreSize,targets,buffers);buffers=r.buffers;delete r.buffers;rows.push(r);
  if(performance.now()-last>100){last=performance.now();self.postMessage({type:'progress',done:i+1,total:steps.length});}
 }
 self.postMessage({type:'done',rows});
};

// SPDX-License-Identifier: GPL-2.0-or-later
import {Engine} from './engine.mjs';
// Each job owns a fresh engine. All its rounds run together to retain P-space/RNG state.
self.onmessage=async({data:job})=>{
 let diagnostics='',assembling=null;
 try {
  const engine=await Engine.create(job.config,{visual:false,log:text=>{diagnostics=(diagnostics+'\n'+text).slice(-6000);}});
  engine.compile(job.warriors.map(w=>w.source),()=>{},null,index=>{assembling=index;});
  assembling=null;
  engine.setDebug(false);engine.setTrace(false);engine.start();
  self.postMessage({type:'started',id:job.id});
  // Avoid snapshots, rendering, and event-loop yields between native execution slices.
  // Cancellation terminates the worker; pause finishes the current matchup.
  let done=0;
  while(!done){done=engine.module._web_advance(100000,8);if(done<0)throw new Error('Engine advance failed.');}
  const update=engine.update(true);
  self.postMessage({type:'done',id:job.id,completed:update.completed,warriors:update.warriors.map(({name,wins,ties,losses,score})=>({name,wins,ties,losses,score}))});
 }catch(error){self.postMessage({type:'error',id:job.id,message:error.message,diagnostics,assemblyWarrior:assembling});}
};

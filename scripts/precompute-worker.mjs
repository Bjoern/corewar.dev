// SPDX-License-Identifier: GPL-2.0-or-later
// One hill pair per message for precompute-hill.mjs, run like docs/tournament-worker.mjs.
import {parentPort} from 'node:worker_threads';
import {Engine} from '../docs/engine.mjs';
parentPort.on('message',async({config,sources})=>{
 let diagnostics='';
 try{
  const engine=await Engine.create(config,{visual:false,log:text=>{diagnostics=(diagnostics+'\n'+text).slice(-6000);}});
  engine.compile(sources);engine.setDebug(false);engine.setTrace(false);engine.start();
  let done=0;
  while(!done){done=engine.module._web_advance(100000,8);if(done<0)throw new Error('Engine advance failed.');}
  const update=engine.update(true);
  parentPort.postMessage({completed:update.completed,warriors:update.warriors.map(({wins,ties,losses})=>({wins,ties,losses}))});
 }catch(error){parentPort.postMessage({error:error.message,diagnostics});}
});

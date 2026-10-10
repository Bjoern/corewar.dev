import {benchmarkCatalog} from '../_site/benchmark-catalog.mjs';
import {readBenchmark} from './benchmarks.mjs';
import {Engine} from './engine.mjs';
let count=0,failed=[];
for(const entry of benchmarkCatalog){
 const suite=readBenchmark(entry.descriptor,entry.files,entry.id);
 for(const warrior of suite.warriors){
  let logs='';
  try{
   const engine=await Engine.create({...suite.config,rounds:1,fixedSeries:false,fixedPosition:'catalog-check'},{visual:false,log:t=>{logs=(logs+'\n'+t).slice(-3000);}});
   engine.compile([';redcode\n;name Test loop\n;assert 1\njmp 0\n',warrior.source]);
   let update=engine.start();while(!update.done)update=engine.advance(100000,8);
   if(update.completed!==1)throw new Error('Expected one completed round.');
   count++;
  }catch(error){failed.push({suite:suite.name,file:warrior.file,error:error.message,logs});}
 }
 console.log(suite.name+': checked '+suite.warriors.length+' opponents');
}
if(failed.length){console.error(JSON.stringify(failed,null,2));process.exitCode=1;}
else console.log('PASS: all '+count+' catalog warriors assemble and complete a matchup under their descriptor settings.');

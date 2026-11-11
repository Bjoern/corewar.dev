// SPDX-License-Identifier: GPL-2.0-or-later
// The benchmark suites the whole app shares: the built-in ones (listed from the catalog, their
// warriors loaded on first use) and the user's own (imported, made from warriors, the library or
// tournament results, or copied from a built-in one), which the workspace saves. Tournaments, the
// Benchmarks tool and the other tools read and change them here; subscribe() hears every change.
import {benchmarkCatalog} from './benchmark-catalog.mjs';
import {readBenchmark,benchmarkHeader} from './benchmarks.mjs';

// onSaved: the user's own suites changed, so the workspace should save them.
export function createSuiteStore({onSaved=()=>{}}={}){
 const suites=benchmarkCatalog.map(s=>({id:s.id,descriptor:s.descriptor,...benchmarkHeader(s.descriptor),data:s.data,warriors:null}));
 const loading=new Map(),listeners=new Set();let serial=0;
 const builtIn=suite=>benchmarkCatalog.some(c=>c.id===(typeof suite==='string'?suite:suite?.id));
 const notify=change=>{for(const listener of [...listeners])listener(change);};
 const get=id=>suites.find(s=>s.id===id)||null;
 // A suite with its warriors: built-in ones are fetched once.
 function load(suite){
  if(typeof suite==='string')suite=get(suite);
  if(!suite)return Promise.reject(new Error('That benchmark is gone; reload the page or pick another.'));
  if(suite.warriors)return Promise.resolve(suite);
  if(!loading.has(suite.id))loading.set(suite.id,(async()=>{
   try{
    const response=await fetch(new URL(suite.data,import.meta.url));if(!response.ok)throw new Error('HTTP '+response.status);
    const {files,scores}=await response.json(),loaded=readBenchmark(suite.descriptor,files,suite.id,scores??null);
    const index=suites.indexOf(suite);if(index>=0)suites[index]=loaded;
    notify({type:'loaded',id:suite.id});return loaded;
   }catch(error){loading.delete(suite.id);suite.loadError=`Could not load the opponents (${error.message})`;notify({type:'loaded',id:suite.id});throw new Error(suite.loadError);}
  })());
  return loading.get(suite.id);
 }
 const newId=(prefix='suite')=>prefix+'-'+(++serial);
 function add(suite,from=null){suites.push(suite);notify({type:'added',id:suite.id,from});onSaved();return suite;}
 const create=(descriptor,files,{scores=null,from=null}={})=>add(readBenchmark(descriptor,files,newId(),scores),from);
 // Put an edited suite in the old one's place (same id).
 function replace(old,updated){
  const index=suites.indexOf(old);if(index<0)throw new Error('That benchmark is gone; reload the page or pick another.');
  suites[index]=updated;notify({type:'changed',id:updated.id});if(!builtIn(updated))onSaved();return updated;
 }
 function remove(suite){
  const index=suites.indexOf(suite);if(index<0||builtIn(suite))return;
  suites.splice(index,1);notify({type:'removed',id:suite.id});onSaved();
 }
 // For the tools' suite lists.
 const benchmarks=()=>suites.map(s=>({id:s.id,name:s.name,config:s.config,builtIn:builtIn(s)}));
 // The user's own suites for the workspace, and back: restoring replaces them, keeps their ids
 // (saved selections refer to them) and skips any that no longer read, saying which.
 const userSuites=()=>suites.filter(s=>!builtIn(s)).map(s=>({id:s.id,descriptor:s.descriptor,files:s.files,...(s.scoresData?{scores:s.scoresData}:{})}));
 function restore(list=[]){
  for(let i=suites.length-1;i>=0;i--)if(!builtIn(suites[i]))suites.splice(i,1);
  const problems=[];
  for(const x of list){
   try{
    if(suites.some(s=>s.id===x.id))throw new Error('its id is used twice');
    suites.push(readBenchmark(x.descriptor,x.files,x.id,x.scores??null));
    const n=Number(/-(\d+)$/.exec(x.id)?.[1]);if(n>serial)serial=n;
   }catch(error){problems.push(`${typeof x.descriptor?.name==='string'?x.descriptor.name:x.id} (${error.message})`);}
  }
  notify({type:'restored'});return problems;
 }
 const subscribe=listener=>{listeners.add(listener);return ()=>listeners.delete(listener);};
 return {suites,builtIn,get,load,newId,add,create,replace,remove,benchmarks,loadBenchmark:load,userSuites,restore,subscribe};
}

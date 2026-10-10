// SPDX-License-Identifier: GPL-2.0-or-later
import {defaults,settings} from './settings.mjs';
export const benchmarkParameters=['coreSize','cycles','tasks','maxLength','distance','pspace','rules88','noPspace','formula','rounds'];
export function benchmarkPath(path){
 if(typeof path!=='string'||!path||path.length>256||path.includes('\\')||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..')||/[:\0]/.test(path))throw new Error('Invalid benchmark file path: '+path);
 return path;
}
export function readBenchmark(descriptor,files,id='imported'){
 if(!descriptor||descriptor.version!==1)throw new Error('Benchmark descriptor must have version: 1.');
 if(typeof descriptor.name!=='string'||!descriptor.name.trim()||descriptor.name.length>100)throw new Error('Benchmark needs a name of 1–100 characters.');
 const parameters=descriptor.parameters??{};
 if(typeof parameters!=='object'||Array.isArray(parameters)||parameters===null)throw new Error('parameters must be an object.');
 for(const key of Object.keys(parameters))if(!benchmarkParameters.includes(key))throw new Error('Unknown benchmark parameter: '+key);
 for(const key of ['rules88','noPspace'])if(key in parameters&&typeof parameters[key]!=='boolean')throw new Error(key+' must be true or false.');
 const rounds=parameters.rounds??100;
 if(!Number.isInteger(rounds)||rounds<1)throw new Error('Benchmark rounds must be a positive integer.');
 const config=settings({...defaults,...parameters,rounds,warriors:2});
 if(!Array.isArray(descriptor.warriors)||!descriptor.warriors.length||descriptor.warriors.length>500)throw new Error('List between 1 and 500 warrior files.');
 const paths=descriptor.warriors.map(benchmarkPath);
 if(new Set(paths).size!==paths.length)throw new Error('A warrior file is listed more than once.');
 const warriors=paths.map((file,i)=>{
  if(!Object.hasOwn(files,file))throw new Error('Missing warrior file: '+file);
  const source=files[file];if(typeof source!=='string'||new TextEncoder().encode(source).length>65536)throw new Error('Warrior exceeds 64 KiB: '+file);
  return {id:id+'-'+i,file,name:source.match(/^\s*;name\s+([^\r\n]*)/im)?.[1].trim()||file,source};
 });
 return {id,name:descriptor.name.trim(),descriptor:JSON.parse(JSON.stringify(descriptor)),files:{...files},warriors,config,rounds};
}
export async function importBenchmarkFiles(input,id){
 const files=Array.from(input);
 if(files.length>1000)throw new Error('Import at most 1,000 files at once.');
 const descriptors=files.filter(f=>f.name.toLowerCase().endsWith('.json'));
 if(descriptors.length!==1)throw new Error('Select one benchmark JSON descriptor together with its warrior files.');
 if(descriptors[0].size>1048576)throw new Error('Descriptor exceeds 1 MiB.');
 const descriptor=JSON.parse((await descriptors[0].text()).replace(/^\uFEFF/,''));
 const descriptorPath=descriptors[0].webkitRelativePath||descriptors[0].name;
 const base=descriptorPath.slice(0,descriptorPath.lastIndexOf('/')+1),sources=Object.create(null);
 for(const f of files){
  if(f===descriptors[0])continue;
  if(f.size>65536)throw new Error('Warrior exceeds 64 KiB: '+f.name);
  const path=f.webkitRelativePath||f.name;
  if(!path.startsWith(base))continue;
  const relative=benchmarkPath(path.slice(base.length));
  if(Object.hasOwn(sources,relative))throw new Error('Duplicate filename: '+relative);
  sources[relative]=await f.text();
 }
 return readBenchmark(descriptor,sources,id);
}

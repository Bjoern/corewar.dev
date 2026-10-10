// SPDX-License-Identifier: GPL-2.0-or-later
export function warriorFilename(name){
 const stem=(name||'warrior').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,180)||'warrior';
 return stem.toLowerCase().endsWith('.red')?stem:stem+'.red';
}
export function suiteFilenames(warriors){
 const used=new Set(['suite.benchmark.json']);
 return warriors.map(w=>{
  const original=w.file||warriorFilename(w.name),dot=original.lastIndexOf('.');
  const stem=dot>0?original.slice(0,dot):original,ext=dot>0?original.slice(dot):'';
  let file=original,n=2;
  while(used.has(file.toLowerCase()))file=stem+'-'+(n++)+ext;
  used.add(file.toLowerCase());return file;
 });
}

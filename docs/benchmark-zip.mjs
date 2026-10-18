// SPDX-License-Identifier: GPL-2.0-or-later
// Store files without compression: small Redcode suites need no ZIP dependency.
const encoder=new TextEncoder();
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function benchmarkZip(suite){
 let descriptorName='suite.benchmark.json';
 while(suite.descriptor.warriors.includes(descriptorName))descriptorName='_'+descriptorName;
 return storeZip([[descriptorName,JSON.stringify(suite.descriptor,null,2)+'\n'],...suite.descriptor.warriors.map(path=>[path,suite.files[path]]),...(suite.scoresData?[[suite.descriptor.scores,JSON.stringify(suite.scoresData)+'\n']]:[])]);
}
// files: [[path, string or Uint8Array], ...]
export function storeZip(files){
 const local=[],central=[];let offset=0,centralSize=0;
 for(const [path,source] of files){
  const name=encoder.encode(path),data=typeof source==='string'?encoder.encode(source):source,crc=crc32(data);
  const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);
  h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);header.set(name,30);
  const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);
  d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);
  d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);
  local.push(header,data);central.push(directory);offset+=header.length+data.length;centralSize+=directory.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
 return new Blob([...local,...central,end],{type:'application/zip'});
}

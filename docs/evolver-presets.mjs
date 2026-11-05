// SPDX-License-Identifier: GPL-2.0-or-later
// Settings presets of the warrior evolver, each with the benchmarks it challenges (catalog ids
// from warriors_public/, first one the default) and run defaults that suit the core size.
const COMMON={rules88:false,noPspace:false,formula:'(W*W-1)/S'};
export const EVOLVER_PRESETS=[
 {id:'nano',title:'Nano hill',note:'core 80 · 80 processes · 800 cycles · length 5 · distance 5',
  config:{...COMMON,coreSize:80,cycles:800,tasks:80,maxLength:5,distance:5,pspace:5},
  benchmarks:['public-nanobm07/suite.benchmark.json'],defaults:{population:40,generations:200,rounds:142}},
 {id:'tiny',title:'Tiny hill',note:'core 800 · 800 processes · 8,000 cycles · length 20 · distance 20',
  config:{...COMMON,coreSize:800,cycles:8000,tasks:800,maxLength:20,distance:20,pspace:50},
  benchmarks:['public-tinybm04/suite.benchmark.json','public-tinybm02/suite.benchmark.json','public-tinyfran/suite.benchmark.json'],defaults:{population:30,generations:150,rounds:100}},
 {id:'94',title:'Standard ’94 hill',note:'core 8000 · 8000 processes · 80,000 cycles · length 100 · distance 100',
  config:{...COMMON,coreSize:8000,cycles:80000,tasks:8000,maxLength:100,distance:100,pspace:500},
  benchmarks:['public-wilkies/suite.benchmark.json','public-wilfiz/suite.benchmark.json','public-ssr5bm/suite.benchmark.json','public-94top50/suite.benchmark.json','public-psptop50/suite.benchmark.json'],defaults:{population:20,generations:100,rounds:40}},
 {id:'custom',title:'Custom',note:'your own core size, cycles, processes, length and distance (ICWS ’94)',
  config:{...COMMON,coreSize:800,cycles:8000,tasks:800,maxLength:20,distance:20,pspace:50},
  benchmarks:[],defaults:{population:30,generations:100,rounds:100}}
];
export const CUSTOM_FIELDS=[['coreSize','Core size',80,65535],['cycles','Cycles',1,10000000],['tasks','Processes',1,65536],['maxLength','Max length',1,1000],['distance','Min distance',1,32767]];
// Settings that pMARS and exMARS both take; the message says what to change.
export function checkCustom(c){
 for(const [key,label,min,max] of CUSTOM_FIELDS)if(!Number.isInteger(c[key])||c[key]<min||c[key]>max)return `${label} must be a whole number from ${min} to ${max}.`;
 if(c.maxLength>c.distance)return 'The minimum distance must be at least the maximum length.';
 if(2*c.distance>c.coreSize)return 'The minimum distance can be at most half the core.';
 return null;
}
// A suite fits when its warriors were written for the same core and length (and '94 rules).
export const suiteFits=(parameters,config)=>!parameters.rules88&&parameters.coreSize===config.coreSize&&parameters.maxLength<=config.maxLength;
// Several warriors pasted at once: split before each ;redcode line, or after each END.
export function splitWarriors(text){
 const t=String(text).replace(/\r\n?/g,'\n').trim();if(!t)return [];
 let parts=t.split(/\n(?=\s*;redcode)/i);
 if(parts.length<2)parts=t.split(/(?<=^\s*end\b[^\n]*)\n/im);
 return parts.map(p=>p.trim()).filter(p=>/^\s*[^;\s]/m.test(p)).map((source,i)=>({name:source.match(/^\s*;name\s+([^\n]*)/im)?.[1].trim()||`Pasted warrior ${i+1}`,source:source+'\n'}));
}

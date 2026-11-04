// SPDX-License-Identifier: GPL-2.0-or-later
// Template language of the constant optimizer, ported from cwopt (tools-import/cwopt/template.py).
// Redcode with "!" markers for the values to tune:
//   marker := "!" [domain] {filter} [":" value]
//   domain := "(" expr ".." expr ["," expr] ")" | "[" token {"," token} "]"
//   filter := "?" ("coprime" | "odd" | "even")
// Text after ";" is ignored and "!=" is pMARS's not-equal operator, never a marker.
// A template maps an index vector (one index per variable into its value list) to source text.

const FILTERS=['coprime','odd','even'];
const OPCODES=new Set(['dat','spl','mov','djn','add','jmz','sub','seq','sne','slt','jmn','jmp','nop','mul','mod','div','ldp','stp','cmp']);
const MODIFIERS=new Set(['a','b','ab','ba','f','x','i']);
const MODE_CHARS=new Set([...'#$@<>*{}']);
const EQU_RE=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:?\s+equ\b/i;
const INT_RE=/^[+-]?\d+$/;
const IDENT_RE=/^[A-Za-z_][A-Za-z0-9_]*$/;
const gcd=(a,b)=>{a=Math.abs(a);b=Math.abs(b);while(b)[a,b]=[b,a%b];return a;};
const mod=(a,n)=>((a%n)+n)%n;

export class TemplateError extends Error{
 constructor(message,line=0,col=0){super(line?`line ${line}, column ${col}: ${message}`:message);this.detail=message;this.line=line;this.col=col;}
}
// Smallest absolute form: -floor(C/2) .. ceil(C/2)-1.
export function signed(v,coreSize){const r=mod(v,coreSize),half=Math.floor(coreSize/2);return r>=coreSize-half?r-coreSize:r;}
const normKey=(v,coreSize)=>INT_RE.test(v.trim())?'#n'+mod(parseInt(v,10),coreSize):v.trim().toLowerCase();

// Constants a range may use; pMARS predefines the same names.
export function templateConstants(config){
 return {CORESIZE:config.coreSize,MAXLENGTH:config.maxLength,MINDISTANCE:config.distance||config.maxLength,
  MAXPROCESSES:config.tasks,MAXCYCLES:config.cycles,PSPACESIZE:config.pspace||Math.max(1,Math.floor(config.coreSize/16)),WARRIORS:2,ROUNDS:config.rounds||1};
}

// Integers, + - * / % and parentheses (C semantics for / and %), and the constants above.
function evaluate(text,names,line,col){
 const toks=text.match(/\d+|[A-Za-z_][A-Za-z0-9_]*|[-+*/%()]|\S/g)||[];let i=0;
 const err=msg=>{throw new TemplateError(`${msg} in expression '${text.trim()}'`,line,col);};
 const peek=()=>toks[i];
 function add(){let v=mul();while(peek()==='+'||peek()==='-'){const op=toks[i++],r=mul();v=op==='+'?v+r:v-r;}return v;}
 function mul(){let v=unary();while(['*','/','%'].includes(peek())){const op=toks[i++],r=unary();if(op==='*')v*=r;else{if(r===0)err('division by zero');const q=Math.trunc(v/r);v=op==='/'?q:v-q*r;}}return v;}
 function unary(){
  const t=peek();
  if(t==='-'||t==='+'){i++;const v=unary();return t==='-'?-v:v;}
  if(t==='('){i++;const v=add();if(peek()!==')')err("missing ')'");i++;return v;}
  if(t===undefined)err('unexpected end');
  i++;
  if(/^\d+$/.test(t))return parseInt(t,10);
  if(Object.hasOwn(names,t.toUpperCase()))return names[t.toUpperCase()];
  err(`unknown name '${t}'`);
 }
 if(!toks.length)err('empty expression');
 const v=add();if(i!==toks.length)err(`unexpected '${toks[i]}'`);
 return v;
}
function matching(s,i,open,close){let depth=0;for(let j=i;j<s.length;j++){if(s[j]===open)depth++;else if(s[j]===close&&--depth===0)return j;}return -1;}
function splitTop(s,sep){const parts=[];let depth=0,cur='';for(const ch of s){if(ch==='(')depth++;else if(ch===')')depth--;if(ch===sep&&depth===0){parts.push(cur);cur='';}else cur+=ch;}parts.push(cur);return parts;}

function parseMarker(code,k,ln,constants){
 const coreSize=constants.CORESIZE,col=k+1,n=code.length;let i=k+1;
 const err=(msg,at=i)=>{throw new TemplateError(msg,ln,at+1);};
 let numeric=true,raw;
 if(code[i]==='('){
  const close=matching(code,i,'(',')');if(close<0)err("missing ')' in marker",k);
  const inner=code.slice(i+1,close);if(!inner.includes('..'))err("range needs 'a..b'");
  const at=inner.indexOf('..'),loText=inner.slice(0,at),parts=splitTop(inner.slice(at+2),',');
  if(parts.length>2)err('range takes at most a step: (a..b, s)');
  const lo=evaluate(loText,constants,ln,i+2),hi=evaluate(parts[0],constants,ln,i+2),step=parts.length===2?evaluate(parts[1],constants,ln,i+2):1;
  if(step<=0)err('step must be positive');
  if(hi<lo)err(`empty range ${lo}..${hi}`);
  if(Math.floor((hi-lo)/step)+1>coreSize)err(`range ${lo}..${hi} is wider than the core (${coreSize})`);
  raw=[];for(let v=lo;v<=hi;v+=step)raw.push(String(v));
  i=close+1;
 }else if(code[i]==='['){
  const close=code.indexOf(']',i);if(close<0)err("missing ']' in marker",k);
  const toks=code.slice(i+1,close).split(',').map(t=>t.trim());
  if(!toks.length||toks.some(t=>!t))err('empty token in list');
  for(const t of toks)if(!(INT_RE.test(t)||MODE_CHARS.has(t)||OPCODES.has(t.toLowerCase())||MODIFIERS.has(t.toLowerCase())||IDENT_RE.test(t)))err(`bad token '${t}' in list`);
  numeric=toks.every(t=>INT_RE.test(t));raw=toks;i=close+1;
 }else{
  const lo=-Math.floor(coreSize/2);raw=Array.from({length:coreSize},(_,j)=>String(lo+j));
 }
 const filters=[];
 while(code[i]==='?'){
  const m=/^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(i+1));
  if(!m||!FILTERS.includes(m[0].toLowerCase()))err('unknown filter; use ?coprime, ?odd or ?even');
  filters.push(m[0].toLowerCase());i+=1+m[0].length;
 }
 const spec=code.slice(k,i);
 let startText=null;
 if(code[i]===':'){
  const rest=code.slice(i+1),m=/^[+-]?\d+/.exec(rest)||/^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
  if(m){startText=m[0];i+=1+m[0].length;}
  else if(MODE_CHARS.has(rest[0])){startText=rest[0];i+=2;}
  else err('missing start value after ":"');
 }
 const values=[],seen=new Set();
 for(const v of raw){
  if(INT_RE.test(v)){
   const iv=parseInt(v,10);
   if(filters.includes('odd')&&iv%2===0)continue;
   if(filters.includes('even')&&iv%2!==0)continue;
   if(filters.includes('coprime')&&gcd(mod(iv,coreSize),coreSize)!==1)continue;
   const key=mod(iv,coreSize);
   if(seen.has(key))throw new TemplateError(`values ${v} and another value are equal mod CORESIZE (${coreSize})`,ln,col);
   seen.add(key);values.push(String(signed(iv,coreSize)));
  }else{
   if(filters.length)throw new TemplateError('filters apply to numbers only',ln,col);
   if(seen.has(v.toLowerCase()))throw new TemplateError(`duplicate token '${v}'`,ln,col);
   seen.add(v.toLowerCase());values.push(v);
  }
 }
 if(!values.length)throw new TemplateError('no values left after filtering',ln,col);
 const variable={name:`${ln}:${col}`,line:ln,col,end:i,spec,values,numeric,start:null,onEqu:false};
 if(startText!==null){
  const index=values.findIndex(v=>normKey(v,coreSize)===normKey(startText,coreSize));
  if(index<0)throw new TemplateError(`start value ${startText} is not in the domain`,ln,col);
  variable.start=index;
 }
 return variable;
}

export function parseTemplate(text,constants){
 const coreSize=constants.CORESIZE,lines=text.split(/(?<=\n)/),variables=[],namesSeen={};
 lines.forEach((rawLine,index)=>{
  const ln=index+1,code=rawLine.replace(/\r?\n$/,'').split(';')[0],equ=EQU_RE.exec(code)?.[1]??null;
  let k=0,shift=0; // shift: length of earlier start values on this line, which names ignore
  for(;;){
   k=code.indexOf('!',k);if(k<0)break;
   if(code[k+1]==='='){k+=2;continue;}
   const v=parseMarker(code,k,ln,constants);
   v.name=`${ln}:${v.col-shift}`;shift+=v.end-k-v.spec.length;
   if(equ){const count=(namesSeen[equ]??0)+1;namesSeen[equ]=count;v.name=count===1?equ:`${equ}#${count}`;v.onEqu=true;}
   variables.push(v);k=v.end;
  }
 });
 return new Template(text,lines,variables,coreSize);
}

export class Template{
 constructor(text,lines,variables,coreSize){this.text=text;this.lines=lines;this.variables=variables;this.coreSize=coreSize;}
 get sizes(){return this.variables.map(v=>v.values.length);}
 searchSpace(){return this.variables.reduce((p,v)=>p*v.values.length,1);}
 startIndices(){return this.variables.map(v=>v.start);}
 substitute(x,writeBack){
  if(x.length!==this.variables.length)throw new Error('wrong number of values');
  const byLine=new Map();
  this.variables.forEach((v,i)=>{if(!byLine.has(v.line))byLine.set(v.line,[]);byLine.get(v.line).push([v,x[i]]);});
  return this.lines.map((line,index)=>{
   const subs=byLine.get(index+1);if(!subs)return line;
   for(const [v,i] of subs.sort((a,b)=>b[0].col-a[0].col)){
    const value=v.values[i];let rep;
    if(writeBack)rep=`${v.spec}:${value}`;
    else{rep=value;const before=line.slice(0,v.col-1).trimEnd();if(value.startsWith('-')&&before&&'+-*/%'.includes(before.at(-1)))rep=`(${value})`;}
    line=line.slice(0,v.col-1)+rep+line.slice(v.end);
   }
   return line;
  }).join('');
 }
 // Plain Redcode with every marker replaced by its value.
 render(x){return this.substitute(x,false);}
 // The template again, every marker carrying ":value" as its start value.
 writeBack(x){return this.substitute(x,true);}
 // Rendered text split into plain runs and substituted values, for highlighting.
 segments(x){
  const byLine=new Map();
  this.variables.forEach((v,i)=>{if(!byLine.has(v.line))byLine.set(v.line,[]);byLine.get(v.line).push([v,x[i]]);});
  const segs=[];let buf='';
  this.lines.forEach((line,index)=>{
   let pos=0;
   for(const [v,i] of (byLine.get(index+1)||[]).sort((a,b)=>a[0].col-b[0].col)){
    buf+=line.slice(pos,v.col-1);segs.push({text:buf});buf='';
    segs.push({text:v.values[i],variable:v.name});pos=v.end;
   }
   buf+=line.slice(pos);
  });
  segs.push({text:buf});
  return segs.filter(s=>s.text||s.variable);
 }
 values(x){return Object.fromEntries(this.variables.map((v,i)=>[v.name,v.values[x[i]]]));}
 usesPspace(){return /\b(ldp|stp)\b/i.test(this.lines.map(l=>l.split(';')[0]).join('\n'));}
}

// Metcalf's markers: "!" for 0..CORESIZE-1 and "!%n" for 0..n-1. Converts them so old
// templates work; comments are left alone.
export function fromMetcalf(text){
 return text.split(/(?<=\n)/).map(line=>{
  const at=line.indexOf(';'),code=at<0?line:line.slice(0,at),rest=at<0?'':line.slice(at);
  return code.replace(/!%(\d+)/g,(_,n)=>`!(0..${Number(n)-1})`).replace(/!(?![=(\[%?:])/g,'!(0..CORESIZE-1)')+rest;
 }).join('');
}

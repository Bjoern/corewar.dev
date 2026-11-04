// SPDX-License-Identifier: GPL-2.0-or-later
// pMARS score formulas, so exMARS results can be scored as pMARS scores them. A port of
// pmars-ai src/eval.c (bounded evaluator) and score() in src/cdb.c, with C long as 32 bits, as in
// the Wasm build corewar.dev ships: integer arithmetic, / and % truncate toward zero, division by
// zero and overflow are errors. Precedence: * / % > + - > < > <= >= == != > && > ||, all
// left-associative; unary + - ! bind to a primary.
// pMARS keeps registers A–Z between evaluations, and its assembler uses them too, so a formula
// that names another register or assigns one (X=...) may depend on hidden state: such formulas
// are not "plain" and stay on pMARS (plainFormula).
const LONG_MAX=2147483647,LONG_MIN=-2147483648,MAX_DEPTH=128,MAX_STEPS=100000;
const OPS={'*':5,'/':5,'%':5,'+':4,'-':4,'<':3,'>':3,'<=':3,'>=':3,'==':3,'!=':3,'&&':2,'||':1};

// Only W, S, digits, operators, parentheses and spaces; no assignment.
export function plainFormula(text){
 if(typeof text!=='string'||!text.trim())return false;
 if(/[^WSws0-9+\-*/%<>=!&|()\s]/.test(text))return false;
 return !/[WSws]\s*=(?!=)/.test(text);
}

class FormulaError extends Error{}
export function evaluateFormula(text,registers){
 let i=0,depth=0,steps=0;
 const fail=()=>{throw new FormulaError('bad expression');};
 const spaces=()=>{while(/\s/.test(text[i]??''))i++;};
 const enter=()=>{if(depth>=MAX_DEPTH||++steps>MAX_STEPS)fail();depth++;};
 const number=negative=>{
  const limit=LONG_MAX+(negative?1:0);let v=0;
  while(/[0-9]/.test(text[i]??'')){const d=text.charCodeAt(i++)-48;if(v>Math.floor((limit-d)/10))fail();v=v*10+d;}
  return negative?-v:v;
 };
 function primary(){
  enter();spaces();let v=0;const ch=text[i];
  if(ch==='('){i++;v=expression(0);spaces();if(text[i]===')')i++;else fail();}
  else if(ch==='+'||ch==='-'||ch==='!'){
   i++;spaces();
   if(ch==='-'&&/[0-9]/.test(text[i]??''))v=number(true);
   else{v=primary();if(ch==='-'){if(v===LONG_MIN)fail();v=-v;}else if(ch==='!')v=v?0:1;}
  }else if(/[0-9]/.test(ch??''))v=number(false);
  else if(/[A-Za-z]/.test(ch??'')){
   i++;spaces();
   if(text[i]==='='&&text[i+1]!=='=')fail(); // assignment: not a plain formula
   v=registers[ch.toUpperCase()]??0;
  }else fail();
  depth--;return v;
 }
 function operator(){
  const two=text.slice(i,i+2);
  if(['<=','>=','==','!=','&&','||'].includes(two))return two;
  const ch=text[i];return ['*','/','%','+','-','<','>'].includes(ch)?ch:null;
 }
 function arithmetic(x,y,op){
  let r;
  switch(op){
   case '+':r=x+y;break;case '-':r=x-y;break;case '*':r=x*y;break;
   case '/':case '%':if(!y)fail();if(x===LONG_MIN&&y===-1)fail();r=op==='/'?Math.trunc(x/y):x%y;break;
   case '&&':return x&&y?1:0;case '||':return x||y?1:0;
   case '==':return x===y?1:0;case '!=':return x!==y?1:0;
   case '<':return x<y?1:0;case '>':return x>y?1:0;case '<=':return x<=y?1:0;case '>=':return x>=y?1:0;
  }
  // A product of two 32-bit values may lose precision in a double, but never its magnitude.
  if(r>LONG_MAX||r<LONG_MIN)fail();
  return r||0; // no -0
 }
 function expression(minimum){
  enter();let left=primary();
  for(;;){
   spaces();const op=operator();if(!op||OPS[op]<minimum)break;
   if(++steps>MAX_STEPS)fail();
   i+=op.length;const right=expression(OPS[op]+1);left=arithmetic(left,right,op);
  }
  depth--;return left;
 }
 try{const v=expression(0);spaces();if(i<text.length)fail();return v;}
 catch(error){if(error instanceof FormulaError)return null;throw error;}
}

// The value of the formula for each survivor count S = 1..warriors, or null if pMARS would not
// score it this way (not plain, or an error for some S).
export function formulaTable(text,warriors){
 if(!plainFormula(text))return null;
 const table=[];
 for(let s=1;s<=warriors;s++){const v=evaluateFormula(text,{W:warriors,S:s});if(v===null)return null;table.push(v);}
 return table;
}
// pMARS score(): sum over S of rounds alive with S survivors times f(W,S), in a C int.
export function scoreFrom(histogram,table){
 let total=0;for(let s=1;s<histogram.length;s++)total=(total+Math.imul(histogram[s],table[s-1]))|0;
 return total;
}

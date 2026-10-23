import {formatBinderNumbers} from './binder-numbers.js';
export function createBinderPrintRequest(docs,{site,height,copies,pages},now=new Date()) {
 if(!docs.length)throw new Error('인쇄할 문서를 선택해주세요.');
 const groups=new Map();
 for(const d of docs){const id=d.id||d.standardId||d.code;let snapshot=groups.get(id);if(!snapshot){snapshot={id,code:d.code,title:d.title,numbers:[],width:d.width,footer1:d.footer1,footer2:d.footer2,footer3:d.footer3};groups.set(id,snapshot);}snapshot.numbers.push(d.labelNumber);}
 for(const d of groups.values()){const numeric=d.numbers.filter(n=>/^\d+$/.test(n));d.number=numeric.length===d.numbers.length?numeric.reduce((a,b)=>Number(a)>Number(b)?a:b):d.numbers.at(-1);d.numberLabel=formatBinderNumbers(d.numbers);}
 return {id:crypto.randomUUID(),requestedAt:now.toISOString(),status:'requested',site,height,copies,pages,font:'HY헤드라인M',documents:[...groups.values()]};
}
export function lastBinderPrint(history,doc,remembered={}) {
 const id=doc.id||doc.standardId||doc.code;
 let candidate=remembered[id]||null;
 for(const job of history){
  if(job.status==='cancelled')continue;
  const printed=job.documents.find(d=>d.id===id||(!doc.id&&d.code===doc.code));
  if(printed){const found={...printed,requestedAt:job.requestedAt,status:job.status,jobId:job.id};if(!candidate||Date.parse(found.requestedAt)>=Date.parse(candidate.requestedAt))candidate=found;break;}
 }
 return candidate;
}
export function nextBinderNumber(last) {
 const value=String(last?.number ?? '');
 if(!/^\d+$/.test(value))return null;
 const number=Number(value);return Number.isSafeInteger(number)&&number<999999999999?String(number+1).padStart(value.length,'0'):null;
}

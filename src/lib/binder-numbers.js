// One expression describes different binder numbers. Copies are handled separately.
export function parseBinderNumbers(expression) {
 const text=String(expression??'').trim().replace(/[–—~]/g,'-').replace(/，/g,',');
 if(!text)throw new Error('인쇄번호를 입력해주세요. 예: 14-18 또는 14,16,20');
 if(text.length>1000)throw new Error('인쇄번호 입력은 1,000자 이내입니다.');
 const result=[],seen=new Set();
 for(const token of text.split(',')){
  const part=token.trim(),range=part.match(/^(\d{1,12})\s*-\s*(\d{1,12})$/);
  let values;
  if(range){const start=Number(range[1]),end=Number(range[2]);if(end<start||end-start>=200)throw new Error('번호 범위는 오름차순으로 최대 200개까지 입력해주세요.');const pad=range[1].startsWith('0')?range[1].length:0;values=Array.from({length:end-start+1},(_,i)=>String(start+i).padStart(pad,'0'));}
  else{if(!part||part.length>12||/[\s()~–—]/.test(part)||/^\d+\s*-|^-\d+$/.test(part))throw new Error('번호를 확인해주세요. 예: 14-18 또는 14,16,20');values=[part];}
  for(const value of values){const key=/^\d+$/.test(value)?String(Number(value)):value;if(seen.has(key))throw new Error(`중복 인쇄번호: ${value}. 같은 번호를 여러 장 뽑으려면 복사본 수를 사용해주세요.`);seen.add(key);result.push(value);if(result.length>200)throw new Error('문서별 인쇄번호는 최대 200개입니다.');}
 }
 return result;
}
export function formatBinderNumbers(values) {
 if(!values?.length)return '';
 const runs=[];let start=0;
 for(let i=1;i<=values.length;i++){
  const prev=String(values[i-1]),next=String(values[i]??'');
  if(i<values.length&&/^\d+$/.test(prev)&&/^\d+$/.test(next)&&Number(next)===Number(prev)+1&&(!prev.startsWith('0')||prev.length===next.length))continue;
  runs.push(i-start>2?`${values[start]}–${values[i-1]}`:values.slice(start,i).join(', '));start=i;
 }
 return runs.join(', ');
}
export function expandBinderNumbers(docs,copies=1){
 const result=docs.flatMap(doc=>parseBinderNumbers(doc.numberExpression||doc.labelNumber).map(labelNumber=>({...doc,labelNumber})));
 if(result.length*copies>500)throw new Error('한 번에 최대 500개 라벨까지 인쇄할 수 있습니다.');
 return result;
}
export function sequenceBinderNumbers(start,count){
 if(!/^\d{1,12}$/.test(String(start))||!Number.isInteger(count)||count<1||count>200||Number(start)+count-1>999999999999)throw new Error('시작 번호는 12자리 이내, 권수는 1~200으로 입력해주세요.');
 const end=String(Number(start)+count-1).padStart(String(start).length,'0');return count===1?String(start):`${start}-${end}`;
}

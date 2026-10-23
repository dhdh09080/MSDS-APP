import {lastBinderPrint} from './binder-history.js';
import {BINDER_STANDARD} from '../data/binder-standard.js';
import {validateBinderCatalog} from './binder-document.js';
export {validateBinderCatalog} from './binder-document.js';
export const catalogText=docs=>docs.map(d=>[d.code,d.title,d.width==null?'':d.width/10,d.category].join('\t')).join('\n');
function validHistory(value) {
 if(!Array.isArray(value))throw new Error('인쇄 기록 형식이 올바르지 않습니다.');
 return value.slice(0,100).filter(job=>job&&typeof job.id==='string'&&typeof job.requestedAt==='string'&&Number.isFinite(Date.parse(job.requestedAt))&&['requested','confirmed','cancelled'].includes(job.status)&&Array.isArray(job.documents));
}
export function createBinderCatalogStore(client,workspaceId,preview=false) {
 let revision=null,history=[],remembered={};
 const key=`binder-preview:${workspaceId}`;
 const api={
  history:()=>structuredClone(history),
  remembered:()=>structuredClone(remembered),
  async load(){
   if(preview){const raw=sessionStorage.getItem(key),saved=raw?JSON.parse(raw):null;history=validHistory(saved?.print_history??[]);remembered=saved?.last_print_numbers??{};return saved?validateBinderCatalog(Array.isArray(saved)?saved:saved.catalog):validateBinderCatalog(structuredClone(BINDER_STANDARD));}
   const {data,error}=await client.from('binder_catalogs').select('catalog,revision,print_history,last_print_numbers').eq('workspace_id',workspaceId).maybeSingle();
   if(error)throw error;
   revision=data?.revision??null;history=validHistory(data?.print_history??[]);remembered=data?.last_print_numbers??{};
   return validateBinderCatalog(data?.catalog??structuredClone(BINDER_STANDARD));
  },
  async save(docs,nextHistory=history,nextRemembered=remembered){
   const catalog=validateBinderCatalog(docs),printed=validHistory(nextHistory);
   const ids=new Set(catalog.map(d=>d.id)),numbers=Object.fromEntries(Object.entries(nextRemembered).filter(([id])=>ids.has(id)));
   if(preview){sessionStorage.setItem(key,JSON.stringify({catalog,print_history:printed,last_print_numbers:numbers}));history=printed;remembered=numbers;return;}
   const value={catalog,print_history:printed,last_print_numbers:numbers,revision:(revision??0)+1,updated_at:new Date().toISOString()};
   const query=revision===null?client.from('binder_catalogs').insert({...value,workspace_id:workspaceId}):client.from('binder_catalogs').update(value).eq('workspace_id',workspaceId).eq('revision',revision);
   const {data,error}=await query.select('revision').maybeSingle();
   if(error||!data)throw new Error(error?.code==='23505'||!error?'다른 담당자가 목록 또는 인쇄 기록을 수정했습니다. 메뉴를 다시 열어 최신 정보를 확인해주세요.':error.message);
   revision=data.revision;history=printed;remembered=numbers;
  },
  async recordPrint(docs,request){
   const numbers=structuredClone(remembered);
   for(const printed of request.documents){const latest=lastBinderPrint(history,{id:printed.id,code:printed.code},remembered),previous=latest?{...latest}:null;if(previous)delete previous.previous;numbers[printed.id]={...printed,requestedAt:request.requestedAt,status:request.status,jobId:request.id,previous};}
   await api.save(docs,[request,...history].slice(0,100),numbers);
  },
  async markPrint(docs,id,status){
   if(!['confirmed','cancelled'].includes(status))throw new Error('잘못된 인쇄 상태입니다.');
   if(!history.some(job=>job.id===id))throw new Error('인쇄 기록을 찾을 수 없습니다.');
   const next=history.map(job=>job.id===id?{...job,status,reviewedAt:new Date().toISOString()}:job),numbers=structuredClone(remembered);
   for(const [key,value] of Object.entries(numbers)){if(value.previous?.jobId===id)value.previous=status==='confirmed'?{...value.previous,status}:null;if(value.jobId===id){
    if(status==='confirmed')numbers[key]={...value,status};
    else{const old=value.previous;delete numbers[key];const previous=lastBinderPrint(next,{id:key},numbers)||old;if(previous)numbers[key]=previous;}
   }}
   await api.save(docs,next,numbers);
  }
 };
 return api;
}

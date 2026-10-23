import test from 'node:test';
import assert from 'node:assert/strict';
import {BINDER_STANDARD} from '../src/data/binder-standard.js';
import {validateBinderCatalog,filterBinderDocuments} from '../src/lib/binder-document.js';
import {createBinderPrintRequest,lastBinderPrint,nextBinderNumber} from '../src/lib/binder-history.js';
import {createBinderCatalogStore} from '../src/lib/binder-catalog.js';
const docs=validateBinderCatalog(BINDER_STANDARD).map(d=>({...d,width:70,labelNumber:'0014'}));
const opts={site:'테스트 현장',height:260,copies:1,pages:1};
test('search includes every classification and custom non-health documents',()=>{
 for(const d of docs)assert.ok(filterBinderDocuments(docs,{query:d.middleName}).length);
 assert.equal(new Set(docs.map(d=>d.middleCode)).size,8);
 assert.equal(filterBinderDocuments(docs).length,40);
 assert.ok(filterBinderDocuments(docs,{query:'위험성평가'}).some(d=>d.middleCode==='B'));
 const quality=validateBinderCatalog([{majorCode:'SQ',majorName:'품질',middleCode:'C',middleName:'공급원승인',minorNumber:'01',title:'레미콘 승인',width:90}]);
 assert.equal(filterBinderDocuments([...docs,...quality],{query:'레미콘'}).length,1);
 assert.equal(filterBinderDocuments([...docs,...quality],{category:'SQ/C'}).length,1);
});
test('last number survives renaming and later edits, excludes cancelled requests',()=>{
 const doc=docs[0],a=createBinderPrintRequest([doc],opts,new Date('2026-10-23T01:00:00Z'));
 const b=createBinderPrintRequest([{...doc,labelNumber:'0015'}],opts,new Date('2026-10-23T02:00:00Z'));
 assert.equal(lastBinderPrint([b,a],{...doc,code:'SR-A-99',minorNumber:'99'}).number,'0015');
 assert.equal(lastBinderPrint([{...b,status:'cancelled'},a],doc).number,'0014');
 assert.equal(nextBinderNumber(lastBinderPrint([a],doc)),'0015');
 assert.equal(nextBinderNumber({number:'A-14'}),null);
 assert.equal(lastBinderPrint([a],{...doc,id:'different-doc'}),null);
});
test('site print history persists, is separate from catalog numbering, and is workspace scoped',async()=>{
 const data=new Map();globalThis.sessionStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 const a=createBinderCatalogStore(null,'site-a',true);await a.load();
 await a.recordPrint(docs,createBinderPrintRequest([docs[0]],opts));
 await a.save(docs.map(d=>({...d,labelNumber:'99'})));
 const reload=createBinderCatalogStore(null,'site-a',true),loaded=await reload.load();
 assert.equal(loaded[0].labelNumber,'99');
 assert.equal(lastBinderPrint(reload.history(),loaded[0]).number,'0014');
 const b=createBinderCatalogStore(null,'site-b',true);await b.load();assert.equal(b.history().length,0);
 await reload.markPrint(loaded,reload.history()[0].id,'confirmed');
 assert.equal(reload.history()[0].status,'confirmed');
 await reload.markPrint(loaded,reload.history()[0].id,'cancelled');
 assert.equal(lastBinderPrint(reload.history(),loaded[0]),null);
});
test('failed server save does not invent a remembered print request',async()=>{
 const failure={from:()=>({insert:()=>({select:()=>({maybeSingle:async()=>({data:null,error:{message:'offline'}})})})})};
 const store=createBinderCatalogStore(failure,'test');
 await assert.rejects(store.recordPrint(docs,createBinderPrintRequest([docs[0]],opts)),/offline/);
 assert.equal(store.history().length,0);
});
test('a rarely printed document retains its last number after 100 other requests',async()=>{
 const data=new Map();globalThis.sessionStorage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 const store=createBinderCatalogStore(null,'long-history',true);await store.load();
 await store.recordPrint(docs,createBinderPrintRequest([docs[0]],opts,new Date('2026-01-01T00:00:00Z')));
 for(let i=0;i<105;i++)await store.recordPrint(docs,createBinderPrintRequest([{...docs[1],labelNumber:String(i+1)}],opts,new Date(Date.UTC(2026,1,1,0,i))));
 assert.equal(store.history().length,100);
 const reload=createBinderCatalogStore(null,'long-history',true);await reload.load();
 assert.equal(lastBinderPrint(reload.history(),docs[0],reload.remembered()).number,'0014');
 assert.equal(lastBinderPrint(reload.history(),docs[1],reload.remembered()).number,'105');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBinderNumbers,formatBinderNumbers,sequenceBinderNumbers,expandBinderNumbers} from '../src/lib/binder-numbers.js';
import {binderTitleTokens,binderTitleSize,binderSheetsHtml} from '../src/lib/binder-print.js';
import {BINDER_STANDARD} from '../src/data/binder-standard.js';
import {validateBinderCatalog,binderCatalogToRows,binderRowsToCatalog} from '../src/lib/binder-document.js';
import {createBinderPrintRequest,nextBinderNumber,lastBinderPrint} from '../src/lib/binder-history.js';
import {createBinderCatalogStore} from '../src/lib/binder-catalog.js';
test('ranges, selected numbers and leading zeroes expand without duplicates',()=>{
 assert.deepEqual(parseBinderNumbers('0014–0016, 20'),['0014','0015','0016','20']);
 assert.equal(formatBinderNumbers(['14','15','16','20']),'14–16, 20');
 assert.equal(sequenceBinderNumbers('0014',3),'0014-0016');
 for(const invalid of ['14-12','1-201','14,014','14,,16','-2'])assert.throws(()=>parseBinderNumbers(invalid));
 assert.throws(()=>sequenceBinderNumbers('999999999999',2));
 assert.throws(()=>expandBinderNumbers([{labelNumber:'1',numberExpression:'1-200'}],3),/500/);
});
test('full standard titles stay intact and compact typography uses whitespace and Latin runs',()=>{
 for(const d of BINDER_STANDARD){assert.equal(binderTitleTokens(d.title).map(t=>t.text).join(''),d.title);const n=validateBinderCatalog([{...d,width:70,printTitle:'잘못된 축약'}])[0];assert.equal(n.title,d.title);assert.equal(n.printTitle,undefined);assert.ok(binderTitleSize(n)>0);}
 const d={...BINDER_STANDARD.find(d=>d.code==='SR-B-06'),width:70};
 assert.ok(binderTitleTokens(d.title).some(t=>t.text==='(Permit to Work)'&&t.latin));
 const old=(746.2/1209.2843*260*72/25.4)/(d.title.length*1.16);
 assert.ok(binderTitleSize(d)>old*1.5);
 assert.ok(binderSheetsHtml([d],{site:'현장'}).includes('(Permit to Work)'));
});
test('multi-number requests remember every number, maximum next and cancellation after reload',async()=>{
 const cache=new Map();globalThis.sessionStorage={getItem:k=>cache.get(k)??null,setItem:(k,v)=>cache.set(k,v)};
 const docs=validateBinderCatalog([{...BINDER_STANDARD[0],width:70,numberExpression:'0014-0016,0020'}]);
 const store=createBinderCatalogStore(null,'batch-test',true);await store.load();
 const req=createBinderPrintRequest(expandBinderNumbers(docs),{site:'현장',height:260,copies:2,pages:4});await store.recordPrint(docs,req);
 assert.deepEqual(req.documents[0].numbers,['0014','0015','0016','0020']);
 const reload=createBinderCatalogStore(null,'batch-test',true),loaded=await reload.load();
 const last=lastBinderPrint(reload.history(),loaded[0],reload.remembered());assert.equal(nextBinderNumber(last),'0021');assert.equal(last.numberLabel,'0014–0016, 0020');
 await reload.markPrint(loaded,req.id,'cancelled');assert.equal(lastBinderPrint(reload.history(),loaded[0],reload.remembered()),null);
 const rows=binderCatalogToRows(loaded);assert.equal(binderRowsToCatalog(rows)[0].numberExpression,'0014-0016,0020');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBinderCatalog,paginateBinderLabels,buildBinderPrintHtml} from '../src/lib/binder-print.js';
const docs = parseBinderCatalog('E-04\t일반건강진단\t9\t보건\n06-03\t밀폐공간 작업허가서\t7\t관리\n01\t자료\t4');
test('catalog preserves leading zeros and rejects missing or ambiguous widths',()=>{
 assert.equal(docs[2].code,'01');
 assert.equal(docs[0].width,90);
 assert.throws(()=>parseBinderCatalog('01\t제목\t19.1'));
 assert.equal(parseBinderCatalog('01\t제목\t8')[0].width,80);
 assert.throws(()=>parseBinderCatalog('01\t제목\t7\n01\t다른 제목\t9'));
});
test('mixed widths and copies stay inside A4 printable width',()=>{
 const pages=paginateBinderLabels(docs,3);
 assert.equal(pages.flat().length,9);
 for(const page of pages) assert.ok(page.reduce((sum,d)=>sum+d.width,0)+4*(page.length-1)<=190);
 assert.equal(paginateBinderLabels([{width:100}],2).length,2);
 assert.equal(paginateBinderLabels([{width:90}],2).length,1);
 assert.throws(()=>paginateBinderLabels(docs,1.5));
});
test('print enforces physical dimensions and escapes user text',()=>{
 const html=buildBinderPrintHtml([{...docs[0],title:'<script>alert(1)</script>'}],{site:'현장 <A>',height:260});
 assert.match(html,/size:A4 portrait/);
 assert.match(html,/width:90mm;height:260mm/);
 assert.ok(!html.includes('<script>'));
 assert.match(html,/현장 &lt;A&gt;/);
 assert.throws(()=>buildBinderPrintHtml(docs,{site:'현장',height:278}));
});

test('202303-R1 standard uses source numbering and leaves site widths unset',async()=>{
 const {BINDER_STANDARD}=await import('../src/data/binder-standard.js');
 const {catalogText,validateBinderCatalog}=await import('../src/lib/binder-catalog.js');
 assert.equal(BINDER_STANDARD.length,40);
 assert.equal(BINDER_STANDARD.find(d=>d.code==='SR-E-10').title,'일반건강진단');
 assert.equal(BINDER_STANDARD.find(d=>d.code==='SR-E-12').title,'배치 전 건강진단');
 assert.ok(BINDER_STANDARD.every(d=>d.width===null));
 assert.equal(parseBinderCatalog(catalogText(BINDER_STANDARD)).length,40);
 assert.equal(validateBinderCatalog(BINDER_STANDARD)[0].security,'C');
 assert.throws(()=>paginateBinderLabels(BINDER_STANDARD));
});


test('refined source classifications, single vertical title and footer/logo are separate',async()=>{
 const {BINDER_STANDARD}=await import('../src/data/binder-standard.js');
 const {binderTitleLines}=await import('../src/lib/binder-print.js');
 const {validateBinderCatalog,binderRowsToCatalog,BINDER_COLUMNS}=await import('../src/lib/binder-document.js');
 const doc={...BINDER_STANDARD.find(d=>d.code==='SR-E-06'),minorNumber:'06-01',title:'밀폐공간\n작업',width:70,labelNumber:'2',footer1:'A'};
 const html=buildBinderPrintHtml([doc],{site:'성동자이리버뷰'});
 assert.deepEqual(binderTitleLines(doc.title),['밀폐공간 작업']);
 assert.match(html,/data-line="1"/);
 assert.ok(!html.includes('data-line="2"'));
 assert.match(html,/binder-cut-frame/);
 assert.match(html,/binder-minor[^>]*>06-01</);
 assert.match(html,/현장<br>안전/);
 assert.match(html,/data:image\/jpeg;base64,/);
 assert.match(html,/background:#ffc000/);
 assert.match(html,/binder-source-borders/);
 assert.match(html,/stroke-width=".75"/);
 assert.equal(validateBinderCatalog([doc])[0].code,'SR-E-06-01');
 const rows=[BINDER_COLUMNS.map(([,n])=>n),...BINDER_STANDARD.map(d=>BINDER_COLUMNS.map(([k])=>d[k]??''))];
 const result=binderRowsToCatalog(rows);
 assert.equal(result.length,40);
 assert.equal(result[0].majorName,'안전보건');
 assert.equal(result[0].details,BINDER_STANDARD[0].details);
 assert.equal(result.find(d=>d.code==='SR-E-04').minorNumber,'04');
 assert.equal(validateBinderCatalog([{...doc,title:'가\n나\n다'}])[0].title,'가 나 다');
});


test('7cm and 9cm use distinct source workbook geometry and explicit border styles',async()=>{
 const {binderTemplate}=await import('../src/lib/binder-print.js');
 const {BINDER_TEMPLATES}=await import('../src/data/binder-templates.js');
 const a=binderTemplate(70),b=binderTemplate(90);
 assert.equal(a.name,'중(7Cm)');
 assert.equal(b.name,'중(9cm) (2)');
 assert.equal(a.boxes.majorCode.width/a.widthPt,.2);
 assert.ok(b.boxes.majorCode.width/b.widthPt<.17);
 assert.equal(a.boxes.minor.height,51);
 assert.equal(b.boxes.minor.height,30.6);
 assert.ok(a.borders.some(line=>line.style==='double'));
 assert.ok(b.borders.some(line=>line.style==='medium'));
 assert.ok(b.borders.some(line=>line.style==='thin'));
 assert.equal(binderTemplate(75),BINDER_TEMPLATES[70]);
 assert.equal(binderTemplate(100),BINDER_TEMPLATES[90]);
});


test('long titles stay in one column and fit with a smaller type size',async()=>{
 const {binderTitleLines}=await import('../src/lib/binder-print.js');
 const short=buildBinderPrintHtml([{...docs[1],title:'짧은제목'}],{site:'현장'});
 const long=buildBinderPrintHtml([{...docs[1],title:'장기간 보관하는 안전보건관리 문서의 상세 제목입니다'.repeat(3)}],{site:'현장'});
 assert.equal(binderTitleLines('긴제목'.repeat(30)).length,1);
 const size=html=>Number(html.match(/binder-title-lines" style="font-size:([0-9.]+)pt/)[1]);
 assert.ok(size(long)<size(short));
 assert.ok(!long.includes('data-line="2"'));
 assert.match(long,/border:.25mm solid #000/);
});

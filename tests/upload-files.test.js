import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptsUpload,collectDroppedFiles} from '../src/lib/upload-files.js';

test('file accept rules support case-insensitive extensions, MIME types and image wildcards',()=>{
  assert.equal(acceptsUpload({name:'등록증.PDF',type:''},'.pdf,.jpg,.png'),true);
  assert.equal(acceptsUpload({name:'사진.webp',type:'image/webp'},'image/*'),true);
  assert.equal(acceptsUpload({name:'이름없음',type:'application/pdf'},'application/pdf'),true);
  assert.equal(acceptsUpload({name:'명단.xlsx',type:''},'.csv,.xlsx,.xls'),true);
  assert.equal(acceptsUpload({name:'파일.exe',type:'application/octet-stream'},'.pdf'),false);
  assert.equal(acceptsUpload({name:'문서.pdf',type:'application/pdf'},'image/*'),false);
  assert.equal(acceptsUpload({name:'임의 파일',type:''},''),true);
});

test('plain dropped files remain available when browser directory entries are unavailable',async()=>{
  const files=[{name:'MSDS.pdf'},{name:'등록증.png'}];
  assert.deepEqual(await collectDroppedFiles({files,items:[]}),files);
  assert.deepEqual(await collectDroppedFiles({files,items:files.map(f=>({kind:'file',webkitGetAsEntry:()=>null,getAsFile:()=>f}))}),files);
});

test('folder drop reads every directory batch and retains paths used to infer contractor and trade',async()=>{
  const file=name=>({name,webkitRelativePath:''});
  const entry=f=>({name:f.name,isFile:true,file:resolve=>resolve(f)});
  const first=Array.from({length:100},(_,i)=>entry(file(`${i}.pdf`)));
  const last=file('101.pdf'),nested=file('도료.pdf');let reads=0;
  const directory={name:'대한건설',isDirectory:true,createReader:()=>({readEntries:resolve=>{
    reads++;resolve(reads===1?first:reads===2?[entry(last),{name:'도장',isDirectory:true,createReader:()=>{let done=false;return {readEntries:r=>{r(done?[]:[entry(nested)]);done=true;}};}}]:[]);
  }})};
  const result=await collectDroppedFiles({files:[],items:[{kind:'file',webkitGetAsEntry:()=>directory}]});
  assert.equal(result.length,102);assert.equal(reads,3);
  assert.equal(result[0].webkitRelativePath,'대한건설/0.pdf');
  assert.equal(nested.webkitRelativePath,'대한건설/도장/도료.pdf');
});

test('unreadable folder entries fail instead of silently submitting an incomplete selection',async()=>{
  await assert.rejects(collectDroppedFiles({files:[],items:[{kind:'file',webkitGetAsEntry:()=>({name:'denied',isDirectory:true,createReader:()=>({readEntries:(_,reject)=>reject(new Error('cannot read directory'))})})}]}),/cannot read directory/);
});

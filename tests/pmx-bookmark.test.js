import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {makePmxBookmarklet,publishPmxSnapshot} from '../src/lib/pmx-bookmarklet.js';
import {validatePmxSnapshot} from '../src/lib/pmx-snapshot.js';

const row={prjCd:'000012',prjNm:'현장',bizFldNm:'주택',cstrnStrtYmd:'20240701',cstrnEndYmd:'20271001',actlTProgrt:60.5};
function environment({origin='https://pmx.gsenc.com',opener=null}={}) {
 const requests=[],navigations=[],alerts=[],listeners=[];
 const context=vm.createContext({location:{origin,pathname:'/com/',replace:url=>navigations.push(url)},window:{opener,name:'old'},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({successOrNot:'Y',data:[{...row,pmEmpNo:'do-not-send',Cookie:'do-not-send',targetUrl:'https://evil.example'}]})};},alert:msg=>alerts.push(msg),AbortSignal,TextEncoder,URL,Blob,Date,setTimeout,document:{createElement:()=>({click(){}})},addEventListener:(...args)=>listeners.push(args)});
 return {context,requests,navigations,alerts,listeners};
}
test('bookmark executes exactly one fixed GET and transfers only six inert fields without a reverse bridge',async()=>{
 const e=environment();
 await vm.runInContext(`(${publishPmxSnapshot.toString()})('https://gshealthk.vercel.app')`,e.context);
 assert.equal(e.requests.length,1);assert.equal(e.requests[0].options.method,'GET');assert.equal(e.requests[0].options.credentials,'include');
 assert.equal(e.requests[0].url,'/com/api/v1/dashboard-hq/project-mls-stn-info-list?orderBy=5&bizFldCd=N0&pmEmpNo=');
 assert.equal(e.listeners.length,0);assert.equal(e.context.window.opener,null);assert.equal(e.context.window.name,'');
 const target=new URL(e.navigations[0]);assert.equal(target.origin,'https://gshealthk.vercel.app');assert.equal(target.pathname,'/pmx-import.html');
 const snapshot=JSON.parse(decodeURIComponent(target.hash.slice('#snapshot='.length)));
 assert.deepEqual(snapshot.projects[0],row);assert.equal(JSON.stringify(snapshot).includes('do-not-send'),false);
 assert.equal(validatePmxSnapshot(snapshot).projects[0].prjCd,'000012');
 // App-side follow-up messages have no recipient and cannot trigger another read.
 for(const listener of e.listeners)listener[1]({origin:'https://gshealthk.vercel.app',data:{type:'FETCH',url:'/com/secret'}});
 assert.equal(e.requests.length,1);
});
test('publisher refuses forged PMX origins and arbitrary destinations before reading',async()=>{
 assert.throws(()=>makePmxBookmarklet('https://evil.example'));
 const wrong=environment({origin:'https://pmx.gsenc.com.evil.example'});
 await vm.runInContext(`(${publishPmxSnapshot.toString()})('https://gshealthk.vercel.app')`,wrong.context);
 assert.equal(wrong.requests.length,0);
 const e=environment();await vm.runInContext(`(${publishPmxSnapshot.toString()})('https://evil.example')`,e.context);assert.equal(e.requests.length,0);
});
test('snapshot rejects extras, malformed values, stale/future dates and duplicates',()=>{
 const s={version:1,source:'pmx-bookmark',fetchedAt:new Date().toISOString(),projects:[row]};
 for(const modified of [
  {...s,Cookie:'private'}, {...s,projects:[{...row,Cookie:'private'}]},
  {...s,projects:[{...row,prjCd:12}]},{...s,projects:[{...row,actlTProgrt:101}]},
  {...s,projects:[{...row,cstrnStrtYmd:'20260230'}]},
  {...s,fetchedAt:'2020-01-01T00:00:00Z'}, {...s,fetchedAt:new Date(Date.now()+3600000).toISOString()},
  {...s,projects:[row,row]}
 ])assert.throws(()=>validatePmxSnapshot(modified));
});
test('generated favorite is a javascript URL with a fixed allowlisted target',()=>{
 const code=makePmxBookmarklet('http://localhost:3000');assert.ok(code.startsWith('javascript:void '));
 assert.equal(/postMessage|addEventListener|document\.cookie|eval\(/.test(code),false);
});

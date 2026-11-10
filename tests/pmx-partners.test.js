import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {publishPartnerSnapshot,makePartnerBookmarklet,validatePartnerSnapshot} from '../src/lib/pmx-partners.js';
import {parsePmxSnapshot} from '../src/lib/pmx-snapshot.js';
for(const code of ['070120','000002'])test(`partner bookmark scopes POST to ${code} and strips unrelated fields`,async()=>{
 const requests=[],navigations=[];
 const context=vm.createContext({location:{origin:'https://pmx.gsenc.com',replace:url=>navigations.push(url)},window:{opener:null,name:'old'},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({resultCode:'0000',result:true,accessToken:'secret',data:{contents:[{companyNm:'테스트 업체',contractNm:'도장',ccwSeq:123,memoToday:'private',uptUserNm:'private'},{companyNm:'테스트 업체',contractNm:'방수'},{companyNm:'별도 업체',contractNm:'-'}]}})};},URLSearchParams,TextEncoder,AbortController,Date,URL,Blob,setTimeout,clearTimeout,alert:msg=>{throw new Error(msg);}});
 await vm.runInContext(`(${publishPartnerSnapshot.toString()})('https://gshealthk.vercel.app','${code}','2026-11-10')`,context);
 assert.equal(requests[0].options.headers['X-Requested-With'],'XMLHttpRequest');
 assert.equal(requests.length,1);assert.equal(requests[0].url,'/pgs/work_daily/getWorkDailyPartnerMainUseList.ax');assert.equal(requests[0].options.method,'POST');
 const body=new URLSearchParams(requests[0].options.body);assert.equal(body.get('pagePjCd'),code);assert.equal(body.get('sdate'),'2026-11-10');assert.equal(body.get('activeTf'),'1');
 const snapshot=parsePmxSnapshot(decodeURIComponent(new URL(navigations[0]).hash.slice(10)));
 assert.equal(snapshot.projectCode,code);assert.equal(snapshot.partners.length,2);assert.deepEqual(snapshot.partners[0].contracts,['도장','방수']);
 assert.equal(/private|secret|ccwSeq/.test(JSON.stringify(snapshot)),false);
});
test('partner validation rejects extras, stale dates, duplicate names and untrusted destinations',()=>{
 const s={version:1,source:'pmx-partners',projectCode:'070120',date:'2026-11-10',fetchedAt:new Date().toISOString(),partners:[{companyNm:'업체',contracts:['도장']}]};
 assert.equal(validatePartnerSnapshot(s).projectCode,'070120');
 for(const invalid of [{...s,accessToken:'secret'},{...s,partners:[{...s.partners[0],memoToday:'secret'}]},{...s,partners:[s.partners[0],s.partners[0]]},{...s,fetchedAt:'2020-01-01'},{...s,projectCode:70120}])assert.throws(()=>validatePartnerSnapshot(invalid));
 assert.throws(()=>makePartnerBookmarklet('https://evil.example','070120','2026-11-10'));
 assert.equal(/document\.cookie|postMessage|eval\(/.test(makePartnerBookmarklet('http://localhost:3000','070120','2026-11-10')),false);
});
for(const [label,response,expected] of [
 ['http error',{ok:false,status:403},'HTTP 403'],
 ['html response',{ok:true,status:200,json:async()=>{throw new SyntaxError('secret body');}},'JSON 대신'],
 ['server code',{ok:true,status:200,json:async()=>({resultCode:'9999',result:false,resultMsg:'private secret'})},'응답코드: 9999'],
 ['unexpected rows',{ok:true,status:200,json:async()=>({resultCode:'0000',result:true,data:{contents:null}})},'data.contents'],
 ['missing company',{ok:true,status:200,json:async()=>({resultCode:'0000',result:true,data:{contents:[{companyNm:null,memoToday:'private secret'}]}})},'업체명 또는 계약명']
])test(`partner favorite reports ${label} without leaking response bodies`,async()=>{
 const alerts=[];
 const context=vm.createContext({location:{origin:'https://pmx.gsenc.com'},fetch:async()=>response,URLSearchParams,AbortController,TextEncoder,setTimeout,clearTimeout,alert:msg=>alerts.push(msg)});
 await vm.runInContext(`(${publishPartnerSnapshot.toString()})('https://gshealthk.vercel.app','070120','2026-11-10')`,context);
 assert.equal(alerts.length,1);assert.ok(alerts[0].includes(expected),alerts[0]);assert.ok(alerts[0].includes('v2'));assert.equal(/secret|private/.test(alerts[0]),false);
});

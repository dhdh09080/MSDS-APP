import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProject, estimatedCare, kstDay} from '../src/lib/pmx.js';

test('PMX codes retain leading zeros and missing progress stays unknown',()=>{
 const p=normalizeProject({prjCd:'000012',prjNm:'현장',cstrnStrtYmd:'20240701',cstrnEndYmd:'20270230',actlTProgrt:null});
 assert.equal(p.prjCd,'000012'); assert.equal(p.cstrnStrtYmd,'2024-07-01');assert.equal(p.cstrnEndYmd,null);assert.equal(p.actlTProgrt,null);
 assert.equal(normalizeProject({...p,actlTProgrt:0}).actlTProgrt,0);
 assert.equal(normalizeProject({...p,actlTProgrt:101}).actlTProgrt,null);
 assert.throws(()=>normalizeProject({...p,prjCd:12}));
});
test('midnight uses Korean time regardless of host timezone',()=>{
 assert.equal(kstDay('2026-10-23T14:59:59Z'),'2026-10-23');
 assert.equal(kstDay('2026-10-23T15:00:00Z'),'2026-10-24');
});
test('recommendations label stages as estimates and handle absent progress',()=>{
 assert.equal(estimatedCare(null).stage,'공정 정보 없음');
 for(const p of [0,15,60,90,100]) assert.match(estimatedCare(p).stage,/예상/);
});

test('search matches names, codes and every supplied business category ignoring spaces',async()=>{
 const {searchProjects}=await import('../src/lib/pmx.js');
 const projects=[{prjNm:'주택 현장',prjCd:'000010',bizFldNm:'주택'},{prjNm:'울산 발전소',prjCd:'000020',bizFldNm:'플랜트'},{prjNm:'교량 공사',prjCd:'000030',bizFldNm:'인프라'}];
 assert.equal(searchProjects(projects,'울산발전소')[0].prjCd,'000020');
 assert.equal(searchProjects(projects,'플랜트').length,1);
 assert.equal(searchProjects(projects,'인 프라')[0].prjCd,'000030');
 assert.equal(searchProjects(projects,'000030').length,1);
 assert.equal(searchProjects(projects,'없는현장').length,0);
});
test('manual projects support plant/infra, optional PMX codes and validated dates',async()=>{
 const {manualProject}=await import('../src/lib/pmx.js');
 const p=manualProject({name:' 발전소 ',code:'000020',category:'플랜트',start:'2026-01-01',end:'2027-12-31'});
 assert.equal(p.prjNm,'발전소');assert.equal(p.prjCd,'000020');assert.equal(p.actlTProgrt,null);
 assert.equal(manualProject({name:'교량',category:'인프라'}).prjCd,null);
 assert.throws(()=>manualProject({name:'교량',category:''}));
 assert.throws(()=>manualProject({name:'교량',category:'인프라',start:'2026-02-30'}));
 assert.throws(()=>manualProject({name:'교량',category:'인프라',start:'2027-01-01',end:'2026-01-01'}));
 assert.throws(()=>manualProject({name:'교량',category:'인프라',code:'<script>'}));
});
test('plant and infrastructure progress do not imply housing construction stages',()=>{
 assert.equal(estimatedCare(60,'플랜트').stage,'실제 작업계획 확인 필요');
 assert.equal(estimatedCare(90,'인프라').stage,'실제 작업계획 확인 필요');
});

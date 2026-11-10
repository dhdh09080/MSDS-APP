import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyFilters,filterHazardMarkers,actionSummary} from '../src/lib/hazard-map-filters.js';
const companies=[{id:'a',name:'한빛전기'},{id:'b',name:'대한건설'}];
const markers=[
 {id:'open',marker_type:'issue',storage_name:'PIT 동측 통로',contractor_id:'a',review_status:'open',content:'적치물 정리'},
 {id:'pending',marker_type:'issue',storage_name:'PIT 서측 통로',contractor_id:'b',review_status:'pending'},
 {id:'done',marker_type:'issue',storage_name:'1층 통로',contractor_id:'a',review_status:'verified'},
 {id:'warehouse',marker_type:'warehouse',storage_name:'자재 창고',contractor_id:'b'},
 {id:'gate',marker_type:'gate',storage_name:'정문',contractor_id:null},
 {id:'legacy',storage_name:'동측 저장소',contractor_id:'a',items:[{name:'아세톤',quantity:'20 L'}]},
];
const find=filter=>filterHazardMarkers(markers,{...emptyFilters(),...filter},companies).map(row=>row.id);
test('combine type, status, company and search without losing map/list identity',()=>{
 assert.deepEqual(find({type:'issue',status:'pending',contractor:'b',query:'  pit  '}),['pending']);
 assert.deepEqual(find({query:'한빛전기'}),['open','done','legacy']);
 assert.deepEqual(find({query:'적치물'}),['open']);
 assert.deepEqual(find({query:'아세톤'}),['legacy']);
 assert.deepEqual(find({contractor:'unassigned'}),['gate']);
 assert.deepEqual(find({type:'warehouse',status:'verified'}),[]);
 assert.deepEqual(find({type:'hazard'}),['legacy']);
 assert.deepEqual(find({}),markers.map(row=>row.id));
});
test('action counts exclude ordinary locations and include requests in any category',()=>{
 assert.deepEqual(actionSummary(markers),{all:3,open:1,pending:1,verified:1});
 assert.deepEqual(actionSummary([...markers,{id:'warehouse-request',marker_type:'warehouse',review_status:'open'}]),{all:4,open:2,pending:1,verified:1});
 assert.deepEqual(find({status:'none'}),['warehouse','gate','legacy']);
 assert.deepEqual(find({requested:true}),['open','pending','done']);
 assert.deepEqual(actionSummary([]),{all:0,open:0,pending:0,verified:0});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {posterModel, buildHealthPosterSvg, weatherChartSvg, hourlyWeatherHtml, kstDate} from '../src/lib/weather-poster.js';
const hours=Array.from({length:14},(_,i)=>({hour:i+6,temp:10+i,feel:9+i,wind:1+i/10,humidity:60}));
const fc={date:'2026-10-19',hours,source:'preview'};

test('season uses calendar and weather extremes and supports explicit selection',()=>{
 assert.equal(posterModel(fc).season,'transition');
 assert.equal(posterModel({...fc,date:'2026-07-19'}).season,'summer');
 assert.equal(posterModel({...fc,date:'2026-01-19'}).season,'winter');
 assert.equal(posterModel({...fc,hours:[{hour:12,feel:35}]}).season,'summer');
 assert.equal(posterModel({...fc,hours:[{hour:6,feel:-3}]}).season,'winter');
 assert.equal(posterModel(fc,'summer').season,'summer');
});
test('daily tips are stable that day, change each day, and roll over at Korean midnight',()=>{
 assert.deepEqual(posterModel(fc).tips,posterModel(fc).tips);
 assert.notDeepEqual(posterModel(fc).tips,posterModel({...fc,date:'2026-10-20'}).tips);
 assert.equal(kstDate(Date.parse('2026-10-19T14:59:59Z')),'2026-10-19');
 assert.equal(kstDate(Date.parse('2026-10-19T15:00:00Z')),'2026-10-20');
});
test('poster retains every working hour and metric in valid XML, escaping site content',()=>{
 const svg=buildHealthPosterSvg(fc,{name:'<script>unsafe</script> & 현장',address:'서울 성동구'},'transition');
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 assert.equal(doc.documentElement.getAttribute('width'),'1440');
 assert.equal(doc.documentElement.getAttribute('height'),'1120');
 assert.equal(doc.getElementsByTagName('parsererror').length,0);
 assert.equal(doc.getElementsByTagName('script').length,0);
 assert.match(svg,/환절기 건강관리/);
 assert.match(svg,/미리보기 예시/);
 for(let h=6;h<=19;h++)assert.match(svg,new RegExp('>'+h+'시<'));
 assert.match(svg,/풍속 m\/s/);
 assert.doesNotMatch(svg,/NaN|Infinity|undefined/);
 assert.notEqual(svg,buildHealthPosterSvg({...fc,date:'2026-10-20'}));
});
test('missing temperatures break lines; missing or zero wind are kept distinct',()=>{
 const svg=weatherChartSvg([{hour:6,temp:1,feel:2,wind:0},{hour:7,temp:null,feel:3,wind:null},{hour:8,temp:4,feel:5,wind:2}]);
 assert.equal((svg.match(/<polyline/g)||[]).length,3);
 assert.doesNotMatch(svg,/NaN|Infinity|undefined/);
 const html=hourlyWeatherHtml({date:'2026-10-19',hours:[{hour:6,temp:-3,feel:null,wind:0}],source:'preview'});
 assert.match(html,/>−?—</);
 assert.match(html,/<td>0<\/td>/);
 assert.match(html,/<td>-3<\/td>/);
 assert.match(html,/풍속 \(m\/s\)/);
 const empty=buildHealthPosterSvg({date:'2026-10-19',hours:[]});
 assert.doesNotMatch(empty,/NaN|Infinity|undefined/);
});

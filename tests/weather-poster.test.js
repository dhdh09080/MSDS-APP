import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {posterModel, buildHealthPosterSvg, weatherChartSvg, hourlyWeatherHtml, kstDate, A4_POSTER} from '../src/lib/weather-poster.js';
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
 assert.equal(doc.documentElement.getAttribute('width'),'1260');
 assert.equal(doc.documentElement.getAttribute('height'),'1782');
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

test('A4 poster and high resolution export have the physical paper aspect ratio',()=>{
 assert.equal(A4_POSTER.width/A4_POSTER.height,210/297);
 assert.equal(A4_POSTER.exportWidth/A4_POSTER.exportHeight,210/297);
 const svg=buildHealthPosterSvg(fc);
 assert.doesNotMatch(svg,/DAILY SITE HEALTH|rx="24"|<circle[^>]*r="12"/);
 assert.match(svg,/210 × 297 mm/);
});

test('download scales the complete A4 SVG to the print canvas and print action sets A4 paper',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {runInNewContext}=await import('node:vm');
 const source=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
 const handlers=source.slice(source.indexOf('window.printWxSitePoster ='),source.indexOf('async function fetchWxPosterList('));
 const drawn=[];let printed='';let saved=false;
 const canvas={width:0,height:0,getContext:()=>({drawImage:(...args)=>drawn.push(args)}),toBlob:cb=>cb(new Blob(['png']))};
 const context={window:{},wxPosterSvg:buildHealthPosterSvg(fc),A4_POSTER,Blob,URL:{createObjectURL:()=> 'blob:poster',revokeObjectURL(){}},
  Image:class{set src(value){this.onload()}},document:{createElement:()=>canvas},
  openPrintWindow:html=>{printed=html},toast:()=>{throw Error('Unexpected error')},downloadBlob:()=>{saved=true},currentWS:{name:'현장'},kstDate:()=>fc.date};
 runInNewContext(handlers,context);
 context.window.downloadWxSitePoster();
 assert.equal(saved,true);
 assert.equal(canvas.width/canvas.height,210/297);
 assert.equal(drawn[0].length,5);
 assert.equal(drawn[0][3],2520);
 assert.equal(drawn[0][4],3564);
 context.window.printWxSitePoster();
 assert.match(printed,/@page\{size:A4 portrait;margin:0\}/);
 assert.match(printed,/width:210mm;height:297mm/);
});

test('wind, heat and cold alert thresholds are inclusive, graduated, and missing-safe',async()=>{
 const {metricAlert}=await import('../src/lib/weather-poster.js');
 for(const [key,value,level] of [
  ['wind',9.99,0],['wind',10,1],['wind',14,1],
  ['feel',30.99,0],['feel',31,1],['feel',32.99,1],['feel',33,2],['feel',34.99,2],['feel',35,3],
  ['temp',-11.99,0],['temp',-12,1],['temp',-14.99,1],['temp',-15,2],['temp',-20,2],
  ['temp',null,0],['feel',NaN,0],['wind',undefined,0],['temp',35,0],['feel',-15,0],
 ]) assert.equal(metricAlert(key,value)?.level||0,level,`${key} ${value}`);
});
test('simultaneous alerts survive seasonal overrides and badge hours match the stated severity',()=>{
 const forecast={...fc,hours:[{hour:6,temp:-15,feel:-20,wind:10},{hour:12,temp:30,feel:31,wind:3},{hour:15,temp:33,feel:35,wind:12}]};
 const model=posterModel(forecast,'transition');
 assert.deepEqual(model.alerts.map(a=>a.kind),['heat','cold','wind']);
 assert.deepEqual(model.alerts[0].hours,[15]);
 assert.deepEqual(model.alerts[1].hours,[6]);
 assert.deepEqual(model.alerts[2].hours,[6,15]);
 const svg=buildHealthPosterSvg(forecast,{},'transition');
 for(const label of ['더위 위험','추위 경고','강풍 주의'])assert.match(svg,new RegExp(label));
 assert.match(svg,/현장 설정 기준/);
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
 assert.equal(doc.getElementsByTagName('parsererror').length,0);
 assert.equal(doc.documentElement.getAttribute('height'),'1782');
 const hourly=hourlyWeatherHtml(forecast);
 assert.match(hourly,/wx-alert-value/);
 assert.match(hourly,/35°C 이상 · 15시/);
});
test('guidance reacts to actual weather, keeps all simultaneous risks and rotates every date',()=>{
 const windy={...fc,hours:hours.map(h=>({...h,wind:11}))};
 const cold={...fc,hours:hours.map(h=>({...h,temp:-15,feel:-20}))};
 const hot={...fc,hours:hours.map(h=>({...h,temp:34,feel:35}))};
 assert.match(posterModel(windy).tips.join(' '),/강풍|바람|10m\/s/);
 assert.match(posterModel(cold).tips.join(' '),/추위|−15°C/);
 assert.match(posterModel(hot).tips.join(' '),/35°C|더위|더운/);
 assert.notDeepEqual(posterModel(windy).tips,posterModel(fc).tips);
 const mixed={...fc,hours:[{hour:6,temp:-15,feel:-18,wind:12},{hour:15,temp:34,feel:36,wind:11}]};
 for(let day=1;day<29;day++){
  const a=posterModel({...mixed,date:`2026-10-${String(day).padStart(2,'0')}`});
  const b=posterModel({...mixed,date:`2026-10-${String(day+1).padStart(2,'0')}`});
  assert.notDeepEqual(a.tips,b.tips);
  assert.equal(a.tips.length,3);
 }
 const diurnal=posterModel({...fc,hours:[{hour:6,temp:5,feel:4},{hour:15,temp:20,feel:19}]});
 assert.match(diurnal.tips.join(),/일교차가 10°C 이상/);
});

test('rounding cannot falsely suggest a threshold was crossed',async()=>{
 const {riskMetric}=await import('../src/lib/weather-poster.js');
 assert.equal(riskMetric('wind',9.99,' m/s'),'9.99 m/s');
 assert.equal(riskMetric('feel',30.99,'°C'),'30.99°C');
 assert.equal(riskMetric('feel',32.99,'°C'),'32.99°C');
 assert.equal(riskMetric('temp',-11.99,'°C'),'-11.99°C');
 assert.equal(riskMetric('temp',-14.99,'°C'),'-14.99°C');
 assert.equal(riskMetric('wind',10.04,' m/s'),'10 m/s');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { kmaGrid, kmaBase, numeric, parseKma, aggregateDays } from '../supabase/functions/site-weather/lib/forecast.js';
import { detailedForecast } from '../supabase/functions/site-weather/detailed.ts';

test('KMA grid matches Seoul and Busan reference cells', () => {
  assert.deepEqual(kmaGrid(37.5665, 126.978), {nx:60, ny:127});
  assert.deepEqual(kmaGrid(35.1796, 129.0756), {nx:98, ny:76});
});
test('KMA publication cutoff selects prior run and rolls back at midnight KST', () => {
  assert.deepEqual(kmaBase(Date.parse('2026-10-19T02:10:00+09:00')), {base_date:'20261018',base_time:'2300'});
  assert.deepEqual(kmaBase(Date.parse('2026-10-19T02:20:00+09:00')), {base_date:'20261019',base_time:'0200'});
  assert.deepEqual(kmaBase(Date.parse('2026-10-19T00:05:00+09:00')), {base_date:'20261018',base_time:'2300'});
});
test('KMA categories preserve missing metrics and textual precipitation', () => {
  const rows = Object.entries({TMP:'18',REH:'70',WSD:'3.2',POP:'80',PCP:'1mm 미만',PTY:'4',SKY:'4'}).map(([category,fcstValue]) => ({category,fcstValue,fcstDate:'20261019',fcstTime:'1400'}));
  const [slot] = parseKma(rows);
  assert.equal(slot.time,'2026-10-19T14:00');
  assert.equal(slot.code,80);
  assert.equal(slot.temp,18);
  assert.equal(slot.feel,null);
  assert.equal(slot.precipitation,'1mm 미만');
  assert.equal(parseKma([{category:'TMP',fcstValue:'18',fcstDate:'20261019',fcstTime:'1400'}])[0].code,null);
  assert.equal(numeric(null),null);
  assert.equal(numeric(''),null);
  const [day] = aggregateDays([slot,{...slot,temp:20,pop:0,humidity:null}]);
  assert.equal(day.min,18);
  assert.equal(day.max,20);
  assert.equal(day.humidity,70);
  assert.equal(day.pop,80);
  assert.equal(day.feel,null);
});

test('detailed forecast prioritizes KMA, labels supplemental feel, and falls back on provider failure', async () => {
  const originalFetch = globalThis.fetch;
  const originalDeno = globalThis.Deno;
  let mode = 'both';
  globalThis.Deno = {env:{get: () => mode === 'no-key' ? undefined : 'test-key'}};
  const date = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  globalThis.fetch = async url => {
    if (String(url).includes('data.go.kr')) {
      if (mode === 'kma-down' || mode === 'all-down') throw new Error('offline');
      const item = Object.entries({TMP:'18',REH:'60',WSD:'4',POP:'70',PCP:'강수없음',PTY:'0',SKY:'1'}).map(([category,fcstValue]) => ({category,fcstValue,fcstDate:date.replaceAll('-',''),fcstTime:'1200'}));
      return Response.json({response:{header:{resultCode:'00'},body:{items:{item}}}});
    }
    if (mode === 'model-down' || mode === 'all-down') throw new Error('offline');
    return Response.json({hourly:{time:[date+'T12:00'],temperature_2m:[21],relative_humidity_2m:[50],apparent_temperature:[19],precipitation_probability:[20],precipitation:[0],wind_speed_10m:[2],wind_direction_10m:[180],weather_code:[0]}});
  };
  try {
    let result = await detailedForecast(37.5665,126.978);
    assert.equal(result.hourly[0].source,'기상청 단기예보');
    assert.equal(result.hourly[0].temp,18);
    assert.equal(result.hourly[0].feel,19);
    assert.equal(result.hourly[0].feelSource,'Open-Meteo');
    mode='kma-down'; result=await detailedForecast(37.5665,126.978);
    assert.equal(result.hourly[0].source,'Open-Meteo');
    assert.match(result.warnings.join(),/기상청 연결/);
    mode='no-key'; result=await detailedForecast(37.5665,126.978);
    assert.match(result.warnings.join(),/키 미설정/);
    mode='model-down'; result=await detailedForecast(37.5665,126.978);
    assert.equal(result.hourly[0].feel,null);
    assert.equal(result.daily[0].feel,null);
    mode='all-down'; await assert.rejects(detailedForecast(37.5665,126.978), /상세 예보/);
  } finally { globalThis.fetch=originalFetch; globalThis.Deno=originalDeno; }
});

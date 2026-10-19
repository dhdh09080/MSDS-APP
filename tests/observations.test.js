import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, parseStations, parseObservation } from '../supabase/functions/site-weather/lib/observations.js';
import { siteObservations } from '../supabase/functions/site-weather/observations.ts';
const now = Date.parse('2026-10-19T12:10:00+09:00');

test('station coordinates and nearest-distance calculation reject malformed catalog entries', () => {
  const stations = parseStations('# STN_ID LON LAT\n108 126.9658 37.5714 1 85\n999 0 0\n</html>');
  assert.equal(stations.length,1);
  assert.ok(distanceKm(37.5665,126.978,stations[0]) < 2);
  assert.equal(distanceKm(stations[0].latitude,stations[0].longitude,stations[0]),0);
});
test('AWS maps minute fields, missing values and observation timestamp', () => {
  const row='202610191205,108,260.4,2.8,254.2,3.6,253.3,2.9,-9.0,0.0,0.0,1.2,2.0,3.0,96.8,1006.6,1017.4,-99.9';
  const result = parseObservation(row,'AWS',108,now);
  assert.equal(result.temp,-9); // A real negative temperature, not a missing value.
  assert.equal(result.wind,2.8);
  assert.equal(result.gust,3.6);
  assert.equal(result.humidity,96.8);
  assert.equal(result.rain60m,1.2);
  assert.equal(result.rainDay,3);
  assert.equal(result.ageMinutes,5);
  assert.equal(result.stale,false);
  const missing = parseObservation(row.replace('-9.0','-99.9').replace('96.8','-99.9').replace(',1.2,',',-99.9,'),'AWS',108,now);
  assert.equal(missing.temp,null);
  assert.equal(missing.humidity,null);
  assert.equal(missing.rain60m,null);
  assert.equal(parseObservation(row,'AWS',999,now),null);
  assert.equal(parseObservation(row,'AWS',108,now+3600000).stale,true);
});
test('ASOS uses its own field order and 36-point wind direction, without inventing hourly rain', () => {
  const row='202610191200 108 29 4.6 32 10.0 331 1025.7 1028.0 2 1.7 -3.0 -24.6 17.0 0.8 -9.0 -9.0 -9.0 -9.0';
  const result=parseObservation(row,'ASOS',108,now);
  assert.equal(result.temp,-3);
  assert.equal(result.humidity,17);
  assert.equal(result.direction,290);
  assert.equal(result.rainDay,null);
  assert.equal(result.rain60m,null);
});
test('provider failures stay isolated and credentials never appear in returned errors', async () => {
  const oldFetch=globalThis.fetch, oldDeno=globalThis.Deno;
  const realNow=Date.now;
  Date.now=()=>now;
  globalThis.Deno={env:{get:()=> 'private-test-key'}};
  globalThis.fetch=async url=> {
    const u=new URL(url);
    assert.equal(u.searchParams.get('authKey'),'private-test-key');
    if (u.searchParams.get('inf') === 'SFC' || u.pathname.endsWith('kma_sfctm2.php')) return new Response('private-test-key', {status:403});
    if (u.pathname.endsWith('stn_inf.php')) return new Response('108 126.9658 37.5714\n999 129.0 35.0');
    return new Response('202610191205 108 260.4 2.8 254.2 3.6 253.3 2.9 18 0 0 1.2 2 3 60 1006 1017 10');
  };
  try {
    const result=await siteObservations(37.5665,126.978);
    assert.equal(result.observations.length,1);
    assert.equal(result.observations[0].station.id,108);
    assert.match(result.warnings[0],/ASOS.*활용승인/);
    assert.doesNotMatch(JSON.stringify(result),/private-test-key/);
    globalThis.Deno={env:{get:()=>undefined}};
    assert.match((await siteObservations(37.5665,126.978)).warnings[0],/키 미설정/);
  } finally { globalThis.fetch=oldFetch; globalThis.Deno=oldDeno; Date.now=realNow; }
});

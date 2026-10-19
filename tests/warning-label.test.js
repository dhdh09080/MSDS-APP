import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PPE_ASSETS, summarizePpe, renderPpe, concreteSafetyText, labelSafetySections } from '../src/lib/warning-label.js';
import { condensePCodes, decodePCodes } from '../src/lib/ghs.js';

test('selects six concrete precautions while retaining all four available categories', () => {
  const raw = decodePCodes('P201 P202 P210 P233 P240 P241 P260 P271 P280 P301+P310 P304+P340 P305+P351+P338 P403 P405 P501');
  const result = condensePCodes(raw);
  assert.equal(result.list.length, 6);
  assert.equal(result.condensed, true);
  for (const group of ['2','3','4','5']) assert.ok(result.list.some(p => p.code.startsWith('P'+group)));
  assert.ok(!result.list.some(p => ['P201','P202'].includes(p.code)));
  for (const item of result.list) assert.ok(raw.some(p => p.code === item.code && p.text === item.text));
});

test('keeps fewer than six available precautions without inventing padding', () => {
  const raw = decodePCodes('P264 P280');
  assert.deepEqual(condensePCodes(raw), {list:raw, condensed:false});
});

test('shows only registered PPE and preserves material/filter/conditional requirements', () => {
  const items = summarizePpe('손 보호: 니트릴 장갑(0.4mm); 눈 보호: 보안경; 호흡기 보호: 환기가 부족한 경우 유기증기용 방독마스크(A형 필터)');
  assert.deepEqual(items.map(p => p.key), ['gloves','goggles','gas']);
  assert.match(items[0].detail, /0.4mm/);
  assert.match(items[2].detail, /환기가 부족한 경우.*A형 필터/);
  const html = renderPpe('보호장갑, 보안경, 방독마스크');
  assert.match(html, /안전장갑 착용/);
  assert.match(html, /방독마스크 착용/);
  assert.ok(!html.includes('data-ppe="boots"'));
});

test('does not turn a negated requirement into a mandatory PPE icon', () => {
  assert.deepEqual(summarizePpe('호흡기 보호: 필요 없음; 손 보호: 보호장갑 착용').map(p => p.key), ['gloves']);
  assert.deepEqual(summarizePpe('보안경 불필요; 안전모 해당 없음'), []);
  assert.deepEqual(summarizePpe('호흡기 보호: 내용없음; 신체 보호: 원본 MSDS 8항 참조'), []);
});

test('distinguishes dust masks, gas masks, and unspecified respiratory protection', () => {
  assert.deepEqual(summarizePpe('방진마스크').map(p => p.key), ['dust']);
  assert.deepEqual(summarizePpe('방독마스크').map(p => p.key), ['gas']);
  assert.deepEqual(summarizePpe('호흡보호구 착용').map(p => p.key), ['respirator']);
});

test('replaces reference-only placeholders with recorded actions and marks genuine gaps', () => {
  const record = {handling_precautions:'원본 MSDS 7항의 취급 지침을 확인하세요.', first_aid:'원본 MSDS 4항을 확인하세요.'};
  const result = labelSafetySections(record, decodePCodes('P210 P301+P310 P391'));
  assert.match(result.handling, /점화원/);
  assert.match(result.firstAid, /삼켰다면.*진찰/);
  assert.match(result.emergency, /누출물/);
  assert.ok(!JSON.stringify(result).includes('참조'));
  assert.equal(labelSafetySections({}, []).firstAid, '응급조치 정보 미등록');
  assert.deepEqual(labelSafetySections({}, []).missing, ['취급·보관','응급조치','화재·누출 대응','보호구']);
  assert.equal(concreteSafetyText('열과 불꽃을 피하십시오. 원본 MSDS 7항을 확인하세요.'), '열과 불꽃을 피하십시오.');
});

test('escapes original safety text before HTML rendering', () => {
  const html = renderPpe('보호장갑 <script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('uses all eight original numbered PNGs without changing their bytes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/ppe/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.length, 8);
  const expected = {goggles:301, gas:302, dust:303, face:304, helmet:305, hearing:306, boots:307, gloves:308};
  for (const [key, number] of Object.entries(expected)) {
    const record = manifest.find(item => item.number === number);
    assert.equal(PPE_ASSETS[key], '/ppe/'+record.file);
    const bytes = readFileSync(new URL('../public/ppe/'+record.file, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  }
  const html = renderPpe('보호장갑, 보안경, 방독마스크');
  assert.ok(!html.includes('<svg'));
  for (const number of [308,301,302]) assert.match(html, new RegExp('-'+number+'-'));
});

test('does not substitute unrelated icons for PPE types absent from the ZIP', () => {
  const html = renderPpe('보호복, 호흡보호구 착용');
  assert.match(html, /보호복 착용/);
  assert.match(html, /호흡보호구 착용/);
  assert.ok(!html.includes('<img'));
});

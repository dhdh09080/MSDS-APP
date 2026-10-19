import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLocalMeasureReport } from '../src/lib/measure-local.js';

function report() {
  return [{ index: 0, text: `3-1. 측정결과의 평가
[ 소음 ]
1 | 철물공사 용접공 | 용접공 | *1 근로자 | 80.0 dB(A) | 90 | 미만
2 | *2 근로자 | 75.0 dB(A) | 90 | 미만
[ 단일물질 ]
1 | 철물공사 용접공 | 용접공 | 기타광물성분진 | *1 근로자 | 0.5 | 미만
2 | 기타광물성분진 | *2 근로자 | 0.8 | 미만
[ 혼합유기화합물 ]
1 | 철물공사 용접공 | 용접공 | *1 근로자 | 0.4 | 미만` }, { index: 1, text: `3-2. 문제점 및 개선대책
유해인자 | 최고노출수준 (해당공정) | 노출기준 | 평가
소음 | 80.0 dB(A) (철물공사 용접공) | 90 dB(A) | 미만
기타광물성분진 | 0.8 ㎎/㎥ (철물공사 용접공) | 1 ㎎/㎥ | 미만
혼합유기화합물(Em) | 0.4 | - | (철물공사 용접공) | 1 | - | 미만
톨루엔 | 2.0 ppm (철물공사 용접공) | 50 ppm | 미만
- 기타광물성분진: 건강영향
☞ 노출감소 방법
: 국소배기장치 설치
▣ 대 책
1) 작업 중 방진마스크를 착용하세요.` }];
}

test('extracts every evaluation row, preserves maximum-only records, and copies report measures without AI', () => {
  const result = parseLocalMeasureReport(report());
  assert.equal(result.aftercare.analysisMethod, 'local');
  assert.equal(result.aftercare.extraction.evaluationRows, 5);
  assert.equal(result.aftercare.extraction.summaryRows, 1);
  assert.equal(result.noise.length, 2);
  assert.equal(result.dust.length, 4);
  assert.equal(result.workTypes.length, 1);
  assert.equal(result.dust[0].measured, '0.5 mg/m³');
  assert.equal(result.dust[0].limit, '1 mg/m³');
  assert.match(result.dust.at(-1).reason, /최고측정치 요약/);
  assert.equal(result.resultRows[0].singleStatus, '미만');
  assert.ok(result.improvements.some(row => row.method.includes('국소배기장치 설치')));
  assert.ok(result.improvements.every(row => row.source === '보고서 기재'));
  assert.ok(!JSON.stringify(result).includes('근로자'));
});

test('preserves exceeded results, exact numbers, and units for Word output', () => {
  const pages = report();
  pages[0].text = pages[0].text.replace('0.8 | 미만', '1.5 | 초과');
  pages[1].text = pages[1].text.replace('0.8 ㎎/㎥ (철물공사 용접공) | 1 ㎎/㎥ | 미만', '1.5 ㎎/㎥ (철물공사 용접공) | 1 ㎎/㎥ | 초과');
  const result = parseLocalMeasureReport(pages);
  assert.equal(result.dustExceeded, true);
  assert.equal(result.resultRows[0].singleStatus, '초과');
  assert.deepEqual(result.resultRows[0].exceededMeasurements[0].measured, { value: '1.5', unit: 'mg/m³' });
});

test('unknown layouts, missing rows, corrupted maxima, missing units, and inconsistent verdicts fail closed', () => {
  const mutations = [
    pages => { pages[0].text = null; },
    pages => { pages[0].text = pages[0].text.replace('1 | 철물공사 용접공 | 용접공 | *1 근로자 | 80.0 dB(A) | 90 | 미만', ''); },
    pages => { pages[1].text = pages[1].text.replace('0.8 ㎎/㎥', '0.9 ㎎/㎥'); },
    pages => { pages[1].text = pages[1].text.replace(/㎎\/㎥/g, ''); },
    pages => { pages[0].text = pages[0].text.replace('0.8 | 미만', '0.8 | 초과'); },
    pages => { pages[1].text = pages[1].text.replace(/☞[\s\S]+/, ''); },
  ];
  for (const mutate of mutations) {
    const pages = report(); mutate(pages);
    assert.throws(() => parseLocalMeasureReport(pages), error => error.code === 'MEASURE_LOCAL_UNSUPPORTED');
  }
});

test('non-detect values remain qualitative instead of being replaced with zero', () => {
  const pages = report();
  pages[0].text = pages[0].text.replace('0.5 | 미만', '불검출 | 미만');
  const result = parseLocalMeasureReport(pages);
  assert.equal(result.dust[0].measured, '불검출 mg/m³');
});

test('uploaded report reconciles 476 evaluation rows, 57 processes, and original maximums', { skip: !process.env.MEASURE_TEXT_FIXTURE }, () => {
  const pages = JSON.parse(fs.readFileSync(process.env.MEASURE_TEXT_FIXTURE));
  const result = parseLocalMeasureReport(pages);
  assert.equal(result.aftercare.extraction.evaluationRows, 476);
  assert.equal(result.workTypes.length, 57);
  assert.equal(result.noise.length, 165);
  assert.equal(result.dust.length, 319);
  assert.equal(Math.max(...result.noise.map(row => parseFloat(row.measured))), 84.2);
  assert.equal(Math.max(...result.measurements.filter(row => row.agent === '기타광물성분진').map(row => Number(row.measured.value))), 0.9504);
  assert.equal(result.dustExceeded || result.noiseExceeded || result.mixedExceeded, false);
});

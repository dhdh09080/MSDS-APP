import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { groupMeasureResults, buildMeasureAftercare } from '../src/lib/measure-aftercare.js';
import { createMeasureAftercareDocx } from '../src/lib/measure-docx.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const direct = (node, name) => Array.from(node.childNodes || []).filter(child => child.namespaceURI === W && child.localName === name);
const all = (node, name) => Array.from(node.getElementsByTagNameNS(W, name));
const text = node => all(node, 't').map(item => item.textContent).join('');
const templateBytes = fs.readFileSync(new URL('../public/templates/measure-aftercare-v1.docx', import.meta.url));
const row = (workType, extra = {}) => ({ workType, singleStatus: '미만', mixedStatus: '해당없음', noiseStatus: '미만', exceededMeasurements: [], ...extra });

test('groups jobs by construction while retaining separate contractors and worst verdicts', () => {
  const result = groupMeasureResults([
    row('설비공사(업체A) 배관공'), row('설비공사(업체A) 소방공', { mixedStatus: '미만' }), row('설비공사(업체B) 배관공'),
    row('철물공사 잡철공'), row('철물공사 용접공', { singleStatus: '초과', exceededMeasurements: [{ agent: '용접흄', measured: { value: '6', unit: 'mg/m³' }, limit: { value: '5', unit: 'mg/m³' } }] }),
    row('철물공사 용접공2', { singleStatus: '초과', exceededMeasurements: [{ agent: '용접흄', measured: { value: '8', unit: 'mg/m³' }, limit: { value: '5', unit: 'mg/m³' } }] }),
  ]);
  assert.deepEqual(result.map(item => item.workType), ['설비공사(업체A)', '설비공사(업체B)', '철물공사']);
  assert.equal(result[0].mixedStatus, '미만');
  assert.equal(result[2].singleStatus, '초과');
  assert.equal(result[2].exceededMeasurements[0].measured.value, '8');
  assert.throws(() => groupMeasureResults([row('철물공사', { singleStatus: '초과' })]), /초과/);
});

test('already concise plans keep their supplied wording and responsible persons', () => {
  const source = { aftercare: { resultRows: [row('철물공사 용접공')], improvements: [{ target: '용접작업', method: '현장에서 확인한 별도 대책', assignee: '입력한 담당자' }] } };
  assert.equal(buildMeasureAftercare(source).improvements[0].assignee, '입력한 담당자');
  assert.equal(buildMeasureAftercare(source).improvements[0].method, '현장에서 확인한 별도 대책');
});

test('fills the real template, keeps approval/layout styles, and never leaks example dates or photos', async () => {
  const data = {
    siteName: '검증현장 & 공사', createdDate: '2026-10-19', period: '2026-05-21 ~ 2026-05-22', receivedDate: '',
    aftercare: { resultRows: [row('철물공사 잡철공'), row('철물공사 용접공')], improvements: [{ target: '용접작업', method: '환기\n보호구 착용', assignee: '' }] },
  };
  const blob = await createMeasureAftercareDocx(data, { templateBytes });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const original = await JSZip.loadAsync(templateBytes);
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = all(doc, 'body')[0], main = direct(body, 'tbl')[0], rows = direct(main, 'tr');
  assert.ok(text(doc).includes('검증현장 & 공사'));
  assert.ok(text(doc).includes('2026.10.19'));
  assert.ok(!text(doc).includes('성동자이리버뷰') && !text(doc).includes('2026.06.26') && !text(doc).includes('2026. 06. 19'));
  assert.ok(text(doc).includes('담당') && text(doc).includes('팀장') && text(doc).includes('소장'));
  assert.ok(text(doc).includes('노출기준 초과여부'));
  assert.equal(text(direct(rows[3], 'tc')[3]), '');
  assert.equal(direct(main, 'tr').filter(r => direct(r, 'tc').length === 7 && text(direct(r, 'tc')[1]) === '철물공사').length, 1);
  assert.ok(!text(doc).includes('AI 분석 결과는 검토용 초안'));
  assert.equal(Object.keys(zip.files).filter(name => name.startsWith('word/media/')).length, 0);
  for (const name of ['word/styles.xml', 'word/theme/theme1.xml']) assert.equal(await zip.file(name).async('string'), await original.file(name).async('string'));
  assert.ok(all(doc, 'br').length > 0);
});

test('export retains exceeded measurements and units instead of hiding them in a grouped construction', async () => {
  const data = { aftercare: { resultRows: [row('철물공사 용접공', { singleStatus: '초과', exceededMeasurements: [{ agent: '용접흄', measured: { value: '8', unit: 'mg/m³' }, limit: { value: '5', unit: 'mg/m³' } }] })], improvements: [] } };
  const blob = await createMeasureAftercareDocx(data, { templateBytes });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml').async('string');
  assert.ok(xml.includes('8 mg/m³ / 5 mg/m³'));
  assert.ok(xml.includes('초과'));
});

test('uploaded report produces the reference structure of 24 constructions and eight plans', { skip: !process.env.MEASURE_TEXT_FIXTURE }, async () => {
  const { parseLocalMeasureReport } = await import('../src/lib/measure-local.js');
  const data = parseLocalMeasureReport(JSON.parse(fs.readFileSync(process.env.MEASURE_TEXT_FIXTURE)));
  const summary = buildMeasureAftercare(data);
  assert.equal(summary.resultRows.length, 24);
  assert.equal(summary.improvements.length, 8);
  assert.ok(summary.improvements.every(item => !item.assignee));
  assert.ok(summary.improvements.every(item => item.method.length < 150));
  assert.ok(!summary.improvements[1].target.includes('도장'));
  // Saved results omit raw measurements; the retained dust rows must still identify welding work.
  const stored = { aftercare: data.aftercare, dust: data.dust };
  assert.ok(buildMeasureAftercare(stored).improvements[1].target.includes('방화문'));
});

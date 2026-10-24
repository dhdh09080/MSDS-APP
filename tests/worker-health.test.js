import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { calculateAge, parseBloodPressure, analyzeRows, createRoster, measurementTitle, measurementDateLabel, koreanToday } from '../src/lib/worker-health/core.js';
import { createExcel } from '../src/lib/worker-health/export.js';

const asOf = '2026-10-24';
function sourceRow(name, birth, pressure, company = '대한건설') {
  const row = Array(17).fill('');
  row[3] = company; row[4] = '전기'; row[5] = name; row[9] = '한국'; row[11] = birth; row[16] = pressure;
  return row;
}

test('age boundary, birthday, resident/foreign century and invalid birth dates', () => {
  assert.equal(calculateAge('631024-1', asOf), 63);
  assert.equal(calculateAge('631025-1', asOf), 62);
  assert.equal(calculateAge('000101-1', asOf), 126);
  assert.equal(calculateAge('000101-3', asOf), 26);
  assert.equal(calculateAge('000101-5', asOf), 126);
  assert.equal(calculateAge('000101-7', asOf), 26);
  assert.equal(calculateAge('1963.10.24', asOf), 63);
  assert.equal(calculateAge('19631024', asOf), 63);
  for (const invalid of ['', 'not-a-date', '630230-1', '2026-10-25', '2026-02-29']) assert.equal(calculateAge(invalid, asOf), null);
  assert.equal(koreanToday(new Date('2026-10-23T16:00:00Z')), asOf);
});

test('pressure parses supported cells and excludes dates and ambiguous multiple readings', () => {
  for (const cell of ['2026.10.16(150/100)', '150 ／ 100', '수축기:150 이완기：100', '최고 150 최저 100']) assert.deepEqual(parseBloodPressure(cell), [150, 100]);
  for (const cell of ['', '2026/10/16', '150/100 160/110', null]) assert.equal(parseBloodPressure(cell), null);
});

test('classification matches gsold thresholds without overlap and counts exclusions', () => {
  const rows = [Array(17).fill('header'),
    sourceRow('고령', '631024-1', '180/110'),
    sourceRow('수축기경계', '631025-1', '150/99'),
    sourceRow('이완기경계', '000101-3', '149/100'),
    sourceRow('정상', '000101-3', '149/99'),
    sourceRow('나이미상', '', '180/110'),
    sourceRow('혈압미상', '000101-3', '2026/10/16'),
    Array(17).fill('')];
  const result = analyzeRows(rows, asOf);
  assert.equal(result.total, 6);
  assert.deepEqual(result.older.map(w => w.name), ['고령']);
  assert.deepEqual(result.pressure.map(w => w.name), ['수축기경계', '이완기경계']);
  assert.equal(result.unknownAge, 1); assert.equal(result.unreadablePressure, 1);
  const noQ = analyzeRows(rows.slice(0, 2).map(row => row.slice(0, 12)), asOf);
  assert.equal(noQ.hasPressure, false); assert.equal(noQ.older.length, 1);
  assert.throws(() => analyzeRows([['bad']], asOf), /L열/);
});

test('titles and entry date blanks cover single, cross-month and cross-year periods', () => {
  assert.equal(measurementTitle('2026-10-24', '2026-10-24'), '2026.10.24 고령자 혈압측정');
  assert.equal(measurementTitle('2026-10-31', '2026-11-01', 'pressure'), '2026.10.31~11.01 고혈압 근로자 혈압측정');
  assert.equal(measurementTitle('2026-12-31', '2027-01-01'), '2026.12.31~2027.01.01 고령자 혈압측정');
  assert.equal(measurementDateLabel('2026-10-24', '2026-10-25'), '2026년 10월      일');
  assert.equal(measurementDateLabel('2026-10-31', '2026-11-01'), '        년     월     일');
  assert.throws(() => measurementTitle('2026-10-25', '2026-10-24'), /종료일/);
});

test('XLSX preserves literal text, original eight columns, blank rows and A4 print styling', async () => {
  const workers = [{ company: '=1+1', name: '<script>홍길동</script>', trade: '전기' }];
  const roster = createRoster(workers, asOf, asOf);
  const blob = await createExcel(roster, asOf, asOf);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await blob.arrayBuffer());
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell('A1').value, '2026.10.24 고령자 혈압측정');
  assert.equal(sheet.getCell('B3').value, '=1+1');
  assert.equal(sheet.getCell('C3').value, '<script>홍길동</script>');
  assert.equal(sheet.getCell('G13').value, '□예  □아니오');
  assert.equal(sheet.rowCount, 13);
  assert.equal(sheet.getCell('E3').fill.fgColor.argb, 'FFFCE4D6');
  assert.equal(sheet.getCell('F3').fill.fgColor.argb, 'FFFFFFCC');
  assert.equal(sheet.getCell('H3').fill.fgColor.argb, 'FFEBF1DE');
  assert.equal(sheet.pageSetup.paperSize, 9); assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.printTitlesRow, '1:2');
  assert.equal(sheet.pageSetup.printArea, 'A1:H13');
});

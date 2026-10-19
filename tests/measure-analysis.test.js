import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { PDFDocument } from 'pdf-lib';
import { analyzeMeasurePdf, mergeMeasureResults } from '../src/lib/measure-analysis.js';

const empty = () => ({ dust: [], noise: [], workTypes: [], measurements: [], resultRows: [], improvements: [] });
async function pdf(count) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([200 + i, 300]);
  return doc.saveAsBase64();
}

test('129 pages are sent in order, within the batch limit, and all results are merged', async () => {
  const seen = [];
  const source = process.env.MEASURE_TEST_PDF
    ? fs.readFileSync(process.env.MEASURE_TEST_PDF).toString('base64') : await pdf(129);
  const expected = await PDFDocument.load(source);
  let calls = 0;
  const progress = [];
  const result = await analyzeMeasurePdf(source, async (name, body) => {
    assert.equal(name, 'parse-msds');
    assert.equal(body.mode, 'measure');
    const chunk = await PDFDocument.load(body.fileBase64);
    assert.ok(chunk.getPageCount() <= 8);
    seen.push(...chunk.getPages().map(page => page.getWidth()));
    if (process.env.MEASURE_TEST_CHUNKS) {
      fs.writeFileSync(`${process.env.MEASURE_TEST_CHUNKS}/${calls}.pdf`, Buffer.from(body.fileBase64, 'base64'));
    }
    return { result: { ...empty(), dust: [{ process: `공정${++calls}`, measured: '1 mg/m³' }], workTypes: ['공정'] } };
  }, state => progress.push(state));
  assert.deepEqual(seen, expected.getPages().map(page => page.getWidth()));
  assert.equal(calls, Math.ceil(expected.getPageCount() / 8));
  assert.equal(result.dust.length, calls);
  assert.deepEqual(result.workTypes, ['공정']);
  assert.equal(progress.at(-1).completed, expected.getPageCount());
});

test('output truncation splits only the failed range, without losing or duplicating results', async () => {
  const seen = [];
  const result = await analyzeMeasurePdf(await pdf(9), async (_, body) => {
    const chunk = await PDFDocument.load(body.fileBase64);
    if (chunk.getPageCount() > 2) throw Object.assign(new Error('truncated'), { code: 'AI_RESPONSE_TRUNCATED' });
    const dust = chunk.getPages().map(page => ({ process: String(page.getWidth()) }));
    seen.push(...dust.map(row => row.process));
    return { result: { ...empty(), dust } };
  });
  assert.equal(seen.length, 9);
  assert.equal(new Set(seen).size, 9);
  assert.equal(result.dust.length, 9);
});

test('a later failure rejects the full analysis; credential errors are not retried', async () => {
  let calls = 0;
  await assert.rejects(analyzeMeasurePdf(await pdf(17), async () => {
    if (++calls === 2) throw Object.assign(new Error('invalid key'), { code: 'AI_KEY_INVALID' });
    return { result: empty() };
  }), error => error.code === 'AI_KEY_INVALID' && error.message.includes('9~16쪽'));
  assert.equal(calls, 2);
});

test('merge preserves exceeded verdicts, units, and report improvements across parts', () => {
  const rows = status => [{ workType: '용접공', singleStatus: status, mixedStatus: '해당없음', noiseStatus: '미만', exceededMeasurements: status === '초과' ? [{ agent: '분진', measured: { value: '6', unit: 'mg/m³' }, limit: { value: '5', unit: 'mg/m³' } }] : [] }];
  const result = mergeMeasureResults([
    { ...empty(), overview: { siteName: '현장' }, resultRows: rows('초과'), dustExceeded: true },
    { ...empty(), overview: { siteName: '' }, resultRows: rows('미만'), improvements: [{ target: '용접공', method: '국소배기' }] },
  ]);
  assert.equal(result.dustExceeded, true);
  assert.equal(result.resultRows[0].singleStatus, '초과');
  assert.equal(result.aftercare.resultRows[0].exceededMeasurements[0].measured.unit, 'mg/m³');
  assert.equal(result.aftercare.improvements[0].method, '국소배기');
  assert.equal(result.overview.siteName, '현장');
});

test('invalid PDF and empty/malformed analysis cannot become successful reports', async () => {
  await assert.rejects(analyzeMeasurePdf('invalid', () => assert.fail()), /PDF를 읽을 수/);
  await assert.rejects(analyzeMeasurePdf(await pdf(1), async () => ({ result: empty() })), /실제 측정결과/);
  await assert.rejects(analyzeMeasurePdf(await pdf(1), async () => ({ result: {} })), /결과 형식/);
});

test('print document includes its autofit function and executes without reference errors', () => {
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function fitWarningLabels(root'), source.indexOf('// 라벨 목록 →'));
  const markup = vm.runInNewContext(`const warnLabelSize = 'a4'; ${fn}; warningAutoFitPrintScript()`);
  const script = markup.replace(/^<script>/, '').replace(/<\/script>$/, '');
  let ran = false;
  vm.runInNewContext(script, {
    window: { addEventListener: (_, callback) => callback() },
    requestAnimationFrame: callback => callback(),
    document: { querySelectorAll: () => { ran = true; return []; } },
  });
  assert.equal(ran, true);
});

test('providers report token truncation and PDF limits without disabling API keys', async () => {
  const source = fs.readFileSync(new URL('../supabase/functions/parse-msds/index.ts', import.meta.url), 'utf8');
  const executable = transformSync(source.replace(/^import .*;\n/gm, ''), { loader: 'ts', format: 'cjs' }).code;
  for (const [provider, payload] of [['Claude', { stop_reason: 'max_tokens' }], ['OpenAI', { status: 'incomplete' }], ['Gemini', { candidates: [{ finishReason: 'MAX_TOKENS' }] }]]) {
    const context = vm.createContext({ serve() {}, AbortController, setTimeout, clearTimeout, fetch: async () => ({ ok: true, json: async () => payload }) });
    vm.runInContext(executable, context);
    await assert.rejects(vm.runInContext(`call${provider}('test', 'JVBERg==', 'application/pdf', 'extract', 16000, 1000)`, context), error => error.code === 'AI_RESPONSE_TRUNCATED');
    const mapped = vm.runInContext("mapProviderError('claude', { status: 400, detail: 'PDF has 129 pages, maximum 100 pages' })", context);
    assert.equal(mapped.code, 'AI_DOCUMENT_LIMIT');
    assert.equal(mapped.disableCredential, false);
  }
});

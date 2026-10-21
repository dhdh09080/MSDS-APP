import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { PDFDocument } from 'pdf-lib';
import { analyzeMeasurePdf as analyzeImplementation, mergeMeasureResults, planMeasureBatches } from '../src/lib/measure-analysis.js';

const analyzeMeasurePdf = (base64, invoke, progress, options = {}) => analyzeImplementation(base64, invoke, progress, { extractPages: false, ...options });

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
  const source = fs.readFileSync(new URL('../src/lib/warning-print.js', import.meta.url), 'utf8');
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

test('text batches cover every page and never exceed the server input limit', () => {
  const pages = Array.from({ length: 129 }, (_, index) => ({ index, text: 'table '.repeat(230) }));
  const batches = planMeasureBatches(pages);
  assert.ok(batches.length < Math.ceil(129 / 8));
  assert.deepEqual(batches.flatMap(batch => batch.pages.map(page => page.index)), pages.map(page => page.index));
  for (const batch of batches) {
    const body = batch.pages.map(page => `[원본 ${page.index + 1}쪽]\n${page.text}`).join('\n\n');
    assert.ok(body.length <= 24000);
  }
  assert.equal(planMeasureBatches([{ index: 0, text: 'a'.repeat(23990) }])[0].kind, 'pdf');
});

test('text analysis uses two requests at most and merges in page order after out-of-order replies', async () => {
  let active = 0, peak = 0, calls = 0;
  const count = 9;
  const result = await analyzeMeasurePdf(await pdf(count), async (_, body) => {
    assert.equal(body.fileBase64, undefined);
    assert.equal(body.mode, 'measure');
    const index = Number(body.documentText.match(/원본 (\d+)쪽/)[1]);
    calls++; peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, index === 1 ? 30 : 2));
    active--;
    return { result: { ...empty(), dust: [{ process: String(index) }] } };
  }, undefined, { extractPages: async () => Array.from({ length: count }, (_, index) => ({ index, text: 'x'.repeat(13000) })) });
  assert.equal(calls, count);
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(result.dust.map(row => row.process), Array.from({ length: count }, (_, i) => String(i + 1)));
});

test('mixed text and scanned pages use the correct transport without dropping scans', async () => {
  const seen = [];
  const result = await analyzeMeasurePdf(await pdf(3), async (_, body) => {
    const isText = typeof body.documentText === 'string';
    seen.push(isText ? 'text' : 'pdf');
    if (!isText) {
      const doc = await PDFDocument.load(body.fileBase64);
      assert.equal(doc.getPageCount(), 1);
      assert.equal(doc.getPage(0).getWidth(), 201);
    }
    return { result: { ...empty(), dust: [{ process: isText ? body.documentText : 'scan' }] } };
  }, undefined, { extractPages: async () => [{ index: 0, text: 'first' }, { index: 1, text: null }, { index: 2, text: 'last' }] });
  assert.equal(seen.filter(kind => kind === 'text').length, 2);
  assert.equal(seen.filter(kind => kind === 'pdf').length, 1);
  assert.equal(result.dust[1].process, 'scan');
});

test('text-layer failure falls back to the complete PDF and parallel failure stops queued work', async () => {
  let calls = 0, active = 0;
  await assert.rejects(analyzeMeasurePdf(await pdf(33), async (_, body) => {
    assert.ok(body.fileBase64);
    const index = ++calls; active++;
    await new Promise(resolve => setTimeout(resolve, index === 1 ? 2 : 20));
    active--;
    if (index === 1) throw Object.assign(new Error('quota'), { code: 'AI_MONTHLY_LIMIT' });
    return { result: empty() };
  }, undefined, { extractPages: async () => { throw new Error('font/worker failed'); } }), error => error.code === 'AI_MONTHLY_LIMIT');
  assert.equal(calls, 2);
  assert.equal(active, 0);
});

test('all providers send extracted report text as text and server rejects oversized input', async () => {
  const source = fs.readFileSync(new URL('../supabase/functions/parse-msds/index.ts', import.meta.url), 'utf8');
  const executable = transformSync(source.replace(/^import .*;\n/gm, ''), { loader: 'ts', format: 'cjs' }).code;
  for (const provider of ['Claude', 'OpenAI', 'Gemini']) {
    let request;
    const context = vm.createContext({ serve() {}, AbortController, TextEncoder, setTimeout, clearTimeout, fetch: async (_, init) => {
      request = JSON.parse(init.body);
      return { ok: true, json: async () => ({ content: [{ text: '{}' }], output_text: '{}', candidates: [{ content: { parts: [{ text: '{}' }] } }] }) };
    } });
    vm.runInContext(executable, context);
    await vm.runInContext(`call${provider}('test', '[원본 1쪽] 측정치 0.9504 mg/m³', 'text/plain', 'extract', 16000, 1000)`, context);
    const serialized = JSON.stringify(request);
    assert.ok(serialized.includes('0.9504 mg/m³'));
    assert.ok(!serialized.includes('inline_data') && !serialized.includes('input_file') && !serialized.includes('base64'));
    assert.equal(vm.runInContext("validateMeasureText('a'.repeat(24001)).code", context), 'DOCUMENT_TEXT_INVALID');
    assert.equal(vm.runInContext("validateMeasureText('측정치').mediaType", context), 'text/plain');
  }
});

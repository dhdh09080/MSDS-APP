import { PDFDocument } from 'pdf-lib';

// Required PDF operations load with the page, so an open tab can still analyze
// after a new deployment removes the previous deployment's lazy chunks.
// Keep PDF requests small enough for page, context and output limits.
export const MEASURE_BATCH_PAGES = 8;
export const MEASURE_TEXT_CHARS = 24000;
const SPLITTABLE_ERRORS = new Set(['AI_RESPONSE_TRUNCATED', 'AI_RESPONSE_INVALID', 'AI_DOCUMENT_LIMIT', 'AI_PROVIDER_TIMEOUT', 'AI_DEADLINE_EXCEEDED']);

export function mergeMeasureResults(parts) {
  const result = { dust: [], noise: [], workTypes: [], measurements: [], resultRows: [], improvements: [], overview: {} };
  const rank = { '해당없음': 0, '미만': 1, '초과': 2 };
  for (const part of parts) {
    if (!part || !Array.isArray(part.dust) || !Array.isArray(part.noise) || !Array.isArray(part.workTypes)) {
      throw new Error('측정 분석 결과 형식이 올바르지 않습니다. 다시 분석해주세요.');
    }
    for (const key of ['dust', 'noise', 'measurements', 'improvements']) {
      result[key].push(...(part[key] || (key === 'improvements' ? part.aftercare?.improvements : []) || []));
    }
    result.workTypes.push(...part.workTypes);
    for (const [key, value] of Object.entries(part.overview || part.aftercare?.overview || {})) {
      if (value && !result.overview[key]) result.overview[key] = value;
    }
    for (const row of part.resultRows || part.aftercare?.resultRows || []) {
      const previous = row.workType && result.resultRows.find(item => item.workType === row.workType);
      if (!previous) result.resultRows.push({ ...row, exceededMeasurements: [...(row.exceededMeasurements || [])] });
      else {
        for (const key of ['singleStatus', 'mixedStatus', 'noiseStatus']) {
          if ((rank[row[key]] ?? 0) > (rank[previous[key]] ?? 0)) previous[key] = row[key];
        }
        previous.exceededMeasurements.push(...(row.exceededMeasurements || []));
      }
    }
    for (const key of ['dustExceeded', 'noiseExceeded', 'mixedExceeded']) result[key] = !!result[key] || part[key] === true;
  }
  result.workTypes = [...new Set(result.workTypes)];
  // The report can repeat results in its detailed tables and evaluation section.
  for (const key of ['dust', 'noise', 'measurements', 'improvements']) {
    const seen = new Set();
    result[key] = result[key].filter(row => {
      const identity = JSON.stringify(Object.keys(row).filter(k => k !== 'no').sort().map(k => [k, row[k]]));
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    }).map((row, i) => ({ ...row, no: i + 1 }));
  }
  result.resultRows = result.resultRows.map((row, i) => ({ ...row, no: i + 1 }));
  for (const [flag, status] of [['dustExceeded', 'singleStatus'], ['noiseExceeded', 'noiseStatus'], ['mixedExceeded', 'mixedStatus']]) {
    result[flag] ||= result.resultRows.some(row => row[status] === '초과');
  }
  result.aftercare = { overview: result.overview, resultRows: result.resultRows, improvements: result.improvements };
  return result;
}

export function planMeasureBatches(pages) {
  const batches = [];
  for (const page of pages) {
    const kind = page.text && page.text.length + 40 <= MEASURE_TEXT_CHARS ? 'text' : 'pdf';
    const previous = batches.at(-1);
    if (previous?.kind === kind && (kind === 'text'
      ? previous.chars + page.text.length + 40 <= MEASURE_TEXT_CHARS
      : previous.pages.length < MEASURE_BATCH_PAGES)) {
      previous.pages.push(page);
      previous.chars += (page.text?.length || 0) + 40;
    } else batches.push({ kind, pages: [page], chars: (page.text?.length || 0) + 40 });
  }
  return batches;
}

export async function analyzeMeasurePdf(base64, invoke, onProgress = () => {}, options = {}) {
  if (base64.length * 0.75 > 20 * 1024 * 1024) throw new Error('파일은 20MB 이하여야 합니다.');
  let document;
  try { document = await PDFDocument.load(base64); }
  catch { throw new Error('PDF를 읽을 수 없습니다. 암호를 해제하거나 정상적인 PDF 파일을 선택해주세요.'); }
  const pageCount = document.getPageCount();
  if (!pageCount) throw new Error('PDF에 분석할 페이지가 없습니다.');
  let pages = Array.from({ length: pageCount }, (_, index) => ({ index, text: null }));
  if (options.extractPages !== false) {
    onProgress({ phase: 'extract', completed: 0, total: pageCount });
    try {
      const extract = options.extractPages || (await import('./measure-pdf-text.js')).extractMeasurePages;
      const extracted = await extract(base64, onProgress);
      if (extracted.length === pageCount && extracted.every((page, i) => page.index === i)) pages = extracted;
    } catch { /* Keep the original PDF route when the text layer/worker is unavailable. */ }
  }
  const batches = planMeasureBatches(pages);
  let completed = 0, next = 0, failure = null;
  async function analyzeBatch(batch) {
    if (failure) throw failure;
    const from = batch.pages[0].index + 1, to = batch.pages.at(-1).index + 1;
    onProgress({ phase: 'analyze', completed, total: pageCount, from, to });
    let payload;
    if (batch.kind === 'text') {
      payload = { documentText: batch.pages.map(page => `[원본 ${page.index + 1}쪽]\n${page.text}`).join('\n\n'), mode: 'measure' };
    } else {
      const pdf = await PDFDocument.create();
      const copied = await pdf.copyPages(document, batch.pages.map(page => page.index));
      copied.forEach(page => pdf.addPage(page));
      // Deterministic metadata keeps successful batch caches reusable on retries.
      pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0));
      payload = { fileBase64: await pdf.saveAsBase64(), mediaType: 'application/pdf', mode: 'measure' };
    }
    try {
      const response = await invoke('parse-msds', payload);
      // Validate before adding: a failed part must never become a complete report.
      mergeMeasureResults([response?.result]);
      completed += batch.pages.length;
      onProgress({ phase: 'analyze', completed, total: pageCount, from, to });
      return [{ index: from, result: response.result }];
    } catch (error) {
      if (batch.pages.length > 1 && SPLITTABLE_ERRORS.has(error.code)) {
        const middle = Math.floor(batch.pages.length / 2);
        const left = await analyzeBatch({ ...batch, pages: batch.pages.slice(0, middle) });
        const right = await analyzeBatch({ ...batch, pages: batch.pages.slice(middle) });
        return [...left, ...right];
      }
      failure = new Error(`${from}~${to}쪽 분석 실패: ${error.message}`);
      failure.code = error.code;
      throw failure;
    }
  }
  async function worker() {
    const results = [];
    while (!failure && next < batches.length) results.push(...await analyzeBatch(batches[next++]));
    return results;
  }
  const settled = await Promise.allSettled(Array.from({ length: Math.min(options.concurrency || 2, 2, batches.length) }, worker));
  const rejected = settled.find(item => item.status === 'rejected');
  if (rejected) throw failure || rejected.reason;
  const parts = settled.flatMap(item => item.value).sort((a, b) => a.index - b.index);
  onProgress({ phase: 'complete', completed: pageCount, total: pageCount });
  const result = mergeMeasureResults(parts.map(part => part.result));
  if (!result.dust.length && !result.noise.length && !result.measurements.length) {
    throw new Error('PDF에서 실제 측정결과를 찾지 못했습니다. 측정결과표가 포함된 보고서인지 확인해주세요.');
  }
  return result;
}

// Keep PDF requests small enough for page, context and output limits.
export const MEASURE_BATCH_PAGES = 8;
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

export async function analyzeMeasurePdf(base64, invoke, onProgress = () => {}) {
  if (base64.length * 0.75 > 20 * 1024 * 1024) throw new Error('파일은 20MB 이하여야 합니다.');
  const { PDFDocument } = await import('pdf-lib');
  let document;
  try { document = await PDFDocument.load(base64); }
  catch { throw new Error('PDF를 읽을 수 없습니다. 암호를 해제하거나 정상적인 PDF 파일을 선택해주세요.'); }
  const pageCount = document.getPageCount();
  if (!pageCount) throw new Error('PDF에 분석할 페이지가 없습니다.');
  const parts = [];
  async function analyzeRange(start, end) {
    onProgress({ completed: start, total: pageCount, from: start + 1, to: end });
    const batch = await PDFDocument.create();
    const pages = await batch.copyPages(document, Array.from({ length: end - start }, (_, i) => start + i));
    pages.forEach(page => batch.addPage(page));
    try {
      const response = await invoke('parse-msds', {
        fileBase64: await batch.saveAsBase64(), mediaType: 'application/pdf', mode: 'measure',
      });
      // Validate before adding: a failed part must never become a complete report.
      mergeMeasureResults([response?.result]);
      parts.push(response.result);
    } catch (error) {
      if (end - start > 1 && SPLITTABLE_ERRORS.has(error.code)) {
        const middle = Math.floor((start + end) / 2);
        await analyzeRange(start, middle);
        await analyzeRange(middle, end);
        return;
      }
      const failure = new Error(`${start + 1}~${end}쪽 분석 실패: ${error.message}`);
      failure.code = error.code;
      throw failure;
    }
  }
  for (let start = 0; start < pageCount; start += MEASURE_BATCH_PAGES) {
    await analyzeRange(start, Math.min(start + MEASURE_BATCH_PAGES, pageCount));
  }
  onProgress({ completed: pageCount, total: pageCount });
  const result = mergeMeasureResults(parts);
  if (!result.dust.length && !result.noise.length && !result.measurements.length) {
    throw new Error('PDF에서 실제 측정결과를 찾지 못했습니다. 측정결과표가 포함된 보고서인지 확인해주세요.');
  }
  return result;
}

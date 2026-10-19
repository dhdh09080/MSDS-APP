const normalize = value => String(value).replace(/\s+/g, '').toLowerCase();
const number = value => /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null;
const statusRank = { '해당없음': 0, '미만': 1, '초과': 2 };
const quantity = /^(\d+(?:\.\d+)?|불검출|검출한계\s*미만)\s*(dB\(A\)|㎎\/㎥|mg\/m[³3]|㎍\/㎥|[µu]g\/m[³3]|ppm|ppb)?/i;
const unsupported = () => Object.assign(new Error('이 보고서는 빠른 분석으로 전체 수치·단위·판정을 확인할 수 없습니다. AI 정밀 분석을 선택해주세요.'), { code: 'MEASURE_LOCAL_UNSUPPORTED' });

function parseQuantity(value, fallbackUnit = '') {
  const match = value.trim().match(quantity);
  const unit = (match?.[2] || fallbackUnit).replace('㎎/㎥', 'mg/m³').replace('㎍/㎥', 'µg/m³').replace(/([muµ]g)\/m3/i, '$1/m³');
  return match ? { value: match[1].replace(/\s+/g, ' '), unit } : null;
}

function processName(raw, job) {
  const compact = String(raw).replace(/\s+/g, '');
  const short = String(job).replace(/\s+/g, '');
  for (let count = short.length; count > 0; count--) {
    if (compact.endsWith(short.slice(0, count))) return `${compact.slice(0, -count)} ${short}`.trim();
  }
  return `${raw} ${job}`.replace(/\s+/g, ' ').trim();
}

function reportLimits(pages) {
  const limits = new Map();
  for (const page of pages) {
    if (!page.text?.includes('최고노출수준')) continue;
    const lines = page.text.split('\n');
    const header = lines.findIndex(line => line.includes('유해인자') && line.includes('최고노출수준'));
    for (const line of lines.slice(header + 1)) {
      const cells = line.split('|').map(cell => cell.trim());
      if (cells.length < 4 || !['미만', '초과'].includes(cells.at(-1))) continue;
      const agent = cells[0];
      const mixed = /혼합.*(?:Em|EM)/i.test(agent);
      const measured = parseQuantity(cells[1], mixed ? 'Em' : '');
      let limit;
      for (let i = cells.length - 2; i > 1; i--) {
        const candidate = parseQuantity(cells[i], measured?.unit || '');
        if (candidate && number(candidate.value) !== null) { limit = candidate; break; }
      }
      if (!measured?.unit || !limit?.unit || number(limit.value) === null) throw unsupported();
      const value = number(measured.value), threshold = number(limit.value);
      if (value !== null && ((value > threshold && cells.at(-1) !== '초과') || (value < threshold && cells.at(-1) === '초과'))) throw unsupported();
      const detail = cells.slice(1, -1).join(' ').slice(cells[1].match(quantity)?.[0].length || 0);
      const process = detail.slice(detail.indexOf('(') + 1, detail.lastIndexOf(')')).trim();
      limits.set(normalize(agent), { agent, measured, limit, page: page.index + 1, mixed, process, status: cells.at(-1) });
    }
  }
  return limits;
}

function improvementsFromReport(pages) {
  const result = [];
  let topic = '', block = null, general = false;
  const flush = () => {
    if (block?.lines.length) result.push({ no: result.length + 1, target: block.target, method: block.lines.join('\n'), assignee: '', source: '보고서 기재', page: block.page });
    block = null;
  };
  for (const page of pages) {
    if (!/3-2\.\s*문제점\s*및\s*개선대책/.test(page.text || '')) continue;
    for (const raw of page.text.split('\n')) {
      const line = raw.replace(/\s*\|\s*/g, ' ').trim();
      if (!line || /^3\.\s*측정\s*결과|^3-2\.|^[-ㅡ─]{5}/.test(line)) continue;
      const chemical = line.match(/^-\s*([^:]+):/);
      if (chemical) { flush(); topic = chemical[1]; }
      if (/^▣\s*대\s*책/.test(line)) { flush(); general = true; }
      const sub = line.match(/^☞\s*(취급방법|저장방법|노출감소\s*방법|응급조치\s*요령)/);
      if (sub) {
        flush();
        block = { target: `${topic || '유해물질'} · ${sub[1]}`, page: page.index + 1, lines: [] };
      } else if (/^☞/.test(line)) flush();
      else if (general) {
        if (/^[○■▣]|^\d+[)\.]/.test(line) || !block) {
          flush();
          block = { target: `현장 보건관리 (보고서 ${page.index + 1}쪽)`, page: page.index + 1, lines: [] };
        }
        block.lines.push(line);
      } else if (block) block.lines.push(line.replace(/^:\s*/, ''));
    }
  }
  flush();
  return result;
}

// Only accept reports whose evaluation rows and stated maximums reconcile.
// Unknown layouts return an explicit choice of AI analysis rather than guessed values.
export function parseLocalMeasureReport(pages) {
  if (!pages.length || pages.some(page => !page.text)) throw unsupported();
  const limits = reportLimits(pages);
  if (!limits.size) throw unsupported();
  const sourceRows = { noise: [], single: [], mixed: [] };
  const samples = new Map();
  let category = null, previousProcess = '', previousJob = '';
  for (const page of pages) {
    if (!/3-1\.\s*측정결과의\s*평가/.test(page.text)) continue;
    const lines = page.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\[\s*소음\s*\]/.test(line)) category = 'noise';
      if (/\[\s*단일물질\s*\]/.test(line)) category = 'single';
      if (/\[\s*혼합유기화합물\s*\]/.test(line)) category = 'mixed';
      if (!/^\d+\s*\|/.test(line)) continue;
      if (!category) throw unsupported();
      const cells = line.split('|').map(cell => cell.trim());
      const sampleAt = cells.findIndex(cell => /^\*\d+(?:\s|$)/.test(cell));
      const status = cells.at(-1);
      if (sampleAt < 1 || !['미만', '초과'].includes(status)) throw unsupported();
      const sampleId = cells[sampleAt].match(/^\*(\d+)/)[1];
      const before = cells.slice(1, sampleAt);
      let reference;
      if (category === 'noise') {
        if (before.length) {
          previousJob = before.at(-1);
          const prefix = before.length > 1 ? before[0] : /공사/.test(lines[i - 1] || '') ? lines[i - 1] : '';
          if (!prefix) throw unsupported();
          previousProcess = processName(prefix, previousJob);
        }
        if (!previousProcess) throw unsupported();
        samples.set(sampleId, { process: previousProcess, job: previousJob });
        const measured = parseQuantity(cells[sampleAt + 1]);
        const limit = parseQuantity(cells[sampleAt + 2], measured?.unit);
        reference = { agent: '소음', measured, limit };
      } else {
        const agentKey = category === 'mixed' ? [...limits.keys()].find(key => limits.get(key).mixed) : normalize(before.at(-1) || '');
        const candidates = [...limits.keys()].filter(key => key === agentKey || (agentKey.length >= 4 && key.startsWith(agentKey)));
        if (candidates.length !== 1) throw unsupported();
        const entry = limits.get(candidates[0]);
        reference = { agent: entry.agent, measured: parseQuantity(cells[sampleAt + 1], entry.limit.unit), limit: entry.limit };
      }
      const location = samples.get(sampleId);
      if (!location || !reference.measured?.unit || !reference.limit?.unit) throw unsupported();
      const value = number(reference.measured.value), limitValue = number(reference.limit.value);
      if (value !== null && limitValue !== null && ((value > limitValue && status !== '초과') || (value < limitValue && status === '초과'))) throw unsupported();
      sourceRows[category].push({ no: Number(cells[0]), sampleId, category, process: location.process, workType: location.process, ...reference, status, page: page.index + 1, reason: `보고서 ${page.index + 1}쪽 판정 · 노출기준은 보고서 요약표 기준` });
    }
  }
  const measurements = Object.values(sourceRows).flat();
  if (!measurements.length) throw unsupported();
  for (const rows of Object.values(sourceRows)) {
    if (rows.some((row, index) => row.no !== index + 1)) throw unsupported();
  }
  for (const entry of limits.values()) {
    const rows = measurements.filter(row => normalize(row.agent) === normalize(entry.agent));
    if (!rows.length) {
      // Mixed-exposure components may only appear in the report's maximum table.
      // Keep them explicitly marked as maximums, never as invented sample results.
      if (!entry.process) throw unsupported();
      measurements.push({ no: null, sampleId: '', category: entry.mixed ? 'mixed' : 'single', process: entry.process, workType: entry.process, agent: entry.agent, measured: entry.measured, limit: entry.limit, status: entry.status, page: entry.page, summaryOnly: true, reason: `보고서 ${entry.page}쪽 최고측정치 요약 (개별 시료값 아님)` });
      continue;
    }
    const maximum = number(entry.measured.value);
    const values = rows.map(row => number(row.measured.value)).filter(value => value !== null);
    if (maximum !== null && (!values.length || Math.abs(Math.max(...values) - maximum) > 0.0000001)) throw unsupported();
  }
  const resultRows = new Map();
  for (const row of measurements) {
    if (!resultRows.has(row.workType)) resultRows.set(row.workType, { no: resultRows.size + 1, workType: row.workType, singleStatus: '해당없음', mixedStatus: '해당없음', noiseStatus: '해당없음', exceededMeasurements: [] });
    const target = resultRows.get(row.workType), field = `${row.category}Status`;
    if (statusRank[row.status] > statusRank[target[field]]) target[field] = row.status;
    if (row.status === '초과') target.exceededMeasurements.push({ agent: row.agent, measured: row.measured, limit: row.limit });
  }
  const displayRow = (row, i) => ({ no: i + 1, sampleId: row.sampleId, process: row.process, agent: row.agent, measured: `${row.measured.value} ${row.measured.unit}`, limit: `${row.limit.value} ${row.limit.unit}`, reason: row.reason });
  const improvements = improvementsFromReport(pages);
  if (!improvements.length) throw unsupported();
  return {
    measurements, dust: measurements.filter(row => row.category !== 'noise').map(displayRow), noise: sourceRows.noise.map(displayRow),
    workTypes: [...resultRows.keys()], resultRows: [...resultRows.values()], improvements,
    dustExceeded: measurements.some(row => row.category === 'single' && row.status === '초과'), mixedExceeded: measurements.some(row => row.category === 'mixed' && row.status === '초과'), noiseExceeded: sourceRows.noise.some(row => row.status === '초과'),
    aftercare: { analysisMethod: 'local', overview: {}, resultRows: [...resultRows.values()], improvements, extraction: { evaluationRows: Object.values(sourceRows).reduce((count, rows) => count + rows.length, 0), summaryRows: measurements.filter(row => row.summaryOnly).length } },
  };
}

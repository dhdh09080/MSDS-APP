const BORDER = { style: 'single', size: 4, color: '3F3F46' };
const NO_BORDER = { style: 'nil', size: 0, color: 'FFFFFF' };

function safeText(value) {
  return String(value ?? '').trim();
}

function statusText(value) {
  return ['미만', '초과', '해당없음'].includes(value) ? value : '해당없음';
}

function unitValue(part) {
  const value = safeText(part?.value);
  const unit = safeText(part?.unit);
  return value && unit ? `${value} ${unit}` : '';
}

function assertExceededUnits(rows) {
  const unitPattern = /(mg|µg|ug|ppm|ppb|dB|개|f|m|cm|mm|%|℃|lux|L)(\s*[/·^³²()A-Za-z가-힣0-9-]*)?/i;
  rows.forEach((row, rowIndex) => {
    const exceeded = [row.singleStatus, row.mixedStatus, row.noiseStatus].includes('초과');
    const details = Array.isArray(row.exceededMeasurements) ? row.exceededMeasurements : [];
    if (exceeded && details.length === 0) throw new Error(`${rowIndex + 1}번 공종의 초과 유해물질 정보가 없습니다.`);
    details.forEach(item => {
      if (!safeText(item.agent) || !safeText(item.measured?.value) || !safeText(item.limit?.value)
        || !unitPattern.test(safeText(item.measured?.unit)) || !unitPattern.test(safeText(item.limit?.unit))) {
        throw new Error(`${rowIndex + 1}번 공종의 초과 측정치 또는 기준치 단위가 누락됐습니다.`);
      }
    });
  });
}

export async function createMeasureAftercareDocx(data) {
  const docx = await import('docx');
  const {
    AlignmentType, BorderStyle, Document, HeightRule, Packer, PageBreak, PageOrientation,
    Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
  } = docx;
  BORDER.style = BorderStyle.SINGLE;
  NO_BORDER.style = BorderStyle.NIL;

  const aftercare = data.aftercare || {};
  const resultRows = Array.isArray(aftercare.resultRows) ? aftercare.resultRows : [];
  const improvements = Array.isArray(aftercare.improvements) ? aftercare.improvements : [];
  assertExceededUnits(resultRows);

  const borders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER };
  const font = 'Arial';
  const paragraph = (text, options = {}) => new Paragraph({
    alignment: options.alignment || AlignmentType.CENTER,
    spacing: { before: 0, after: 0, line: options.line || 240 },
    children: [new TextRun({ text: safeText(text), font, size: options.size || 18, bold: Boolean(options.bold), color: options.color || '111827' })],
  });
  const cell = (text, options = {}) => new TableCell({
    width: options.width ? { size: options.width, type: WidthType.DXA } : undefined,
    columnSpan: options.columnSpan,
    rowSpan: options.rowSpan,
    verticalAlign: VerticalAlign.CENTER,
    shading: options.fill ? { fill: options.fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 90, bottom: 90, left: 90, right: 90 },
    borders,
    children: [paragraph(text, { bold: options.bold, size: options.size, alignment: options.alignment })],
  });
  const sectionTitle = text => new Paragraph({
    spacing: { before: 260, after: 100 }, keepNext: true,
    children: [new TextRun({ text, font, size: 22, bold: true, color: '111827' })],
  });
  const table = (rows, widths) => new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: widths,
    rows,
  });
  const formatDate = value => {
    const raw = safeText(value);
    if (!raw) return '';
    const date = new Date(`${raw.substring(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const overview = aftercare.overview || {};
  const siteName = safeText(data.siteName || overview.siteName);
  const resultRowsForDoc = resultRows.length ? resultRows : [{ no: 1, workType: '확인 필요', singleStatus: '해당없음', mixedStatus: '해당없음', noiseStatus: '해당없음', exceededMeasurements: [] }];
  const resultTableRows = [
    new TableRow({ tableHeader: true, children: [
      cell('구분', { width: 600, rowSpan: 2, bold: true, fill: 'EEECE1' }),
      cell('대상 공종', { width: 1800, rowSpan: 2, bold: true, fill: 'EEECE1' }),
      cell('노출기준 초과여부\n(미만/초과/해당없음)', { columnSpan: 3, bold: true, fill: 'EEECE1' }),
      cell('초과시', { columnSpan: 2, bold: true, fill: 'EEECE1' }),
    ] }),
    new TableRow({ tableHeader: true, children: [
      cell('단일물질', { width: 1100, bold: true, fill: 'EEECE1' }),
      cell('혼합유기\n화합물', { width: 1450, bold: true, fill: 'EEECE1' }),
      cell('소음', { width: 900, bold: true, fill: 'EEECE1' }),
      cell('초과 유해물질', { width: 1450, bold: true, fill: 'EEECE1' }),
      cell('측정치/기준치', { width: 1700, bold: true, fill: 'EEECE1' }),
    ] }),
    ...resultRowsForDoc.map((row, index) => {
      const exceeded = Array.isArray(row.exceededMeasurements) ? row.exceededMeasurements : [];
      const agents = exceeded.map(item => safeText(item.agent)).filter(Boolean).join('\n');
      const values = exceeded.map(item => `${unitValue(item.measured)} / ${unitValue(item.limit)}`).filter(Boolean).join('\n');
      return new TableRow({ cantSplit: true, children: [
        cell(row.no || index + 1, { width: 600 }), cell(row.workType, { width: 1800 }),
        cell(statusText(row.singleStatus), { width: 1100 }), cell(statusText(row.mixedStatus), { width: 1450 }),
        cell(statusText(row.noiseStatus), { width: 900 }), cell(agents, { width: 1450 }), cell(values, { width: 1700 }),
      ] });
    }),
  ];

  const improvementRows = improvements.length ? improvements : [{ no: 1, target: '보고서의 문제점 및 개선대책 확인 필요', method: '원본 보고서를 확인하여 개선대책을 입력하세요.', assignee: '' }];
  const improvementTableRows = [
    new TableRow({ tableHeader: true, children: [
      cell('구분', { width: 600, bold: true, fill: 'EEECE1' }), cell('개선대상', { width: 2300, bold: true, fill: 'EEECE1' }),
      cell('개선방법', { width: 4700, bold: true, fill: 'EEECE1' }), cell('담당자', { width: 1400, bold: true, fill: 'EEECE1' }),
    ] }),
    ...improvementRows.map((item, index) => new TableRow({ cantSplit: true, children: [
      cell(item.no || index + 1, { width: 600 }), cell(item.target, { width: 2300 }),
      cell(item.method, { width: 4700 }), cell(item.assignee || data.defaultAssignee, { width: 1400 }),
    ] })),
  ];

  const children = [
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 80 }, children: [new TextRun({ text: '[별첨2]  * 작업환경측정 결과 수신 후 1개월 이내 작성', font, size: 16, color: '4B5563' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 220 }, children: [new TextRun({ text: '작업환경측정 사후관리 결과', font, size: 30, bold: true })] }),
    sectionTitle('1. 개요'),
    table([
      new TableRow({ children: [cell('현장명', { width: 1400, bold: true, fill: 'EEECE1' }), cell(siteName, { width: 3100 }), cell('작성일자', { width: 1400, bold: true, fill: 'EEECE1' }), cell(formatDate(data.createdDate), { width: 3100 })] }),
      new TableRow({ children: [cell('작업환경측정\n실시일자', { width: 1400, bold: true, fill: 'EEECE1' }), cell(safeText(data.period || overview.measurementPeriod), { width: 3100 }), cell('결과수신일자', { width: 1400, bold: true, fill: 'EEECE1' }), cell(formatDate(data.receivedDate || overview.receivedDate), { width: 3100 })] }),
    ], [1400, 3100, 1400, 3100]),
    sectionTitle('2. 측정결과'),
    table(resultTableRows, [600, 1800, 1100, 1450, 900, 1450, 1700]),
    sectionTitle('3. 개선대책'),
    table(improvementTableRows, [600, 2300, 4700, 1400]),
    new Paragraph({ spacing: { before: 90, after: 60 }, children: [new TextRun({ text: '※ 작업환경측정 결과서에 기재된 문제점 및 개선대책은 노출기준 초과 여부와 관계없이 이행해야 합니다.', font, size: 16, color: '374151' })] }),
    new Paragraph({ children: [new TextRun({ text: '※ AI 분석 결과는 검토용 초안입니다. 측정 보고서 원문과 단위·판정·개선대책을 확인한 뒤 사용하세요.', font, size: 16, bold: true, color: 'B45309' })] }),
    new Paragraph({ children: [new PageBreak()] }),
    sectionTitle('4. 개선대책 결과'),
    table(Array.from({ length: 3 }, (_, index) => new TableRow({
      height: { value: 2300, rule: HeightRule.ATLEAST },
      children: [cell(index === 0 ? '개선 전 사진' : '', { width: 4500, size: 16, color: '6B7280' }), cell(index === 0 ? '개선 후 사진' : '', { width: 4500, size: 16, color: '6B7280' })],
    })), [4500, 4500]),
  ];

  const document = new Document({
    styles: { default: { document: { run: { font, size: 18 }, paragraph: { spacing: { after: 0, line: 240 } } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT }, margin: { top: 1700, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });
  return Packer.toBlob(document);
}

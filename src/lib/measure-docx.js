import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { buildMeasureAftercare } from './measure-aftercare.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const direct = (node, name) => Array.from(node.childNodes || []).filter(child => child.namespaceURI === W && child.localName === name);
const descendants = (node, name) => Array.from(node.getElementsByTagNameNS(W, name));
const content = node => descendants(node, 't').map(item => item.textContent).join('');
const safe = value => String(value ?? '').trim();

function setCellText(cell, value, align) {
  const doc = cell.ownerDocument;
  const oldParagraph = direct(cell, 'p')[0];
  const pPr = oldParagraph && direct(oldParagraph, 'pPr')[0]?.cloneNode(true);
  const rPr = oldParagraph && descendants(oldParagraph, 'rPr')[0]?.cloneNode(true);
  for (const child of Array.from(cell.childNodes)) if (!(child.namespaceURI === W && child.localName === 'tcPr')) cell.removeChild(child);
  const paragraph = doc.createElementNS(W, 'w:p');
  if (pPr) paragraph.appendChild(pPr);
  if (align) {
    const properties = pPr || doc.createElementNS(W, 'w:pPr');
    if (!pPr) paragraph.appendChild(properties);
    let jc = direct(properties, 'jc')[0];
    if (!jc) { jc = doc.createElementNS(W, 'w:jc'); properties.appendChild(jc); }
    jc.setAttributeNS(W, 'w:val', align);
  }
  safe(value).split('\n').forEach((line, index) => {
    const run = doc.createElementNS(W, 'w:r');
    if (rPr) run.appendChild(rPr.cloneNode(true));
    if (index) run.appendChild(doc.createElementNS(W, 'w:br'));
    const text = doc.createElementNS(W, 'w:t'); text.setAttribute('xml:space', 'preserve'); text.textContent = line;
    run.appendChild(text); paragraph.appendChild(run);
  });
  cell.appendChild(paragraph);
}

function fillRow(prototype, values, alignments = {}) {
  const row = prototype.cloneNode(true);
  for (const name of ['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference']) for (const marker of descendants(row, name)) marker.parentNode.removeChild(marker);
  direct(row, 'tc').forEach((cell, i) => setCellText(cell, values[i] || '', alignments[i]));
  return row;
}

function formatDate(value) {
  const match = safe(value).match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  return match ? `${match[1]}.${match[2].padStart(2, '0')}.${match[3].padStart(2, '0')}` : safe(value);
}

function formatPeriod(value) {
  const parts = safe(value).split(/\s*[~∼]\s*/);
  if (parts.length !== 2) return safe(value);
  const from = formatDate(parts[0]), to = formatDate(parts[1]);
  return `${from} ~ ${from.slice(0, 4) === to.slice(0, 4) ? to.slice(5) : to}`;
}

function exceededText(row) {
  const agents = [], values = [];
  const exceeded = [row.singleStatus, row.mixedStatus, row.noiseStatus].includes('초과');
  if (exceeded && !row.exceededMeasurements?.length) throw new Error(`${row.workType}의 초과 측정값을 확인해주세요.`);
  for (const item of row.exceededMeasurements || []) {
    if (!safe(item.agent) || !safe(item.measured?.value) || !safe(item.measured?.unit) || !safe(item.limit?.value) || !safe(item.limit?.unit)) throw new Error(`${row.workType}의 초과 측정값과 단위를 확인해주세요.`);
    agents.push(item.agent); values.push(`${item.measured.value} ${item.measured.unit} / ${item.limit.value} ${item.limit.unit}`);
  }
  return [agents.join('\n'), values.join('\n')];
}

export async function createMeasureAftercareDocx(data, { templateBytes } = {}) {
  if (!templateBytes) {
    const response = await fetch('/templates/measure-aftercare-v1.docx');
    if (!response.ok) throw new Error('사후관리 원본 양식을 불러오지 못했습니다. 다시 시도해주세요.');
    templateBytes = await response.arrayBuffer();
  }
  const zip = await JSZip.loadAsync(templateBytes);
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = descendants(doc, 'body')[0];
  const tables = direct(body, 'tbl');
  const table = tables[0];
  const original = direct(table, 'tr');
  const summary = buildMeasureAftercare(data);
  if (!summary.resultRows.length) throw new Error('측정결과가 없습니다. 보고서를 먼저 분석해주세요.');
  const overview = summary.overview || {};
  const overviewCells = direct(original[2], 'tc'), periodCells = direct(original[3], 'tc');
  setCellText(overviewCells[1], data.siteName || overview.siteName || '');
  setCellText(overviewCells[3], formatDate(data.createdDate));
  setCellText(periodCells[1], formatPeriod(data.period || overview.measurementPeriod));
  setCellText(periodCells[3], formatDate(data.receivedDate || overview.receivedDate));
  const improvementHeading = original.findIndex(row => content(row).replace(/\s/g, '') === '3.개선대책');
  const resultPrototype = original[7];
  for (const row of original.slice(7, improvementHeading)) table.removeChild(row);
  for (const row of summary.resultRows) table.insertBefore(fillRow(resultPrototype, [String(row.no), row.workType, row.singleStatus, row.mixedStatus, row.noiseStatus, ...exceededText(row)]), original[improvementHeading]);
  const note = original.at(-1), improvementPrototype = original[improvementHeading + 2];
  for (const row of original.slice(improvementHeading + 2, -1)) table.removeChild(row);
  const improvements = summary.improvements.length ? summary.improvements : [{ target: '', method: '', assignee: '' }];
  for (const [index, row] of improvements.entries()) table.insertBefore(fillRow(improvementPrototype, [String(index + 1), row.target, row.method, row.assignee || data.defaultAssignee || summary.defaultAssignee || '']), note);
  // Execution evidence stays empty; reference photos are not evidence for this site.
  if (tables[1]) direct(tables[1], 'tr').forEach((row, index) => {
    if (index % 2 === 0) direct(row, 'tc').forEach((cell, col) => setCellText(cell, `개선대책 이행 사진 ${index + col + 1} (첨부)`));
  });
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

import ExcelJS from 'exceljs';
import { COLUMNS, GROUPS, measurementTitle } from './core.js';

export async function createExcel(roster, start, end, group = 'older') {
  const title = measurementTitle(start, end, group);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${GROUPS[group]}명단`, { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:2', horizontalCentered: true } });
  sheet.columns = [6, 25, 12, 18, 24, 19, 22, 16].map(width => ({ width }));
  sheet.mergeCells('A1:H1');
  sheet.getCell('A1').value = title;
  sheet.addRow(COLUMNS);
  for (const row of roster) sheet.addRow(row);
  for (let i = 0; i < 10; i++) sheet.addRow(['', '', '', '', '', '', '□예  □아니오', '']);
  for (let r = 1; r <= roster.length + 12; r++) {
    const row = sheet.getRow(r); row.height = 25;
    for (let c = 1; c <= 8; c++) {
      const cell = row.getCell(c);
      cell.font = { name: '맑은 고딕', size: r === 1 ? 18 : 12, bold: r <= 2 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [side, { style: 'thin' }]));
      const color = r === 2 ? 'FFD9D9D9' : r > 2 ? ({ 5: 'FFFCE4D6', 6: 'FFFFFFCC', 8: 'FFEBF1DE' })[c] : null;
      if (color) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    }
  }
  sheet.pageSetup.printArea = `A1:H${roster.length + 12}`;
  return new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const fontPromises = new Map();
async function loadFont(url) {
  if (!fontPromises.has(url)) fontPromises.set(url, (async () => {
    const font = new FontFace('WorkerHealth', `url("${url}")`);
    document.fonts.add(await font.load());
  })().catch(error => { fontPromises.delete(url); throw new Error('명단 글꼴을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.', { cause: error }); }));
  await fontPromises.get(url);
}

function wrap(ctx, value, maxWidth) {
  const lines = [''];
  for (const char of String(value)) {
    if (char === '\n') lines.push('');
    else if (lines.at(-1) && ctx.measureText(lines.at(-1) + char).width > maxWidth) lines.push(char);
    else lines[lines.length - 1] += char;
  }
  return lines;
}

// A4 pages avoid the browser's canvas height limit for large rosters.
export async function createImages(roster, title, fontUrl, start, end) {
  await loadFont(fontUrl);
  const width = 2480, height = 3508, margin = 80, tableTop = 190, bottom = 3190;
  const edges = [80, 266, 1310, 1774, 2400];
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('이미지 생성 기능을 사용할 수 없습니다.');
  measure.font = '40px WorkerHealth';
  const rows = roster.map(row => {
    const cells = row.slice(0, 4).map((value, i) => wrap(measure, value, edges[i + 1] - edges[i] - 30));
    return { cells, height: Math.max(85, Math.max(...cells.map(lines => lines.length)) * 52 + 24) };
  });
  const pages = []; let page = [], used = tableTop + 90;
  for (const row of rows) {
    if (row.height > bottom - tableTop - 90) throw new Error('한 칸의 내용이 너무 길어 이미지 한 장에 담을 수 없습니다. 원본 내용을 확인해 주세요.');
    if (used + row.height > bottom && page.length) { pages.push(page); page = []; used = tableTop + 90; }
    page.push(row); used += row.height;
  }
  if (page.length) pages.push(page);
  const blobs = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = 60;
    do { ctx.font = `${size--}px WorkerHealth`; } while (ctx.measureText(title).width > width - margin * 2 && size > 15);
    ctx.fillText(title, width / 2, 95);
    let y = tableTop;
    for (const row of [{ cells: [['No.'], ['협력회사'], ['이름'], ['공종']], height: 90, header: true }, ...pages[pageIndex]]) {
      ctx.font = '40px WorkerHealth'; ctx.lineWidth = 2;
      row.cells.forEach((lines, i) => {
        ctx.fillStyle = row.header ? '#D9D9D9' : '#fff'; ctx.fillRect(edges[i], y, edges[i + 1] - edges[i], row.height);
        ctx.strokeStyle = '#111'; ctx.strokeRect(edges[i], y, edges[i + 1] - edges[i], row.height);
        ctx.fillStyle = '#111'; lines.forEach((line, k) => ctx.fillText(line, (edges[i] + edges[i + 1]) / 2, y + row.height / 2 + (k - (lines.length - 1) / 2) * 52));
      }); y += row.height;
    }
    ctx.font = '32px WorkerHealth'; ctx.fillStyle = '#444';
    ctx.fillText(`측정 기간: ${start.replaceAll('-', '.')} ~ ${end.replaceAll('-', '.')}`, width / 2, y + 65);
    ctx.fillText('근로자들이 기간 내 혈압을 측정하고 결과를 기록할 수 있도록 독려해 주세요.', width / 2, y + 115);
    ctx.fillText(`${pageIndex + 1} / ${pages.length}`, width / 2, height - 70);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('이미지를 생성하지 못했습니다.');
    blobs.push(blob);
  }
  return blobs;
}

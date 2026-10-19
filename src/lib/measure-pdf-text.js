import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

// Reconstruct visual rows so values stay beside their table headings.
export function textFromItems(items, viewport) {
  const rows = [];
  const positioned = items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => {
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    return { x, y, text: item.str };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const item of positioned) {
    let row = rows.at(-1);
    if (!row || Math.abs(row.y - item.y) > 2) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  return rows.map(row => row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' | ')).join('\n');
}

export async function extractMeasurePages(base64, onProgress) {
  const data = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const task = getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let index = 0; index < pdf.numPages; index++) {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      const text = textFromItems(content.items, page.getViewport({ scale: 1 }));
      // Sparse/scanned pages still travel as PDFs; never silently discard a page.
      const readable = text.replace(/[\s|]/g, '').length >= 60 && !/\uFFFD{2}/.test(text);
      pages.push({ index, text: readable ? text : null });
      page.cleanup();
      onProgress?.({ phase: 'extract', completed: index + 1, total: pdf.numPages });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

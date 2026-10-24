import * as XLSX from 'xlsx';
import { analyzeRows, koreanToday, COLUMNS, measurementTitle, createRoster } from './core.js';
import './workbench.css';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function mountWorkerHealth(root, { fontUrl }) {
  if (root.workerHealthDispose) return;
  let workbook = null, analysis = null, group = 'older', disposed = false, revision = 0, imageUrls = [], busy = false;
  root.classList.add('wh-workbench');
  root.innerHTML = `
    <div class="wh-intro"><p>근로자 엑셀에서 만 63세 이상과 고혈압 재측정 대상자를 구분합니다.</p><small>파일은 이 브라우저에서만 처리합니다. 서버에 업로드하거나 명단을 저장하지 않습니다.</small></div>
    <fieldset class="wh-controls"><legend>원본 파일과 측정 기간</legend>
      <label class="wh-file">근로자 명단 엑셀<input data-wh="file" type="file" accept=".xlsx,.xls"></label>
      <label>시트<select data-wh="sheet" disabled><option>파일을 먼저 선택하세요</option></select></label>
      <label>나이 기준일<input data-wh="asof" type="date" value="${koreanToday()}"></label>
      <label>측정 시작일<input data-wh="start" type="date" value="${koreanToday()}"></label>
      <label>측정 종료일<input data-wh="end" type="date" value="${koreanToday()}"></label>
      <button data-wh="clear" type="button">명단 비우기</button>
    </fieldset>
    <details class="wh-guide"><summary>원본 엑셀 열 위치와 대상자 기준</summary><p>첫 행은 열 제목으로 사용합니다. D열: 협력회사명 · E열: 직종 · F열: 성명 · J열: 국적 · L열: 생년월일(예: 630101-1) · Q열: 최종 혈압(예: 2026.10.16(150/100)). 원본 양식에서 A열부터의 위치를 사용합니다.</p><p>나이 기준일의 만 63세 이상은 고령자 명단에 포함합니다. 만 63세 미만 중 수축기 150 이상 또는 이완기 100 이상은 고혈압 재측정 명단에 포함합니다. 나이를 확인할 수 없거나 혈압값이 여러 개인 셀은 자동 분류하지 않습니다. Q열이 없어도 고령자 명단은 만들 수 있습니다.</p><p>엑셀에는 혈압 기록용 8개 열과 추가 기입용 빈 줄 10개가 포함됩니다. PNG에는 번호·협력회사·이름·공종을 표시하며, 인원이 많으면 A4 크기 여러 장으로 나눕니다. 최대 파일 크기는 20MB입니다.</p></details>
    <p data-wh="status" role="status" aria-live="polite">엑셀 파일을 선택해 주세요.</p>
    <p data-wh="error" role="alert" class="wh-error"></p>
    <section data-wh="result" hidden>
      <div data-wh="metrics" class="wh-metrics"></div>
      <div class="wh-groups" role="group" aria-label="출력할 명단"><button data-wh="older" type="button" aria-pressed="true">고령자 혈압측정</button><button data-wh="pressure" type="button" aria-pressed="false">고혈압 근로자 혈압측정</button></div>
      <p data-wh="warnings" class="wh-warnings"></p>
      <h2 data-wh="title"></h2>
      <div class="wh-actions"><button data-wh="excel" type="button">엑셀 다운로드</button><button data-wh="images" type="button">이미지 미리보기 · 저장</button><span data-wh="count"></span></div>
      <div class="wh-table-wrap" tabindex="0" role="region" aria-label="혈압측정 대상자 명단"><table><thead><tr>${COLUMNS.map(col => `<th scope="col">${col}</th>`).join('')}</tr></thead><tbody data-wh="body"></tbody></table></div>
      <div data-wh="pagination" class="wh-pagination"></div>
      <section data-wh="previews" class="wh-previews" aria-label="PNG 미리보기"></section>
    </section>`;
  const el = key => root.querySelector(`[data-wh="${key}"]`);
  let previewPage = 0;
  function releaseImages() { imageUrls.forEach(url => URL.revokeObjectURL(url)); imageUrls = []; el('previews').replaceChildren(); }
  function clearResult() { analysis = null; el('result').hidden = true; releaseImages(); }
  function dates() {
    const start = el('start').value, end = el('end').value;
    return { start, end, title: measurementTitle(start, end, group) };
  }
  function activeWorkers() { return analysis?.[group] || []; }
  function setBusy(value) {
    busy = value;
    root.querySelectorAll('input, select, button').forEach(node => { node.disabled = value; });
    el('sheet').disabled = value || !workbook;
    if (!value && analysis) render();
  }
  function showError(error) { el('error').textContent = error.message || String(error); }
  function render() {
    if (!analysis || disposed) return;
    releaseImages();
    el('result').hidden = false;
    el('error').textContent = '';
    const workers = activeWorkers();
    el('metrics').innerHTML = [['전체 근로자', analysis.total], ['만 63세 이상', analysis.older.length], ['고혈압 재측정 대상', analysis.pressure.length]].map(([label, count]) => `<div><span>${label}</span><strong>${count}명</strong></div>`).join('');
    for (const key of ['older', 'pressure']) el(key).setAttribute('aria-pressed', String(key === group));
    const notes = [];
    if (analysis.unknownAge) notes.push(`생년월일을 확인할 수 없는 ${analysis.unknownAge}명은 대상자 선별에서 제외했습니다.`);
    if (!analysis.hasPressure) notes.push('Q열이 없어 고혈압 재측정 대상자를 확인할 수 없습니다.');
    else if (group === 'pressure' && analysis.unreadablePressure) notes.push(`만 63세 미만 중 ${analysis.unreadablePressure}명은 혈압값이 없거나 형식을 확인할 수 없어 제외했습니다.`);
    el('warnings').textContent = notes.join(' ');
    let period;
    try { period = dates(); }
    catch (error) { showError(error); }
    el('title').textContent = period?.title || '측정 기간을 확인해 주세요';
    const enabled = Boolean(period && workers.length && (group !== 'pressure' || analysis.hasPressure));
    el('excel').disabled = el('images').disabled = busy || !enabled;
    el('count').textContent = workers.length ? `대상 ${workers.length}명` : '해당하는 근로자가 없습니다.';
    const roster = period ? createRoster(workers, period.start, period.end) : [];
    const pageSize = 100, pages = Math.max(1, Math.ceil(roster.length / pageSize));
    previewPage = Math.min(previewPage, pages - 1);
    el('body').innerHTML = roster.slice(previewPage * pageSize, (previewPage + 1) * pageSize).map(row => `<tr>${row.map(value => `<td>${esc(value)}</td>`).join('')}</tr>`).join('');
    el('pagination').replaceChildren();
    if (pages > 1) {
      for (const [label, step] of [['이전', -1], ['다음', 1]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.disabled = busy || previewPage + step < 0 || previewPage + step >= pages;
        button.onclick = () => { previewPage += step; render(); }; el('pagination').append(button);
      }
      const label = document.createElement('span'); label.textContent = `${previewPage + 1} / ${pages}쪽 · 다운로드에는 전체 명단이 포함됩니다.`; el('pagination').append(label);
    }
  }
  function analyze() {
    revision++; previewPage = 0; clearResult(); el('error').textContent = '';
    if (!workbook) return;
    try {
      const sheet = workbook.Sheets[el('sheet').value];
      if (!sheet?.['!ref']) throw new Error('비어 있는 시트입니다. 다른 시트를 선택해 주세요.');
      const bounds = XLSX.utils.decode_range(sheet['!ref']);
      if (bounds.e.r > 50000) throw new Error('시트는 50,000행까지 처리할 수 있습니다. 사용하지 않는 행을 제거해 주세요.');
      // Always anchor at A1; a sheet whose first populated cell is D1 must not shift columns.
      bounds.s = { r: 0, c: 0 }; bounds.e.c = Math.min(16, bounds.e.c);
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true, range: bounds });
      if (!rows.some(row => row.some(value => String(value ?? '').trim()))) throw new Error('비어 있는 시트입니다. 다른 시트를 선택해 주세요.');
      analysis = analyzeRows(rows, el('asof').value);
      el('status').textContent = `분석 완료 · ${el('sheet').value} · 나이 기준일 ${analysis.asOf}`;
      render();
    } catch (error) { el('status').textContent = '파일과 분석 기준을 확인해 주세요.'; showError(error); }
  }
  el('file').onchange = async () => {
    const file = el('file').files[0]; if (!file) return;
    el('file').value = '';
    const token = ++revision; workbook = null; clearResult(); el('error').textContent = '';
    el('sheet').replaceChildren(); el('sheet').disabled = true;
    el('status').textContent = '엑셀 파일을 읽고 있습니다…';
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('20MB 이하의 엑셀 파일을 선택해 주세요.');
      const data = await file.arrayBuffer();
      if (disposed || token !== revision) return;
      const next = XLSX.read(data, { type: 'array' });
      if (!next.SheetNames.length) throw new Error('시트가 없는 파일입니다.');
      workbook = next;
      next.SheetNames.forEach(name => { const option = document.createElement('option'); option.value = option.textContent = name; el('sheet').append(option); });
      el('sheet').disabled = false; analyze();
    } catch (error) { if (!disposed && token === revision) { el('status').textContent = '파일을 읽지 못했습니다.'; showError(error); } }
  };
  for (const key of ['sheet', 'asof']) el(key).onchange = analyze;
  for (const key of ['start', 'end']) el(key).onchange = () => { revision++; render(); };
  for (const key of ['older', 'pressure']) el(key).onclick = () => { group = key; previewPage = 0; revision++; render(); };
  function clear() {
    revision++; workbook = null; clearResult(); el('file').value = ''; el('sheet').replaceChildren(); el('sheet').disabled = true;
    el('error').textContent = ''; el('status').textContent = '명단을 비웠습니다. 엑셀 파일을 선택해 주세요.';
  }
  el('clear').onclick = clear;
  const save = (blob, name) => {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  async function runExport(kind) {
    const token = revision;
    setBusy(true); releaseImages(); el('error').textContent = ''; el('status').textContent = '출력 파일을 만들고 있습니다…';
    try {
      const { start, end, title } = dates(), roster = createRoster(activeWorkers(), start, end);
      const { createExcel, createImages } = await import('./export.js');
      if (kind === 'excel') {
        const blob = await createExcel(roster, start, end, group);
        if (disposed || token !== revision) return;
        save(blob, `${title}.xlsx`);
      } else {
        const blobs = await createImages(roster, title, fontUrl, start, end);
        if (disposed || token !== revision) return;
        // Restore controls before attaching previews; render() releases old image URLs.
        setBusy(false);
        for (const [i, blob] of blobs.entries()) {
          const url = URL.createObjectURL(blob); imageUrls.push(url);
          const article = document.createElement('article'), img = document.createElement('img'), link = document.createElement('a');
          img.src = url; img.alt = `${title} ${i + 1}쪽`; img.loading = 'lazy';
          link.href = url; link.download = `${title}${blobs.length > 1 ? `_${i + 1}` : ''}.png`; link.textContent = `PNG 저장${blobs.length > 1 ? ` (${i + 1}/${blobs.length}쪽)` : ''}`;
          article.append(link, img); el('previews').append(article);
        }
      }
      el('status').textContent = kind === 'excel' ? '엑셀 파일을 만들었습니다.' : '이미지를 만들었습니다. 각 이미지의 PNG 저장을 눌러 주세요.';
    } catch (error) { if (!disposed) { showError(error); el('status').textContent = '파일 생성에 실패했습니다. 다시 시도해 주세요.'; } }
    finally { if (!disposed && busy) setBusy(false); }
  }
  el('excel').onclick = () => runExport('excel'); el('images').onclick = () => runExport('images');
  root.workerHealthDispose = () => { disposed = true; revision++; releaseImages(); workbook = analysis = null; root.replaceChildren(); delete root.workerHealthDispose; };
}

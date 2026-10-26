import { createClient } from '@supabase/supabase-js';
import './contractor-portal.css';
import { createWarningRenderer } from './lib/warning-print.js';
import { openPrintWindow } from './lib/ui.js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(20000) }) } },
);

let wsData = null,
  contractorData = null;
let workTypes = [],
  selectedWorkType = '',
  fileQueue = [];
let licenseData = null;
let publicLinkData = null,
  contractorList = [];
let currentUploadToken = '';

let portalRecords = [];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function portalRequest(contractorId = null) {
  const { data, error } = await supabase.rpc('get_contractor_portal', {
    p_token: currentUploadToken, p_contractor_id: contractorId,
  });
  if (error) throw new Error(/invalid or expired|not found|does not match/.test(error.message || '') ? '만료되었거나 유효하지 않은 링크입니다. 담당 보건관리자에게 새 링크를 요청해주세요.' : '관리페이지를 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.');
  return data;
}
async function init() {
  try {
    const params = new URLSearchParams(location.search);
    currentUploadToken = params.get('token') || params.get('ptoken') || params.get('dtoken') || '';
    if (!currentUploadToken) throw new Error('링크에 토큰이 없습니다. 담당 보건관리자에게 링크를 요청해주세요.');
    const data = await portalRequest(params.get('contractor_id'));
    wsData = data.workspace;
    if (params.get('dtoken')) {
      const back = document.getElementById('directoryBackLink');
      back.href = `/contractors.html?dtoken=${encodeURIComponent(currentUploadToken)}`; back.hidden = false;
    }
    if (data.public_link) publicLinkData = data.public_link;
    if (!data.contractor) {
      contractorList = data.contractors || [];
      document.title = `${wsData.name} 협력사 관리페이지`;
      document.getElementById('headerWS').textContent = document.title;
      document.getElementById('headerDesc').textContent = '관리할 협력사를 선택해주세요';
      renderContractorPicker();
      document.getElementById('contractorPickView').style.display = 'block';
    } else {
      contractorData = data.contractor;
      await proceedToUploadView(data);
    }
  } catch (err) { showError(err.message); }
  finally { document.getElementById('loadingView').style.display = 'none'; }
}
async function proceedToUploadView(data) {
  try {
    if (!data) data = await portalRequest(contractorData.id);
    contractorData = data.contractor;
    workTypes = data.work_types || [];
    licenseData = data.license;
    portalRecords = data.records || [];
    document.title = `${wsData.name} ${contractorData.name} 관리페이지`;
    document.getElementById('headerWS').textContent = document.title;
    document.getElementById('headerDesc').textContent = '협력사 안전보건 자료를 한곳에서 관리하세요';
    document.getElementById('contractorPickView').style.display = 'none';
    document.getElementById('portalView').hidden = false;
    const allowMsds = !publicLinkData || publicLinkData.allow_msds;
    const allowLicense = !publicLinkData || publicLinkData.allow_license;
    document.querySelectorAll('[data-msds]').forEach(el => el.hidden = !allowMsds);
    document.getElementById('licenseTab').hidden = !allowLicense;
    renderWorkTypes(); renderLicenseCard(); renderPortalRecords();
    const requestedPanel = new URLSearchParams(location.search).get('panel');
    const canOpenRequestedPanel = (requestedPanel === 'license' && allowLicense)
      || (['records', 'upload', 'warnings'].includes(requestedPanel) && allowMsds);
    window.switchPortalPanel(canOpenRequestedPanel ? requestedPanel : allowMsds ? 'records' : 'license');
    if (allowMsds) loadReuploadRequests();
  } catch (err) { showError(err.message); }
  finally { document.getElementById('loadingView').style.display = 'none'; }
}
window.switchPortalPanel = function (panel) {
  document.querySelectorAll('[data-portal-panel]').forEach(el => el.hidden = el.dataset.portalPanel !== panel);
  document.querySelectorAll('[data-portal-tab]').forEach(el => {
    const active = el.dataset.portalTab === panel;
    el.setAttribute('aria-selected', String(active));
    el.tabIndex = active ? 0 : -1;
  });
  if (panel === 'warnings') renderPortalRecords();
};
document.getElementById('portalTabs').addEventListener('keydown', event => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-portal-tab]')].filter(el => !el.hidden);
  let i = tabs.indexOf(document.activeElement);
  i = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); tabs[i].click(); tabs[i].focus();
});
async function refreshPortalRecords() {
  try {
    const data = await portalRequest(contractorData.id);
    portalRecords = data.records || []; renderPortalRecords();
  } catch (err) { toast(err.message, 'error'); }
}
window.refreshPortalRecords = refreshPortalRecords;
function printable(r) { return Boolean(r.signal_word && (r.h_codes || r.pictograms)); }
function renderPortalDocumentLists() {
  for (const [searchId, listId] of [['portalSearch', 'portalRecordList'], ['uploadExistingSearch', 'uploadExistingList']]) {
    const query = document.getElementById(searchId).value.trim().toLowerCase();
    const rows = portalRecords.filter(r => [r.product_name, r.work_type, r.supplier, r.pdf_name]
      .some(value => (value || '').toLowerCase().includes(query)));
  document.getElementById(listId).innerHTML = rows.length ? rows.map(r => `<article class="document-row"><div class="document-icon" aria-hidden="true">↗</div><div class="document-info"><h3>${escapeHtml(r.product_name)}</h3><p>${escapeHtml(r.work_type || '공종 미지정')} · ${escapeHtml(r.pdf_name || '첨부파일 없음')}</p><span class="status ${printable(r) ? 'ready' : ''}">${printable(r) ? '안전정보 등록' : '관리자 분석 대기'}</span></div><div class="document-actions">${r.pdf_path ? `<a class="btn btn-secondary" href="${import.meta.env.VITE_SUPABASE_URL}/functions/v1/msds-view?id=${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">원본 보기 ↗</a>` : '<span class="muted">원본 없음</span>'}</div></article>`).join('') : `<div class="portal-empty">${query ? '검색 결과가 없습니다.' : '아직 등록된 MSDS가 없습니다. 새 자료를 업로드해주세요.'}</div>`;
    if (listId === 'uploadExistingList') {
      document.getElementById('uploadExistingCount').textContent = query
        ? `검색 ${rows.length}건 / 전체 ${portalRecords.length}건` : `${portalRecords.length}건`;
    }
  }
}
function renderPortalRecords() {
  renderPortalDocumentLists();
  document.getElementById('recordCount').textContent = portalRecords.length;
  document.getElementById('licenseSummary').textContent = licenseData ? '등록 완료' : '미등록';
  document.getElementById('warningCount').textContent = portalRecords.filter(printable).length;

  document.getElementById('warningRecordList').innerHTML = portalRecords.length ? portalRecords.map(r => `<label class="warning-row"><input type="checkbox" value="${r.id}" ${printable(r) ? '' : 'disabled'}><span><strong>${escapeHtml(r.product_name)}</strong><small>${printable(r) ? escapeHtml(r.work_type || '공종 미지정') : '관리자 안전정보 분석 후 인쇄할 수 있습니다'}</small></span></label>`).join('') : '<div class="portal-empty">등록된 MSDS가 없습니다.</div>';
  document.getElementById('printPortalWarnings').disabled = !portalRecords.some(printable);
  updatePortalWarningPreview();
}
document.getElementById('portalSearch').addEventListener('input', renderPortalDocumentLists);
document.getElementById('uploadExistingSearch').addEventListener('input', renderPortalDocumentLists);
window.selectAllPortalWarnings = function (checked) { document.querySelectorAll('#warningRecordList input:not(:disabled)').forEach(el => el.checked = checked); updatePortalWarningPreview(); };
let portalPreviewPage = 0;
let portalPreviewSheets = [];
let portalPreviewRenderer = null;
function portalWarningOutput(example = false) {
  const selected = new Set([...document.querySelectorAll('#warningRecordList input:checked')].map(el => el.value));
  let records = portalRecords.filter(r => selected.has(r.id) && printable(r));
  const isExample = !records.length && example;
  if (isExample) records = portalRecords.filter(printable).slice(0, 1);
  const size = document.getElementById('portalPrintSize').value;
  const copies = Math.min(20, Math.max(1, parseInt(document.getElementById('portalPrintCopies').value, 10) || 1));
  const renderer = createWarningRenderer({ size });
  const labels = records.flatMap(r => Array.from({length: copies}, () => renderer.buildWarnLabel(r, wsData.name)));
  return { renderer, sheets: renderer.warnSheets(labels), records, copies, isExample };
}
function updatePortalWarningPreview() {
  if (!wsData) return;
  const output = portalWarningOutput(true);
  portalPreviewRenderer = output.renderer;
  portalPreviewSheets = output.sheets;
  portalPreviewPage = 0;
  document.getElementById('portalPreviewSummary').textContent = output.isExample && output.records.length
    ? `예시 · ${output.records[0].product_name} — 물질을 선택하면 실제 인쇄 내용으로 바뀝니다.`
    : output.records.length ? `선택 ${output.records.length}종 · 물질당 ${output.copies}매 · A4 ${output.sheets.length}장` : '';
  document.getElementById('portalPreviewEmpty').hidden = Boolean(output.sheets.length);
  document.getElementById('portalPreviewViewport').hidden = !output.sheets.length;
  document.getElementById('portalPreviewPages').hidden = !output.sheets.length;
  renderPortalWarningPreviewPage();
}
function resizePortalWarningPreview() {
  const viewport = document.getElementById('portalPreviewViewport');
  if (!viewport.clientWidth) return;
  const scale = document.getElementById('portalPreviewZoom').value === 'actual' ? 1 : Math.min(1, Math.max(1, viewport.clientWidth - 24) / 794);
  const frame = document.getElementById('portalWarningPreview');
  frame.style.transform = `scale(${scale})`;
  const paper = document.getElementById('portalPreviewPaper');
  paper.style.width = `${794 * scale}px`;
  paper.style.height = `${1070 * scale}px`;
}
function renderPortalWarningPreviewPage() {
  const frame = document.getElementById('portalWarningPreview');
  document.getElementById('portalPreviewPrev').disabled = portalPreviewPage === 0;
  document.getElementById('portalPreviewNext').disabled = portalPreviewPage >= portalPreviewSheets.length - 1;
  document.getElementById('portalPreviewPageNumber').textContent = portalPreviewSheets.length ? `${portalPreviewPage + 1} / ${portalPreviewSheets.length}장` : '';
  if (!portalPreviewSheets.length) { frame.removeAttribute('srcdoc'); return; }
  const renderer = portalPreviewRenderer;
  frame.onload = async () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    await Promise.all([doc.fonts.ready, ...[...doc.images].map(img => img.decode().catch(() => {}))]);
    if (doc !== frame.contentDocument) return;
    renderer.fitWarningLabels(doc);
    resizePortalWarningPreview();
  };
  frame.srcdoc = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;width:210mm;font-family:'Malgun Gothic',sans-serif}${renderer.warnLabelCss()}</style></head><body>${portalPreviewSheets[portalPreviewPage]}</body></html>`;
  resizePortalWarningPreview();
}
window.changePortalPreviewPage = function (delta) {
  portalPreviewPage = Math.min(portalPreviewSheets.length - 1, Math.max(0, portalPreviewPage + delta));
  renderPortalWarningPreviewPage();
};
document.getElementById('warningRecordList').addEventListener('change', updatePortalWarningPreview);
document.getElementById('portalPrintSize').addEventListener('change', updatePortalWarningPreview);
document.getElementById('portalPrintCopies').addEventListener('input', updatePortalWarningPreview);
document.getElementById('portalPreviewZoom').addEventListener('change', resizePortalWarningPreview);
new ResizeObserver(resizePortalWarningPreview).observe(document.getElementById('portalPreviewViewport'));
window.printPortalWarnings = function () {
  const { renderer, sheets, records } = portalWarningOutput();
  if (!records.length) return toast('인쇄할 물질을 선택해주세요.', 'error');
  openPrintWindow(`<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>경고표지</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:'Malgun Gothic',sans-serif}${renderer.warnLabelCss()}</style></head><body>${sheets.join('')}${renderer.warningAutoFitPrintScript()}</body></html>`);
};

function showError(msg) {
  document.getElementById('portalView').hidden = true;
  document.getElementById('contractorPickView').style.display = 'none';
  document.getElementById('loadingView').style.display = 'none';
  document.getElementById('errorView').style.display = 'block';
  document.getElementById('errorMsg').textContent = msg;
}

function renderWorkTypes() {
  window.workTypesForPicker = workTypes.map(w => w.name);
  const grid = document.getElementById('worktypeGrid');
  const noWt = document.getElementById('noWorktype');
  if (workTypes.length === 0) {
    grid.style.display = 'none';
    noWt.style.display = 'block';
    selectedWorkType = '미지정';
    document.getElementById('step1Next').disabled = false;
    return;
  }
  grid.innerHTML = workTypes
    .map(
      (w) =>
        `<button class="worktype-btn" onclick="selectWorkType(workTypesForPicker[${workTypes.indexOf(w)}],this)">${escapeHtml(w.name)}</button>`,
    )
    .join('');
}

window.selectWorkType = function (name, btn) {
  selectedWorkType = name;
  document
    .querySelectorAll('.worktype-btn')
    .forEach((b) => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('step1Next').disabled = false;
};

window.goStep2 = function () {
  document.getElementById('stepView1').style.display = 'none';
  document.getElementById('stepView2').style.display = 'block';
  document.getElementById('selectedWorktypeLabel').textContent =
    selectedWorkType;
  setStep(2);
};

window.goStep1 = function () {
  document.getElementById('stepView2').style.display = 'none';
  document.getElementById('stepView1').style.display = 'block';
  setStep(1);
};

function setStep(n) {
  for (let i = 1; i <= 3; i++) {
    const s = document.getElementById(`step${i}`);
    s.className = 'step' + (i < n ? ' done' : i === n ? ' active' : '');
  }
  if (document.getElementById('line12'))
    document.getElementById('line12').className =
      'step-line' + (n >= 2 ? ' done' : '');
  if (document.getElementById('line23'))
    document.getElementById('line23').className =
      'step-line' + (n >= 3 ? ' done' : '');
}

// ─── 파일 처리 ───
window.onDragOver = function (e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.add('drag');
};
window.onDragLeave = function (e) {
  document.getElementById('uploadZone').classList.remove('drag');
};
window.onDrop = function (e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('drag');
  const ok = ['application/pdf', 'image/jpeg', 'image/png'];
  const files = [...e.dataTransfer.files].filter((f) =>
    ok.includes(f.type),
  );
  const non = e.dataTransfer.files.length - files.length;
  if (non > 0) toast(`PDF/JPG/PNG만 가능합니다 (${non}개 제외)`, 'error');
  if (files.length) addFiles(files);
};
window.onFileSelect = function (e) {
  const ok = ['application/pdf', 'image/jpeg', 'image/png'];
  const files = [...e.target.files].filter((f) => ok.includes(f.type));
  addFiles(files);
  e.target.value = '';
};

function addFiles(files) {
  files.forEach((file) => {
    const id = Date.now() + Math.random().toString(36).slice(2);
    const item = {
      id,
      file,
      name: file.name,
      data: null,
      mediaType: file.type,
      status: 'waiting',
    };
    fileQueue.push(item);
    const reader = new FileReader();
    reader.onload = (ev) => {
      item.data = ev.target.result.split(',')[1];
      renderFileList();
    };
    reader.readAsDataURL(file);
  });
  renderFileList();
}

function renderFileList() {
  const el = document.getElementById('fileList');
  if (fileQueue.length === 0) {
    el.style.display = 'none';
    document.getElementById('uploadBtn').disabled = true;
    return;
  }
  el.style.display = 'flex';
  document.getElementById('uploadBtn').disabled = !fileQueue.some(
    (f) => f.status === 'waiting',
  );
  el.innerHTML = fileQueue
    .map(
      (item) => `
    <div class="file-item ${item.status}">
<span class="fi-icon">${{ waiting: '📄', uploading: '⏳', done: '✅', error: '❌' }[item.status]}</span>
<div class="fi-info">
  <div class="fi-name">${item.name}</div>
  <div class="fi-status">${{ waiting: '업로드 대기', uploading: '안전하게 접수 중...', done: '접수 완료', error: '오류 발생' }[item.status]}</div>
  ${item.status === 'uploading' ? '<div class="progress-bar"><div class="progress-fill"></div></div>' : ''}
</div>
${item.status !== 'uploading' ? `<button class="fi-remove" onclick="removeFile('${item.id}')">✕</button>` : ''}
    </div>`,
    )
    .join('');
}

window.removeFile = function (id) {
  fileQueue = fileQueue.filter((f) => f.id !== id);
  renderFileList();
};

// ─── 업로드 ───
window.startUpload = async function () {
  const waiting = fileQueue.filter((f) => f.status === 'waiting');
  if (waiting.length === 0) return;
  document.getElementById('uploadBtn').disabled = true;
  let saved = 0;
  for (const item of waiting) {
    item.status = 'uploading';
    renderFileList();
    try {
      // 공개 링크에서는 현장 관리자 API 비용과 문서 외부 전송을 막고 파일만 접수합니다.
      // 보건관리자가 로그인 후 MSDS 대장에서 필요한 건만 AI 분석합니다.
      // 파일을 먼저 스토리지에 올리고, PDF 정보를 포함해 한 번에 저장
      // (기존 방식은 저장 후 UPDATE였는데, 비로그인 권한으로는 UPDATE가 조용히 실패해 has_pdf가 항상 false로 남는 버그가 있었음)
      const recId = crypto.randomUUID();
      const ext =
        item.mediaType === 'application/pdf'
          ? 'pdf'
          : item.mediaType.split('/')[1] || 'jpg';
      const path = `${wsData.id}/${recId}.${ext}`;
      const bytes = atob(item.data);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: item.mediaType });
      const { error: stErr } = await supabase.storage
        .from('msds-pdfs')
        .upload(path, blob, {
          contentType: item.mediaType,
          upsert: true,
        });
      if (stErr)
        throw new Error('원본 파일 업로드 실패: ' + stErr.message);
      const hasPdf = true;
      const { error: dbErr } = await supabase
        .from('msds_records')
        .insert({
          id: recId,
          workspace_id: wsData.id,
          uploaded_by: null, // 협력사 업로드 = null
          product_name: item.name.replace(/\.(pdf|jpg|jpeg|png)$/i, ''),
          supplier: '',
          supplier_contact: '',
          contractor: contractorData.name,
          work_type: selectedWorkType,
          cas_no: '',
          components: '',
          signal_word: '',
          h_codes: '',
          p_codes: '',
          pictograms: '',
          issue_date: '',
          protective_equipment: '',
          legal_measurement: 'N',
          legal_exam: 'N',
          legal_exam_cycle: '',
          legal_manage: 'N',
          legal_permit: 'N',
          legal_special: 'N',
          legal_dangerous: 'N',
          special: 'N',
          status: 'active',
          receipt_status: 'received',
          receipt_date: new Date().toISOString().split('T')[0],
          version: 1,
          history: [],
          has_pdf: hasPdf,
          pdf_name: hasPdf ? item.name : null,
          pdf_path: hasPdf ? path : null,
        });
      if (dbErr) {
        await supabase.storage.from('msds-pdfs').remove([path]);
        throw new Error('저장 실패: ' + dbErr.message);
      }
      saved++;
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
      console.error(err);
    }
    renderFileList();
    await new Promise((r) => setTimeout(r, 300));
  }
  document.getElementById('uploadBtn').disabled = false;
  if (saved > 0) {
    await refreshPortalRecords();
    const failed = waiting.length - saved;
    document.getElementById('uploadedCount').textContent = saved;
    const failureSummary = document.getElementById(
      'uploadFailureSummary',
    );
    const retryBtn = document.getElementById('retryFailedBtn');
    failureSummary.style.display = failed ? 'block' : 'none';
    failureSummary.textContent = failed
      ? `${failed}개 파일은 업로드하지 못했습니다. 아래 버튼으로 다시 시도해주세요.`
      : '';
    retryBtn.style.display = failed ? '' : 'none';
    setStep(3);
    document.getElementById('stepView2').style.display = 'none';
    document.getElementById('stepView3').style.display = 'block';
    renderLicenseCard();
  } else {
    toast('업로드 실패. 다시 시도해주세요.', 'error');
  }
};

// ─── 완료 후 액션 ───
window.resetForm = function () {
  fileQueue = [];
  selectedWorkType = '';
  document
    .querySelectorAll('.worktype-btn')
    .forEach((b) => b.classList.remove('selected'));
  document.getElementById('step1Next').disabled = true;
  document.getElementById('stepView3').style.display = 'none';
  document.getElementById('stepView1').style.display = 'block';
  renderWorkTypes();
  renderFileList();
  setStep(1);
};

window.retryFailedUploads = function () {
  fileQueue = fileQueue
    .filter((item) => item.status === 'error')
    .map((item) => ({ ...item, status: 'waiting', error: null }));
  document.getElementById('stepView3').style.display = 'none';
  document.getElementById('stepView2').style.display = 'block';
  renderFileList();
  setStep(2);
};

function toast(msg, type = '') {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── 사업자등록증 ───
// ─── 협력사 선택 (공용 링크) ───
function renderContractorPicker() {
  const grid = document.getElementById('contractorPickGrid');
  if (!contractorList.length) {
    grid.innerHTML = `<div style="text-align:center;color:var(--text3);font-size:13px;padding:10px 0;">등록된 협력사가 없습니다. 아래에서 직접 추가해주세요.</div>`;
    return;
  }
  grid.innerHTML = contractorList
    .map(
      (c) =>
        `<button class="worktype-btn" onclick="selectExistingContractor('${c.id}')">${escapeHtml(c.name)}</button>`,
    )
    .join('');
}

window.selectExistingContractor = async function (id) {
  const c = contractorList.find((x) => x.id === id);
  if (!c) return;
  contractorData = { id: c.id, name: c.name };
  document.getElementById('loadingView').style.display = 'block';
  document.getElementById('contractorPickView').style.display = 'none';
  await proceedToUploadView();
  document.getElementById('loadingView').style.display = 'none';
};

window.addNewContractorAndSelect = async function () {
  const name = document
    .getElementById('newContractorNameInput')
    .value.trim();
  if (!name) {
    toast('협력사명을 입력하세요', 'error');
    return;
  }
  if (contractorList.some((c) => c.name === name)) {
    const existing = contractorList.find((c) => c.name === name);
    selectExistingContractor(existing.id);
    return;
  }
  try {
    const { data, error } = await supabase.rpc('register_public_contractor', {p_token:currentUploadToken,p_name:name});
    if (error) throw error;
    contractorData = { id: data.id, name: data.name };
    document.getElementById('loadingView').style.display = 'block';
    document.getElementById('contractorPickView').style.display = 'none';
    await proceedToUploadView();
    document.getElementById('loadingView').style.display = 'none';
  } catch (err) {
    toast('협력사 추가 실패: ' + err.message, 'error');
  }
};

function renderLicenseCard() {
  const allowLicense = publicLinkData
    ? publicLinkData.allow_license
    : true;
  if (!allowLicense) {
    document.getElementById('licenseCard').style.display = 'none';
    return;
  }
  document.getElementById('licenseCard').style.display = 'block';
  if (licenseData) {
    document.getElementById('licenseAlreadyDone').style.display = 'block';
    document.getElementById('licenseUploadZoneWrap').style.display =
      'none';
    document.getElementById('licenseFileNameDisplay').textContent =
      licenseData.file_name;
  } else {
    document.getElementById('licenseAlreadyDone').style.display = 'none';
    document.getElementById('licenseUploadZoneWrap').style.display =
      'block';
  }
}

window.handleLicenseFileSelect = async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  if (licenseData) return;
  if (!/\.(pdf|jpe?g|png)$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
    e.target.value = ''; return toast('PDF, JPG, PNG 파일을 20MB 이하로 선택해주세요.', 'error');
  }
  e.target.disabled = true;
  const statusEl = document.getElementById('licenseUploadStatus');
  statusEl.textContent = '업로드 중...';
  statusEl.style.color = 'var(--text3)';

  try {
    const ext = file.name.split('.').pop();
    const path = `${wsData.id}/${contractorData.id}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('business-licenses')
      .upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) throw upErr;

    const { error: dbErr } = await supabase.rpc('register_contractor_license', {
      p_token: currentUploadToken, p_contractor_id: contractorData.id,
      p_file_name: file.name, p_file_path: path,
    });
    if (dbErr) throw dbErr;

    licenseData = { file_name: file.name, file_path: path };
    toast('사업자등록증이 제출됐습니다', 'success');
    renderLicenseCard();
    renderPortalRecords();
  } catch (err) {
    statusEl.textContent = '업로드 실패: ' + err.message;
    statusEl.style.color = 'var(--danger)';
  } finally { e.target.disabled = false; e.target.value = ''; }
};

// ─── 재업로드 요청 (보건관리자가 요청한 MSDS 교체) ───
let reuploadItems = [];

async function loadReuploadRequests() {
  const { data, error } = await supabase.rpc(
    'get_public_reupload_requests',
    {
      p_token: currentUploadToken,
      p_contractor_id: contractorData.id,
    },
  );
  if (error) {
    console.error('재업로드 요청 조회 실패', error);
    return;
  }
  reuploadItems = (data || []).map((r) => ({ ...r, status: 'waiting' }));
  renderReuploadSection();
}

function renderReuploadSection() {
  const sec = document.getElementById('reuploadSection');
  if (!reuploadItems.length) {
    sec.style.display = 'none';
    sec.innerHTML = '';
    return;
  }
  sec.style.display = 'block';
  sec.innerHTML = `
    <div class="card" style="border:1.5px solid #fbbf24;background:#fffbeb;margin-bottom:16px;">
<div style="font-weight:800;font-size:15px;color:#92400e;margin-bottom:4px;">🔁 재업로드 요청 ${reuploadItems.filter((i) => i.status !== 'done').length}건</div>
<div style="font-size:12px;color:#a16207;margin-bottom:12px;">보건관리자가 아래 MSDS의 새 파일을 요청했습니다. 항목별로 파일을 올려주세요. (PDF/JPG/PNG)</div>
${reuploadItems
  .map(
    (item) => `
  <div style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;margin-bottom:8px;">
    <span style="font-size:18px;">${{ waiting: '📄', uploading: '⏳', done: '✅', error: '❌' }[item.status]}</span>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:700;font-size:13px;color:#1e293b;">${item.product_name} <span style="color:#94a3b8;font-weight:400;">v${item.version || 1}</span></div>
      <div style="font-size:12px;color:#b45309;">${item.status === 'done' ? '재업로드 접수 완료! 감사합니다' : item.status === 'uploading' ? '안전하게 접수 중...' : item.status === 'error' ? '오류: ' + (item.error || '다시 시도해주세요') : '사유: ' + (item.reupload_reason || '재업로드 필요')}</div>
    </div>
    ${item.status === 'waiting' || item.status === 'error' ? `<button class="btn btn-primary" style="flex-shrink:0;padding:8px 14px;" onclick="pickReuploadFile('${item.id}')">파일 올리기</button>` : ''}
  </div>`,
  )
  .join('')}
    </div>`;
}

window.pickReuploadFile = function (recordId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.jpeg,.png';
  input.onchange = (e) => {
    const f = e.target.files[0];
    if (f) doReupload(recordId, f);
  };
  input.click();
};

async function doReupload(recordId, file) {
  const item = reuploadItems.find((i) => i.id === recordId);
  if (!item) return;
  const ok = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!ok.includes(file.type)) {
    toast('PDF/JPG/PNG만 가능합니다', 'error');
    return;
  }
  item.status = 'uploading';
  renderReuploadSection();
  try {
    // 1) 파일 읽기
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = (ev) => res(ev.target.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    // 2) 공개 링크에서는 AI로 보내지 않고 스토리지 파일만 교체
    const ext =
      file.type === 'application/pdf'
        ? 'pdf'
        : file.type.split('/')[1] || 'jpg';
    const path = `${wsData.id}/${recordId}.${ext}`;
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const { error: stErr } = await supabase.storage
      .from('msds-pdfs')
      .upload(path, new Blob([arr], { type: file.type }), {
        contentType: file.type,
        upsert: true,
      });
    const hasPdf = !stErr;
    // 3) 토큰 검증 RPC로 버전 업 + 요청 해제 + 관리자 알림
    const nv = (item.version || 1) + 1;
    if (!hasPdf)
      throw new Error('원본 파일 업로드 실패: ' + stErr.message);
    const { error: upErr } = await supabase.rpc(
      'complete_public_reupload',
      {
        p_token: currentUploadToken,
        p_contractor_id: contractorData.id,
        p_record_id: recordId,
        p_file_name: file.name,
        p_file_path: path,
      },
    );
    if (upErr) throw new Error('저장 실패: ' + upErr.message);
    item.status = 'done';
    item.version = nv;
  } catch (err) {
    item.status = 'error';
    item.error = err.message;
  }
  renderReuploadSection();
}

document.querySelectorAll('.upload-zone').forEach(zone => {
  zone.setAttribute('role', 'button'); zone.tabIndex = 0;
  zone.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === zone) { event.preventDefault(); zone.click(); }
  });
});
init();

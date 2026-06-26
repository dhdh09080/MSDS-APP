import { supabase } from './lib/supabase.js';
import { ghsPictogramWithLabel, decodeHCodes, decodePCodes, GHS_NAMES } from './lib/ghs.js';

// ═══════════════ State ═══════════════
let user = null;
let records = [];
let contractors = [];
let workTypes = [];
let fileQueue = [];
let warnSelected = new Set();
let editingId = null, currentDetailId = null, receiptEditId = null, currentPdfUrl = null;

// ═══════════════ Auth ═══════════════
let authMode = 'login';
function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
  document.getElementById('authSite').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('authSubmit').textContent = mode === 'login' ? '로그인' : '회원가입';
  document.getElementById('authMsg').textContent = '';
}
window.switchAuthTab = switchAuthTab;

async function handleAuth() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const site = document.getElementById('authSite').value.trim();
  const msg = document.getElementById('authMsg');
  const btn = document.getElementById('authSubmit');
  if (!email || !password) { msg.className = 'auth-msg error'; msg.textContent = '이메일과 비밀번호를 입력하세요'; return; }
  btn.disabled = true;
  try {
    if (authMode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { site_name: site } } });
      if (error) throw error;
      msg.className = 'auth-msg success';
      msg.textContent = '가입 완료! 이메일 인증 후 로그인하세요. (인증 비활성화 시 바로 로그인)';
      switchAuthTab('login');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    msg.className = 'auth-msg error';
    msg.textContent = translateAuthError(err.message);
  } finally {
    btn.disabled = false;
  }
}
window.handleAuth = handleAuth;

function translateAuthError(m) {
  if (m.includes('Invalid login')) return '이메일 또는 비밀번호가 틀렸습니다';
  if (m.includes('already registered')) return '이미 가입된 이메일입니다';
  if (m.includes('Password should')) return '비밀번호는 6자 이상이어야 합니다';
  if (m.includes('Email not confirmed')) return '이메일 인증이 필요합니다 (메일함 확인)';
  return m;
}

async function handleLogout() {
  await supabase.auth.signOut();
  location.reload();
}
window.handleLogout = handleLogout;

// Auth state listener
supabase.auth.onAuthStateChange((event, session) => {
  if (session?.user) {
    user = session.user;
    showApp();
  } else {
    user = null;
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
  }
});

async function showApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'flex';
  const siteName = user.user_metadata?.site_name || '';
  document.getElementById('userInfo').textContent = (siteName ? siteName + '\n' : '') + user.email;
  document.getElementById('accountInfo').innerHTML = `이메일: ${user.email}<br>현장명: ${siteName || '(미설정)'}<br>가입일: ${new Date(user.created_at).toLocaleDateString('ko-KR')}`;
  await loadContractors();
  await loadWorkTypes();
  await loadRecords();
}

// ═══════════════ Data Load ═══════════════
async function loadRecords() {
  const { data, error } = await supabase.from('msds_records').select('*').order('created_at', { ascending: true });
  if (error) { toast('데이터 로드 실패: ' + error.message, 'error'); return; }
  records = data || [];
  updateStats();
  renderTable();
}
async function loadContractors() {
  const { data, error } = await supabase.from('contractors').select('*').order('created_at', { ascending: true });
  if (error) { toast('협력사 로드 실패', 'error'); return; }
  contractors = (data || []).map(c => ({ id: c.id, name: c.name }));
  if (contractors.length === 0) {
    // 기본 협력사 시드
    const defaults = ['엘엑스하우시스', '화승토건', '대우건설', '현대건설'];
    for (const name of defaults) {
      const { data: ins } = await supabase.from('contractors').insert({ user_id: user.id, name }).select().single();
      if (ins) contractors.push({ id: ins.id, name: ins.name });
    }
  }
  renderContractorTags();
  populateSelects();
}

// ═══════════════ Nav ═══════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.getElementById('nav-' + id).classList.add('active');
  if (id === 'warning') renderWarnPickList();
  if (id === 'register') populateFormSelects();
}
window.showPage = showPage;

// ═══════════════ File Queue ═══════════════
function handleFileSelect(e) { addFilesToQueue([...e.target.files]); e.target.value = ''; }
window.handleFileSelect = handleFileSelect;

// 폴더 업로드 — webkitRelativePath에서 협력사/공종 자동 추출
function handleFolderSelect(e) {
  const files = [...e.target.files].filter(f => /\.(pdf|jpg|jpeg|png|webp)$/i.test(f.name));
  if (files.length === 0) { toast('폴더에 PDF/이미지가 없습니다', 'error'); e.target.value = ''; return; }
  files.forEach(file => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const rel = file.webkitRelativePath || file.name;
    const parts = rel.split('/').filter(Boolean);
    // 경로에서 협력사·공종 추측 (등록된 목록과 이름 매칭)
    let guessCon = '', guessWork = '';
    for (const p of parts.slice(0, -1)) {
      const mc = contractors.find(c => p.includes(c.name) || c.name.includes(p));
      if (mc && !guessCon) guessCon = mc.name;
      const mw = workTypes.find(w => p.includes(w.name) || w.name.includes(p));
      if (mw && !guessWork) guessWork = mw.name;
    }
    const item = { id, file, name: file.name, path: rel, data: null, mediaType: file.type, status: 'waiting', error: null, guessCon, guessWork };
    fileQueue.push(item);
    const reader = new FileReader();
    reader.onload = ev => { item.data = ev.target.result.split(',')[1]; renderFileQueue(); };
    reader.readAsDataURL(file);
  });
  renderFileQueue(); updateBatchBar();
  e.target.value = '';
  toast(`${files.length}개 파일 추가됨 (폴더에서 협력사·공종 자동 인식)`, 'success');
}
window.handleFolderSelect = handleFolderSelect;
function dragOver(e) { e.preventDefault(); document.getElementById('uploadZone').classList.add('drag'); }
window.dragOver = dragOver;
function dragLeave(e) { document.getElementById('uploadZone').classList.remove('drag'); }
window.dragLeave = dragLeave;
function dropFiles(e) {
  e.preventDefault(); document.getElementById('uploadZone').classList.remove('drag');
  const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const files = [...e.dataTransfer.files].filter(f => ok.includes(f.type));
  const non = e.dataTransfer.files.length - files.length;
  if (non > 0) toast(`PDF/JPG/PNG만 추가됩니다 (${non}개 제외)`, 'error');
  if (files.length) addFilesToQueue(files);
}
window.dropFiles = dropFiles;
function addFilesToQueue(files) {
  files.forEach(file => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const mediaType = file.type;
    const item = { id, file, name: file.name, data: null, mediaType, status: 'waiting', error: null };
    fileQueue.push(item);
    const reader = new FileReader();
    reader.onload = e => { item.data = e.target.result.split(',')[1]; renderFileQueue(); };
    reader.readAsDataURL(file);
  });
  renderFileQueue(); updateBatchBar();
}
function removeFileFromQueue(id) { fileQueue = fileQueue.filter(f => f.id !== id); renderFileQueue(); updateBatchBar(); }
window.removeFileFromQueue = removeFileFromQueue;
function clearAllFiles() { fileQueue = []; renderFileQueue(); updateBatchBar(); }
window.clearAllFiles = clearAllFiles;
function renderFileQueue() {
  const el = document.getElementById('fileQueue');
  if (fileQueue.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const icons = { waiting: '📄', parsing: '⏳', done: '✅', error: '❌' };
  const st = { waiting: '대기 중', parsing: 'Claude AI 분석 중...', done: '완료 — 저장됨', error: '' };
  el.innerHTML = fileQueue.map(item => {
    const guess = (item.guessCon || item.guessWork)
      ? `<span style="color:var(--accent);font-size:11px;"> · ${item.guessCon || ''}${item.guessWork ? ' / ' + item.guessWork : ''}</span>` : '';
    const status = item.status === 'error' ? '오류: ' + (item.error || '알수없음') : (st[item.status] + (item.status === 'waiting' ? guess : ''));
    return `<div class="file-item ${item.status}"><span class="fi-icon">${icons[item.status]}</span><div class="fi-info"><div class="fi-name">${item.name}</div><div class="fi-status">${status}</div>${item.status === 'parsing' ? '<div class="file-progress"><div class="file-progress-bar" style="width:60%"></div></div>' : ''}</div>${item.status !== 'parsing' ? `<button class="fi-remove" onclick="removeFileFromQueue('${item.id}')">✕</button>` : ''}</div>`;
  }).join('');
}
function updateBatchBar() {
  const bar = document.getElementById('batchBar'), info = document.getElementById('batchInfo');
  if (fileQueue.length === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const done = fileQueue.filter(f => f.status === 'done').length, err = fileQueue.filter(f => f.status === 'error').length, wait = fileQueue.filter(f => f.status === 'waiting').length;
  info.innerHTML = `<strong>${fileQueue.length}개</strong> 파일 · 대기 ${wait} · 완료 ${done}${err ? ` · 오류 ${err}` : ''}`;
  document.getElementById('parseAllBtn').disabled = wait === 0;
}

// ═══════════════ Parse + Save ═══════════════
async function parseAllFiles() {
  const batchContractor = document.getElementById('batchContractor').value;
  const batchWork = document.getElementById('batchWorkType').value;
  const waiting = fileQueue.filter(f => f.status === 'waiting');
  if (waiting.length === 0) { toast('대기 중인 파일이 없습니다', 'error'); return; }
  // 협력사: 폴더 추측 > 드롭다운. 둘 다 없으면 막기
  const hasAnyContractor = waiting.every(f => f.guessCon || batchContractor);
  if (!hasAnyContractor) { toast('협력사를 선택하거나, 폴더 구조에 협력사명이 포함되게 해주세요', 'error'); return; }
  document.getElementById('parseAllBtn').disabled = true;
  let saved = 0;
  for (const item of waiting) {
    item.status = 'parsing'; renderFileQueue();
    try {
      const contractor = item.guessCon || batchContractor;
      const workType = item.guessWork || batchWork || '';
      const parsed = await callParseFunction(item.data, item.mediaType);
      const recId = await saveRecordToDB({
        product_name: parsed.productName || item.name.replace(/\.(pdf|jpg|jpeg|png|webp)$/i, ''),
        supplier: parsed.supplier || '',
        supplier_contact: parsed.supplierContact || '',
        contractor,
        work_type: workType,
        cas_no: parsed.casNo || '',
        components: parsed.components || '',
        signal_word: parsed.signalWord || '',
        h_codes: parsed.hCodes || '',
        p_codes: parsed.pCodes || '',
        pictograms: parsed.pictograms || '',
        issue_date: parsed.issueDate || '',
        protective_equipment: parsed.protectiveEquipment || '',
        legal_measurement: parsed.legalMeasurement || 'N',
        legal_exam: parsed.legalExam || 'N',
        legal_exam_cycle: parsed.legalExamCycle || '',
        legal_manage: parsed.legalManage || 'N',
        legal_permit: parsed.legalPermit || 'N',
        legal_special: parsed.legalSpecial || 'N',
        legal_dangerous: parsed.legalDangerous || 'N',
        special: (parsed.legalSpecial === 'Y') ? 'Y_special' : 'N',
        receipt_status: 'received',
        receipt_date: new Date().toISOString().split('T')[0],
      });
      await uploadFile(recId, item.name, item.data, item.mediaType);
      saved++; item.status = 'done';
    } catch (err) {
      item.status = 'error'; item.error = err.message;
    }
    renderFileQueue(); updateBatchBar();
    await new Promise(r => setTimeout(r, 300));
  }
  await loadRecords();
  toast(`${saved}개 저장 완료${fileQueue.some(f => f.status === 'error') ? ', 일부 오류' : ''}`, saved > 0 ? 'success' : 'error');
  document.getElementById('parseAllBtn').disabled = false;
}
window.parseAllFiles = parseAllFiles;

async function callParseFunction(base64Data, mediaType) {
  const approxMB = (base64Data.length * 0.75 / 1024 / 1024).toFixed(1);
  if (approxMB > 20) throw new Error(`파일이 너무 큽니다 (${approxMB}MB)`);
  const { data, error } = await supabase.functions.invoke('parse-msds', { body: { fileBase64: base64Data, mediaType } });
  if (error) throw new Error('파싱 함수 오류: ' + error.message);
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function saveRecordToDB(fields) {
  const { data, error } = await supabase.from('msds_records').insert({
    user_id: user.id, status: 'active', version: 1, history: [],
    has_pdf: false, created_at: new Date().toISOString(), ...fields,
  }).select().single();
  if (error) throw new Error('DB 저장 실패: ' + error.message);
  return data.id;
}

async function uploadFile(recId, fileName, base64Data, mediaType) {
  const ext = mediaType === 'application/pdf' ? 'pdf' : (mediaType.split('/')[1] || 'bin');
  const path = `${user.id}/${recId}.${ext}`;
  const blob = base64ToBlob(base64Data, mediaType);
  const { error } = await supabase.storage.from('msds-pdfs').upload(path, blob, { contentType: mediaType, upsert: true });
  if (error) { console.warn('파일 업로드 실패:', error.message); return; }
  await supabase.from('msds_records').update({ has_pdf: true, pdf_name: fileName, pdf_path: path }).eq('id', recId);
}

// ═══════════════ Manual Save ═══════════════
function chk(id) { const el = document.getElementById(id); return (el && el.checked) ? 'Y' : 'N'; }
async function saveManual() {
  const productName = document.getElementById('f_productName').value.trim();
  const supplier = document.getElementById('f_supplier').value.trim();
  const contractor = document.getElementById('f_contractor').value;
  if (!productName || !supplier || !contractor) { toast('제품명·공급업체·협력사는 필수', 'error'); return; }
  const legalSpecial = chk('f_legal_special');
  const fields = {
    product_name: productName, supplier, contractor,
    work_type: val('f_workType'), supplier_contact: val('f_supplierContact'),
    cas_no: val('f_casNo'), components: val('f_components'), signal_word: val('f_signalWord'),
    h_codes: val('f_hCodes'), p_codes: val('f_pCodes'), pictograms: val('f_pictograms'),
    issue_date: val('f_issueDate'), protective_equipment: val('f_protectiveEquipment'),
    legal_measurement: chk('f_legal_measurement'), legal_exam: chk('f_legal_exam'),
    legal_exam_cycle: val('f_legalExamCycle'), legal_manage: chk('f_legal_manage'),
    legal_permit: chk('f_legal_permit'), legal_special: legalSpecial, legal_dangerous: chk('f_legal_dangerous'),
    special: legalSpecial === 'Y' ? 'Y_special' : 'N',
  };
  try {
    if (editingId) {
      const old = records.find(r => r.id === editingId);
      const nv = (old.version || 1) + 1;
      const history = old.history || [];
      history.push({ version: old.version || 1, date: (old.updated_at || old.created_at || '').split('T')[0], note: '이전 버전' });
      const { error } = await supabase.from('msds_records').update({ ...fields, version: nv, history, updated_at: new Date().toISOString() }).eq('id', editingId);
      if (error) throw error;
      toast('수정됨 (v' + nv + ')', 'success');
      editingId = null; document.getElementById('regPageTitle').textContent = 'MSDS 등록';
    } else {
      await saveRecordToDB({ ...fields, receipt_status: 'pending' });
      toast('등록됨', 'success');
    }
    resetForm(); await loadRecords(); showPage('dashboard');
  } catch (err) { toast('저장 실패: ' + err.message, 'error'); }
}
window.saveManual = saveManual;
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function resetForm() {
  ['f_productName', 'f_supplier', 'f_supplierContact', 'f_casNo', 'f_components', 'f_hCodes', 'f_pCodes', 'f_pictograms', 'f_issueDate', 'f_protectiveEquipment', 'f_legalExamCycle'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['f_workType', 'f_signalWord'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['f_legal_measurement', 'f_legal_exam', 'f_legal_manage', 'f_legal_permit', 'f_legal_special', 'f_legal_dangerous'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
  editingId = null;
}
window.resetForm = resetForm;

// ═══════════════ Table ═══════════════
function getFiltered() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const fCon = document.getElementById('filterContractor').value;
  const fWork = document.getElementById('filterWorkType')?.value || '';
  const fSpc = document.getElementById('filterSpecial').value;
  const fSt = document.getElementById('filterStatus').value;
  const fRc = document.getElementById('filterReceipt').value;
  return records.filter(r => {
    const mq = !q || [r.product_name, r.supplier, r.cas_no, r.contractor, r.work_type].join(' ').toLowerCase().includes(q);
    const mc = !fCon || r.contractor === fCon;
    const mw = !fWork || r.work_type === fWork;
    const ms = !fSpc || (fSpc === 'Y' ? r.legal_special === 'Y' : r.legal_special !== 'Y');
    const mst = !fSt || (r.status || 'active') === fSt;
    const mrc = !fRc || (r.receipt_status || 'received') === fRc;
    return mq && mc && mw && ms && mst && mrc;
  });
}
function renderTable() {
  const filtered = getFiltered();
  const tbody = document.getElementById('tableBody');
  if (filtered.length === 0) { tbody.innerHTML = '<tr class="empty-row"><td colspan="13">등록된 MSDS가 없습니다</td></tr>'; return; }
  tbody.innerHTML = filtered.map((r, i) => {
    const sp = r.legal_special === 'Y' ? `<span class="badge badge-danger">특별관리</span>` : `<span class="badge badge-ok">일반</span>`;
    const pdf = r.has_pdf ? `<span class="pdf-link" onclick="viewPDF('${r.id}')">📄 보기</span>` : '<span style="color:var(--text3)">-</span>';
    const st = (r.status || 'active') === 'active' ? `<span class="badge badge-ok status-toggle" onclick="toggleStatus('${r.id}')">● 사용중</span>` : `<span class="badge badge-gray status-toggle" onclick="toggleStatus('${r.id}')">○ 종료</span>`;
    const rc = (r.receipt_status || 'received') === 'received' ? `<span class="badge badge-blue status-toggle" onclick="openReceipt('${r.id}')">✓ 수령</span>` : `<span class="badge badge-danger status-toggle" onclick="openReceipt('${r.id}')">! 미수령</span>`;
    return `<tr><td><input type="checkbox" class="row-check" value="${r.id}" onchange="updateCheckAll()"></td><td style="color:var(--text3)">${i + 1}</td><td><div class="td-product">${r.product_name}</div></td><td>${r.contractor}</td><td>${r.work_type || '-'}</td><td>${r.supplier || '-'}</td><td style="font-size:12px;color:var(--text2)">${r.cas_no || '-'}</td><td>${sp}</td><td>${st}</td><td>${rc}</td><td>${pdf}</td><td><span class="badge badge-blue">v${r.version}</span></td><td><div style="display:flex;gap:4px;"><button class="btn btn-secondary btn-sm btn-icon" onclick="showDetail('${r.id}')">👁</button><button class="btn btn-secondary btn-sm btn-icon" onclick="startEdit('${r.id}')">✏️</button><button class="btn btn-danger btn-sm btn-icon" onclick="deleteRecord('${r.id}')">🗑</button></div></td></tr>`;
  }).join('');
  updateCheckAll();
}
window.renderTable = renderTable;
function toggleAll(cb) { document.querySelectorAll('.row-check').forEach(c => c.checked = cb.checked); }
window.toggleAll = toggleAll;
function updateCheckAll() { const all = document.querySelectorAll('.row-check'), ch = document.querySelectorAll('.row-check:checked'); const ca = document.getElementById('checkAll'); if (ca) ca.checked = all.length > 0 && all.length === ch.length; }
window.updateCheckAll = updateCheckAll;
function getCheckedIds() { return [...document.querySelectorAll('.row-check:checked')].map(c => c.value); }

// ═══════════════ Status / Receipt ═══════════════
async function toggleStatus(id) {
  const r = records.find(x => x.id === id); if (!r) return;
  const newStatus = (r.status || 'active') === 'active' ? 'ended' : 'active';
  const { error } = await supabase.from('msds_records').update({ status: newStatus }).eq('id', id);
  if (error) { toast('변경 실패', 'error'); return; }
  r.status = newStatus; renderTable(); updateStats();
  toast(newStatus === 'active' ? '사용중으로 변경' : '사용종료로 변경');
}
window.toggleStatus = toggleStatus;

function openReceipt(id) {
  const r = records.find(x => x.id === id); if (!r) return; receiptEditId = id;
  const received = (r.receipt_status || 'received') === 'received';
  document.getElementById('receiptBody').innerHTML = `
    <div style="font-size:13px;color:var(--text2);margin-bottom:16px;"><strong style="color:var(--text)">${r.product_name}</strong> · ${r.contractor}</div>
    <div class="form-field" style="margin-bottom:14px;"><label class="form-label">수령 상태</label><select class="form-input" id="rc_status"><option value="received" ${received ? 'selected' : ''}>✓ 수령 완료</option><option value="pending" ${!received ? 'selected' : ''}>! 미수령</option></select></div>
    <div class="form-field" style="margin-bottom:14px;"><label class="form-label">수령일</label><input class="form-input" type="date" id="rc_date" value="${r.receipt_date || ''}"></div>
    <div class="form-field" style="margin-bottom:14px;"><label class="form-label">담당자</label><input class="form-input" id="rc_manager" value="${r.receipt_manager || ''}" placeholder="예) 김OO 과장"></div>
    <div class="form-field"><label class="form-label">비고</label><input class="form-input" id="rc_note" value="${r.receipt_note || ''}"></div>`;
  openModal('receiptModal');
}
window.openReceipt = openReceipt;
async function saveReceipt() {
  const upd = { receipt_status: val('rc_status'), receipt_date: val('rc_date'), receipt_manager: val('rc_manager'), receipt_note: val('rc_note') };
  const { error } = await supabase.from('msds_records').update(upd).eq('id', receiptEditId);
  if (error) { toast('저장 실패', 'error'); return; }
  Object.assign(records.find(r => r.id === receiptEditId), upd);
  closeModal('receiptModal'); renderTable(); updateStats(); toast('수령 정보 저장됨', 'success');
}
window.saveReceipt = saveReceipt;

// ═══════════════ Detail ═══════════════
function showDetail(id) {
  const r = records.find(x => x.id === id); if (!r) return; currentDetailId = id;
  document.getElementById('detailTitle').textContent = r.product_name;
  const yn = v => v === 'Y' ? '<span style="color:var(--danger);font-weight:700">해당 ●</span>' : '<span style="color:var(--text3)">비해당</span>';
  const hist = r.history && r.history.length > 0
    ? `<div class="version-list">${r.history.map(h => `<div class="version-item"><span class="version-badge">v${h.version}</span><span class="version-date">${h.date}</span><span class="version-note">${h.note || '-'}</span></div>`).join('')}<div class="version-item"><span class="version-badge" style="background:var(--ok)">v${r.version} (현재)</span><span class="version-date">${(r.updated_at || r.created_at || '').split('T')[0]}</span><span class="version-note">최신본</span></div></div>`
    : `<div style="color:var(--text3);font-size:12px">개정 이력 없음 (현재 v${r.version})</div>`;
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-section"><div class="detail-row"><div class="detail-key">제품명</div><div class="detail-val"><strong>${r.product_name}</strong></div></div><div class="detail-row"><div class="detail-key">사용 협력사</div><div class="detail-val">${r.contractor}</div></div><div class="detail-row"><div class="detail-key">취급 공종</div><div class="detail-val">${r.work_type || '-'}</div></div><div class="detail-row"><div class="detail-key">공급업체</div><div class="detail-val">${r.supplier || '-'}${r.supplier_contact ? ' (' + r.supplier_contact + ')' : ''}</div></div><div class="detail-row"><div class="detail-key">MSDS 개정일</div><div class="detail-val">${r.issue_date || '-'}</div></div>${r.pdf_name ? `<div class="detail-row"><div class="detail-key">원본 파일</div><div class="detail-val">${r.has_pdf ? `<span class="pdf-link" onclick="viewPDF('${r.id}')">📄 ${r.pdf_name}</span>` : r.pdf_name}</div></div>` : ''}</div>
    <div class="detail-section"><div class="detail-row"><div class="detail-key">CAS No.</div><div class="detail-val">${r.cas_no || '-'}</div></div><div class="detail-row"><div class="detail-key">구성성분</div><div class="detail-val" style="white-space:pre-wrap">${r.components || '-'}</div></div></div>
    <div class="detail-section"><div class="detail-row"><div class="detail-key">신호어</div><div class="detail-val">${r.signal_word || '-'}</div></div><div class="detail-row"><div class="detail-key">H코드</div><div class="detail-val">${r.h_codes || '-'}</div></div><div class="detail-row"><div class="detail-key">P코드</div><div class="detail-val">${r.p_codes || '-'}</div></div><div class="detail-row"><div class="detail-key">GHS 픽토그램</div><div class="detail-val">${r.pictograms || '-'}</div></div><div class="detail-row"><div class="detail-key">추천 보호구</div><div class="detail-val">${r.protective_equipment || '-'}</div></div></div>
    <div class="detail-section"><div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:12px;">법정 대상물질</div>
      <div class="detail-row"><div class="detail-key">작업환경측정</div><div class="detail-val">${yn(r.legal_measurement)}</div></div>
      <div class="detail-row"><div class="detail-key">특수건강진단</div><div class="detail-val">${yn(r.legal_exam)} ${r.legal_exam === 'Y' && r.legal_exam_cycle ? '· ' + r.legal_exam_cycle : ''}</div></div>
      <div class="detail-row"><div class="detail-key">관리대상유해물질</div><div class="detail-val">${yn(r.legal_manage)}</div></div>
      <div class="detail-row"><div class="detail-key">허가대상유해물질</div><div class="detail-val">${yn(r.legal_permit)}</div></div>
      <div class="detail-row"><div class="detail-key">특별관리물질</div><div class="detail-val">${yn(r.legal_special)}</div></div>
      <div class="detail-row"><div class="detail-key">위험물 규제</div><div class="detail-val">${yn(r.legal_dangerous)}</div></div>
    </div>
    <div class="detail-section"><div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:12px;">개정 이력</div>${hist}</div>`;
  const pdfBtn = document.getElementById('detailViewPdfBtn'); pdfBtn.style.display = r.has_pdf ? 'inline-flex' : 'none';
  pdfBtn.onclick = () => { closeModal('detailModal'); viewPDF(r.id); };
  document.getElementById('detailDeleteBtn').onclick = () => { closeModal('detailModal'); deleteRecord(id); };
  openModal('detailModal');
}
window.showDetail = showDetail;
function editRecord() { closeModal('detailModal'); startEdit(currentDetailId); }
window.editRecord = editRecord;
function startEdit(id) {
  const r = records.find(x => x.id === id); if (!r) return; editingId = id;
  showPage('register');
  document.getElementById('manualSection').open = true;
  document.getElementById('regPageTitle').textContent = `MSDS 수정 (v${r.version} → v${r.version + 1})`;
  populateFormSelects();
  setTimeout(() => {
    set('f_productName', r.product_name); set('f_supplier', r.supplier); set('f_supplierContact', r.supplier_contact);
    set('f_contractor', r.contractor); set('f_workType', r.work_type); set('f_casNo', r.cas_no); set('f_components', r.components);
    set('f_signalWord', r.signal_word); set('f_hCodes', r.h_codes); set('f_pCodes', r.p_codes);
    set('f_pictograms', r.pictograms); set('f_issueDate', r.issue_date); set('f_protectiveEquipment', r.protective_equipment);
    set('f_legalExamCycle', r.legal_exam_cycle);
    setChk('f_legal_measurement', r.legal_measurement); setChk('f_legal_exam', r.legal_exam);
    setChk('f_legal_manage', r.legal_manage); setChk('f_legal_permit', r.legal_permit);
    setChk('f_legal_special', r.legal_special); setChk('f_legal_dangerous', r.legal_dangerous);
  }, 50);
}
window.startEdit = startEdit;
function set(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }
function setChk(id, v) { const el = document.getElementById(id); if (el) el.checked = (v === 'Y'); }

async function deleteRecord(id) {
  const r = records.find(x => x.id === id);
  if (!confirm(`"${r?.product_name || '이 항목'}"을(를) 삭제하시겠습니까?\n원본 PDF도 함께 삭제됩니다.`)) return;
  if (r.has_pdf && r.pdf_path) await supabase.storage.from('msds-pdfs').remove([r.pdf_path]);
  const { error } = await supabase.from('msds_records').delete().eq('id', id);
  if (error) { toast('삭제 실패', 'error'); return; }
  await loadRecords(); toast('삭제되었습니다');
}
window.deleteRecord = deleteRecord;

// ═══════════════ PDF Viewer ═══════════════
async function viewPDF(id) {
  const r = records.find(x => x.id === id);
  if (!r?.pdf_path) { toast('원본 파일이 없습니다', 'error'); return; }
  const { data, error } = await supabase.storage.from('msds-pdfs').createSignedUrl(r.pdf_path, 3600);
  if (error) { toast('파일 로드 실패', 'error'); return; }
  currentPdfUrl = data.signedUrl;
  const isImage = /\.(jpg|jpeg|png|webp)$/i.test(r.pdf_path);
  const frame = document.getElementById('pdfFrame');
  if (isImage) {
    frame.style.display = 'none';
    let img = document.getElementById('pdfImg');
    if (!img) { img = document.createElement('img'); img.id = 'pdfImg'; img.style.cssText = 'width:100%;max-height:70vh;object-fit:contain;background:#fff;border-radius:6px;'; frame.parentNode.appendChild(img); }
    img.style.display = 'block'; img.src = currentPdfUrl;
  } else {
    frame.style.display = 'block'; frame.src = currentPdfUrl;
    const img = document.getElementById('pdfImg'); if (img) img.style.display = 'none';
  }
  document.getElementById('pdfModalTitle').textContent = r.product_name;
  document.getElementById('pdfDownloadBtn').onclick = () => window.open(currentPdfUrl, '_blank');
  openModal('pdfModal');
}
window.viewPDF = viewPDF;
function closePdfModal() { closeModal('pdfModal'); document.getElementById('pdfFrame').src = ''; const img = document.getElementById('pdfImg'); if (img) img.src = ''; currentPdfUrl = null; }
window.closePdfModal = closePdfModal;
function base64ToBlob(b64, type) { const bytes = atob(b64); const arr = new Uint8Array(bytes.length); for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i); return new Blob([arr], { type }); }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }

// ═══════════════ Package ═══════════════
function openPackageModal() {
  const sel = document.getElementById('pkgContractor'); const cur = sel.value;
  sel.innerHTML = '<option value="">선택하세요</option>' + contractors.map(c => `<option>${c.name}</option>`).join('');
  sel.value = cur; updatePkgCount(); openModal('packageModal');
}
window.openPackageModal = openPackageModal;
function pkgTargets() {
  const con = document.getElementById('pkgContractor').value;
  const st = document.getElementById('pkgStatus').value;
  if (!con) return [];
  return records.filter(r => r.contractor === con && (!st || (r.status || 'active') === st));
}
function updatePkgCount() {
  const t = pkgTargets(); const el = document.getElementById('pkgCount');
  if (!document.getElementById('pkgContractor').value) { el.textContent = ''; return; }
  el.textContent = `해당 물질 ${t.length}건 (원본 PDF ${t.filter(r => r.has_pdf).length}건)`;
}
window.updatePkgCount = updatePkgCount;
async function exportPackage() {
  const con = document.getElementById('pkgContractor').value;
  if (!con) { toast('협력사를 선택해주세요', 'error'); return; }
  const targets = pkgTargets();
  if (targets.length === 0) { toast('해당 협력사 물질이 없습니다', 'error'); return; }
  const wantList = document.getElementById('pkgList').checked;
  const wantPdf = document.getElementById('pkgPdf').checked;
  const wantWarn = document.getElementById('pkgWarn').checked;
  if (!wantList && !wantPdf && !wantWarn) { toast('출력 항목을 선택해주세요', 'error'); return; }
  const today = new Date().toISOString().split('T')[0];
  toast(`${con} 패키지 생성 중...`);
  const zip = new JSZip(); const root = zip.folder(`${con}_MSDS_${today}`);
  if (wantList) {
    const YN = v => v === 'Y' ? 'O' : '';
    const rows = [];
    let no = 0;
    targets.forEach(r => {
      no++;
      const comps = splitComponents(r);
      comps.forEach((comp, idx) => {
        rows.push({
          'No.': idx === 0 ? no : '', '취급공종': idx === 0 ? (r.work_type || '') : '',
          '제품명': idx === 0 ? r.product_name : '', '공급업체': idx === 0 ? (r.supplier || '') : '',
          '연락처': idx === 0 ? (r.supplier_contact || '') : '', 'MSDS개정일': idx === 0 ? (r.issue_date || '') : '',
          'CAS No.': comp.cas || '', '구성성분명': comp.name || '',
          '작업환경측정': idx === 0 ? YN(r.legal_measurement) : '',
          '특수검진': idx === 0 ? (r.legal_exam === 'Y' ? (r.legal_exam_cycle || '대상') : '') : '',
          '관리대상': idx === 0 ? YN(r.legal_manage) : '', '허가대상': idx === 0 ? YN(r.legal_permit) : '',
          '특별관리': idx === 0 ? YN(r.legal_special) : '', '위험물': idx === 0 ? YN(r.legal_dangerous) : '',
          '추천보호구': idx === 0 ? (r.protective_equipment || '') : '',
          '사용상태': idx === 0 ? ((r.status || 'active') === 'active' ? '사용중' : '종료') : '',
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, con.slice(0, 30));
    root.file(`${con}_MSDS목록_${today}.xlsx`, XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
  }
  if (wantPdf) {
    const pf = root.folder('원본PDF');
    for (const r of targets) {
      if (!r.has_pdf || !r.pdf_path) continue;
      const { data } = await supabase.storage.from('msds-pdfs').download(r.pdf_path);
      if (!data) continue;
      let fname = r.pdf_name || (r.product_name + '.pdf'); let n = fname, c = 1;
      while (pf.file(n)) { n = fname.replace(/\.pdf$/i, `_${c}.pdf`); c++; }
      pf.file(n, data);
    }
  }
  const content = await zip.generateAsync({ type: 'blob' });
  downloadBlob(content, `${con}_MSDS패키지_${today}.zip`);
  if (wantWarn) setTimeout(() => printWarningsFor(targets, `${con} (협력사)`), 600);
  toast(`${con} 패키지 다운로드 완료`, 'success');
  closeModal('packageModal');
}
window.exportPackage = exportPackage;

// ═══════════════ List Print (A4 가로) ═══════════════
function printList() {
  const filtered = getFiltered();
  if (filtered.length === 0) { toast('인쇄할 데이터가 없습니다', 'error'); return; }
  const fCon = document.getElementById('filterContractor').value;
  const fWork = document.getElementById('filterWorkType')?.value || '';
  let title = 'MSDS 관리대장';
  if (fCon) title += ` — ${fCon}`;
  if (fWork) title += ` / ${fWork}`;
  const YN = v => v === 'Y' ? '●' : '';
  const rowsHtml = filtered.map((r, i) => `<tr>
    <td class="ctr">${i + 1}</td>
    <td>${r.contractor}</td>
    <td>${r.work_type || '-'}</td>
    <td class="pname">${r.product_name}</td>
    <td>${r.supplier || '-'}</td>
    <td>${r.supplier_contact || '-'}</td>
    <td class="ctr">${r.issue_date || '-'}</td>
    <td>${r.cas_no || '-'}</td>
    <td class="ctr">${YN(r.legal_measurement)}</td>
    <td class="ctr">${r.legal_exam === 'Y' ? (r.legal_exam_cycle || '●') : ''}</td>
    <td class="ctr">${YN(r.legal_manage)}</td>
    <td class="ctr">${YN(r.legal_permit)}</td>
    <td class="ctr">${YN(r.legal_special)}</td>
    <td class="ctr">${YN(r.legal_dangerous)}</td>
    <td class="pe">${r.protective_equipment || '-'}</td>
  </tr>`).join('');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
    @page{size:A4 landscape;margin:8mm;}
    *{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;}
    thead{display:table-header-group;}
    .doc-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:6px;border-bottom:3px solid #111;padding-bottom:6px;}
    .doc-title{font-size:16px;font-weight:800;}
    .doc-meta{font-size:10px;color:#555;text-align:right;}
    .legend{font-size:9px;color:#444;margin-bottom:6px;line-height:1.4;}
    .legend b{color:#000;}
    table{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed;}
    th{background:#333;color:#fff;padding:4px 2px;text-align:center;font-weight:700;border:1px solid #333;}
    td{padding:3px 3px;border:1px solid #ccc;vertical-align:top;word-break:break-all;}
    tr:nth-child(even) td{background:#f7f7f7;}
    .pname{font-weight:700;}
    .ctr{text-align:center;}
    .pe{font-size:7.5px;}
    @media print{tr{page-break-inside:avoid;}}
    /* 컬럼 너비 (합 100%) */
    col.no{width:2.5%;} col.con{width:8%;} col.work{width:6%;} col.prod{width:13%;}
    col.sup{width:9%;} col.tel{width:7%;} col.date{width:6%;} col.cas{width:8%;}
    col.m{width:4%;} col.exam{width:7%;} col.mg{width:5%;} col.pm{width:5%;} col.sp{width:4.5%;} col.dg{width:4.5%;} col.pe{width:10%;}
  </style></head><body>
    <div class="doc-head"><div class="doc-title">${title}</div><div class="doc-meta">총 ${filtered.length}건 · 출력일 ${new Date().toISOString().split('T')[0]}</div></div>
    <div class="legend"><b>범례</b> · ●=해당 · 측정=작업환경측정 대상 · 특수검진=특수건강진단(배치후/이후 주기) · 관리=관리대상유해물질 · 허가=허가대상유해물질 · 특별=특별관리물질(CMR) · 위험물=위험물안전관리법 규제대상</div>
    <table>
      <colgroup><col class="no"><col class="con"><col class="work"><col class="prod"><col class="sup"><col class="tel"><col class="date"><col class="cas"><col class="m"><col class="exam"><col class="mg"><col class="pm"><col class="sp"><col class="dg"><col class="pe"></colgroup>
      <thead><tr><th>No</th><th>협력사</th><th>공종</th><th>제품명</th><th>공급업체</th><th>연락처</th><th>개정일</th><th>CAS No.</th><th>측정</th><th>특수검진</th><th>관리</th><th>허가</th><th>특별</th><th>위험물</th><th>추천 보호구</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script>
  </body></html>`);
  w.document.close();
  toast(`${filtered.length}건 인쇄 준비 완료`, 'success');
}
window.printList = printList;

// ═══════════════ Warning Labels ═══════════════
function renderWarnPickList() {
  const el = document.getElementById('warnPickList');
  if (records.length === 0) { el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3);font-size:13px">등록된 물질이 없습니다</div>'; return; }
  el.innerHTML = records.map(r => `<label class="warn-pick-item"><input type="checkbox" class="warn-check" value="${r.id}" onchange="onWarnCheck('${r.id}',this.checked)" ${warnSelected.has(r.id) ? 'checked' : ''}><div style="flex:1"><div class="wp-name">${r.product_name}</div><div class="wp-sub">${r.contractor || ''} ${r.signal_word ? '· ' + r.signal_word : ''}</div></div>${r.legal_special === 'Y' ? '<span class="badge badge-danger">특별</span>' : ''}</label>`).join('');
}
function onWarnCheck(id, checked) { if (checked) warnSelected.add(id); else warnSelected.delete(id); updateWarningPreview(); }
window.onWarnCheck = onWarnCheck;
function selectAllWarn(v) { warnSelected = v ? new Set(records.map(r => r.id)) : new Set(); document.querySelectorAll('.warn-check').forEach(c => c.checked = v); updateWarningPreview(); }
window.selectAllWarn = selectAllWarn;
function updateWarningPreview() {
  const ids = [...warnSelected]; const prev = document.getElementById('warningPreview');
  if (ids.length === 0) { prev.innerHTML = '<div class="warn-empty">왼쪽에서 물질을 선택하세요</div>'; return; }
  const site = document.getElementById('warningSite').value || '현장명';
  const first = records.find(r => r.id === ids[0]);
  prev.innerHTML = `<div style="font-size:12px;color:var(--text2);margin-bottom:12px;"><strong style="color:var(--text)">${ids.length}개</strong> 선택됨 · A4 한 장에 하나씩 출력</div><div style="transform:scale(0.85);transform-origin:top center;">${buildWarnLabel(first, site)}</div>`;
}
window.updateWarningPreview = updateWarningPreview;

// 경고표지 HTML (미리보기·인쇄 공용) — 두번째 예시 디자인 기반
function buildWarnLabel(r, site) {
  const isDanger = r.signal_word && r.signal_word.includes('위험');
  const codes = (r.pictograms || '').match(/GHS\d{2}/g) || [];
  const pictoHtml = codes.length
    ? codes.map(c => ghsPictogramWithLabel(c, 92)).join('')
    : `<div style="font-size:40px;">⚠️</div>`;
  const hList = decodeHCodes(r.h_codes);
  const pList = decodePCodes(r.p_codes);
  const hHtml = hList.length ? hList.map(h => `<li>${h.text}</li>`).join('') : '<li>해당 정보 없음</li>';
  const pHtml = pList.length ? pList.map(p => `<li>${p.text}</li>`).join('') : '<li>해당 정보 없음</li>';

  return `<div class="wlabel">
    <div class="wl-top">(산업안전보건법 제114조 규정에 의한 경고표지)</div>
    <div class="wl-name-box">${r.product_name}</div>
    <div class="wl-picto-row">${pictoHtml}</div>
    <div class="wl-signal-bar ${isDanger ? 'danger' : 'warning'}">신호어 : ${r.signal_word || '경고'}</div>
    <div class="wl-block">
      <div class="wl-block-head">유해·위험 문구</div>
      <ul class="wl-list">${hHtml}</ul>
    </div>
    <div class="wl-block">
      <div class="wl-block-head">예방조치 문구</div>
      <ul class="wl-list">${pHtml}</ul>
    </div>
    ${r.protective_equipment ? `<div class="wl-block"><div class="wl-block-head">착용 보호구</div><div class="wl-pe">${r.protective_equipment}</div></div>` : ''}
    ${r.legal_special === 'Y' ? `<div class="wl-special">⚠️ 특별관리물질 — 발암성·생식독성 등, 취급 시 관리감독자 확인 및 특별안전보건교육 대상</div>` : ''}
    <div class="wl-foot">
      <div><b>공급업체</b> ${r.supplier || '-'} ${r.supplier_contact ? '(' + r.supplier_contact + ')' : ''}</div>
      <div><b>사용 협력사</b> ${r.contractor || '-'} ${r.work_type ? '/ ' + r.work_type : ''}</div>
      <div><b>현장</b> ${site}</div>
      <div class="wl-ref">■ 기타 자세한 내용은 물질안전보건자료(MSDS) 참조</div>
    </div>
  </div>`;
}

function warnPrintStyles() {
  return `@page{size:A4;margin:10mm;}*{box-sizing:border-box;}
  body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;}
  .page-a4{width:100%;min-height:277mm;page-break-after:always;}
  .page-a4:last-child{page-break-after:auto;}
  .wlabel{border:3px solid #111;border-radius:6px;padding:20px;height:100%;}
  .wl-top{text-align:center;font-size:18px;font-weight:800;margin-bottom:14px;}
  .wl-name-box{border:3px solid #e30613;border-radius:6px;text-align:center;font-size:40px;font-weight:900;letter-spacing:8px;padding:14px;margin-bottom:20px;}
  .wl-picto-row{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;margin-bottom:18px;}
  .wl-signal-bar{text-align:center;font-size:24px;font-weight:900;color:#fff;padding:8px;border-radius:6px;margin-bottom:18px;}
  .wl-signal-bar.danger{background:#c0392b;}
  .wl-signal-bar.warning{background:#e67e22;}
  .wl-block{margin-bottom:14px;border:1.5px solid #bbb;border-radius:6px;overflow:hidden;}
  .wl-block-head{background:#c0392b;color:#fff;font-size:16px;font-weight:800;padding:7px 14px;}
  .wl-list{margin:0;padding:12px 14px 12px 34px;font-size:16px;line-height:1.7;}
  .wl-list li{margin-bottom:4px;}
  .wl-pe{padding:12px 16px;font-size:16px;line-height:1.6;font-weight:600;}
  .wl-special{background:#fff3cd;border:2.5px solid #ffc107;border-radius:6px;padding:12px;margin-bottom:14px;font-size:15px;font-weight:800;color:#856404;text-align:center;}
  .wl-foot{border-top:2px solid #111;padding-top:12px;font-size:14px;line-height:1.8;}
  .wl-foot b{display:inline-block;min-width:90px;color:#444;}
  .wl-ref{margin-top:8px;font-weight:700;text-align:center;font-size:13px;}`;
}

function printWarnings() {
  const ids = [...warnSelected];
  if (ids.length === 0) { toast('인쇄할 물질을 선택해주세요', 'error'); return; }
  const site = document.getElementById('warningSite').value || '현장명';
  const labels = ids.map(id => records.find(r => r.id === id)).filter(Boolean);
  printWarningsFor(labels, site);
}
window.printWarnings = printWarnings;
function printWarningsFor(labels, site) {
  if (!labels || labels.length === 0) return;
  const pages = labels.map(r => `<div class="page-a4">${buildWarnLabel(r, site)}</div>`).join('');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>경고표지 (${labels.length}건)</title><style>${warnPrintStyles()}</style></head><body>${pages}<script>window.onload=function(){setTimeout(function(){window.print();},500);}<\/script></body></html>`);
  w.document.close();
  toast(`${labels.length}건 인쇄 준비 완료`, 'success');
}

// ═══════════════ Excel ═══════════════
// 구성성분 문자열을 성분별로 분해: "아세톤(67-64-1) 30%, 톨루엔(108-88-3) 20%"
function splitComponents(r) {
  const comp = r.components || '';
  const casAll = r.cas_no || '';
  // 성분 단위로 split (쉼표 기준이나 괄호 안 쉼표 보호)
  let parts = comp.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    // 구성성분 텍스트 없으면 CAS만 분리
    const cass = casAll.split(',').map(s => s.trim()).filter(Boolean);
    if (cass.length === 0) return [{ name: '', cas: '' }];
    return cass.map(c => ({ name: '', cas: c }));
  }
  return parts.map(p => {
    const m = p.match(/\(([\d-]+)\)/);
    const cas = m ? m[1] : '';
    const name = p.replace(/\([\d-]+\)/, '').trim();
    return { name, cas };
  });
}

function exportExcel() {
  const filtered = getFiltered();
  if (filtered.length === 0) { toast('내보낼 데이터가 없습니다', 'error'); return; }
  const YN = v => v === 'Y' ? 'O' : '';
  const rows = [];
  let no = 0;
  filtered.forEach(r => {
    no++;
    const comps = splitComponents(r);
    comps.forEach((comp, idx) => {
      rows.push({
        'No.': idx === 0 ? no : '',
        '사용 협력사': idx === 0 ? r.contractor : '',
        '취급 공종': idx === 0 ? (r.work_type || '') : '',
        '제품명': idx === 0 ? r.product_name : '',
        '공급업체': idx === 0 ? (r.supplier || '') : '',
        '공급업체 연락처': idx === 0 ? (r.supplier_contact || '') : '',
        'MSDS 개정일자': idx === 0 ? (r.issue_date || '') : '',
        'CAS No.': comp.cas || '',
        '구성성분명': comp.name || '',
        '작업환경측정': idx === 0 ? YN(r.legal_measurement) : '',
        '특수검진 주기(배치후/이후)': idx === 0 ? (r.legal_exam === 'Y' ? (r.legal_exam_cycle || '대상') : '') : '',
        '관리대상유해물질': idx === 0 ? YN(r.legal_manage) : '',
        '허가대상유해물질': idx === 0 ? YN(r.legal_permit) : '',
        '특별관리물질': idx === 0 ? YN(r.legal_special) : '',
        '위험물 규제': idx === 0 ? YN(r.legal_dangerous) : '',
        '추천 보호구': idx === 0 ? (r.protective_equipment || '') : '',
      });
    });
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  // 열 너비
  ws['!cols'] = [
    { wch: 5 }, { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 12 },
    { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 9 }, { wch: 30 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MSDS 관리대장');
  const fCon = document.getElementById('filterContractor').value;
  const tag = fCon ? `_${fCon}` : '';
  XLSX.writeFile(wb, `MSDS_관리대장${tag}_${new Date().toISOString().split('T')[0]}.xlsx`);
  toast('엑셀 다운로드 완료', 'success');
}
window.exportExcel = exportExcel;

// ═══════════════ Contractors ═══════════════
function renderContractorTags() {
  document.getElementById('contractorTags').innerHTML = contractors.map(c => `<span class="tag">${c.name}<span class="tag-remove" onclick="removeContractor('${c.id}')">✕</span></span>`).join('');
}
async function addContractor() {
  const v = document.getElementById('newContractor').value.trim(); if (!v) return;
  if (contractors.some(c => c.name === v)) { toast('이미 있는 협력사', 'error'); return; }
  const { data, error } = await supabase.from('contractors').insert({ user_id: user.id, name: v }).select().single();
  if (error) { toast('추가 실패', 'error'); return; }
  contractors.push({ id: data.id, name: data.name });
  renderContractorTags(); populateSelects();
  document.getElementById('newContractor').value = ''; toast(v + ' 추가됨', 'success');
}
window.addContractor = addContractor;
async function removeContractor(id) {
  const { error } = await supabase.from('contractors').delete().eq('id', id);
  if (error) { toast('삭제 실패', 'error'); return; }
  contractors = contractors.filter(c => c.id !== id);
  renderContractorTags(); populateSelects();
}

async function loadWorkTypes() {
  const { data, error } = await supabase.from('work_types').select('*').order('created_at', { ascending: true });
  if (error) { console.warn('공종 로드 실패', error); workTypes = []; renderWorkTypeTags(); populateSelects(); return; }
  workTypes = (data || []).map(w => ({ id: w.id, name: w.name }));
  if (workTypes.length === 0) {
    const defaults = ['철근콘크리트', '형틀목공', '미장', '방수', '도장', '타일', '설비', '전기', '조경'];
    for (const name of defaults) {
      const { data: ins } = await supabase.from('work_types').insert({ user_id: user.id, name }).select().single();
      if (ins) workTypes.push({ id: ins.id, name: ins.name });
    }
  }
  renderWorkTypeTags(); populateSelects();
}
window.removeContractor = removeContractor;

// ═══════════════ Work Types ═══════════════
function renderWorkTypeTags() {
  const el = document.getElementById('workTypeTags');
  if (el) el.innerHTML = workTypes.map(w => `<span class="tag">${w.name}<span class="tag-remove" onclick="removeWorkType('${w.id}')">✕</span></span>`).join('');
}
async function addWorkType() {
  const v = document.getElementById('newWorkType').value.trim(); if (!v) return;
  if (workTypes.some(w => w.name === v)) { toast('이미 있는 공종', 'error'); return; }
  const { data, error } = await supabase.from('work_types').insert({ user_id: user.id, name: v }).select().single();
  if (error) { toast('추가 실패', 'error'); return; }
  workTypes.push({ id: data.id, name: data.name });
  renderWorkTypeTags(); populateSelects(); populateFormSelects();
  document.getElementById('newWorkType').value = ''; toast(v + ' 추가됨', 'success');
}
window.addWorkType = addWorkType;
async function removeWorkType(id) {
  const { error } = await supabase.from('work_types').delete().eq('id', id);
  if (error) { toast('삭제 실패', 'error'); return; }
  workTypes = workTypes.filter(w => w.id !== id);
  renderWorkTypeTags(); populateSelects(); populateFormSelects();
}
window.removeWorkType = removeWorkType;

function populateSelects() {
  const fCon = document.getElementById('filterContractor');
  if (fCon) { const cur = fCon.value; fCon.innerHTML = '<option value="">전체 협력사</option>' + contractors.map(c => `<option>${c.name}</option>`).join(''); fCon.value = cur; }
  const fWork = document.getElementById('filterWorkType');
  if (fWork) { const cur = fWork.value; fWork.innerHTML = '<option value="">전체 공종</option>' + workTypes.map(w => `<option>${w.name}</option>`).join(''); fWork.value = cur; }
}
function populateFormSelects() {
  const b = document.getElementById('batchContractor');
  if (b) { const cur = b.value; b.innerHTML = '<option value="">선택하세요</option>' + contractors.map(c => `<option>${c.name}</option>`).join(''); b.value = cur; }
  const bw = document.getElementById('batchWorkType');
  if (bw) { const cur = bw.value; bw.innerHTML = '<option value="">선택 (선택사항)</option>' + workTypes.map(w => `<option>${w.name}</option>`).join(''); bw.value = cur; }
  const f = document.getElementById('f_contractor');
  if (f) { const cur = f.value; f.innerHTML = '<option value="">선택</option>' + contractors.map(c => `<option>${c.name}</option>`).join(''); f.value = cur; }
  const fw = document.getElementById('f_workType');
  if (fw) { const cur = fw.value; fw.innerHTML = '<option value="">선택</option>' + workTypes.map(w => `<option>${w.name}</option>`).join(''); fw.value = cur; }
}

// ═══════════════ Stats ═══════════════
function updateStats() {
  document.getElementById('statTotal').textContent = records.length;
  document.getElementById('statSpecial').textContent = records.filter(r => r.legal_special === 'Y').length;
  document.getElementById('statActive').textContent = records.filter(r => (r.status || 'active') === 'active').length;
  document.getElementById('statPending').textContent = records.filter(r => (r.receipt_status || 'received') === 'pending').length;
  document.getElementById('dashSubtitle').textContent = `총 ${records.length}건`;
}

// ═══════════════ Modal / Toast ═══════════════
function openModal(id) { document.getElementById(id).classList.add('open'); }
window.openModal = openModal;
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
window.closeModal = closeModal;
function toast(msg, type = '') {
  const wrap = document.getElementById('toastWrap'); const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = (type === 'success' ? '✓ ' : type === 'error' ? '✕ ' : '') + msg;
  wrap.appendChild(el); setTimeout(() => el.remove(), 3000);
}
window.toast = toast;

// ═══════════════ Initial session check ═══════════════
(async () => {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) { user = data.session.user; showApp(); }
})();
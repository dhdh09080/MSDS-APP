import { supabase } from './lib/supabase.js';

// ═══════════════ State ═══════════════
let user = null;
let records = [];
let contractors = [];
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
      msg.textContent = '가입 완료! 이메일 인증 후 로그인하세요.';
      switchAuthTab('login');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    msg.className = 'auth-msg error';
    msg.textContent = translateAuthError(err.message);
  } finally { btn.disabled = false; }
}
window.handleAuth = handleAuth;

function translateAuthError(m) {
  if (m.includes('Invalid login')) return '이메일 또는 비밀번호가 틀렸습니다';
  if (m.includes('already registered')) return '이미 가입된 이메일입니다';
  if (m.includes('Password should')) return '비밀번호는 6자 이상이어야 합니다';
  if (m.includes('Email not confirmed')) return '이메일 인증이 필요합니다 (메일함 확인)';
  return m;
}

async function handleLogout() { await supabase.auth.signOut(); location.reload(); }
window.handleLogout = handleLogout;

supabase.auth.onAuthStateChange((event, session) => {
  if (session?.user) { user = session.user; showApp(); }
  else { user = null; document.getElementById('authScreen').style.display = 'flex'; document.getElementById('appScreen').style.display = 'none'; }
});

async function showApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'flex';
  const siteName = user.user_metadata?.site_name || '';
  document.getElementById('userInfo').textContent = (siteName ? siteName + '\n' : '') + user.email;
  document.getElementById('accountInfo').innerHTML = `이메일: ${user.email}<br>현장명: ${siteName || '(미설정)'}<br>가입일: ${new Date(user.created_at).toLocaleDateString('ko-KR')}`;
  await loadContractors();
  await loadRecords();
}

// ═══════════════ Data ═══════════════
async function loadRecords() {
  const { data, error } = await supabase.from('msds_records').select('*').order('created_at', { ascending: true });
  if (error) { toast('데이터 로드 실패: ' + error.message, 'error'); return; }
  records = data || [];
  updateStats(); renderTable();
}
async function loadContractors() {
  const { data, error } = await supabase.from('contractors').select('*').order('created_at', { ascending: true });
  if (error) { toast('협력사 로드 실패', 'error'); return; }
  contractors = (data || []).map(c => ({ id: c.id, name: c.name }));
  if (contractors.length === 0) {
    const defaults = ['엘엑스하우시스', '화승토건', '대우건설', '현대건설'];
    for (const name of defaults) {
      const { data: ins } = await supabase.from('contractors').insert({ user_id: user.id, name }).select().single();
      if (ins) contractors.push({ id: ins.id, name: ins.name });
    }
  }
  renderContractorTags(); populateSelects();
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
function dragOver(e) { e.preventDefault(); document.getElementById('uploadZone').classList.add('drag'); }
window.dragOver = dragOver;
function dragLeave(e) { document.getElementById('uploadZone').classList.remove('drag'); }
window.dragLeave = dragLeave;
function dropFiles(e) {
  e.preventDefault(); document.getElementById('uploadZone').classList.remove('drag');
  const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
  const non = e.dataTransfer.files.length - files.length;
  if (non > 0) toast(`PDF만 추가됩니다 (${non}개 제외)`, 'error');
  if (files.length) addFilesToQueue(files);
}
window.dropFiles = dropFiles;
function addFilesToQueue(files) {
  files.forEach(file => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const item = { id, file, name: file.name, data: null, status: 'waiting', error: null };
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
  el.innerHTML = fileQueue.map(item => `<div class="file-item ${item.status}"><span class="fi-icon">${icons[item.status]}</span><div class="fi-info"><div class="fi-name">${item.name}</div><div class="fi-status">${item.status === 'error' ? '오류: ' + (item.error || '알수없음') : st[item.status]}</div>${item.status === 'parsing' ? '<div class="file-progress"><div class="file-progress-bar" style="width:60%"></div></div>' : ''}</div>${item.status !== 'parsing' ? `<button class="fi-remove" onclick="removeFileFromQueue('${item.id}')">✕</button>` : ''}</div>`).join('');
}
function updateBatchBar() {
  const bar = document.getElementById('batchBar'), info = document.getElementById('batchInfo');
  if (fileQueue.length === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const done = fileQueue.filter(f => f.status === 'done').length, err = fileQueue.filter(f => f.status === 'error').length, wait = fileQueue.filter(f => f.status === 'waiting').length;
  info.innerHTML = `<strong>${fileQueue.length}개</strong> 파일 · 대기 ${wait} · 완료 ${done}${err ? ` · 오류 ${err}` : ''}`;
  document.getElementById('parseAllBtn').disabled = wait === 0;
}

// ═══════════════ Parse ═══════════════
async function parseAllFiles() {
  const contractor = document.getElementById('batchContractor').value;
  if (!contractor) { toast('사용 협력사를 먼저 선택해주세요', 'error'); return; }
  const waiting = fileQueue.filter(f => f.status === 'waiting');
  if (waiting.length === 0) { toast('대기 중인 파일이 없습니다', 'error'); return; }
  document.getElementById('parseAllBtn').disabled = true;
  let saved = 0;
  for (const item of waiting) {
    item.status = 'parsing'; renderFileQueue();
    try {
      const parsed = await callParseFunction(item.data);
      const recId = await saveRecordToDB({
        product_name: parsed.productName || item.name.replace(/\.pdf$/i, ''),
        manufacturer: parsed.manufacturer || '',
        supplier: parsed.supplier || '',
        contractor,
        cas_no: parsed.casNo || '',
        components: parsed.components || '',
        signal_word: parsed.signalWord || '',
        special: parsed.specialSubstance || 'N',
        h_codes: parsed.hCodes || '',
        p_codes: parsed.pCodes || '',
        pictograms: parsed.pictograms || '',
        issue_date: parsed.issueDate || '',
        receipt_status: 'received',
        receipt_date: new Date().toISOString().split('T')[0],
      });
      await uploadPDF(recId, item.name, item.data);
      saved++; item.status = 'done';
    } catch (err) { item.status = 'error'; item.error = err.message; }
    renderFileQueue(); updateBatchBar();
    await new Promise(r => setTimeout(r, 300));
  }
  await loadRecords();
  toast(`${saved}개 저장 완료${fileQueue.some(f => f.status === 'error') ? ', 일부 오류' : ''}`, saved > 0 ? 'success' : 'error');
  document.getElementById('parseAllBtn').disabled = false;
}
window.parseAllFiles = parseAllFiles;

async function callParseFunction(base64Data) {
  const approxMB = (base64Data.length * 0.75 / 1024 / 1024).toFixed(1);
  if (approxMB > 20) throw new Error(`PDF가 너무 큽니다 (${approxMB}MB)`);
  const { data, error } = await supabase.functions.invoke('parse-msds', { body: { pdfBase64: base64Data } });
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

async function uploadPDF(recId, fileName, base64Data) {
  const path = `${user.id}/${recId}.pdf`;
  const blob = base64ToBlob(base64Data, 'application/pdf');
  const { error } = await supabase.storage.from('msds-pdfs').upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (error) { console.warn('PDF 업로드 실패:', error.message); return; }
  await supabase.from('msds_records').update({ has_pdf: true, pdf_name: fileName, pdf_path: path }).eq('id', recId);
}

// ═══════════════ Manual Save ═══════════════
async function saveManual() {
  const productName = document.getElementById('f_productName').value.trim();
  const manufacturer = document.getElementById('f_manufacturer').value.trim();
  const supplier = document.getElementById('f_supplier').value.trim();
  const contractor = document.getElementById('f_contractor').value;
  if (!productName || !manufacturer || !supplier || !contractor) { toast('제품명·제조사·공급업체·협력사는 필수', 'error'); return; }
  const fields = {
    product_name: productName, manufacturer, supplier, contractor,
    cas_no: val('f_casNo'), components: val('f_components'), signal_word: val('f_signalWord'),
    special: val('f_special'), h_codes: val('f_hCodes'), p_codes: val('f_pCodes'),
    pictograms: val('f_pictograms'), issue_date: val('f_issueDate'), revision_note: val('f_revisionNote'),
  };
  try {
    if (editingId) {
      const old = records.find(r => r.id === editingId);
      const nv = (old.version || 1) + 1;
      const history = old.history || [];
      history.push({ version: old.version || 1, date: old.updated_at || old.created_at, note: old.revision_note || '이전 버전' });
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
function val(id) { return document.getElementById(id)?.value || ''; }
function resetForm() {
  ['f_productName','f_manufacturer','f_supplier','f_casNo','f_components','f_hCodes','f_pCodes','f_pictograms','f_revisionNote','f_issueDate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('f_signalWord').value = ''; document.getElementById('f_special').value = 'N'; editingId = null;
}
window.resetForm = resetForm;

// ═══════════════ Table ═══════════════
function getFiltered() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const fCon = document.getElementById('filterContractor').value;
  const fSpc = document.getElementById('filterSpecial').value;
  const fSt = document.getElementById('filterStatus').value;
  const fRc = document.getElementById('filterReceipt').value;
  return records.filter(r => {
    const mq = !q || [r.product_name, r.manufacturer, r.supplier, r.cas_no, r.contractor].join(' ').toLowerCase().includes(q);
    const mc = !fCon || r.contractor === fCon;
    const ms = !fSpc || (fSpc === 'Y' ? r.special !== 'N' : r.special === 'N');
    const mst = !fSt || (r.status || 'active') === fSt;
    const mrc = !fRc || (r.receipt_status || 'received') === fRc;
    return mq && mc && ms && mst && mrc;
  });
}
function renderTable() {
  const filtered = getFiltered();
  const tbody = document.getElementById('tableBody');
  if (filtered.length === 0) { tbody.innerHTML = '<tr class="empty-row"><td colspan="13">등록된 MSDS가 없습니다</td></tr>'; return; }
  tbody.innerHTML = filtered.map((r, i) => {
    const sp = r.special && r.special !== 'N' ? `<span class="badge badge-danger">특별관리</span>` : `<span class="badge badge-ok">일반</span>`;
    const pdf = r.has_pdf ? `<span class="pdf-link" onclick="viewPDF('${r.id}')">📄 보기</span>` : '<span style="color:var(--text3)">-</span>';
    const st = (r.status || 'active') === 'active' ? `<span class="badge badge-ok status-toggle" onclick="toggleStatus('${r.id}')">● 사용중</span>` : `<span class="badge badge-gray status-toggle" onclick="toggleStatus('${r.id}')">○ 종료</span>`;
    const rc = (r.receipt_status || 'received') === 'received' ? `<span class="badge badge-blue status-toggle" onclick="openReceipt('${r.id}')">✓ 수령</span>` : `<span class="badge badge-danger status-toggle" onclick="openReceipt('${r.id}')">! 미수령</span>`;
    return `<tr><td><input type="checkbox" class="row-check" value="${r.id}" onchange="updateCheckAll()"></td><td style="color:var(--text3)">${i + 1}</td><td><div class="td-product">${r.product_name}</div></td><td>${r.manufacturer || '-'}</td><td>${r.supplier || '-'}</td><td>${r.contractor}</td><td style="font-size:12px;color:var(--text2)">${r.cas_no || '-'}</td><td>${sp}</td><td>${st}</td><td>${rc}</td><td>${pdf}</td><td><span class="badge badge-blue">v${r.version}</span></td><td><div style="display:flex;gap:4px;"><button class="btn btn-secondary btn-sm btn-icon" onclick="showDetail('${r.id}')">👁</button><button class="btn btn-secondary btn-sm btn-icon" onclick="startEdit('${r.id}')">✏️</button><button class="btn btn-danger btn-sm btn-icon" onclick="deleteRecord('${r.id}')">🗑</button></div></td></tr>`;
  }).join('');
  updateCheckAll();
}
window.renderTable = renderTable;
function toggleAll(cb) { document.querySelectorAll('.row-check').forEach(c => c.checked = cb.checked); }
window.toggleAll = toggleAll;
function updateCheckAll() { const all = document.querySelectorAll('.row-check'), ch = document.querySelectorAll('.row-check:checked'); const ca = document.getElementById('checkAll'); if (ca) ca.checked = all.length > 0 && all.length === ch.length; }
window.updateCheckAll = updateCheckAll;

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

// ═══════════════ Detail / Edit / Delete ═══════════════
function showDetail(id) {
  const r = records.find(x => x.id === id); if (!r) return; currentDetailId = id;
  document.getElementById('detailTitle').textContent = r.product_name;
  const sT = { N: '해당없음', Y_cancer: '발암성(1A/1B)', Y_repro: '생식독성', Y_mutagen: '변이원성', Y_sensitizer: '과민성', Y_other: '기타 특별관리' };
  const hist = r.history && r.history.length > 0
    ? `<div class="version-list">${r.history.map(h => `<div class="version-item"><span class="version-badge">v${h.version}</span><span class="version-date">${h.date}</span><span class="version-note">${h.note || '-'}</span></div>`).join('')}<div class="version-item"><span class="version-badge" style="background:var(--ok)">v${r.version} (현재)</span><span class="version-date">${(r.updated_at || r.created_at || '').split('T')[0]}</span><span class="version-note">${r.revision_note || '최신본'}</span></div></div>`
    : `<div style="color:var(--text3);font-size:12px">개정 이력 없음 (현재 v${r.version})</div>`;
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-section"><div class="detail-row"><div class="detail-key">제품명</div><div class="detail-val"><strong>${r.product_name}</strong></div></div><div class="detail-row"><div class="detail-key">제조사</div><div class="detail-val">${r.manufacturer || '-'}</div></div><div class="detail-row"><div class="detail-key">공급업체</div><div class="detail-val">${r.supplier || '-'}</div></div><div class="detail-row"><div class="detail-key">사용 협력사</div><div class="detail-val">${r.contractor}</div></div><div class="detail-row"><div class="detail-key">MSDS 발행일</div><div class="detail-val">${r.issue_date || '-'}</div></div>${r.pdf_name ? `<div class="detail-row"><div class="detail-key">원본 파일</div><div class="detail-val">${r.has_pdf ? `<span class="pdf-link" onclick="viewPDF('${r.id}')">📄 ${r.pdf_name}</span>` : r.pdf_name}</div></div>` : ''}</div>
    <div class="detail-section"><div class="detail-row"><div class="detail-key">CAS No.</div><div class="detail-val">${r.cas_no || '-'}</div></div><div class="detail-row"><div class="detail-key">구성성분</div><div class="detail-val" style="white-space:pre-wrap">${r.components || '-'}</div></div></div>
    <div class="detail-section"><div class="detail-row"><div class="detail-key">신호어</div><div class="detail-val">${r.signal_word || '-'}</div></div><div class="detail-row"><div class="detail-key">특별관리물질</div><div class="detail-val">${sT[r.special] || '-'}</div></div><div class="detail-row"><div class="detail-key">H코드</div><div class="detail-val">${r.h_codes || '-'}</div></div><div class="detail-row"><div class="detail-key">P코드</div><div class="detail-val">${r.p_codes || '-'}</div></div><div class="detail-row"><div class="detail-key">GHS 픽토그램</div><div class="detail-val">${r.pictograms || '-'}</div></div></div>
    <div class="detail-section"><div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--accent);margin-bottom:12px;">개정 이력</div>${hist}</div>`;
  const pdfBtn = document.getElementById('detailViewPdfBtn');
  pdfBtn.style.display = r.has_pdf ? 'inline-flex' : 'none';
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
    set('f_productName', r.product_name); set('f_manufacturer', r.manufacturer); set('f_supplier', r.supplier);
    set('f_contractor', r.contractor); set('f_casNo', r.cas_no); set('f_components', r.components);
    set('f_signalWord', r.signal_word); set('f_special', r.special || 'N');
    set('f_hCodes', r.h_codes); set('f_pCodes', r.p_codes); set('f_pictograms', r.pictograms); set('f_issueDate', r.issue_date);
  }, 50);
}
window.startEdit = startEdit;
function set(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }

async function deleteRecord(id) {
  const r = records.find(x => x.id === id);
  if (!confirm(`"${r?.product_name || '이 항목'}"을(를) 삭제하시겠습니까?`)) return;
  if (r.has_pdf && r.pdf_path) await supabase.storage.from('msds-pdfs').remove([r.pdf_path]);
  const { error } = await supabase.from('msds_records').delete().eq('id', id);
  if (error) { toast('삭제 실패', 'error'); return; }
  await loadRecords(); toast('삭제되었습니다');
}
window.deleteRecord = deleteRecord;

// ═══════════════ PDF Viewer ═══════════════
async function viewPDF(id) {
  const r = records.find(x => x.id === id);
  if (!r?.pdf_path) { toast('원본 PDF가 없습니다', 'error'); return; }
  const { data, error } = await supabase.storage.from('msds-pdfs').createSignedUrl(r.pdf_path, 3600);
  if (error) { toast('PDF 로드 실패', 'error'); return; }
  currentPdfUrl = data.signedUrl;
  document.getElementById('pdfFrame').src = currentPdfUrl;
  document.getElementById('pdfModalTitle').textContent = r.product_name;
  document.getElementById('pdfDownloadBtn').onclick = () => window.open(currentPdfUrl, '_blank');
  openModal('pdfModal');
}
window.viewPDF = viewPDF;
function closePdfModal() { closeModal('pdfModal'); document.getElementById('pdfFrame').src = ''; currentPdfUrl = null; }
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
    const sT = { N: '해당없음', Y_cancer: '발암성(1A/1B)', Y_repro: '생식독성', Y_mutagen: '변이원성', Y_sensitizer: '과민성', Y_other: '기타' };
    const rows = targets.map((r, i) => ({ 'No.': i + 1, '제품명': r.product_name, '제조사': r.manufacturer, '공급업체': r.supplier, 'CAS No.': r.cas_no, '신호어': r.signal_word, '특별관리물질': sT[r.special] || r.special, '사용상태': (r.status || 'active') === 'active' ? '사용중' : '종료', '수령상태': (r.receipt_status || 'received') === 'received' ? '수령완료' : '미수령', 'H코드': r.h_codes, 'P코드': r.p_codes, 'MSDS 발행일': r.issue_date, '버전': 'v' + r.version }));
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
  toast(`${con} 패키지 완료`, 'success');
  closeModal('packageModal');
}
window.exportPackage = exportPackage;

// ═══════════════ Print List ═══════════════
function printList() {
  const filtered = getFiltered();
  if (filtered.length === 0) { toast('인쇄할 데이터가 없습니다', 'error'); return; }
  const fCon = document.getElementById('filterContractor').value;
  const title = fCon ? `MSDS 관리대장 — ${fCon}` : 'MSDS 관리대장 (전체)';
  const rows = filtered.map((r, i) => `<tr><td>${i + 1}</td><td class="pname">${r.product_name}</td><td>${r.manufacturer || '-'}</td><td>${r.supplier || '-'}</td><td>${r.contractor}</td><td>${r.cas_no || '-'}</td><td class="ctr">${r.signal_word || '-'}</td><td class="ctr">${r.special && r.special !== 'N' ? '●' : ''}</td><td class="ctr">${(r.status || 'active') === 'active' ? '사용중' : '종료'}</td><td class="ctr">${(r.receipt_status || 'received') === 'received' ? 'O' : 'X'}</td><td>${r.issue_date || '-'}</td><td class="ctr">v${r.version}</td></tr>`).join('');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>@page{size:A4 landscape;margin:10mm;}*{box-sizing:border-box;}body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;}.doc-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;border-bottom:3px solid #111;padding-bottom:8px;}.doc-title{font-size:20px;font-weight:800;}.doc-meta{font-size:11px;color:#555;text-align:right;}table{width:100%;border-collapse:collapse;font-size:10px;}th{background:#333;color:#fff;padding:6px 4px;text-align:left;font-weight:700;border:1px solid #333;white-space:nowrap;}td{padding:5px 4px;border:1px solid #ccc;vertical-align:top;}tr:nth-child(even) td{background:#f7f7f7;}.pname{font-weight:700;}.ctr{text-align:center;}@media print{tr{page-break-inside:avoid;}}</style></head><body><div class="doc-head"><div class="doc-title">${title}</div><div class="doc-meta">총 ${filtered.length}건<br>출력일: ${new Date().toISOString().split('T')[0]}</div></div><table><thead><tr><th>No.</th><th>제품명</th><th>제조사</th><th>공급업체</th><th>사용협력사</th><th>CAS No.</th><th>신호어</th><th>특별</th><th>상태</th><th>수령</th><th>발행일</th><th>ver.</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script></body></html>`);
  w.document.close();
  toast(`${filtered.length}건 인쇄 준비 완료`, 'success');
}
window.printList = printList;

// ═══════════════ Warning Labels ═══════════════
const GHS_PICTO = { GHS01:'💥', GHS02:'🔥', GHS03:'🔥', GHS04:'🟢', GHS05:'🧪', GHS06:'☠️', GHS07:'❗', GHS08:'🫁', GHS09:'🐟' };

function renderWarnPickList() {
  const el = document.getElementById('warnPickList');
  if (records.length === 0) { el.innerHTML = '<div style="padding:30px;text-align:center;color:#555">등록된 물질이 없습니다</div>'; return; }
  el.innerHTML = records.map(r => `<label class="warn-pick-item"><input type="checkbox" class="warn-check" value="${r.id}" onchange="onWarnCheck('${r.id}',this.checked)" ${warnSelected.has(r.id) ? 'checked' : ''}><div style="flex:1"><div class="wp-name">${r.product_name}</div><div class="wp-sub">${r.manufacturer || ''} ${r.signal_word ? '· ' + r.signal_word : ''}</div></div>${r.special && r.special !== 'N' ? '<span class="badge badge-danger">특별</span>' : ''}</label>`).join('');
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
  prev.innerHTML = `<div style="font-size:12px;color:var(--text2);margin-bottom:12px;"><strong style="color:var(--text)">${ids.length}개</strong> 선택됨 · A4 한 장에 하나씩 출력</div>` + buildWarnPreview(first, site);
}
window.updateWarningPreview = updateWarningPreview;

function buildWarnPreview(r, site) {
  const isDanger = r.signal_word && r.signal_word.includes('위험');
  const codes = (r.pictograms || '').match(/GHS\d{2}/g) || [];
  const picto = codes.length ? codes.map(c => `<span style="display:inline-block;width:46px;height:46px;border:2px solid #111;transform:rotate(45deg);text-align:center;line-height:42px;margin:6px;"><span style="display:inline-block;transform:rotate(-45deg);font-size:22px;">${GHS_PICTO[c] || '⚠️'}</span></span>`).join('') : '<span style="font-size:28px">⚠️</span>';
  return `<div style="background:#fff;color:#111;border:3px solid #111;border-radius:8px;padding:18px;"><div style="text-align:center;border-bottom:3px solid #111;padding-bottom:10px;margin-bottom:12px;"><div style="font-size:10px;letter-spacing:2px;color:#666;">SAFETY DATA SHEET · 경고표지</div><div style="font-size:22px;font-weight:900;margin-top:4px;">${r.product_name}</div><div style="font-size:13px;color:#444;">${r.manufacturer || ''}</div><div style="display:inline-block;font-size:16px;font-weight:800;margin-top:8px;padding:3px 18px;border-radius:6px;color:#fff;background:${isDanger ? '#c0392b' : '#e67e22'};">${r.signal_word || '경고'}</div></div><div style="text-align:center;margin:10px 0;">${picto}</div>${r.h_codes ? `<div style="margin-bottom:8px;"><div style="font-size:10px;font-weight:700;color:#fff;background:#333;padding:2px 8px;display:inline-block;border-radius:3px;">유해·위험 문구 (H)</div><div style="font-size:13px;margin-top:4px;">${r.h_codes}</div></div>` : ''}${r.p_codes ? `<div style="margin-bottom:8px;"><div style="font-size:10px;font-weight:700;color:#fff;background:#333;padding:2px 8px;display:inline-block;border-radius:3px;">예방조치 문구 (P)</div><div style="font-size:13px;margin-top:4px;">${r.p_codes}</div></div>` : ''}${r.special && r.special !== 'N' ? `<div style="background:#fff3cd;border:2px solid #ffc107;border-radius:5px;padding:8px;margin:10px 0;font-size:12px;font-weight:700;color:#856404;text-align:center;">⚠️ 특별관리물질 — 취급 시 관리감독자 확인 필수</div>` : ''}<div style="margin-top:12px;padding-top:8px;border-top:1px solid #ddd;font-size:11px;color:#555;line-height:1.6;"><strong>공급업체</strong> ${r.supplier || '-'} | <strong>협력사</strong> ${r.contractor || '-'}<br><strong>현장</strong> ${site} | <strong>작성일</strong> ${(r.created_at || '').split('T')[0]}</div></div>`;
}

function buildWarnPrint(r, site) {
  const isDanger = r.signal_word && r.signal_word.includes('위험');
  const codes = (r.pictograms || '').match(/GHS\d{2}/g) || [];
  const picto = codes.length ? codes.map(c => `<div class="wl-picto"><span>${GHS_PICTO[c] || '⚠️'}</span></div>`).join('') : '<div class="wl-picto"><span>⚠️</span></div>';
  return `<div class="page-a4"><div class="warning-label"><div class="wl-header"><div class="wl-sds">SAFETY DATA SHEET · 경고표지</div><div class="wl-product">${r.product_name}</div><div class="wl-maker">${r.manufacturer || ''}</div><div class="wl-signal ${isDanger ? 'danger' : 'warning'}">${r.signal_word || '경고'}</div></div><div class="wl-pictograms">${picto}</div>${r.components ? `<div class="wl-section"><div class="wl-stitle">유해·위험 성분</div><div class="wl-sbody">${r.components}</div></div>` : ''}${r.h_codes ? `<div class="wl-section"><div class="wl-stitle">유해·위험 문구 (H)</div><div class="wl-sbody">${r.h_codes}</div></div>` : ''}${r.p_codes ? `<div class="wl-section"><div class="wl-stitle">예방조치 문구 (P)</div><div class="wl-sbody">${r.p_codes}</div></div>` : ''}${r.special && r.special !== 'N' ? `<div class="wl-special">⚠️ 특별관리물질 — 취급 시 관리감독자 확인 필수, 특별안전보건교육 대상</div>` : ''}<div class="wl-footer"><div><strong>공급업체</strong> ${r.supplier || '-'}</div><div><strong>사용 협력사</strong> ${r.contractor || '-'}</div><div><strong>현장</strong> ${site}</div><div><strong>작성일</strong> ${(r.created_at || '').split('T')[0]}</div></div></div></div>`;
}

function printWarnings() {
  const ids = [...warnSelected];
  if (ids.length === 0) { toast('인쇄할 물질을 선택해주세요', 'error'); return; }
  const site = document.getElementById('warningSite').value || '현장명';
  printWarningsFor(ids.map(id => records.find(r => r.id === id)).filter(Boolean), site);
}
window.printWarnings = printWarnings;

function printWarningsFor(labels, site) {
  if (!labels || labels.length === 0) return;
  const pages = labels.map(r => buildWarnPrint(r, site)).join('');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>경고표지 (${labels.length}건)</title><style>@page{size:A4;margin:12mm;}*{box-sizing:border-box;}body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;}.page-a4{width:100%;min-height:271mm;page-break-after:always;display:flex;align-items:center;justify-content:center;}.page-a4:last-child{page-break-after:auto;}.warning-label{width:100%;border:4px solid #111;border-radius:8px;padding:28px;}.wl-header{text-align:center;border-bottom:4px solid #111;padding-bottom:16px;margin-bottom:20px;}.wl-sds{font-size:13px;letter-spacing:3px;color:#666;margin-bottom:8px;}.wl-product{font-size:34px;font-weight:900;line-height:1.2;}.wl-maker{font-size:16px;color:#444;margin-top:6px;}.wl-signal{display:inline-block;font-size:26px;font-weight:900;margin-top:14px;padding:6px 28px;border-radius:8px;}.wl-signal.danger{color:#fff;background:#c0392b;}.wl-signal.warning{color:#fff;background:#e67e22;}.wl-pictograms{display:flex;gap:24px;flex-wrap:wrap;justify-content:center;margin:30px 0;}.wl-picto{width:90px;height:90px;border:4px solid #111;transform:rotate(45deg);display:flex;align-items:center;justify-content:center;}.wl-picto span{transform:rotate(-45deg);font-size:38px;}.wl-section{margin-bottom:16px;}.wl-stitle{font-size:13px;font-weight:800;letter-spacing:1px;color:#fff;background:#333;padding:4px 12px;display:inline-block;border-radius:4px;margin-bottom:6px;}.wl-sbody{font-size:16px;line-height:1.6;padding:0 4px;}.wl-special{background:#fff3cd;border:3px solid #ffc107;border-radius:6px;padding:14px;margin:18px 0;font-size:17px;font-weight:800;color:#856404;text-align:center;}.wl-footer{margin-top:24px;padding-top:16px;border-top:2px solid #ddd;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px;}.wl-footer strong{color:#666;margin-right:8px;}</style></head><body>${pages}<script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script></body></html>`);
  w.document.close();
  toast(`${labels.length}건 인쇄 준비 완료`, 'success');
}

// ═══════════════ Excel ═══════════════
function exportExcel() {
  const filtered = getFiltered();
  if (filtered.length === 0) { toast('내보낼 데이터가 없습니다', 'error'); return; }
  const sT = { N: '해당없음', Y_cancer: '발암성(1A/1B)', Y_repro: '생식독성', Y_mutagen: '변이원성', Y_sensitizer: '과민성', Y_other: '기타 특별관리' };
  const rows = filtered.map((r, i) => ({ 'No.': i + 1, '제품명': r.product_name, '제조사': r.manufacturer, '공급업체': r.supplier, '사용 협력사': r.contractor, 'CAS No.': r.cas_no, '구성성분': r.components, '신호어': r.signal_word, '특별관리물질': sT[r.special] || r.special, '사용상태': (r.status || 'active') === 'active' ? '사용중' : '종료', '수령상태': (r.receipt_status || 'received') === 'received' ? '수령완료' : '미수령', 'H코드': r.h_codes, 'P코드': r.p_codes, 'MSDS 발행일': r.issue_date, '버전': 'v' + r.version, '등록일': (r.created_at || '').split('T')[0] }));
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'MSDS 관리대장');
  XLSX.writeFile(wb, `MSDS_관리대장_${new Date().toISOString().split('T')[0]}.xlsx`);
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
window.removeContractor = removeContractor;
function populateSelects() {
  const fCon = document.getElementById('filterContractor');
  if (fCon) { const cur = fCon.value; fCon.innerHTML = '<option value="">전체 협력사</option>' + contractors.map(c => `<option>${c.name}</option>`).join(''); fCon.value = cur; }
}
function populateFormSelects() {
  const b = document.getElementById('batchContractor');
  if (b) { const cur = b.value; b.innerHTML = '<option value="">선택하세요</option>' + contractors.map(c => `<option>${c.name}</option>`).join(''); b.value = cur; }
  const f = document.getElementById('f_contractor');
  if (f) { const cur = f.value; f.innerHTML = '<option value="">선택</option>' + contractors.map(c => `<option>${c.name}</option>`).join(''); f.value = cur; }
}

// ═══════════════ Stats ═══════════════
function updateStats() {
  document.getElementById('statTotal').textContent = records.length;
  document.getElementById('statSpecial').textContent = records.filter(r => r.special && r.special !== 'N').length;
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

// ═══════════════ Init ═══════════════
(async () => {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) { user = data.session.user; showApp(); }
})();
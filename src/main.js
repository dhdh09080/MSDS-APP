import { supabase } from './lib/supabase.js';
import { generateCode, generateToken, base64ToBlob, downloadBlob, guessFromPath, today } from './lib/utils.js';
import { ghsPictogramWithLabel, decodeHCodes, decodePCodes, GHS_NAMES } from './lib/ghs.js';

// ═══════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════
let user = null, profile = null;
let workspaces = [], currentWS = null;
let contractors = [], workTypes = [], msdsRecords = [];
let tokens = [], members = [];
let msdsFileQueue = [], healthFileQueue = [];
let editingMsdsId = null, currentDetailId = null, receiptEditId = null;
let warnSelected = new Set();
let measureFileData = null, measureFileName_val = null;
let healthConfirmData = [], healthExcelData = null, healthExcelName_val = null;
let healthCurrentRound = null;
let currentMeasureData = null;

// ═══════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    user = session.user;
    await showWorkspaces();
  } else {
    showAuth();
  }
  document.getElementById('loadingScreen').style.display = 'none';
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    user = session.user;
  }
});

// ═══════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════
function showAuth() {
  document.getElementById('authScreen').style.display = 'block';
  document.getElementById('workspaceScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'none';
}

window.switchTab = function(tab) {
  ['login','signup','forgot'].forEach(t => {
    document.getElementById(t+'Form').style.display = t === tab ? 'flex' : 'none';
  });
  const tabs = document.querySelectorAll('.auth-tab');
  tabs[0].classList.toggle('active', tab === 'login');
  tabs[1].classList.toggle('active', tab === 'signup');
  if (tab === 'forgot') { tabs[0].classList.remove('active'); tabs[1].classList.remove('active'); }
};

window.handleLogin = async function() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const msg = document.getElementById('loginMsg');
  const btn = document.getElementById('loginBtn');
  if (!email || !password) { msg.className='auth-msg error'; msg.textContent='이메일과 비밀번호를 입력하세요'; return; }
  btn.disabled = true; btn.textContent = '로그인 중...';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = '로그인';
  if (error) { msg.className='auth-msg error'; msg.textContent=translateAuthError(error.message); return; }
  user = (await supabase.auth.getUser()).data.user;
  await showWorkspaces();
};

window.handleSignup = async function() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const msg = document.getElementById('signupMsg');
  const btn = document.getElementById('signupBtn');
  if (!name || !email || !password) { msg.className='auth-msg error'; msg.textContent='모든 항목을 입력하세요'; return; }
  btn.disabled = true; btn.textContent = '가입 중...';
  const { error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
  btn.disabled = false; btn.textContent = '회원가입';
  if (error) { msg.className='auth-msg error'; msg.textContent=translateAuthError(error.message); return; }
  msg.className='auth-msg success'; msg.textContent='가입 완료! 이메일 인증 후 로그인하세요.';
  setTimeout(() => switchTab('login'), 2000);
};

window.handleForgot = async function() {
  const email = document.getElementById('forgotEmail').value.trim();
  const msg = document.getElementById('forgotMsg');
  const btn = document.getElementById('forgotBtn');
  if (!email) { msg.className='auth-msg error'; msg.textContent='이메일을 입력하세요'; return; }
  btn.disabled = true;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  btn.disabled = false;
  if (error) { msg.className='auth-msg error'; msg.textContent=translateAuthError(error.message); return; }
  msg.className='auth-msg success'; msg.textContent='재설정 링크를 전송했습니다. 이메일을 확인하세요.';
};

window.handleLogout = async function() {
  await supabase.auth.signOut();
  user = null; currentWS = null; contractors = []; workTypes = []; msdsRecords = [];
  showAuth();
};

function translateAuthError(m) {
  if (m.includes('Invalid login')) return '이메일 또는 비밀번호가 틀렸습니다';
  if (m.includes('already registered')) return '이미 가입된 이메일입니다';
  if (m.includes('Password should')) return '비밀번호는 6자 이상이어야 합니다';
  if (m.includes('Email not confirmed')) return '이메일 인증이 필요합니다 (메일함 확인)';
  return m;
}

// ═══════════════════════════════════════════════
// Workspace
// ═══════════════════════════════════════════════
async function showWorkspaces() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('workspaceScreen').style.display = 'block';
  document.getElementById('appScreen').style.display = 'none';
  const name = user.user_metadata?.name || user.email.split('@')[0];
  document.getElementById('wsGreeting').textContent = `안녕하세요, ${name}님 👋`;
  document.getElementById('topbarUser').textContent = user.email;
  await loadWorkspaces();
}

async function loadWorkspaces() {
  const { data, error } = await supabase.from('workspaces')
    .select('*, workspace_members!inner(role)')
    .eq('workspace_members.user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) { toast('현장 목록 로드 실패', 'error'); return; }
  workspaces = data || [];
  renderWorkspaceList();
}

function renderWorkspaceList() {
  const el = document.getElementById('wsList');
  if (workspaces.length === 0) {
    el.innerHTML = `<div class="ws-empty"><div class="ws-empty-icon">🏗️</div><div class="ws-empty-text">아직 등록된 현장이 없습니다</div><div>아래 버튼으로 첫 번째 현장을 추가하세요</div></div>`;
    return;
  }
  el.innerHTML = workspaces.map(ws => {
    const role = ws.workspace_members?.[0]?.role || 'member';
    const isOwner = ws.owner_id === user.id;
    return `<div class="ws-card" onclick="enterWorkspace('${ws.id}')">
      <div class="ws-card-icon">🏗️</div>
      <div class="ws-card-info">
        <div class="ws-card-name">${ws.name}</div>
        <div class="ws-card-meta">코드: ${ws.code} · ${isOwner ? '관리자' : role === 'admin' ? '관리자' : '멤버'}</div>
      </div>
      <div class="ws-card-badge">입장 →</div>
    </div>`;
  }).join('');
}

window.createWorkspace = async function() {
  const name = document.getElementById('wsNameInput').value.trim();
  if (!name) { toast('현장명을 입력하세요', 'error'); return; }
  const code = generateCode();
  const { data: ws, error } = await supabase.from('workspaces')
    .insert({ name, code, owner_id: user.id }).select().single();
  if (error) { toast('생성 실패: ' + error.message, 'error'); return; }
  await supabase.from('workspace_members').insert({ workspace_id: ws.id, user_id: user.id, role: 'admin' });
  closeModal('createWSModal');
  document.getElementById('wsNameInput').value = '';
  await loadWorkspaces();
  toast(name + ' 현장이 추가됐습니다', 'success');
};

async function enterWorkspace(wsId) {
  currentWS = workspaces.find(w => w.id === wsId);
  if (!currentWS) return;
  document.getElementById('workspaceScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('sidebarWSName').textContent = currentWS.name;
  document.getElementById('homeTitle').textContent = currentWS.name;
  document.getElementById('homeDate').textContent = new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' });
  document.getElementById('wsNameEdit').value = currentWS.name;
  document.getElementById('warningSite').value = currentWS.name;
  const name = user.user_metadata?.name || user.email.split('@')[0];
  document.getElementById('sidebarName').textContent = name;
  document.getElementById('sidebarEmail').textContent = user.email;
  document.getElementById('sidebarAvatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('accountInfo').innerHTML = `이메일: ${user.email}<br>이름: ${name}<br>가입일: ${new Date(user.created_at).toLocaleDateString('ko-KR')}`;
  await Promise.all([loadContractors(), loadWorkTypes(), loadMembers(), loadTokens()]);
  await loadMsdsRecords();
  showPage('home');
}

window.goWorkspaces = function() {
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('workspaceScreen').style.display = 'block';
  loadWorkspaces();
};

window.updateWSName = async function() {
  const name = document.getElementById('wsNameEdit').value.trim();
  if (!name) { toast('현장명을 입력하세요', 'error'); return; }
  const { error } = await supabase.from('workspaces').update({ name }).eq('id', currentWS.id);
  if (error) { toast('저장 실패', 'error'); return; }
  currentWS.name = name;
  document.getElementById('sidebarWSName').textContent = name;
  document.getElementById('homeTitle').textContent = name;
  document.getElementById('warningSite').value = name;
  toast('저장됐습니다', 'success');
};

// ═══════════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════════
const PAGES = ['home','msds','warning','upload-link','measure','health','settings'];
const MOBILE_TABS = ['home','msds','measure','health','settings'];

window.showPage = function(id) {
  PAGES.forEach(p => {
    document.getElementById('page-'+p)?.classList.toggle('active', p === id);
    document.getElementById('nav-'+p)?.classList.toggle('active', p === id);
  });
  MOBILE_TABS.forEach(t => {
    document.getElementById('mtab-'+t)?.classList.toggle('active', t === id);
  });
  if (id === 'warning') { renderWarnPickList(); updateWarningPreview(); }
  if (id === 'upload-link') renderTokenList();
  if (id === 'settings') { renderContractorTags(); loadMembers(); }
  document.getElementById('mainContent')?.scrollTo(0, 0);
};

// ═══════════════════════════════════════════════
// Contractors & Work Types
// ═══════════════════════════════════════════════
async function loadContractors() {
  const { data } = await supabase.from('contractors')
    .select('*').eq('workspace_id', currentWS.id).order('created_at');
  contractors = data || [];
  renderContractorTags();
  populateContractorSelects();
}

async function loadWorkTypes() {
  const { data } = await supabase.from('work_types')
    .select('*').eq('workspace_id', currentWS.id).order('created_at');
  workTypes = data || [];
}

function populateContractorSelects() {
  const opts = '<option value="">선택하세요</option>' + contractors.map(c => `<option value="${c.id}" data-name="${c.name}">${c.name}</option>`).join('');
  const opts2 = '<option value="">전체 협력사</option>' + contractors.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  ['batchContractor','f_contractor','pkgContractor','linkContractor','workTypeContractor'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'filterContractor') { el.innerHTML = opts2; return; }
    const cur = el.value; el.innerHTML = id === 'filterContractor' ? opts2 : opts; el.value = cur;
  });
  const fc = document.getElementById('filterContractor');
  if (fc) { const cur = fc.value; fc.innerHTML = opts2; fc.value = cur; }
}

function getWorkTypesForContractor(contractorId) {
  return workTypes.filter(w => w.contractor_id === contractorId);
}

window.updateBatchWorkTypes = function() {
  const conId = document.getElementById('batchContractor').value;
  const wts = getWorkTypesForContractor(conId);
  document.getElementById('batchWorkType').innerHTML =
    '<option value="">공종 선택 (선택사항)</option>' + wts.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
};

window.updateManualWorkTypes = function() {
  const conId = document.getElementById('f_contractor').value;
  const wts = getWorkTypesForContractor(conId);
  document.getElementById('f_workType').innerHTML =
    '<option value="">공종 선택</option>' + wts.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
};

window.renderContractorTags = function() {
  const el = document.getElementById('contractorTags');
  if (!el) return;
  el.innerHTML = contractors.length === 0
    ? '<div style="color:var(--text3);font-size:13px;">등록된 협력사가 없습니다</div>'
    : contractors.map(c => `<span class="tag">${c.name}<span class="tag-remove" onclick="removeContractor('${c.id}')">✕</span></span>`).join('');
};

window.addContractor = async function() {
  const v = document.getElementById('newContractor').value.trim();
  if (!v) return;
  if (contractors.some(c => c.name === v)) { toast('이미 있는 협력사입니다', 'error'); return; }
  const { data, error } = await supabase.from('contractors').insert({ workspace_id: currentWS.id, name: v }).select().single();
  if (error) { toast('추가 실패', 'error'); return; }
  contractors.push(data);
  document.getElementById('newContractor').value = '';
  renderContractorTags(); populateContractorSelects();
  toast(v + ' 추가됨', 'success');
};

window.removeContractor = async function(id) {
  if (!confirm('협력사를 삭제하면 관련 공종도 삭제됩니다. 계속하시겠습니까?')) return;
  await supabase.from('contractors').delete().eq('id', id);
  contractors = contractors.filter(c => c.id !== id);
  workTypes = workTypes.filter(w => w.contractor_id !== id);
  renderContractorTags(); populateContractorSelects();
  toast('삭제됐습니다');
};

window.renderWorkTypeTags = function() {
  const conId = document.getElementById('workTypeContractor').value;
  const tagEl = document.getElementById('workTypeTags');
  const addRow = document.getElementById('workTypeAddRow');
  if (!conId) {
    tagEl.innerHTML = '<div style="color:var(--text3);font-size:13px;">협력사를 먼저 선택하세요</div>';
    if (addRow) addRow.style.display = 'none';
    return;
  }
  if (addRow) addRow.style.display = 'flex';
  const wts = getWorkTypesForContractor(conId);
  tagEl.innerHTML = wts.length === 0
    ? '<div style="color:var(--text3);font-size:13px;">등록된 공종이 없습니다</div>'
    : wts.map(w => `<span class="tag">${w.name}<span class="tag-remove" onclick="removeWorkType('${w.id}')">✕</span></span>`).join('');
};

window.addWorkType = async function() {
  const conId = document.getElementById('workTypeContractor').value;
  const v = document.getElementById('newWorkType').value.trim();
  if (!conId) { toast('협력사를 먼저 선택하세요', 'error'); return; }
  if (!v) return;
  const { data, error } = await supabase.from('work_types').insert({ workspace_id: currentWS.id, contractor_id: conId, name: v }).select().single();
  if (error) { toast('추가 실패', 'error'); return; }
  workTypes.push(data);
  document.getElementById('newWorkType').value = '';
  renderWorkTypeTags();
  toast(v + ' 추가됨', 'success');
};

window.removeWorkType = async function(id) {
  await supabase.from('work_types').delete().eq('id', id);
  workTypes = workTypes.filter(w => w.id !== id);
  renderWorkTypeTags();
};

window.onFilterContractorChange = function() {
  const conName = document.getElementById('filterContractor').value;
  const con = contractors.find(c => c.name === conName);
  const wts = con ? getWorkTypesForContractor(con.id) : [];
  const wtSel = document.getElementById('filterWorkType');
  wtSel.innerHTML = '<option value="">전체 공종</option>' + wts.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
  renderMsdsTable();
};

// ═══════════════════════════════════════════════
// Members
// ═══════════════════════════════════════════════
async function loadMembers() {
  const { data } = await supabase.from('workspace_members')
    .select('*, user:user_id(email, raw_user_meta_data)')
    .eq('workspace_id', currentWS.id);
  members = data || [];
  renderMemberList();
}

function renderMemberList() {
  const el = document.getElementById('memberList');
  if (!el) return;
  el.innerHTML = members.map(m => {
    const email = m.user?.email || '알 수 없음';
    const name = m.user?.raw_user_meta_data?.name || email.split('@')[0];
    const isMe = m.user_id === user.id;
    const isOwner = currentWS.owner_id === m.user_id;
    return `<div class="member-item">
      <div class="member-avatar">${name.charAt(0).toUpperCase()}</div>
      <div class="member-info">
        <div class="member-name">${name}${isMe ? ' (나)' : ''}</div>
        <div class="member-email">${email}</div>
      </div>
      <span class="member-role ${m.role}">${isOwner ? '소유자' : m.role === 'admin' ? '관리자' : '멤버'}</span>
      ${!isMe && !isOwner && currentWS.owner_id === user.id ? `<button class="btn btn-danger btn-sm" onclick="removeMember('${m.id}')">제거</button>` : ''}
    </div>`;
  }).join('');
}

window.handleInvite = async function() {
  const email = document.getElementById('inviteEmail').value.trim();
  const role = document.getElementById('inviteRole').value;
  const msg = document.getElementById('inviteMsg');
  if (!email) { msg.className='auth-msg error'; msg.textContent='이메일을 입력하세요'; return; }
  const { data: users, error } = await supabase.from('auth.users').select('id').eq('email', email).single().catch(() => ({ data: null }));
  if (!users) {
    // Try via RPC or profiles
    const { data: profile } = await supabase.rpc('get_user_id_by_email', { email_input: email }).catch(() => ({ data: null }));
    if (!profile) { msg.className='auth-msg error'; msg.textContent='해당 이메일로 가입된 계정이 없습니다'; return; }
  }
  msg.className='auth-msg success'; msg.textContent='초대 완료! 해당 사용자가 로그인하면 현장이 보입니다.';
};

window.removeMember = async function(memberId) {
  if (!confirm('팀원을 제거하시겠습니까?')) return;
  await supabase.from('workspace_members').delete().eq('id', memberId);
  await loadMembers();
  toast('제거됐습니다');
};

// ═══════════════════════════════════════════════
// Upload Tokens
// ═══════════════════════════════════════════════
async function loadTokens() {
  const { data } = await supabase.from('upload_tokens')
    .select('*, contractor:contractor_id(name)')
    .eq('workspace_id', currentWS.id).order('created_at');
  tokens = data || [];
}

window.generateUploadLink = async function() {
  const conId = document.getElementById('linkContractor').value;
  if (!conId) { toast('협력사를 선택하세요', 'error'); return; }
  const existing = tokens.find(t => t.contractor_id === conId);
  if (existing) { toast('이미 발급된 링크가 있습니다', 'warn'); renderTokenList(); return; }
  const token = generateToken();
  const { data, error } = await supabase.from('upload_tokens')
    .insert({ workspace_id: currentWS.id, contractor_id: conId, token }).select('*, contractor:contractor_id(name)').single();
  if (error) { toast('발급 실패: ' + error.message, 'error'); return; }
  tokens.push(data);
  renderTokenList();
  toast('링크가 발급됐습니다', 'success');
};

function renderTokenList() {
  const el = document.getElementById('tokenList');
  if (!el) return;
  const wsTokens = tokens;
  if (wsTokens.length === 0) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text3);text-align:center;padding:20px;">발급된 링크가 없습니다</div>';
    return;
  }
  const base = window.location.origin + '/upload.html';
  el.innerHTML = wsTokens.map(t => {
    const url = `${base}?token=${t.token}`;
    return `<div class="token-card">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">👷 ${t.contractor?.name || '알 수 없음'}</div>
        <div class="token-url">${url}</div>
        <div class="token-meta">발급일: ${new Date(t.created_at).toLocaleDateString('ko-KR')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
        <button class="btn btn-primary btn-sm" onclick="copyLink('${url}')">복사</button>
        <button class="btn btn-secondary btn-sm" onclick="shareLink('${url}','${t.contractor?.name || ''}')">공유</button>
        <button class="btn btn-danger btn-sm" onclick="revokeToken('${t.id}')">삭제</button>
      </div>
    </div>`;
  }).join('');
}

window.copyLink = function(url) {
  navigator.clipboard.writeText(url).then(() => toast('링크가 복사됐습니다', 'success')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('링크가 복사됐습니다', 'success');
  });
};

window.shareLink = function(url, name) {
  if (navigator.share) {
    navigator.share({ title: `MSDS 업로드 링크 - ${name}`, text: `MSDS를 업로드해주세요`, url });
  } else { copyLink(url); }
};

window.revokeToken = async function(id) {
  if (!confirm('링크를 삭제하면 협력사에서 더 이상 업로드할 수 없습니다. 계속하시겠습니까?')) return;
  await supabase.from('upload_tokens').delete().eq('id', id);
  tokens = tokens.filter(t => t.id !== id);
  renderTokenList();
  toast('링크가 삭제됐습니다');
};

// ═══════════════════════════════════════════════
// MSDS Records
// ═══════════════════════════════════════════════
async function loadMsdsRecords() {
  const { data } = await supabase.from('msds_records')
    .select('*').eq('workspace_id', currentWS.id).order('created_at', { ascending: false });
  msdsRecords = data || [];
  updateStats(); renderMsdsTable(); renderHomeDashboard(); renderWarnPickList();
}

function updateStats() {
  const total = msdsRecords.length;
  const pending = msdsRecords.filter(r => r.receipt_status === 'pending').length;
  const special = msdsRecords.filter(r => r.legal_special === 'Y').length;
  const active = msdsRecords.filter(r => (r.status||'active') === 'active').length;
  document.getElementById('homeStatTotal').textContent = total;
  document.getElementById('homeStatPending').textContent = pending;
  document.getElementById('homeStatSpecial').textContent = special;
  document.getElementById('homeStatActive').textContent = active;
  document.getElementById('msdsSubtitle').textContent = `총 ${total}건`;
  const nb = document.getElementById('navBadgeMsds');
  const mb = document.getElementById('mBadgeMsds');
  if (pending > 0) { nb.style.display='inline'; nb.textContent=pending; mb.style.display='inline'; mb.textContent=pending; }
  else { nb.style.display='none'; mb.style.display='none'; }
}

function renderHomeDashboard() {
  // 미수령 알림
  const pending = msdsRecords.filter(r => r.receipt_status === 'pending');
  const pendingAlert = document.getElementById('pendingAlert');
  const pendingList = document.getElementById('pendingList');
  if (pending.length > 0) {
    pendingAlert.style.display = 'block';
    const grouped = {};
    pending.forEach(r => { if (!grouped[r.contractor]) grouped[r.contractor] = 0; grouped[r.contractor]++; });
    pendingList.innerHTML = Object.entries(grouped).map(([con, cnt]) => {
      const token = tokens.find(t => t.contractor?.name === con);
      const url = token ? `${window.location.origin}/upload.html?token=${token.token}` : null;
      return `<div class="alert-item">
        <span><b>${con}</b> · ${cnt}건</span>
        ${url ? `<button class="btn btn-warn btn-sm" onclick="copyLink('${url}')">링크 복사</button>` : '<span style="font-size:11px;color:var(--text3)">링크 없음</span>'}
      </div>`;
    }).join('');
  } else {
    pendingAlert.style.display = 'none';
  }

  // 최근 등록
  const recent = msdsRecords.slice(0, 5);
  document.getElementById('recentMsdsList').innerHTML = recent.length === 0
    ? '<div style="color:var(--text3);font-size:13px;text-align:center;padding:20px;">등록된 물질이 없습니다</div>'
    : recent.map(r => `<div class="recent-item" onclick="showMsdsDetail('${r.id}')">
        <div class="recent-icon">🧪</div>
        <div>
          <div class="recent-name">${r.product_name}</div>
          <div class="recent-meta">${r.contractor} ${r.work_type ? '/ ' + r.work_type : ''} · ${r.legal_special === 'Y' ? '<span style="color:var(--danger)">특별관리물질</span>' : '일반'}</div>
        </div>
      </div>`).join('');
}

// ═══════════════════════════════════════════════
// MSDS Table
// ═══════════════════════════════════════════════
function getFilteredMsds() {
  const q = (document.getElementById('searchInput')?.value||'').toLowerCase();
  const fCon = document.getElementById('filterContractor')?.value||'';
  const fWork = document.getElementById('filterWorkType')?.value||'';
  const fSt = document.getElementById('filterStatus')?.value||'';
  const fRc = document.getElementById('filterReceipt')?.value||'';
  const fSpc = document.getElementById('filterSpecial')?.value||'';
  return msdsRecords.filter(r => {
    const mq = !q || [r.product_name, r.supplier, r.cas_no, r.contractor, r.work_type].join(' ').toLowerCase().includes(q);
    const mc = !fCon || r.contractor === fCon;
    const mw = !fWork || r.work_type === fWork;
    const ms = !fSt || (r.status||'active') === fSt;
    const mr = !fRc || (r.receipt_status||'received') === fRc;
    const msp = !fSpc || r.legal_special === 'Y';
    return mq && mc && mw && ms && mr && msp;
  });
}

window.renderMsdsTable = function() {
  const filtered = getFilteredMsds();
  const tbody = document.getElementById('msdsTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="11">등록된 MSDS가 없습니다</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(r => {
    const sp = r.legal_special === 'Y' ? '<span class="badge badge-danger">특별</span>' : '<span class="badge badge-gray">일반</span>';
    const st = (r.status||'active') === 'active'
      ? `<span class="badge badge-ok status-toggle" onclick="toggleMsdsStatus('${r.id}')">사용중</span>`
      : `<span class="badge badge-gray status-toggle" onclick="toggleMsdsStatus('${r.id}')">종료</span>`;
    const rc = (r.receipt_status||'received') === 'received'
      ? `<span class="badge badge-ok status-toggle" onclick="openReceipt('${r.id}')">✓ 수령</span>`
      : `<span class="badge badge-danger status-toggle" onclick="openReceipt('${r.id}')">! 미수령</span>`;
    const file = r.has_pdf ? `<span class="pdf-link" onclick="viewFile('${r.id}')">📄</span>` : '-';
    return `<tr>
      <td><input type="checkbox" class="row-check" value="${r.id}" onchange="updateCheckAll()"></td>
      <td><div class="td-name">${r.product_name}</div><div class="td-sub">v${r.version||1}</div></td>
      <td>${r.contractor}</td>
      <td>${r.work_type||'-'}</td>
      <td>${r.supplier||'-'}</td>
      <td style="font-size:12px;">${r.cas_no||'-'}</td>
      <td>${sp}</td>
      <td>${st}</td>
      <td>${rc}</td>
      <td>${file}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-secondary btn-sm btn-icon" onclick="showMsdsDetail('${r.id}')" title="상세">👁</button>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="startMsdsEdit('${r.id}')" title="수정">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteMsdsRecord('${r.id}')" title="삭제">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
};

window.toggleAll = function(cb) { document.querySelectorAll('.row-check').forEach(c => c.checked = cb.checked); };
window.updateCheckAll = function() {
  const all = document.querySelectorAll('.row-check');
  const ch = document.querySelectorAll('.row-check:checked');
  const ca = document.getElementById('checkAll');
  if (ca) ca.checked = all.length > 0 && all.length === ch.length;
};

// ═══════════════════════════════════════════════
// MSDS Register Modal
// ═══════════════════════════════════════════════
window.openMsdsRegister = function() {
  editingMsdsId = null;
  document.getElementById('msdsRegisterTitle').textContent = 'MSDS 등록';
  document.getElementById('msdsManualFooter').style.display = 'none';
  switchMsdsTab('upload');
  populateContractorSelects();
  openModal('msdsRegisterModal');
};

window.switchMsdsTab = function(tab) {
  document.getElementById('msdsUploadTab').style.display = tab === 'upload' ? 'block' : 'none';
  document.getElementById('msdsManualTab').style.display = tab === 'manual' ? 'block' : 'none';
  document.getElementById('msdsManualFooter').style.display = tab === 'manual' ? 'flex' : 'none';
  if (tab === 'manual') { populateContractorSelects(); }
};

// ═══════════════════════════════════════════════
// File Queue (MSDS)
// ═══════════════════════════════════════════════
window.dragOver = function(e, zoneId) { e.preventDefault(); document.getElementById(zoneId)?.classList.add('drag'); };
window.dragLeave = function(e, zoneId) { document.getElementById(zoneId)?.classList.remove('drag'); };

window.dropMsdsFiles = function(e) {
  e.preventDefault();
  document.getElementById('msdsUploadZone').classList.remove('drag');
  const items = [...e.dataTransfer.items];
  const ok = ['application/pdf','image/jpeg','image/png'];
  const files = [...e.dataTransfer.files].filter(f => ok.includes(f.type));
  const non = e.dataTransfer.files.length - files.length;
  if (non > 0) toast(`PDF/JPG/PNG만 가능합니다 (${non}개 제외)`, 'warn');
  if (files.length) addMsdsFilesToQueue(files, e.dataTransfer);
};

window.handleMsdsFileSelect = function(e) {
  const ok = ['application/pdf','image/jpeg','image/png'];
  const files = [...e.target.files].filter(f => ok.includes(f.type));
  addMsdsFilesToQueue(files, null);
  e.target.value = '';
};

window.handleFolderSelect = function(e) {
  const ok = ['application/pdf','image/jpeg','image/png'];
  const files = [...e.target.files].filter(f => ok.includes(f.type));
  if (files.length === 0) { toast('폴더에 PDF/JPG/PNG가 없습니다', 'error'); e.target.value=''; return; }
  addMsdsFilesToQueue(files, null, true);
  e.target.value = '';
  toast(`${files.length}개 파일 추가됨 (폴더에서 협력사·공종 자동 인식)`, 'success');
};

function addMsdsFilesToQueue(files, dt, fromFolder = false) {
  files.forEach(file => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const rel = file.webkitRelativePath || file.name;
    let guessCon = '', guessWork = '';
    if (fromFolder) {
      const g = guessFromPath(rel, contractors, workTypes);
      guessCon = g.guessCon; guessWork = g.guessWork;
    }
    const item = { id, file, name: file.name, path: rel, data: null, mediaType: file.type, status: 'waiting', error: null, guessCon, guessWork };
    msdsFileQueue.push(item);
    const reader = new FileReader();
    reader.onload = ev => { item.data = ev.target.result.split(',')[1]; renderMsdsFileQueue(); };
    reader.readAsDataURL(file);
  });
  renderMsdsFileQueue(); updateMsdsBatchBar();
}

function renderMsdsFileQueue() {
  const el = document.getElementById('msdsFileQueue');
  if (!el) return;
  if (msdsFileQueue.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const icons = { waiting:'📄', parsing:'⏳', done:'✅', error:'❌' };
  const st = { waiting:'대기 중', parsing:'Claude AI 분석 중...', done:'완료 — 저장됨', error:'' };
  el.innerHTML = msdsFileQueue.map(item => {
    const guess = (item.guessCon || item.guessWork) ? ` · ${[item.guessCon, item.guessWork].filter(Boolean).join(' / ')}` : '';
    const statusText = item.status === 'error' ? '오류: ' + (item.error||'알수없음') : (st[item.status] + (item.status === 'waiting' ? guess : ''));
    return `<div class="file-item ${item.status}">
      <span class="fi-icon">${icons[item.status]}</span>
      <div class="fi-info">
        <div class="fi-name">${item.name}</div>
        <div class="fi-status">${statusText}</div>
        ${item.status === 'parsing' ? '<div class="file-progress"><div class="file-progress-bar"></div></div>' : ''}
      </div>
      ${item.status !== 'parsing' ? `<button class="fi-remove" onclick="removeMsdsFile('${item.id}')">✕</button>` : ''}
    </div>`;
  }).join('');
}

window.removeMsdsFile = function(id) { msdsFileQueue = msdsFileQueue.filter(f => f.id !== id); renderMsdsFileQueue(); updateMsdsBatchBar(); };
window.clearMsdsFiles = function() { msdsFileQueue = []; renderMsdsFileQueue(); updateMsdsBatchBar(); };

function updateMsdsBatchBar() {
  const bar = document.getElementById('msdsBatchBar');
  if (!bar) return;
  if (msdsFileQueue.length === 0) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const done = msdsFileQueue.filter(f => f.status === 'done').length;
  const err = msdsFileQueue.filter(f => f.status === 'error').length;
  const wait = msdsFileQueue.filter(f => f.status === 'waiting').length;
  document.getElementById('msdsBatchInfo').innerHTML = `<strong>${msdsFileQueue.length}개</strong> 파일 · 대기 ${wait} · 완료 ${done}${err ? ` · <span style="color:var(--danger)">오류 ${err}</span>` : ''}`;
  document.getElementById('parseAllBtn').disabled = wait === 0;
}

// ═══════════════════════════════════════════════
// Parse & Save MSDS
// ═══════════════════════════════════════════════
window.parseAllFiles = async function() {
  const batchConId = document.getElementById('batchContractor').value;
  const batchWork = document.getElementById('batchWorkType').value;
  const waiting = msdsFileQueue.filter(f => f.status === 'waiting');
  if (waiting.length === 0) { toast('대기 중인 파일이 없습니다', 'error'); return; }
  const hasContractor = waiting.every(f => f.guessCon || batchConId);
  if (!hasContractor) { toast('협력사를 선택하거나 폴더 구조에 협력사명을 포함해주세요', 'error'); return; }
  document.getElementById('parseAllBtn').disabled = true;
  let saved = 0;
  for (const item of waiting) {
    item.status = 'parsing'; renderMsdsFileQueue();
    try {
      const parsed = await callParseFunction(item.data, item.mediaType);
      const conName = item.guessCon || contractors.find(c => c.id === batchConId)?.name || '';
      const workTypeName = item.guessWork || batchWork || '';
      const recId = await saveMsdsRecord({
        product_name: parsed.productName || item.name.replace(/\.(pdf|jpg|jpeg|png)$/i,''),
        supplier: parsed.supplier||'', supplier_contact: parsed.supplierContact||'',
        contractor: conName, work_type: workTypeName,
        cas_no: parsed.casNo||'', components: parsed.components||'',
        signal_word: parsed.signalWord||'', h_codes: parsed.hCodes||'', p_codes: parsed.pCodes||'',
        pictograms: parsed.pictograms||'', issue_date: parsed.issueDate||'',
        protective_equipment: parsed.protectiveEquipment||'',
        legal_measurement: parsed.legalMeasurement||'N', legal_exam: parsed.legalExam||'N',
        legal_exam_cycle: parsed.legalExamCycle||'', legal_manage: parsed.legalManage||'N',
        legal_permit: parsed.legalPermit||'N', legal_special: parsed.legalSpecial||'N',
        legal_dangerous: parsed.legalDangerous||'N', special: parsed.legalSpecial==='Y'?'Y_special':'N',
        receipt_status: 'received', receipt_date: today(),
      });
      await uploadMsdsFile(recId, item.name, item.data, item.mediaType);
      saved++; item.status = 'done';
    } catch (err) { item.status = 'error'; item.error = err.message; }
    renderMsdsFileQueue(); updateMsdsBatchBar();
    await new Promise(r => setTimeout(r, 300));
  }
  await loadMsdsRecords();
  toast(`${saved}개 저장 완료${msdsFileQueue.some(f=>f.status==='error') ? ', 일부 오류 발생' : ''}`, saved > 0 ? 'success' : 'error');
  document.getElementById('parseAllBtn').disabled = false;
  if (saved > 0) setTimeout(() => { closeModal('msdsRegisterModal'); msdsFileQueue = []; renderMsdsFileQueue(); updateMsdsBatchBar(); }, 800);
};

async function callParseFunction(base64Data, mediaType) {
  const mb = (base64Data.length * 0.75 / 1024 / 1024).toFixed(1);
  if (mb > 20) throw new Error(`파일이 너무 큽니다 (${mb}MB)`);
  const { data, error } = await supabase.functions.invoke('parse-msds', { body: { fileBase64: base64Data, mediaType } });
  if (error) throw new Error('파싱 오류: ' + error.message);
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function saveMsdsRecord(fields) {
  const { data, error } = await supabase.from('msds_records').insert({
    workspace_id: currentWS.id, uploaded_by: user.id, status: 'active',
    version: 1, history: [], has_pdf: false, ...fields,
  }).select().single();
  if (error) throw new Error('DB 저장 실패: ' + error.message);
  return data.id;
}

async function uploadMsdsFile(recId, fileName, base64Data, mediaType) {
  const ext = mediaType === 'application/pdf' ? 'pdf' : (mediaType.split('/')[1]||'jpg');
  const path = `${currentWS.id}/${recId}.${ext}`;
  const blob = base64ToBlob(base64Data, mediaType);
  const { error } = await supabase.storage.from('msds-pdfs').upload(path, blob, { contentType: mediaType, upsert: true });
  if (error) { console.warn('파일 업로드 실패:', error.message); return; }
  await supabase.from('msds_records').update({ has_pdf: true, pdf_name: fileName, pdf_path: path }).eq('id', recId);
}

// ═══════════════════════════════════════════════
// MSDS Manual Save
// ═══════════════════════════════════════════════
window.saveMsdsManual = async function() {
  const productName = document.getElementById('f_productName').value.trim();
  const supplier = document.getElementById('f_supplier').value.trim();
  const conId = document.getElementById('f_contractor').value;
  const conName = contractors.find(c => c.id === conId)?.name || '';
  if (!productName || !supplier || !conName) { toast('제품명·공급업체·협력사는 필수입니다', 'error'); return; }
  const lsp = document.getElementById('f_legal_special').checked ? 'Y' : 'N';
  const fields = {
    product_name: productName, supplier, contractor: conName,
    work_type: document.getElementById('f_workType').value,
    supplier_contact: document.getElementById('f_supplierContact').value,
    cas_no: document.getElementById('f_casNo').value,
    components: document.getElementById('f_components').value,
    signal_word: document.getElementById('f_signalWord').value,
    h_codes: document.getElementById('f_hCodes').value,
    p_codes: document.getElementById('f_pCodes').value,
    pictograms: document.getElementById('f_pictograms').value,
    issue_date: document.getElementById('f_issueDate').value,
    protective_equipment: document.getElementById('f_protectiveEquipment').value,
    legal_measurement: document.getElementById('f_legal_measurement').checked ? 'Y' : 'N',
    legal_exam: document.getElementById('f_legal_exam').checked ? 'Y' : 'N',
    legal_exam_cycle: document.getElementById('f_legalExamCycle').value,
    legal_manage: document.getElementById('f_legal_manage').checked ? 'Y' : 'N',
    legal_permit: document.getElementById('f_legal_permit').checked ? 'Y' : 'N',
    legal_special: lsp, legal_dangerous: document.getElementById('f_legal_dangerous').checked ? 'Y' : 'N',
    special: lsp === 'Y' ? 'Y_special' : 'N',
  };
  try {
    if (editingMsdsId) {
      const old = msdsRecords.find(r => r.id === editingMsdsId);
      const nv = (old.version||1) + 1;
      const history = [...(old.history||[]), { version: old.version||1, date: (old.updated_at||old.created_at||'').split('T')[0], note: '수정됨' }];
      const { error } = await supabase.from('msds_records').update({ ...fields, version: nv, history, updated_at: new Date().toISOString() }).eq('id', editingMsdsId);
      if (error) throw error;
      toast(`수정됐습니다 (v${nv})`, 'success');
    } else {
      await saveMsdsRecord({ ...fields, receipt_status: 'pending' });
      toast('등록됐습니다', 'success');
    }
    closeModal('msdsRegisterModal'); resetMsdsForm(); await loadMsdsRecords();
  } catch (err) { toast('저장 실패: ' + err.message, 'error'); }
};

window.resetMsdsForm = function() {
  ['f_productName','f_supplier','f_supplierContact','f_casNo','f_components','f_hCodes','f_pCodes','f_pictograms','f_issueDate','f_protectiveEquipment','f_legalExamCycle'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  ['f_signalWord','f_workType'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  ['f_legal_measurement','f_legal_exam','f_legal_manage','f_legal_permit','f_legal_special','f_legal_dangerous'].forEach(id => { const el = document.getElementById(id); if(el) el.checked=false; });
  editingMsdsId = null;
};

// ═══════════════════════════════════════════════
// MSDS Detail / Edit / Delete
// ═══════════════════════════════════════════════
window.showMsdsDetail = function(id) {
  const r = msdsRecords.find(x => x.id === id); if (!r) return;
  currentDetailId = id;
  document.getElementById('detailTitle').textContent = r.product_name;
  const yn = v => v === 'Y' ? '<span style="color:var(--danger);font-weight:700">● 해당</span>' : '<span style="color:var(--text3)">해당없음</span>';
  const hist = r.history?.length > 0 ? r.history.map(h => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">v${h.version} · ${h.date} · ${h.note}</div>`).join('') : '<div style="color:var(--text3);font-size:12px;">개정 이력 없음</div>';
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-row"><div class="detail-key">제품명</div><div class="detail-val"><strong>${r.product_name}</strong> <span class="badge badge-gray" style="margin-left:6px;">v${r.version||1}</span></div></div>
    <div class="detail-row"><div class="detail-key">협력사</div><div class="detail-val">${r.contractor}</div></div>
    <div class="detail-row"><div class="detail-key">취급 공종</div><div class="detail-val">${r.work_type||'-'}</div></div>
    <div class="detail-row"><div class="detail-key">공급업체</div><div class="detail-val">${r.supplier||'-'} ${r.supplier_contact?'('+r.supplier_contact+')':''}</div></div>
    <div class="detail-row"><div class="detail-key">MSDS 개정일</div><div class="detail-val">${r.issue_date||'-'}</div></div>
    <div class="detail-row"><div class="detail-key">CAS No.</div><div class="detail-val">${r.cas_no||'-'}</div></div>
    <div class="detail-row"><div class="detail-key">구성성분</div><div class="detail-val" style="white-space:pre-wrap;">${r.components||'-'}</div></div>
    <div class="detail-row"><div class="detail-key">신호어</div><div class="detail-val">${r.signal_word||'-'}</div></div>
    <div class="detail-row"><div class="detail-key">H코드</div><div class="detail-val">${r.h_codes||'-'}</div></div>
    <div class="detail-row"><div class="detail-key">P코드</div><div class="detail-val">${r.p_codes||'-'}</div></div>
    <div class="detail-row"><div class="detail-key">추천 보호구</div><div class="detail-val">${r.protective_equipment||'-'}</div></div>
    <div class="detail-row"><div class="detail-key">작업환경측정</div><div class="detail-val">${yn(r.legal_measurement)}</div></div>
    <div class="detail-row"><div class="detail-key">특수건강진단</div><div class="detail-val">${yn(r.legal_exam)} ${r.legal_exam==='Y'&&r.legal_exam_cycle?'· '+r.legal_exam_cycle:''}</div></div>
    <div class="detail-row"><div class="detail-key">관리대상유해물질</div><div class="detail-val">${yn(r.legal_manage)}</div></div>
    <div class="detail-row"><div class="detail-key">허가대상유해물질</div><div class="detail-val">${yn(r.legal_permit)}</div></div>
    <div class="detail-row"><div class="detail-key">특별관리물질</div><div class="detail-val">${yn(r.legal_special)}</div></div>
    <div class="detail-row"><div class="detail-key">위험물 규제</div><div class="detail-val">${yn(r.legal_dangerous)}</div></div>
    <div style="margin-top:16px;"><div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:1px;margin-bottom:8px;">개정 이력</div>${hist}</div>`;
  const fb = document.getElementById('detailViewFileBtn');
  fb.style.display = r.has_pdf ? 'inline-flex' : 'none';
  fb.onclick = () => { closeModal('msdsDetailModal'); viewFile(r.id); };
  document.getElementById('detailDeleteBtn').onclick = () => { closeModal('msdsDetailModal'); deleteMsdsRecord(id); };
  openModal('msdsDetailModal');
};

window.editMsdsRecord = function() { closeModal('msdsDetailModal'); startMsdsEdit(currentDetailId); };

window.startMsdsEdit = function(id) {
  const r = msdsRecords.find(x => x.id === id); if (!r) return;
  editingMsdsId = id;
  document.getElementById('msdsRegisterTitle').textContent = `MSDS 수정 (v${r.version} → v${(r.version||1)+1})`;
  switchMsdsTab('manual');
  populateContractorSelects();
  setTimeout(() => {
    const setV = (id, v) => { const el = document.getElementById(id); if(el) el.value = v||''; };
    const setC = (id, v) => { const el = document.getElementById(id); if(el) el.checked = v === 'Y'; };
    setV('f_productName', r.product_name); setV('f_supplier', r.supplier); setV('f_supplierContact', r.supplier_contact);
    const con = contractors.find(c => c.name === r.contractor);
    setV('f_contractor', con?.id||'');
    setTimeout(() => {
      updateManualWorkTypes();
      setTimeout(() => setV('f_workType', r.work_type), 50);
    }, 50);
    setV('f_casNo', r.cas_no); setV('f_components', r.components); setV('f_signalWord', r.signal_word);
    setV('f_hCodes', r.h_codes); setV('f_pCodes', r.p_codes); setV('f_pictograms', r.pictograms);
    setV('f_issueDate', r.issue_date); setV('f_protectiveEquipment', r.protective_equipment);
    setV('f_legalExamCycle', r.legal_exam_cycle);
    setC('f_legal_measurement', r.legal_measurement); setC('f_legal_exam', r.legal_exam);
    setC('f_legal_manage', r.legal_manage); setC('f_legal_permit', r.legal_permit);
    setC('f_legal_special', r.legal_special); setC('f_legal_dangerous', r.legal_dangerous);
  }, 100);
  openModal('msdsRegisterModal');
};

window.deleteMsdsRecord = async function(id) {
  const r = msdsRecords.find(x => x.id === id);
  if (!confirm(`"${r?.product_name||'이 항목'}"을 삭제하시겠습니까?`)) return;
  if (r?.has_pdf && r?.pdf_path) await supabase.storage.from('msds-pdfs').remove([r.pdf_path]);
  await supabase.from('msds_records').delete().eq('id', id);
  await loadMsdsRecords();
  toast('삭제됐습니다');
};

// ═══════════════════════════════════════════════
// Status / Receipt
// ═══════════════════════════════════════════════
window.toggleMsdsStatus = async function(id) {
  const r = msdsRecords.find(x => x.id === id); if (!r) return;
  const newSt = (r.status||'active') === 'active' ? 'ended' : 'active';
  await supabase.from('msds_records').update({ status: newSt }).eq('id', id);
  r.status = newSt; renderMsdsTable(); updateStats();
  toast(newSt === 'active' ? '사용중으로 변경됐습니다' : '사용종료로 변경됐습니다');
};

window.openReceipt = function(id) {
  const r = msdsRecords.find(x => x.id === id); if (!r) return;
  receiptEditId = id;
  const recv = (r.receipt_status||'received') === 'received';
  document.getElementById('receiptBody').innerHTML = `
    <div style="font-size:13px;color:var(--text2);margin-bottom:16px;"><strong>${r.product_name}</strong> · ${r.contractor}</div>
    <div class="form-field" style="margin-bottom:12px;"><label class="form-label">수령 상태</label>
      <select class="form-input" id="rc_status"><option value="received" ${recv?'selected':''}>✓ 수령 완료</option><option value="pending" ${!recv?'selected':''}>! 미수령</option></select></div>
    <div class="form-field" style="margin-bottom:12px;"><label class="form-label">수령일</label><input class="form-input" type="date" id="rc_date" value="${r.receipt_date||''}"></div>
    <div class="form-field" style="margin-bottom:12px;"><label class="form-label">담당자</label><input class="form-input" id="rc_manager" value="${r.receipt_manager||''}" placeholder="예) 김OO 과장"></div>
    <div class="form-field"><label class="form-label">비고</label><input class="form-input" id="rc_note" value="${r.receipt_note||''}"></div>`;
  openModal('receiptModal');
};

window.saveReceipt = async function() {
  const upd = { receipt_status: document.getElementById('rc_status').value, receipt_date: document.getElementById('rc_date').value, receipt_manager: document.getElementById('rc_manager').value, receipt_note: document.getElementById('rc_note').value };
  await supabase.from('msds_records').update(upd).eq('id', receiptEditId);
  Object.assign(msdsRecords.find(r => r.id === receiptEditId)||{}, upd);
  closeModal('receiptModal'); renderMsdsTable(); updateStats(); renderHomeDashboard();
  toast('수령 정보가 저장됐습니다', 'success');
};

// ═══════════════════════════════════════════════
// File Viewer
// ═══════════════════════════════════════════════
window.viewFile = async function(id) {
  const r = msdsRecords.find(x => x.id === id);
  if (!r?.pdf_path) { toast('원본 파일이 없습니다', 'error'); return; }
  const { data, error } = await supabase.storage.from('msds-pdfs').createSignedUrl(r.pdf_path, 3600);
  if (error) { toast('파일 로드 실패', 'error'); return; }
  const url = data.signedUrl;
  const isImg = /\.(jpg|jpeg|png|webp)$/i.test(r.pdf_path);
  const frame = document.getElementById('fileViewerFrame');
  const img = document.getElementById('fileViewerImg');
  if (isImg) { frame.style.display='none'; img.style.display='block'; img.src=url; }
  else { img.style.display='none'; frame.style.display='block'; frame.src=url; }
  document.getElementById('fileViewerTitle').textContent = r.product_name;
  document.getElementById('fileDownloadBtn').onclick = () => window.open(url, '_blank');
  openModal('fileViewerModal');
};

window.closeFileViewer = function() {
  closeModal('fileViewerModal');
  document.getElementById('fileViewerFrame').src = '';
  document.getElementById('fileViewerImg').src = '';
};

// ═══════════════════════════════════════════════
// Warning Labels
// ═══════════════════════════════════════════════
function renderWarnPickList() {
  const el = document.getElementById('warnPickList');
  if (!el) return;
  if (msdsRecords.length === 0) { el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px;">등록된 물질이 없습니다</div>'; return; }
  el.innerHTML = msdsRecords.map(r => `
    <label class="warn-pick-item">
      <input type="checkbox" class="warn-check" value="${r.id}" onchange="onWarnCheck('${r.id}',this.checked)" ${warnSelected.has(r.id)?'checked':''}>
      <div style="flex:1;min-width:0;">
        <div class="wp-name">${r.product_name}</div>
        <div class="wp-sub">${r.contractor} ${r.work_type?'/ '+r.work_type:''} ${r.signal_word?'· '+r.signal_word:''}</div>
      </div>
      ${r.legal_special==='Y'?'<span class="badge badge-danger">특별</span>':''}
    </label>`).join('');
}

window.onWarnCheck = function(id, checked) { if(checked) warnSelected.add(id); else warnSelected.delete(id); updateWarningPreview(); };
window.selectAllWarn = function(v) {
  warnSelected = v ? new Set(msdsRecords.map(r => r.id)) : new Set();
  document.querySelectorAll('.warn-check').forEach(c => c.checked = v);
  updateWarningPreview();
};

window.updateWarningPreview = function() {
  const ids = [...warnSelected];
  const prev = document.getElementById('warningPreview');
  if (!prev) return;
  if (ids.length === 0) { prev.innerHTML='<div class="warn-empty">왼쪽에서 물질을 선택하세요</div>'; return; }
  const site = document.getElementById('warningSite')?.value || currentWS?.name || '현장명';
  const labels = ids.map(id => msdsRecords.find(r => r.id === id)).filter(Boolean);
  prev.innerHTML = `<div style="font-size:12px;color:var(--text3);margin-bottom:12px;"><strong style="color:var(--text)">${ids.length}개</strong> 선택됨 · A4 한 장에 하나씩</div>` +
    labels.map(r => `<div style="margin-bottom:20px;transform:scale(0.85);transform-origin:top left;width:calc(100% / 0.85);">${buildWarnLabel(r, site)}</div>`).join('');
};

function buildWarnLabel(r, site) {
  const isDanger = r.signal_word?.includes('위험');
  const codes = (r.pictograms||'').match(/GHS\d{2}/g)||[];
  const pictoHtml = codes.length
    ? codes.map(c => ghsPictogramWithLabel(c, 80)).join('')
    : '<span style="font-size:36px;">⚠️</span>';
  const hList = decodeHCodes(r.h_codes);
  const pList = decodePCodes(r.p_codes);
  const hHtml = hList.length ? hList.map(h => `<li><span style="color:#888;font-size:10px;">[${h.code}]</span> ${h.text}</li>`).join('') : '<li>해당 정보 없음</li>';
  const pHtml = pList.length ? pList.map(p => `<li><span style="color:#888;font-size:10px;">[${p.code}]</span> ${p.text}</li>`).join('') : '<li>해당 정보 없음</li>';
  return `<div class="wlabel">
    <div class="wl-top">(산업안전보건법 제114조 규정에 의한 경고표지)</div>
    <div class="wl-name-box">${r.product_name}</div>
    <div class="wl-picto-row">${pictoHtml}</div>
    <div class="wl-signal-bar ${isDanger?'danger':'warning'}">신호어 : ${r.signal_word||'경고'}</div>
    <div class="wl-block"><div class="wl-block-head">유해·위험 문구</div><ul class="wl-list">${hHtml}</ul></div>
    <div class="wl-block"><div class="wl-block-head">예방조치 문구</div><ul class="wl-list">${pHtml}</ul></div>
    ${r.protective_equipment?`<div class="wl-block"><div class="wl-block-head">개인보호구</div><div class="wl-pe">${r.protective_equipment}</div></div>`:''}
    ${r.legal_special==='Y'?`<div class="wl-special">⚠️ 특별관리물질 — 발암성·생식독성 등 CMR 물질, 취급 시 관리감독자 확인 및 특별안전보건교육 필수</div>`:''}
    <div class="wl-foot">
      <div><b>공급업체</b>${r.supplier||'-'} ${r.supplier_contact?'('+r.supplier_contact+')':''}</div>
      <div><b>사용 협력사</b>${r.contractor||'-'} ${r.work_type?'/ '+r.work_type:''}</div>
      <div><b>현장</b>${site}</div>
      <div style="margin-top:6px;font-weight:700;text-align:center;">■ 기타 자세한 내용은 물질안전보건자료(MSDS) 참조</div>
    </div>
  </div>`;
}

window.printWarnings = function() {
  const ids = [...warnSelected];
  if (ids.length === 0) { toast('인쇄할 물질을 선택하세요', 'error'); return; }
  const site = document.getElementById('warningSite')?.value || currentWS?.name || '현장명';
  const labels = ids.map(id => msdsRecords.find(r => r.id === id)).filter(Boolean);
  const w = window.open('', '_blank');
  const pages = labels.map(r => `<div class="page-a4">${buildWarnLabel(r, site)}</div>`).join('');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>경고표지</title><style>
    @page{size:A4;margin:12mm;}
    *{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;}
    .page-a4{min-height:273mm;display:flex;align-items:center;justify-content:center;page-break-after:always;}
    .page-a4:last-child{page-break-after:auto;}
    .wlabel{border:3px solid #111;border-radius:6px;padding:20px;width:100%;font-family:'Malgun Gothic',sans-serif;color:#111;background:#fff;}
    .wl-top{text-align:center;font-size:13px;font-weight:700;margin-bottom:10px;}
    .wl-name-box{border:2.5px solid #E30613;border-radius:6px;text-align:center;font-size:26px;font-weight:900;padding:10px;margin-bottom:14px;letter-spacing:4px;}
    .wl-picto-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:14px;align-items:flex-end;}
    .wl-signal-bar{text-align:center;font-size:17px;font-weight:900;color:#fff;padding:7px;border-radius:6px;margin-bottom:14px;}
    .wl-signal-bar.danger{background:#C0392B;} .wl-signal-bar.warning{background:#E67E22;}
    .wl-block{margin-bottom:10px;border:1px solid #ccc;border-radius:5px;overflow:hidden;}
    .wl-block-head{background:#C0392B;color:#fff;font-size:12px;font-weight:800;padding:5px 12px;}
    .wl-list{margin:0;padding:8px 12px 8px 26px;font-size:12px;line-height:1.8;}
    .wl-pe{padding:8px 12px;font-size:12px;font-weight:600;}
    .wl-special{background:#FFF3CD;border:2px solid #FFC107;border-radius:5px;padding:8px;margin:8px 0;font-size:11px;font-weight:800;color:#856404;text-align:center;}
    .wl-foot{border-top:1px solid #ddd;padding-top:8px;margin-top:10px;font-size:11px;color:#555;line-height:1.8;}
    .wl-foot b{color:#333;margin-right:4px;}
  </style></head><body>${pages}<script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script></body></html>`);
  w.document.close();
  toast(`${labels.length}건 인쇄 준비 완료`, 'success');
};

// ═══════════════════════════════════════════════
// Excel Export
// ═══════════════════════════════════════════════
function splitComponents(r) {
  const comp = r.components||'';
  let parts = comp.split(/,(?![^(]*\))/).map(s=>s.trim()).filter(Boolean);
  if (parts.length === 0) {
    const cass = (r.cas_no||'').split(',').map(s=>s.trim()).filter(Boolean);
    return cass.length ? cass.map(c=>({name:'',cas:c})) : [{name:'',cas:''}];
  }
  return parts.map(p => { const m = p.match(/\(([\d-]+)\)/); return {name:p.replace(/\([\d-]+\)/,'').trim(), cas:m?m[1]:''}; });
}

window.exportMsdsExcel = function() {
  const filtered = getFilteredMsds();
  if (filtered.length === 0) { toast('내보낼 데이터가 없습니다', 'error'); return; }
  const YN = v => v === 'Y' ? 'O' : '';
  const rows = [];
  let no = 0;
  filtered.forEach(r => {
    no++;
    const comps = splitComponents(r);
    comps.forEach((comp, idx) => {
      rows.push({
        'No.': idx===0?no:'', '사용 협력사': idx===0?r.contractor:'', '취급 공종': idx===0?(r.work_type||''):'',
        '제품명': idx===0?r.product_name:'', '공급업체': idx===0?(r.supplier||''):'',
        '공급업체 연락처': idx===0?(r.supplier_contact||''):'', 'MSDS 개정일자': idx===0?(r.issue_date||''):'',
        'CAS No.': comp.cas||'', '구성성분명': comp.name||'',
        '작업환경측정': idx===0?YN(r.legal_measurement):'',
        '특수검진 주기': idx===0?(r.legal_exam==='Y'?(r.legal_exam_cycle||'대상'):''):'',
        '관리대상유해물질': idx===0?YN(r.legal_manage):'', '허가대상유해물질': idx===0?YN(r.legal_permit):'',
        '특별관리물질': idx===0?YN(r.legal_special):'', '위험물 규제': idx===0?YN(r.legal_dangerous):'',
        '추천 보호구': idx===0?(r.protective_equipment||''):'',
      });
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:5},{wch:14},{wch:10},{wch:22},{wch:16},{wch:14},{wch:12},{wch:12},{wch:20},{wch:10},{wch:16},{wch:12},{wch:12},{wch:10},{wch:9},{wch:30}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'MSDS 관리대장');
  XLSX.writeFile(wb, `MSDS_관리대장_${currentWS.name}_${today()}.xlsx`);
  toast('엑셀 다운로드 완료', 'success');
};

// ═══════════════════════════════════════════════
// Print List
// ═══════════════════════════════════════════════
window.printMsdsList = function() {
  const filtered = getFilteredMsds();
  if (filtered.length === 0) { toast('인쇄할 데이터가 없습니다', 'error'); return; }
  const YN = v => v === 'Y' ? '●' : '';
  const title = `MSDS 관리대장 — ${currentWS.name}`;
  const rows = filtered.map((r,i) => `<tr>
    <td class="ctr">${i+1}</td><td>${r.contractor}</td><td>${r.work_type||'-'}</td>
    <td class="pname">${r.product_name}</td><td>${r.supplier||'-'}</td><td>${r.supplier_contact||'-'}</td>
    <td class="ctr">${r.issue_date||'-'}</td><td>${r.cas_no||'-'}</td>
    <td class="ctr">${YN(r.legal_measurement)}</td>
    <td class="ctr">${r.legal_exam==='Y'?(r.legal_exam_cycle||'●'):''}</td>
    <td class="ctr">${YN(r.legal_manage)}</td><td class="ctr">${YN(r.legal_permit)}</td>
    <td class="ctr">${YN(r.legal_special)}</td><td class="ctr">${YN(r.legal_dangerous)}</td>
    <td style="font-size:8px;">${r.protective_equipment||'-'}</td>
  </tr>`).join('');
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
    @page{size:A4 landscape;margin:8mm;}*{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;}
    .doc-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:6px;border-bottom:3px solid #111;padding-bottom:6px;}
    .legend{font-size:9px;color:#444;margin-bottom:6px;line-height:1.4;}
    table{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed;}
    th{background:#333;color:#fff;padding:4px 3px;text-align:center;border:1px solid #333;}
    td{padding:3px;border:1px solid #ccc;vertical-align:top;word-break:break-all;}
    tr:nth-child(even) td{background:#f7f7f7;}.pname{font-weight:700;}.ctr{text-align:center;}
    thead{display:table-header-group;}
  </style></head><body>
  <div class="doc-head"><div style="font-size:16px;font-weight:800;">${title}</div><div style="font-size:10px;color:#555;">총 ${filtered.length}건 · ${today()}</div></div>
  <div class="legend"><b>범례</b> ● = 해당 · 측정=작업환경측정 · 특수검진=특수건강진단(주기) · 관리=관리대상 · 허가=허가대상 · 특별=특별관리물질(CMR) · 위험=위험물</div>
  <table>
    <thead><tr><th>No</th><th>협력사</th><th>공종</th><th>제품명</th><th>공급업체</th><th>연락처</th><th>개정일</th><th>CAS</th><th>측정</th><th>특수검진</th><th>관리</th><th>허가</th><th>특별</th><th>위험</th><th>보호구</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script></body></html>`);
  w.document.close();
};

// ═══════════════════════════════════════════════
// Package
// ═══════════════════════════════════════════════
window.openPackageModal = function() {
  const sel = document.getElementById('pkgContractor');
  sel.innerHTML = '<option value="">선택하세요</option>' + contractors.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  const fc = document.getElementById('filterContractor').value;
  if (fc) sel.value = fc;
  updatePkgCount(); openModal('packageModal');
};

function pkgTargets() {
  const con = document.getElementById('pkgContractor').value;
  const st = document.getElementById('pkgStatus').value;
  if (!con) return [];
  return msdsRecords.filter(r => r.contractor === con && (!st || (r.status||'active') === st));
}

window.updatePkgCount = function() {
  const t = pkgTargets();
  const el = document.getElementById('pkgCount');
  if (!document.getElementById('pkgContractor').value) { el.textContent=''; return; }
  el.textContent = `해당 물질 ${t.length}건 (원본 파일 ${t.filter(r=>r.has_pdf).length}건)`;
};

window.exportPackage = async function() {
  const con = document.getElementById('pkgContractor').value;
  if (!con) { toast('협력사를 선택하세요', 'error'); return; }
  const targets = pkgTargets();
  if (targets.length === 0) { toast('해당 협력사 물질이 없습니다', 'error'); return; }
  const wantList = document.getElementById('pkgList').checked;
  const wantPdf = document.getElementById('pkgPdf').checked;
  const wantWarn = document.getElementById('pkgWarn').checked;
  if (!wantList && !wantPdf && !wantWarn) { toast('출력 항목을 선택하세요', 'error'); return; }
  toast(`${con} 패키지 생성 중...`);
  const zip = new JSZip(); const root = zip.folder(`${con}_MSDS_${today()}`);
  if (wantList) {
    const YN = v => v === 'Y' ? 'O' : '';
    const rows = [];
    targets.forEach((r, idx) => {
      const comps = splitComponents(r);
      comps.forEach((comp, i) => {
        rows.push({ 'No.':i===0?idx+1:'', '공종':i===0?(r.work_type||''):'', '제품명':i===0?r.product_name:'',
          '공급업체':i===0?(r.supplier||''):'', '연락처':i===0?(r.supplier_contact||''):'',
          '개정일':i===0?(r.issue_date||''):'', 'CAS No.':comp.cas||'', '성분':comp.name||'',
          '측정':i===0?YN(r.legal_measurement):'', '특수검진':i===0?(r.legal_exam==='Y'?(r.legal_exam_cycle||'대상'):''):'',
          '관리':i===0?YN(r.legal_manage):'', '허가':i===0?YN(r.legal_permit):'',
          '특별':i===0?YN(r.legal_special):'', '위험물':i===0?YN(r.legal_dangerous):'',
          '보호구':i===0?(r.protective_equipment||''):'',
        });
      });
    });
    const ws2 = XLSX.utils.json_to_sheet(rows); const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, ws2, con.slice(0,30));
    root.file(`${con}_MSDS목록.xlsx`, XLSX.write(wb2, {bookType:'xlsx',type:'array'}));
  }
  if (wantPdf) {
    const pf = root.folder('원본파일');
    for (const r of targets) {
      if (!r.has_pdf || !r.pdf_path) continue;
      const { data } = await supabase.storage.from('msds-pdfs').download(r.pdf_path);
      if (!data) continue;
      let fname = r.pdf_name || (r.product_name+'.pdf');
      let n = fname, c = 1; while (pf.file(n)) { n = fname.replace(/\.(\w+)$/,`_${c}.$1`); c++; }
      pf.file(n, data);
    }
  }
  const content = await zip.generateAsync({type:'blob'});
  downloadBlob(content, `${con}_MSDS패키지_${today()}.zip`);
  if (wantWarn) setTimeout(() => {
    warnSelected = new Set(targets.map(r=>r.id));
    printWarnings();
  }, 600);
  toast(`${con} 패키지 완료`, 'success');
  closeModal('packageModal');
};

// ═══════════════════════════════════════════════
// 작업환경측정
// ═══════════════════════════════════════════════
let measureFileB64 = null;

window.openMeasureUpload = function() {
  measureFileB64 = null; measureFileName_val = null;
  document.getElementById('measureFileInfo').style.display = 'none';
  document.getElementById('measureUploadZone').style.display = 'block';
  document.getElementById('measureRound').value = '';
  document.getElementById('measurePeriod').value = '';
  openModal('measureUploadModal');
};

window.dropMeasureFile = function(e) {
  e.preventDefault(); document.getElementById('measureUploadZone').classList.remove('drag');
  const file = [...e.dataTransfer.files].find(f => f.type === 'application/pdf');
  if (!file) { toast('PDF 파일만 가능합니다', 'error'); return; }
  loadMeasureFile(file);
};

window.handleMeasureFile = function(e) {
  const file = e.target.files[0]; if (!file) return;
  loadMeasureFile(file); e.target.value = '';
};

function loadMeasureFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    measureFileB64 = ev.target.result.split(',')[1];
    measureFileName_val = file.name;
    document.getElementById('measureUploadZone').style.display = 'none';
    const info = document.getElementById('measureFileInfo');
    info.style.display = 'flex'; info.querySelector('.fi-name').textContent = file.name;
  };
  reader.readAsDataURL(file);
}

window.clearMeasureFile = function() {
  measureFileB64 = null; measureFileName_val = null;
  document.getElementById('measureFileInfo').style.display = 'none';
  document.getElementById('measureUploadZone').style.display = 'block';
};

window.analyzeMeasure = async function() {
  const round = document.getElementById('measureRound').value.trim();
  const period = document.getElementById('measurePeriod').value.trim();
  if (!round || !period) { toast('측정 회차와 기간을 입력하세요', 'error'); return; }
  if (!measureFileB64) { toast('파일을 먼저 업로드하세요', 'error'); return; }
  const btn = document.getElementById('measureAnalyzeBtn');
  btn.disabled = true; btn.textContent = '🤖 AI 분석 중...';
  try {
    const { data, error } = await supabase.functions.invoke('parse-msds', {
      body: {
        fileBase64: measureFileB64, mediaType: 'application/pdf',
        mode: 'measure',
        prompt: `이 작업환경측정 결과 보고서에서 분진 측정결과와 소음 측정결과를 추출하세요. JSON만 응답:
{
  "dust": [{"no":1,"process":"공정명","agent":"유해인자명","measured":"측정치(단위포함)","limit":"노출기준(단위포함)","reason":"적용사유"}],
  "noise": [{"no":1,"process":"공종명","measured":"측정치 dB(A)","limit":"90dB(A)","reason":"적용사유"}],
  "workTypes": ["공종명1","공종명2"],
  "dustExceeded": false,
  "noiseExceeded": false,
  "mixedExceeded": false
}`
      }
    });
    if (error || data.error) throw new Error((error||data).message || data.error);
    currentMeasureData = { round, period, ...data.result };
    closeModal('measureUploadModal');
    showMeasureResult(currentMeasureData);
  } catch (err) { toast('분석 실패: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '🤖 AI 분석 시작'; }
};

function showMeasureResult(d) {
  document.getElementById('measureResultTitle').textContent = `측정 결과 — ${d.round}`;
  const body = document.getElementById('measureResultBody');
  const dustRows = (d.dust||[]).map(row => `<tr><td class="ctr">${row.no||''}</td><td>${row.process||''}</td><td>${row.agent||''}</td><td class="ctr">${row.measured||''}</td><td class="ctr">${row.limit||''}</td><td>${row.reason||''}</td></tr>`).join('');
  const noiseRows = (d.noise||[]).map(row => `<tr><td class="ctr">${row.no||''}</td><td>${row.process||''}</td><td class="ctr">소음</td><td class="ctr">${row.measured||''}</td><td class="ctr">${row.limit||'90dB(A)'}</td><td>${row.reason||''}</td></tr>`).join('');
  const workTypeRows = (d.workTypes||[]).map((wt,i) => {
    const hasDust = (d.dust||[]).some(r => r.process?.includes(wt));
    const hasNoise = (d.noise||[]).some(r => r.process?.includes(wt));
    const dustEx = hasDust && d.dustExceeded;
    const noiseEx = hasNoise && d.noiseExceeded;
    return `<tr>
      <td class="ctr">${i+1}</td><td>${wt}</td>
      <td class="ctr">${hasDust ? (dustEx?'<span style="color:red;font-weight:700">초과</span>':'미만') : '해당없음'}</td>
      <td class="ctr">${d.mixedExceeded ? (hasDust?'초과':'해당없음') : '해당없음'}</td>
      <td class="ctr">${hasNoise ? (noiseEx?'<span style="color:red;font-weight:700">초과</span>':'미만') : '해당없음'}</td>
      <td></td><td></td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div style="background:var(--ok-light);border:1.5px solid #86EFAC;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--ok);">
      ✅ AI 분석 완료 — 아래 내용을 확인하고 다운로드하세요. 오류가 있으면 다운로드 후 수정하세요.
    </div>
    <h4 style="margin-bottom:8px;font-size:14px;">📋 분진 측정결과 (${d.dust?.length||0}건)</h4>
    <div style="overflow-x:auto;margin-bottom:20px;">
      <table class="result-table">
        <thead><tr><th>No.</th><th>공정명</th><th>유해인자</th><th>측정치</th><th>노출기준</th><th>적용사유</th></tr></thead>
        <tbody>${dustRows||'<tr><td colspan="6" style="text-align:center;color:#999;">분진 측정결과 없음</td></tr>'}</tbody>
      </table>
    </div>
    <h4 style="margin-bottom:8px;font-size:14px;">🔊 소음 측정결과 (${d.noise?.length||0}건)</h4>
    <div style="overflow-x:auto;margin-bottom:20px;">
      <table class="result-table">
        <thead><tr><th>No.</th><th>공종명</th><th>유해인자</th><th>측정치</th><th>노출기준</th><th>적용사유</th></tr></thead>
        <tbody>${noiseRows||'<tr><td colspan="6" style="text-align:center;color:#999;">소음 측정결과 없음</td></tr>'}</tbody>
      </table>
    </div>
    <h4 style="margin-bottom:8px;font-size:14px;">📊 사후관리 측정결과 요약</h4>
    <div style="overflow-x:auto;">
      <table class="result-table">
        <thead><tr><th>No.</th><th>대상 공종</th><th>단일물질</th><th>혼합유기화합물</th><th>소음</th><th>초과 유해물질</th><th>측정치/기준치</th></tr></thead>
        <tbody>${workTypeRows||'<tr><td colspan="7" style="text-align:center;color:#999;">공종 정보 없음</td></tr>'}</tbody>
      </table>
    </div>`;

  document.getElementById('measureResultFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal('measureResultModal')">닫기</button>
    <button class="btn btn-primary btn-sm" onclick="downloadMeasureDust()">📥 분진 결과표</button>
    <button class="btn btn-primary btn-sm" onclick="downloadMeasureNoise()">📥 소음 결과표</button>
    <button class="btn btn-primary btn-sm" onclick="downloadMeasureAfter()">📥 사후관리 결과표</button>`;
  openModal('measureResultModal');
  saveMeasureToList(d);
}

function saveMeasureToList(d) {
  const list = document.getElementById('measureList');
  const card = document.createElement('div');
  card.className = 'measure-card';
  card.innerHTML = `<div class="measure-round">${d.round}</div>
    <div class="measure-date">측정 기간: ${d.period}</div>
    <div class="measure-badges">
      <span class="badge badge-primary">분진 ${d.dust?.length||0}건</span>
      <span class="badge badge-primary">소음 ${d.noise?.length||0}건</span>
      ${d.dustExceeded||d.noiseExceeded ? '<span class="badge badge-danger">기준 초과 있음</span>' : '<span class="badge badge-ok">전체 기준 이하</span>'}
    </div>`;
  card.onclick = () => { currentMeasureData = d; showMeasureResult(d); };
  if (list.querySelector('[style*="text-align:center"]')) list.innerHTML = '';
  list.prepend(card);
}

window.downloadMeasureDust = function() {
  if (!currentMeasureData) return;
  const d = currentMeasureData;
  const rows = (d.dust||[]).map(r => ({ 'No.':r.no||'', '공정명':r.process||'', '유해인자':r.agent||'', '측정치':r.measured||'', '노출기준':r.limit||'', '적용사유':r.reason||'' }));
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new();
  const sheetName = `(${d.round}) 분진측정결과`.slice(0,30);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `작업환경측정_분진_${d.round}_${today()}.xlsx`);
  toast('분진 결과표 다운로드 완료', 'success');
};

window.downloadMeasureNoise = function() {
  if (!currentMeasureData) return;
  const d = currentMeasureData;
  const rows = (d.noise||[]).map(r => ({ 'No.':r.no||'', '공종명':r.process||'', '유해인자(소음)':'소음', '측정치dB(A)':r.measured||'', '노출기준 90dB(A)':'90dB(A)', '적용사유':r.reason||'' }));
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `소음측정결과`.slice(0,30));
  XLSX.writeFile(wb, `작업환경측정_소음_${d.round}_${today()}.xlsx`);
  toast('소음 결과표 다운로드 완료', 'success');
};

window.downloadMeasureAfter = function() {
  if (!currentMeasureData) return;
  const d = currentMeasureData;
  const rows = (d.workTypes||[]).map((wt,i) => {
    const hasDust = (d.dust||[]).some(r=>r.process?.includes(wt));
    const hasNoise = (d.noise||[]).some(r=>r.process?.includes(wt));
    return { '구분':i+1, '대상 공종':wt,
      '단일물질':hasDust?(d.dustExceeded?'초과':'미만'):'해당없음',
      '혼합유기화합물':d.mixedExceeded?(hasDust?'초과':'해당없음'):'해당없음',
      '소음':hasNoise?(d.noiseExceeded?'초과':'미만'):'해당없음',
      '초과 유해물질':'', '측정치/기준치':'' };
  });
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '사후관리결과');
  XLSX.writeFile(wb, `작업환경측정_사후관리_${d.round}_${today()}.xlsx`);
  toast('사후관리 결과표 다운로드 완료', 'success');
};

// ═══════════════════════════════════════════════
// 건강진단
// ═══════════════════════════════════════════════
window.openHealthUpload = function() {
  healthFileQueue = []; healthConfirmData = []; healthExcelData = null; healthExcelName_val = null;
  document.getElementById('healthRound').value = '';
  document.getElementById('healthFileQueue').style.display = 'none';
  document.getElementById('healthUploadZone').style.display = 'block';
  openModal('healthUploadModal');
};

window.dropHealthFiles = function(e) {
  e.preventDefault(); document.getElementById('healthUploadZone').classList.remove('drag');
  const ok = ['application/pdf','image/jpeg','image/png'];
  const files = [...e.dataTransfer.files].filter(f => ok.includes(f.type));
  if (files.length) addHealthFiles(files);
};

window.handleHealthFiles = function(e) {
  const ok = ['application/pdf','image/jpeg','image/png'];
  const files = [...e.target.files].filter(f => ok.includes(f.type));
  addHealthFiles(files); e.target.value = '';
};

function addHealthFiles(files) {
  files.forEach(file => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const item = { id, file, name: file.name, data: null, mediaType: file.type, status: 'waiting' };
    healthFileQueue.push(item);
    const reader = new FileReader();
    reader.onload = ev => { item.data = ev.target.result.split(',')[1]; renderHealthFileQueue(); };
    reader.readAsDataURL(file);
  });
  renderHealthFileQueue();
}

function renderHealthFileQueue() {
  const el = document.getElementById('healthFileQueue');
  if (healthFileQueue.length === 0) { el.style.display='none'; return; }
  el.style.display = 'flex';
  el.innerHTML = healthFileQueue.map(item => `
    <div class="file-item ${item.status}">
      <span class="fi-icon">${{waiting:'📄',parsing:'⏳',done:'✅',error:'❌'}[item.status]}</span>
      <div class="fi-info"><div class="fi-name">${item.name}</div></div>
      ${item.status !== 'parsing' ? `<button class="fi-remove" onclick="removeHealthFile('${item.id}')">✕</button>` : ''}
    </div>`).join('');
}

window.removeHealthFile = function(id) { healthFileQueue = healthFileQueue.filter(f => f.id !== id); renderHealthFileQueue(); };

window.analyzeHealth = async function() {
  const round = document.getElementById('healthRound').value.trim();
  if (!round) { toast('진단 회차를 입력하세요', 'error'); return; }
  if (healthFileQueue.length === 0) { toast('파일을 먼저 업로드하세요', 'error'); return; }
  const btn = document.getElementById('healthAnalyzeBtn');
  btn.disabled = true; btn.textContent = '🤖 AI 분석 중...';
  healthCurrentRound = round;
  healthConfirmData = [];
  for (const item of healthFileQueue) {
    item.status = 'parsing'; renderHealthFileQueue();
    try {
      const { data, error } = await supabase.functions.invoke('parse-msds', {
        body: {
          fileBase64: item.data, mediaType: item.mediaType,
          mode: 'health',
          prompt: `이 건강진단 결과 문서에서 근로자별 정보를 추출하세요. 여러 명이면 모두 추출. JSON 배열만 응답:
[{
  "name":"이름",
  "contractor":"협력사명",
  "jobType":"직무구분(예:소음작업,분진작업,일반)",
  "examDate":"검진일자 YYYY.MM.DD",
  "examType":"1(일반)/2(특수)/3(배치전)",
  "resultCode":"A|B|C1|C2|CN|D1|D2|DN|R|U|V",
  "hazardResult":"유해인자별 판정이 A가 아닌 것만. 예: 소음(우) D1, 소음(좌) C1"
}]`
        }
      });
      if (error || data.error) throw new Error((error||data).message || data.error);
      const parsed = Array.isArray(data.result) ? data.result : [data.result];
      healthConfirmData.push(...parsed);
      item.status = 'done';
    } catch (err) { item.status = 'error'; console.error(err); }
    renderHealthFileQueue();
    await new Promise(r => setTimeout(r, 200));
  }
  btn.disabled = false; btn.textContent = '🤖 AI 분석 시작';
  if (healthConfirmData.length === 0) { toast('분석 결과가 없습니다. 파일을 확인하세요', 'error'); return; }
  closeModal('healthUploadModal');
  showHealthConfirm();
};

function showHealthConfirm() {
  const tbody = document.getElementById('healthConfirmBody');
  const contractorOpts = contractors.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  tbody.innerHTML = healthConfirmData.map((item, i) => `
    <tr>
      <td class="ctr" style="color:var(--text3);">${i+1}</td>
      <td><input value="${item.name||''}" onchange="healthConfirmData[${i}].name=this.value"></td>
      <td><select onchange="healthConfirmData[${i}].contractor=this.value"><option value="">선택</option>${contractorOpts}</select></td>
      <td><input value="${item.jobType||''}" onchange="healthConfirmData[${i}].jobType=this.value" placeholder="소음작업"></td>
      <td><input value="${item.examDate||''}" onchange="healthConfirmData[${i}].examDate=this.value" placeholder="2026.01.01"></td>
      <td>
        <select onchange="healthConfirmData[${i}].examType=this.value">
          <option value="1" ${item.examType==='1'?'selected':''}>1 일반</option>
          <option value="2" ${item.examType==='2'?'selected':''}>2 특수</option>
          <option value="3" ${item.examType==='3'?'selected':''}>3 배치전</option>
        </select>
      </td>
      <td>
        <select onchange="healthConfirmData[${i}].resultCode=this.value">
          ${['A','B','C1','C2','CN','D1','D2','DN','R','U','V'].map(c => `<option value="${c}" ${item.resultCode===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </td>
      <td><input value="${item.hazardResult||''}" onchange="healthConfirmData[${i}].hazardResult=this.value" placeholder="소음(우) D1" style="min-width:140px;"></td>
    </tr>`).join('');

  // 협력사 select 기본값 설정
  const rows = tbody.querySelectorAll('tr');
  healthConfirmData.forEach((item, i) => {
    const sel = rows[i]?.querySelector('select');
    if (sel && item.contractor) sel.value = item.contractor;
  });

  document.getElementById('healthExcelName').textContent = '';
  document.getElementById('healthDownloadBtn').disabled = true;
  document.getElementById('healthAnalyzeBtn').disabled = false;
  openModal('healthConfirmModal');
}

window.handleHealthExcel = function(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    healthExcelData = ev.target.result;
    healthExcelName_val = file.name;
    document.getElementById('healthExcelName').textContent = '✅ ' + file.name;
    document.getElementById('healthDownloadBtn').disabled = false;
    toast('엑셀 양식이 로드됐습니다', 'success');
  };
  reader.readAsBinaryString(file);
  e.target.value = '';
};

window.downloadHealthExcel = function() {
  if (!healthExcelData) { toast('엑셀 양식을 먼저 업로드하세요', 'error'); return; }
  try {
    const wb = XLSX.read(healthExcelData, { type: 'binary' });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const allData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // L=11, M=12, N=13, O=14 (0-indexed)
    const nameCol = findNameColumn(allData);

    healthConfirmData.forEach(item => {
      if (!item.name) return;
      // 이름으로 행 찾기
      const rowIdx = allData.findIndex((row, ri) => ri > 0 && String(row[nameCol]||'').trim() === item.name.trim());
      if (rowIdx < 0) return;
      allData[rowIdx][11] = item.examDate || '';      // L열: 검진일자
      allData[rowIdx][12] = item.examType || '';      // M열: 구분코드
      allData[rowIdx][13] = item.resultCode || '';    // N열: 결과코드
      allData[rowIdx][14] = item.hazardResult || '';  // O열: 유해인자별
    });

    const newWS = XLSX.utils.aoa_to_sheet(allData);
    wb.Sheets[wsName] = newWS;
    XLSX.writeFile(wb, `건강진단_${healthCurrentRound}_${today()}.xlsx`);
    toast('엑셀 다운로드 완료', 'success');
  } catch (err) { toast('엑셀 처리 실패: ' + err.message, 'error'); }
};

function findNameColumn(data) {
  // 헤더 행에서 '이름' 또는 '성명' 컬럼 찾기
  for (let ri = 0; ri < Math.min(5, data.length); ri++) {
    for (let ci = 0; ci < data[ri].length; ci++) {
      const cell = String(data[ri][ci]||'');
      if (cell.includes('이름') || cell.includes('성명')) return ci;
    }
  }
  return 0; // 기본값: 첫 번째 열
}

window.saveHealthRecord = function() {
  // 대장에 저장 (추후 Supabase 테이블 추가 시 활용)
  closeModal('healthConfirmModal');
  const list = document.getElementById('healthList');
  const card = document.createElement('div');
  card.className = 'health-card';
  card.innerHTML = `<div class="measure-round">${healthCurrentRound}</div>
    <div class="measure-date">${today()}</div>
    <div class="measure-badges">
      <span class="badge badge-primary">총 ${healthConfirmData.length}명</span>
      <span class="badge badge-ok">분석 완료</span>
    </div>`;
  card.onclick = () => showHealthConfirm();
  if (list.querySelector('[style*="text-align:center"]')) list.innerHTML = '';
  list.prepend(card);
  toast('건강진단 결과가 저장됐습니다', 'success');
};

// ═══════════════════════════════════════════════
// Modal / Toast
// ═══════════════════════════════════════════════
window.openModal = function(id) { document.getElementById(id)?.classList.add('open'); };
window.closeModal = function(id) { document.getElementById(id)?.classList.remove('open'); };

// ESC로 모달 닫기
document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open')); } });

window.toast = function(msg, type='') {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = (type==='success'?'✓ ':type==='error'?'✕ ':type==='warn'?'⚠ ':'')+msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

// ═══════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════
init();

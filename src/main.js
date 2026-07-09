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
let pendingInvites = [];
let measureFileData = null, measureFileName_val = null;

// 전역 붙여넣기 캐치: 사진 업로드 모달이 열려있을 때 어디서 Ctrl+V를 눌러도 잡히도록 보강
document.addEventListener('paste', (e) => {
  const modal = document.getElementById('photoUploadModal');
  if (modal && modal.classList.contains('open') && typeof window.handlePhotoPaste === 'function') {
    window.handlePhotoPaste(e);
  }
});
let healthConfirmData = [], healthExcelData = null, healthExcelName_val = null;
let healthCurrentRound = null;
let currentMeasureData = null;

// ═══════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════
// ── 자동 로그인 (이 기기에 저장) ──
const AUTO_LOGIN_KEY = 'fms_auto_login';
const b64enc = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
function getSavedLogin() {
  try {
    const raw = localStorage.getItem(AUTO_LOGIN_KEY);
    if (!raw) return null;
    const { e, p } = JSON.parse(b64dec(raw));
    return { email: e, password: p };
  } catch { return null; }
}
function saveLogin(email, password) {
  try { localStorage.setItem(AUTO_LOGIN_KEY, b64enc(JSON.stringify({ e: email, p: password }))); } catch {}
}
function clearSavedLogin() { localStorage.removeItem(AUTO_LOGIN_KEY); }

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    user = session.user;
    await showWorkspaces(true);
  } else {
    const saved = getSavedLogin();
    if (saved) {
      const { error } = await supabase.auth.signInWithPassword(saved);
      if (!error) {
        user = (await supabase.auth.getUser()).data.user;
        await showWorkspaces(true);
        document.getElementById('loadingScreen').style.display = 'none';
        return;
      }
      // 비밀번호가 바뀌었거나 실패 → 저장 삭제 후 로그인 화면
      clearSavedLogin();
    }
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
  const saved = getSavedLogin();
  const savedBtn = document.getElementById('savedLoginBtn');
  if (saved) {
    document.getElementById('loginEmail').value = saved.email;
    document.getElementById('autoLoginChk').checked = true;
    if (savedBtn) { savedBtn.style.display = 'block'; savedBtn.textContent = `⚡ ${saved.email} (으)로 바로 로그인`; }
  } else if (savedBtn) savedBtn.style.display = 'none';
}

window.loginWithSaved = async function() {
  const saved = getSavedLogin();
  if (!saved) return;
  const btn = document.getElementById('savedLoginBtn');
  btn.disabled = true; btn.textContent = '로그인 중...';
  const { error } = await supabase.auth.signInWithPassword(saved);
  btn.disabled = false;
  if (error) {
    clearSavedLogin(); btn.style.display = 'none';
    const msg = document.getElementById('loginMsg');
    msg.className = 'auth-msg error'; msg.textContent = '저장된 정보로 로그인 실패 — 비밀번호를 다시 입력하세요';
    return;
  }
  user = (await supabase.auth.getUser()).data.user;
  await showWorkspaces(true);
};

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
  if (document.getElementById('autoLoginChk')?.checked) saveLogin(email, password);
  else clearSavedLogin();
  user = (await supabase.auth.getUser()).data.user;
  await showWorkspaces(true);
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
  msg.className='auth-msg success'; msg.textContent='가입 완료! 로그인하세요.';
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
  clearSavedLogin(); // 로그아웃 = 자동 로그인도 해제 (아니면 새로고침 시 다시 로그인됨)
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
async function showWorkspaces(autoEnter = false) {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('workspaceScreen').style.display = 'block';
  document.getElementById('appScreen').style.display = 'none';
  const name = user.user_metadata?.name || user.email.split('@')[0];
  document.getElementById('wsGreeting').textContent = `안녕하세요, ${name}님 👋`;
  document.getElementById('topbarUser').textContent = user.email;
  await loadWorkspaces();
  if (autoEnter && workspaces.length > 0) {
    const lastId = localStorage.getItem('fms_last_ws');
    const target = workspaces.find(w => w.id === lastId) || (workspaces.length === 1 ? workspaces[0] : null);
    if (target) await enterWorkspace(target.id);
  }
}

async function loadWorkspaces() {
  const { data: memberRows } = await supabase.from('workspace_members')
    .select('workspace_id, role').eq('user_id', user.id);
  if (!memberRows || memberRows.length === 0) {
    workspaces = []; renderWorkspaceList(); return;
  }
  const wsIds = memberRows.map(m => m.workspace_id);
  const { data, error } = await supabase.from('workspaces')
    .select('*').in('id', wsIds).order('created_at', { ascending: true });
  if (error) { toast('현장 목록 로드 실패', 'error'); workspaces = []; renderWorkspaceList(); return; }
  workspaces = (data || []).map(ws => ({
    ...ws,
    workspace_members: [{ role: memberRows.find(m => m.workspace_id === ws.id)?.role || 'member' }]
  }));
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

window.enterWorkspace = async function(wsId) {
  currentWS = workspaces.find(w => w.id === wsId);
  if (!currentWS) return;
  localStorage.setItem('fms_last_ws', wsId);
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
  await Promise.all([loadContractors(), loadWorkTypes(), loadMembers(), loadTokens(), loadPublicLink()]);
  await loadMsdsRecords();
  await Promise.all([loadPlacementSnapshots(), loadTodos(), loadRoutineTasks(), loadBusinessLicenses(), loadMeasureRounds(), loadMeasureResults(), loadNotifications(), loadHealthRecords()]);
  subscribeNotifications();
  renderHomeDashboard(); // 알림(재업로드 도착) 로드 후 대시보드 갱신
  loadDashWeather();
  await loadPhotoFolders();
  await loadPhotos();
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
const PAGES = ['home','calendar','msds','warning','upload-link','measure','health','photos','manpower','weather','vulnerable','bp','library','settings'];
const MOBILE_TABS = ['home','calendar','msds','health','settings'];

window.showPage = function(id) {
  PAGES.forEach(p => {
    document.getElementById('page-'+p)?.classList.toggle('active', p === id);
    document.getElementById('nav-'+p)?.classList.toggle('active', p === id);
  });
  MOBILE_TABS.forEach(t => {
    document.getElementById('mtab-'+t)?.classList.toggle('active', t === id);
  });
  if (id === 'warning') { renderWarnPickList(); updateWarningPreview(); }
  if (id === 'upload-link') { renderTokenList(); renderPublicLinkUI(); }
  if (id === 'health') switchHealthSub('result');
  if (id === 'calendar') { loadCalendarEvents().then(renderCalendar); }
  if (id === 'photos') { renderPhotoFolderTree(); renderPhotoMain(); }
  if (id === 'measure') { renderMeasureRoundsChecklist(); renderMeasureList(); }
  if (id === 'manpower') { initManpowerPage(); }
  if (id === 'weather') { loadWeatherPage(); }
  if (id === 'bp') { initBpPage(); }
  if (id === 'library') { initLibraryPage(); }
  if (id === 'settings') { renderContractorTags(); loadMembers(); }
  document.getElementById('mainContent')?.scrollTo(0, 0);
  if (id === 'settings') {
    renderContractorTags(); loadMembers();
    // 재판정 버튼 건수 업데이트
    const btn = document.getElementById('reanalyzeLegalBtn');
    if (btn) btn.textContent = `⚖️ 법정물질 일괄 재판정 (${msdsRecords.length}건)`;
  }
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
  ['batchContractor','f_contractor','pkgContractor','linkContractor','workTypeContractor'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const q = (document.getElementById(id + 'Search')?.value || '').trim().toLowerCase();
    const list = !q ? contractors : contractors.filter(c => c.name.toLowerCase().includes(q));
    const cur = el.value;
    el.innerHTML = '<option value="">' + (q ? `검색결과 ${list.length}건` : '선택하세요') + '</option>' +
      list.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    el.value = list.some(c => c.id === cur) ? cur : '';
  });
}

window.searchContractorSelect = function(id) {
  const isNameBased = id === 'warnFilterContractor'; // 경고표지 필터는 값이 이름 기반
  isNameBased ? populateWarnContractorFilter() : populateContractorSelects();
  // 검색 결과가 정확히 1곳이면 자동 선택 + 연동 로직(공종 목록·목록 필터 등)까지 발동
  const q = (document.getElementById(id + 'Search')?.value || '').trim().toLowerCase();
  if (!q) return;
  const matches = contractors.filter(c => c.name.toLowerCase().includes(q));
  const el = document.getElementById(id);
  const val = isNameBased ? matches[0]?.name : matches[0]?.id;
  if (matches.length === 1 && el && el.value !== val) {
    el.value = val;
    el.dispatchEvent(new Event('change'));
  }
};

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
  const el = document.getElementById('conMgrList');
  if (!el) return;
  const q = (document.getElementById('conMgrSearch')?.value || '').trim().toLowerCase();
  const list = contractors.filter(c => !q || c.name.toLowerCase().includes(q));
  const cnt = document.getElementById('conMgrCount');
  if (cnt) cnt.textContent = `(${contractors.length}개사)`;
  if (!list.length) {
    el.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:14px 0;">${q ? '검색 결과가 없습니다' : '등록된 협력사가 없습니다'}</div>`;
    return;
  }
  el.innerHTML = list.map(c => {
    const wts = getWorkTypesForContractor(c.id);
    const msdsCnt = msdsRecords.filter(r => r.contractor === c.name).length;
    const hasLic = businessLicenses.some(l => l.contractor_id === c.id);
    const wtChips = wts.map(w => `<span class="tag" style="font-size:11px;padding:2px 8px;">${w.name}<span class="tag-remove" onclick="conMgrDelWt('${w.id}')">✕</span></span>`).join('')
      + `<button class="btn btn-outline btn-sm" style="padding:1px 8px;font-size:11px;" onclick="conMgrAddWt('${c.id}')">+ 공종</button>`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <div style="flex:1;min-width:140px;">
        <div style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;">
          ${c.name}
          <button class="btn btn-secondary btn-sm btn-icon" style="padding:1px 6px;" onclick="renameContractor('${c.id}')" title="이름 변경">✏️</button>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;align-items:center;">${wtChips}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
        <span style="font-size:12px;color:var(--text2);cursor:pointer;" onclick="showPage('msds');window.selectedContractor='${c.name.replace(/'/g,"\\'")}';renderMsdsTable();renderContractorSidebar&&renderContractorSidebar()" title="MSDS 대장에서 보기">🧪 ${msdsCnt}건</span>
        <span style="font-size:12px;color:${hasLic?'var(--ok)':'var(--danger)'};">📑 ${hasLic?'제출':'미제출'}</span>
        <button class="btn btn-danger btn-sm btn-icon" onclick="removeContractor('${c.id}')" title="삭제">🗑</button>
      </div>
    </div>`;
  }).join('');
};

window.renameContractor = async function(id) {
  const c = contractors.find(x => x.id === id);
  if (!c) return;
  const name = prompt(`'${c.name}'의 새 이름을 입력하세요.\n(MSDS 대장의 협력사명도 함께 변경됩니다)`, c.name);
  if (!name || name.trim() === '' || name.trim() === c.name) return;
  const newName = name.trim();
  if (contractors.some(x => x.name === newName)) { toast('이미 같은 이름의 협력사가 있습니다', 'error'); return; }
  const { error } = await supabase.from('contractors').update({ name: newName }).eq('id', id);
  if (error) { toast('변경 실패: ' + error.message, 'error'); return; }
  // MSDS 대장의 협력사명 문자열도 연쇄 변경
  const { error: e2 } = await supabase.from('msds_records')
    .update({ contractor: newName }).eq('workspace_id', currentWS.id).eq('contractor', c.name);
  if (e2) toast('협력사명은 바뀌었지만 MSDS 대장 반영 실패: ' + e2.message, 'error');
  if (window.selectedContractor === c.name) window.selectedContractor = newName;
  c.name = newName;
  await loadMsdsRecords();
  populateContractorSelects(); renderContractorTags();
  toast(`'${newName}'(으)로 변경됐습니다`, 'success');
};

window.conMgrAddWt = async function(conId) {
  const v = prompt('추가할 공종명을 입력하세요');
  if (!v || !v.trim()) return;
  const name = v.trim();
  if (getWorkTypesForContractor(conId).some(w => w.name === name)) { toast('이미 있는 공종입니다', 'error'); return; }
  const { data, error } = await supabase.from('work_types').insert({ workspace_id: currentWS.id, contractor_id: conId, name }).select().single();
  if (error) { toast('추가 실패', 'error'); return; }
  workTypes.push(data);
  renderContractorTags();
  toast(name + ' 추가됨', 'success');
};

window.conMgrDelWt = async function(id) {
  await supabase.from('work_types').delete().eq('id', id);
  workTypes = workTypes.filter(w => w.id !== id);
  renderContractorTags();
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
  const c = contractors.find(x => x.id === id);
  const linked = c ? msdsRecords.filter(r => r.contractor === c.name).length : 0;
  const warn = linked > 0
    ? `이 협력사에 연결된 MSDS가 ${linked}건 있습니다.\nMSDS 기록은 삭제되지 않고 남지만, 협력사와 공종 정보는 삭제됩니다.\n계속하시겠습니까?`
    : '협력사를 삭제하면 관련 공종도 삭제됩니다. 계속하시겠습니까?';
  if (!confirm(warn)) return;
  await supabase.from('contractors').delete().eq('id', id);
  contractors = contractors.filter(c => c.id !== id);
  workTypes = workTypes.filter(w => w.contractor_id !== id);
  renderContractorTags(); populateContractorSelects();
  toast('삭제됐습니다');
};

window.renderWorkTypeTags = function() {
  const sel = document.getElementById('workTypeContractor');
  if (!sel) { renderContractorTags(); return; } // 통합 협력사 관리 UI로 대체됨
  const conId = sel.value;
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

// ═══════════════════════════════════════════════
// Members
// ═══════════════════════════════════════════════
async function loadMembers() {
  const { data } = await supabase.from('workspace_members')
    .select('*, user:user_id(email, raw_user_meta_data)')
    .eq('workspace_id', currentWS.id);
  members = data || [];
  const { data: inviteData } = await supabase.from('workspace_invites')
    .select('*').eq('workspace_id', currentWS.id).is('accepted_at', null).order('created_at');
  pendingInvites = inviteData || [];
  renderMemberList();
}

function renderMemberList() {
  const el = document.getElementById('memberList');
  if (!el) return;
  const canManage = currentWS.owner_id === user.id || members.find(m => m.user_id === user.id)?.role === 'admin';
  const memberHtml = members.map(m => {
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
      ${!isMe && !isOwner && canManage ? `<button class="btn btn-danger btn-sm" onclick="removeMember('${m.id}')">제거</button>` : ''}
    </div>`;
  }).join('');
  const inviteHtml = pendingInvites.map(inv => `
    <div class="member-item">
      <div class="member-avatar" style="background:var(--text3);">✉️</div>
      <div class="member-info">
        <div class="member-name">${inv.email}</div>
        <div class="member-email">초대 대기 중 · 가입 시 자동 합류</div>
      </div>
      <span class="member-role ${inv.role}">${inv.role === 'admin' ? '관리자' : '멤버'}</span>
      ${canManage ? `
        <button class="btn btn-secondary btn-sm" onclick="resendInvite('${inv.email.replace(/'/g,"\\'")}')">재전송</button>
        <button class="btn btn-danger btn-sm" onclick="cancelInvite('${inv.id}')">취소</button>` : ''}
    </div>`).join('');
  el.innerHTML = memberHtml + inviteHtml;
}

window.handleInvite = async function() {
  const emailInput = document.getElementById('inviteEmail');
  const email = emailInput.value.trim().toLowerCase();
  const role = document.getElementById('inviteRole').value;
  const msg = document.getElementById('inviteMsg');
  const btn = document.getElementById('inviteBtn');
  if (!email) { msg.className='auth-msg error'; msg.textContent='이메일을 입력하세요'; return; }
  if (email === user.email.toLowerCase()) { msg.className='auth-msg error'; msg.textContent='본인은 이미 팀원입니다'; return; }
  if (members.some(m => (m.user?.email||'').toLowerCase() === email)) { msg.className='auth-msg error'; msg.textContent='이미 팀원으로 등록되어 있습니다'; return; }

  if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
  msg.className='auth-msg'; msg.textContent='';

  try {
    // 1) 이미 가입된 사용자인지 확인
    const { data: existingUserId, error: rpcErr } = await supabase.rpc('get_user_id_by_email', { email_input: email });
    if (rpcErr) throw rpcErr;

    if (existingUserId) {
      const { error } = await supabase.from('workspace_members').insert({ workspace_id: currentWS.id, user_id: existingUserId, role });
      if (error) throw error;
      msg.className='auth-msg success'; msg.textContent='팀원으로 추가되었습니다!';
      emailInput.value = '';
      await loadMembers();
      return;
    }

    // 2) 미가입자 → 초대 대기 등록 + 가입 유도 메일 발송
    const { error: inviteErr } = await supabase.from('workspace_invites')
      .upsert({ workspace_id: currentWS.id, email, role, invited_by: user.id, accepted_at: null }, { onConflict: 'workspace_id,email' });
    if (inviteErr) throw inviteErr;

    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin }
    });
    if (otpErr) throw otpErr;

    msg.className='auth-msg success'; msg.textContent='초대 메일을 보냈습니다. 상대방이 메일의 링크로 가입하면 자동으로 팀에 합류합니다.';
    emailInput.value = '';
    await loadMembers();
  } catch (error) {
    msg.className='auth-msg error'; msg.textContent='초대 실패: ' + (error?.message || '알 수 없는 오류');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '초대'; }
  }
};

window.resendInvite = async function(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin }
  });
  if (error) { toast('재전송 실패: ' + error.message, 'error'); return; }
  toast('초대 메일을 다시 보냈습니다', 'success');
};

window.cancelInvite = async function(id) {
  if (!confirm('초대를 취소하시겠습니까?')) return;
  await supabase.from('workspace_invites').delete().eq('id', id);
  await loadMembers();
  toast('초대가 취소됐습니다');
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
  renderContractorSidebar(); // 추가
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
  // ① 경고 배너 — PDF 있고 재분석 안 한 것 + 사업자등록증 미제출 + MSDS 미수령
  const subNoIssues = msdsRecords.filter(r => r.submission_no_valid === 'N' && r.has_pdf);
  const licenseMissing = contractors.filter(c => !businessLicenses.some(l => l.contractor_id === c.id));
  const pending = msdsRecords.filter(r => r.receipt_status === 'pending');

  const alertWrap = document.getElementById('dashAlertWrap');
  const alertSummary = document.getElementById('dashAlertSummary');

  const alerts = [];
  const unreadNotifs = (notifs || []).filter(n => !n.read);
  if (unreadNotifs.length) alerts.push(`협력사 재업로드 도착 ${unreadNotifs.length}건`);
  if (subNoIssues.length) alerts.push(`MSDS 제출번호 미확인 ${subNoIssues.length}건`);
  if (licenseMissing.length) alerts.push(`사업자등록증 미제출 ${licenseMissing.length}개사`);
  if (pending.length) alerts.push(`MSDS 미수령 ${pending.length}건`);

  if (alerts.length) {
    alertWrap.style.display = 'block';
    alertSummary.textContent = '⚠️ ' + alerts.join(' · ');

    // 협력사 재업로드 도착 알림
    const notifInner = document.getElementById('notifAlertInner');
    const notifList = document.getElementById('notifAlertList');
    if (notifInner && notifList) {
      if (unreadNotifs.length) {
        notifInner.style.display = 'block';
        notifList.innerHTML = unreadNotifs.slice(0, 6).map(n => `
          <div class="alert-item">
            <span><b>${n.title}</b>${n.body ? ` · ${n.body}` : ''}</span>
            <div style="display:flex;gap:4px;">
              ${n.record_id ? `<button class="btn btn-warn btn-sm" onclick="openNotifRecord('${n.id}','${n.record_id}')">확인</button>` : ''}
              <button class="btn btn-secondary btn-sm" onclick="markNotifRead('${n.id}')">읽음</button>
            </div>
          </div>`).join('') + (unreadNotifs.length > 6 ? `<div style="font-size:12px;color:var(--warn);margin-top:4px;">외 ${unreadNotifs.length-6}건</div>` : '');
      } else notifInner.style.display = 'none';
    }

    // MSDS 제출번호
    const subInner = document.getElementById('submissionNoAlertInner');
    const subList = document.getElementById('submissionNoAlertList');
    if (subNoIssues.length) {
      subInner.style.display = 'block';
      subList.innerHTML = subNoIssues.slice(0, 6).map(r => `
        <div class="alert-item">
          <span><b>${r.product_name}</b> · ${r.contractor}</span>
          <button class="btn btn-warn btn-sm" onclick="showMsdsDetail('${r.id}')">확인</button>
        </div>`).join('') + (subNoIssues.length > 6 ? `<div style="font-size:12px;color:var(--warn);margin-top:4px;">외 ${subNoIssues.length-6}건</div>` : '');
    } else { subInner.style.display = 'none'; }

    // 사업자등록증
    const licInner = document.getElementById('licenseAlertInner');
    const licList = document.getElementById('licenseAlertList');
    if (licenseMissing.length) {
      licInner.style.display = 'block';
      licList.innerHTML = licenseMissing.slice(0, 6).map(c => `
        <div class="alert-item">
          <span><b>${c.name}</b></span>
          <button class="btn btn-warn btn-sm" onclick="showPage('settings')">관리</button>
        </div>`).join('') + (licenseMissing.length > 6 ? `<div style="font-size:12px;color:var(--warn);margin-top:4px;">외 ${licenseMissing.length-6}개사</div>` : '');
    } else { licInner.style.display = 'none'; }

    // MSDS 미수령
    const pendingInner = document.getElementById('pendingAlertInner');
    const pendingList = document.getElementById('pendingList');
    if (pending.length) {
      pendingInner.style.display = 'block';
      const grouped = {};
      pending.forEach(r => { grouped[r.contractor] = (grouped[r.contractor]||0)+1; });
      pendingList.innerHTML = Object.entries(grouped).slice(0,6).map(([con, cnt]) => {
        const token = tokens.find(t => t.contractor?.name === con);
        const url = token ? `${window.location.origin}/upload.html?token=${token.token}` : null;
        return `<div class="alert-item">
          <span><b>${con}</b> · ${cnt}건</span>
          ${url ? `<button class="btn btn-warn btn-sm" onclick="copyLink('${url}')">링크 복사</button>` : '<span style="font-size:11px;color:var(--text3)">링크 없음</span>'}
        </div>`;
      }).join('') + (Object.keys(grouped).length > 6 ? `<div style="font-size:12px;color:var(--warn);margin-top:4px;">외 ${Object.keys(grouped).length-6}개사</div>` : '');
    } else { pendingInner.style.display = 'none'; }
  } else {
    alertWrap.style.display = 'none';
  }

  // ② 이번 주 일정 (월~일 7칸)
  renderDashWeekSchedule();

  // ③ 최근 등록 MSDS
  const recent = msdsRecords.slice(0, 5);
  document.getElementById('recentMsdsList').innerHTML = recent.length === 0
    ? '<div style="color:var(--text3);font-size:13px;text-align:center;padding:20px;">등록된 물질이 없습니다</div>'
    : recent.map(r => `<div class="recent-item" onclick="showMsdsDetail('${r.id}')">
        <div class="recent-icon">🧪</div>
        <div>
          <div class="recent-name">${r.product_name}</div>
          <div class="recent-meta">${r.contractor} ${r.work_type ? '/ '+r.work_type : ''} · ${r.legal_special==='Y' ? '<span style="color:var(--danger)">특별관리물질</span>' : '일반'}</div>
        </div>
      </div>`).join('');
}

function renderDashWeekSchedule() {
  const el = document.getElementById('dashWeekSchedule');
  if (!el) return;
  const now = new Date();
  const dow = now.getDay(); // 0=일
  const monday = new Date(now); monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  const days = Array.from({length: 7}, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return d;
  });
  const todayStr = today();
  const dayLabels = ['월','화','수','목','금','토','일'];

  el.innerHTML = `<div class="dash-week-row">${days.map((d, i) => {
    const dStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const isToday = dStr === todayStr;
    const isSun = i === 6;
    const isSat = i === 5;
    const dayEvs = calendarEvents.filter(e => e.event_date === dStr)
      .sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||''));

    const numEl = isToday
      ? `<div class="dash-day-today-marker">${d.getDate()}</div>`
      : `<div style="text-align:center;font-size:11px;color:${isSun?'#DC2626':isSat?'#2563EB':'var(--text3)'};margin-bottom:4px;">${d.getDate()}</div>`;

    return `<div class="dash-day-col">
      <div class="dash-day-label ${isToday?'today':''} ${isSun?'sun':''} ${isSat?'sat':''}">${dayLabels[i]}</div>
      ${numEl}
      ${dayEvs.slice(0,3).map(ev=>`<div class="dash-day-event" style="background:${ev.color||'#EFF6FF'};color:${ev.color?'#fff':'var(--primary)'};" onclick="showPage('calendar')" title="${ev.title}">${ev.start_time?ev.start_time.slice(0,5)+' ':''}${ev.title}</div>`).join('')}
      ${dayEvs.length>3?`<div style="font-size:10px;color:var(--text3);text-align:center;">+${dayEvs.length-3}</div>`:''}
    </div>`;
  }).join('')}</div>`;
}

let dashAlertsOpen = false;
window.toggleDashAlerts = function() {
  dashAlertsOpen = !dashAlertsOpen;
  document.getElementById('dashAlertDetail').style.display = dashAlertsOpen ? 'block' : 'none';
  document.getElementById('dashAlertToggleIcon').textContent = dashAlertsOpen ? '▴ 접기' : '▾ 펼치기';
};


// ═══════════════════════════════════════════════
// MSDS Table
// ═══════════════════════════════════════════════
function getFilteredMsds() {
  const q = (document.getElementById('searchInput')?.value||'').toLowerCase();
  const fCon = window.selectedContractor || '';
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
  }).sort((a,b) => {
    const conSort = a.contractor.localeCompare(b.contractor, 'ko');
    if (conSort !== 0) return conSort;
    return a.product_name.localeCompare(b.product_name, 'ko');
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
      <td><div class="td-name">${r.product_name}</div><div class="td-sub">v${r.version||1}${r.submission_no_valid === 'N' ? ' · <span style="color:var(--danger);font-weight:700;">⚠ 제출번호 확인필요</span>' : ''}${r.reupload_requested ? ' · <span style="color:var(--warn);font-weight:700;">🔁 재업로드 요청중</span>' : ''}</div></td>
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
          <button class="btn ${r.reupload_requested?'btn-warn':'btn-secondary'} btn-sm btn-icon" onclick="${r.reupload_requested?`cancelReupload('${r.id}')`:`requestReupload('${r.id}')`}" title="${r.reupload_requested?'재업로드 요청 취소':'협력사에 재업로드 요청'}">🔁</button>
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
        submission_no: parsed.submissionNo||'', submission_no_valid: parsed.submissionNoValid||'N',
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
    <div class="detail-row"><div class="detail-key">제출번호</div><div class="detail-val">${r.submission_no ? r.submission_no : '<span style="color:var(--danger);font-weight:700;">없음</span>'} ${r.submission_no_valid === 'N' ? '<span class="badge badge-danger" style="margin-left:6px;">⚠ 확인 필요</span>' : ''}</div></div>
    <div class="detail-row"><div class="detail-key">CAS No.</div><div class="detail-val">${r.cas_no||'-'} ${r.cas_no ? `<button class="btn btn-outline btn-sm" style="margin-left:8px;padding:2px 9px;font-size:11px;" onclick="openKosha('${r.cas_no.split(/[,;\s]/)[0].replace(/'/g,'')}')">🔍 KOSHA 조회</button>` : ''}</div></div>
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

// ─── 새 MSDS 파일로 갱신 (기존 레코드를 AI 재분석 결과로 버전업) ───
window.openMsdsRenewPicker = function() {
  if (!currentDetailId) return;
  document.getElementById('msdsRenewFileInput').value = '';
  document.getElementById('msdsRenewFileInput').click();
};

window.handleMsdsRenewFile = async function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const recId = currentDetailId;
  const old = msdsRecords.find(r => r.id === recId);
  if (!old) { toast('대상 MSDS를 찾을 수 없습니다', 'error'); return; }

  const btn = document.getElementById('msdsRenewBtn');
  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 분석 중...'; }

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const parsed = await callParseFunction(base64, file.type);

    const nv = (old.version || 1) + 1;
    const history = [...(old.history || []), { version: old.version || 1, date: (old.updated_at || old.created_at || '').split('T')[0], note: '새 MSDS 파일로 갱신' }];

    const updateFields = {
      product_name: parsed.productName || old.product_name,
      supplier: parsed.supplier || old.supplier,
      supplier_contact: parsed.supplierContact || old.supplier_contact,
      cas_no: parsed.casNo || '', components: parsed.components || '',
      signal_word: parsed.signalWord || '', h_codes: parsed.hCodes || '', p_codes: parsed.pCodes || '',
      pictograms: parsed.pictograms || '', issue_date: parsed.issueDate || '',
      protective_equipment: parsed.protectiveEquipment || '',
      legal_measurement: parsed.legalMeasurement || 'N', legal_exam: parsed.legalExam || 'N',
      legal_exam_cycle: parsed.legalExamCycle || '', legal_manage: parsed.legalManage || 'N',
      legal_permit: parsed.legalPermit || 'N', legal_special: parsed.legalSpecial || 'N',
      legal_dangerous: parsed.legalDangerous || 'N', special: parsed.legalSpecial === 'Y' ? 'Y_special' : 'N',
      submission_no: parsed.submissionNo || '', submission_no_valid: parsed.submissionNoValid || 'N',
      version: nv, history, updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('msds_records').update(updateFields).eq('id', recId);
    if (error) throw error;

    await uploadMsdsFile(recId, file.name, base64, file.type);
    await loadMsdsRecords();

    const updated = msdsRecords.find(r => r.id === recId);
    if (updated) showMsdsDetail(recId); // 상세 화면 새로고침
    toast(`새 MSDS로 갱신됐습니다 (v${nv})${parsed.submissionNoValid === 'N' ? ' — 제출번호 확인 필요' : ''}`, parsed.submissionNoValid === 'N' ? 'warn' : 'success');
  } catch (err) {
    console.error(err);
    toast('갱신 실패: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    e.target.value = '';
  }
};

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
function populateWarnContractorFilter() {
  const sel = document.getElementById('warnFilterContractor');
  if (!sel) return;
  const cur = sel.value;
  const q = (document.getElementById('warnFilterContractorSearch')?.value || '').trim().toLowerCase();
  const sorted = [...contractors].filter(c => !q || c.name.toLowerCase().includes(q)).sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  sel.innerHTML = `<option value="">${q ? `검색결과 ${sorted.length}건 (전체 보기)` : '전체 협력사'}</option>` + sorted.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  sel.value = sorted.some(c => c.name === cur) ? cur : '';
}

function getFilteredWarnRecords() {
  const q = (document.getElementById('warnSearchInput')?.value||'').trim().toLowerCase();
  const fCon = document.getElementById('warnFilterContractor')?.value || '';
  return msdsRecords.filter(r => {
    const mq = !q || [r.product_name, r.cas_no, r.supplier, r.contractor, r.work_type].join(' ').toLowerCase().includes(q);
    const mc = !fCon || r.contractor === fCon;
    return mq && mc;
  });
}

function renderWarnPickList() {
  const el = document.getElementById('warnPickList');
  if (!el) return;
  populateWarnContractorFilter();
  const filtered = getFilteredWarnRecords();
  const countLabel = document.getElementById('warnPickCountLabel');
  if (countLabel) countLabel.textContent = `물질 선택 (${filtered.length}건 표시 중 · ${warnSelected.size}건 선택됨)`;
  if (msdsRecords.length === 0) { el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px;">등록된 물질이 없습니다</div>'; return; }
  if (filtered.length === 0) { el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px;">검색/필터 조건에 맞는 물질이 없습니다</div>'; return; }
  el.innerHTML = filtered.map(r => `
    <label class="warn-pick-item">
      <input type="checkbox" class="warn-check" value="${r.id}" onchange="onWarnCheck('${r.id}',this.checked)" ${warnSelected.has(r.id)?'checked':''}>
      <div style="flex:1;min-width:0;">
        <div class="wp-name">${r.product_name}</div>
        <div class="wp-sub">${r.contractor} ${r.work_type?'/ '+r.work_type:''} ${r.signal_word?'· '+r.signal_word:''} ${r.cas_no?'· CAS '+r.cas_no:''}</div>
      </div>
      ${r.legal_special==='Y'?'<span class="badge badge-danger">특별</span>':''}
    </label>`).join('');
}
window.renderWarnPickList = renderWarnPickList;

window.onWarnCheck = function(id, checked) {
  if(checked) warnSelected.add(id); else warnSelected.delete(id);
  const countLabel = document.getElementById('warnPickCountLabel');
  if (countLabel) countLabel.textContent = countLabel.textContent.replace(/\d+건 선택됨/, `${warnSelected.size}건 선택됨`);
  updateWarningPreview();
};
window.selectAllWarn = function(v) {
  // 현재 검색/필터 조건에 맞는 물질만 대상으로 전체 선택·해제 (다른 필터의 기존 선택은 유지)
  const filtered = getFilteredWarnRecords();
  if (v) filtered.forEach(r => warnSelected.add(r.id));
  else filtered.forEach(r => warnSelected.delete(r.id));
  renderWarnPickList();
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
    ${r.legal_special==='Y'?`<div class="wl-special">⚠️ 특별관리물질 — 취급 시 관리감독자 확인 및 특별안전보건교육 필수</div>`:''}
    <div class="wl-foot">
      <div><b>공급업체</b>${r.supplier||'-'} ${r.supplier_contact?'('+r.supplier_contact+')':''}</div>
      <div><b>사용 협력사</b>${r.contractor||'-'} ${r.work_type?'/ '+r.work_type:''}</div>
      <div><b>현장</b>${site}</div>
      <div style="margin-top:6px;font-weight:700;text-align:center;">■ 기타 자세한 내용은 물질안전보건자료(MSDS) 참조</div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════
// 인쇄 공통 유틸 — 팝업 차단에 안전한 숨김 iframe 방식
// (기존 window.open 방식은 팝업 차단 시 조용히 실패해 "인쇄가 안 됨"으로 보이는 문제가 있었음)
// ═══════════════════════════════════════════════
function openPrintWindow(html) {
  const old = document.getElementById('__printFrame');
  if (old) old.remove();
  const iframe = document.createElement('iframe');
  iframe.id = '__printFrame';
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  const cleanup = () => { try { iframe.remove(); } catch {} };
  try { iframe.contentWindow.onafterprint = cleanup; } catch {}
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      toast('인쇄 창을 열지 못했습니다: ' + (e?.message || e), 'error');
      cleanup();
      return;
    }
    setTimeout(cleanup, 60000); // afterprint 미지원 브라우저 대비 안전장치
  }, 350);
}

function buildPrintHtml(title, pageSize, bodyStyle, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
    @page{size:${pageSize};margin:6mm;}
    *{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;}
    ${bodyStyle}
  </style></head><body>${bodyHtml}</body></html>`;
}

window.printWarnings = function() {
  const ids = [...warnSelected];
  if (ids.length === 0) { toast('인쇄할 물질을 선택하세요', 'error'); return; }
  const site = document.getElementById('warningSite')?.value || currentWS?.name || '현장명';
  const labels = ids.map(id => msdsRecords.find(r => r.id === id)).filter(Boolean);
  const pages = labels.map(r => `<div class="page-a4">${buildWarnLabel(r, site)}</div>`).join('');
  openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>경고표지</title><style>
    @page{size:A4;margin:6mm;}
    *{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;}
    .page-a4{width:100%;page-break-after:always;display:flex;align-items:flex-start;justify-content:center;}
    .page-a4:last-child{page-break-after:auto;}
    .wlabel{border:3px solid #111;border-radius:6px;padding:14px;width:100%;font-family:'Malgun Gothic',sans-serif;color:#111;background:#fff;}
    .wl-top{text-align:center;font-size:11px;font-weight:700;margin-bottom:6px;}
    .wl-name-box{border:2.5px solid #E30613;border-radius:5px;text-align:center;font-size:24px;font-weight:900;padding:8px;margin-bottom:10px;letter-spacing:3px;}
    .wl-picto-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:10px;align-items:flex-end;}
    .wl-signal-bar{text-align:center;font-size:15px;font-weight:900;color:#fff;padding:6px;border-radius:5px;margin-bottom:10px;}
    .wl-signal-bar.danger{background:#C0392B;} .wl-signal-bar.warning{background:#E67E22;}
    .wl-two-col{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:7px;}
    .wl-block{margin-bottom:7px;border:1px solid #ccc;border-radius:4px;overflow:hidden;}
    .wl-block.full{margin-bottom:7px;}
    .wl-block-head{background:#C0392B;color:#fff;font-size:10px;font-weight:800;padding:3px 10px;}
    .wl-list{margin:0;padding:5px 10px 5px 22px;font-size:9px;line-height:1.7;columns:2;column-gap:12px;}
    .wl-list li{break-inside:avoid;}
    .wl-pe{padding:5px 10px;font-size:9px;font-weight:600;columns:2;column-gap:12px;}
    .wl-special{background:#FFF3CD;border:1.5px solid #FFC107;border-radius:4px;padding:6px;margin:6px 0;font-size:9px;font-weight:800;color:#856404;text-align:center;}
    .wl-foot{border-top:1px solid #ddd;padding-top:6px;margin-top:8px;font-size:9px;color:#555;line-height:1.7;}
    .wl-foot b{color:#333;margin-right:3px;}
  </style></head><body>${pages}</body></html>`);
  toast(`${labels.length}건 인쇄 준비 완료`, 'success');
};

// ═══════════════════════════════════════════════
// 저장된 전체 물질 인쇄 (협력사별 표지 포함, 양면인쇄 대응)
// ═══════════════════════════════════════════════
window.printAllWarningsByContractor = function() {
  if (msdsRecords.length === 0) { toast('인쇄할 물질이 없습니다', 'error'); return; }
  const site = document.getElementById('warningSite')?.value || currentWS?.name || '현장명';

  const sorted = [...msdsRecords].sort((a,b) => {
    const c = (a.contractor||'').localeCompare(b.contractor||'', 'ko');
    if (c !== 0) return c;
    return (a.product_name||'').localeCompare(b.product_name||'', 'ko');
  });

  // 협력사별로 그룹핑
  const groups = [];
  sorted.forEach(r => {
    const last = groups[groups.length-1];
    if (last && last.contractor === r.contractor) last.items.push(r);
    else groups.push({ contractor: r.contractor, items: [r] });
  });

  // 표지가 항상 앞면(홀수 페이지)에 오도록 페이지를 구성.
  // 양면인쇄 시 앞면=홀수 페이지, 뒷면=짝수 페이지이므로,
  // 필요하면 빈 페이지를 하나 끼워서 표지를 홀수 페이지로 맞춘다.
  let pageCount = 0;
  const htmlPages = [];
  groups.forEach(g => {
    if (pageCount % 2 === 1) { // 다음 페이지가 짝수(뒷면)가 되는 상황 → 빈 페이지 하나 삽입해 홀수로 맞춤
      htmlPages.push(`<div class="page-a4 blank-page"></div>`);
      pageCount++;
    }
    htmlPages.push(`<div class="page-a4 cover-page"><div class="cover-inner">
      <div class="cover-label">협력사</div>
      <div class="cover-name">${g.contractor}</div>
      <div class="cover-sub">${site}</div>
    </div></div>`);
    pageCount++;
    g.items.forEach(r => {
      htmlPages.push(`<div class="page-a4">${buildWarnLabel(r, site)}</div>`);
      pageCount++;
    });
  });

  openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>경고표지 전체 인쇄</title><style>
    @page{size:A4;margin:6mm;}
    *{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;}
    .page-a4{width:100%;page-break-after:always;display:flex;align-items:flex-start;justify-content:center;}
    .page-a4:last-child{page-break-after:auto;}
    .blank-page{min-height:270mm;}
    .cover-page{align-items:center;justify-content:center;min-height:270mm;}
    .cover-inner{text-align:center;}
    .cover-label{font-size:16px;letter-spacing:6px;color:#888;font-weight:700;margin-bottom:18px;}
    .cover-name{font-size:48px;font-weight:900;color:#111;border:4px solid #111;border-radius:10px;padding:30px 50px;letter-spacing:2px;}
    .cover-sub{font-size:15px;color:#555;margin-top:20px;font-weight:600;}
    .wlabel{border:3px solid #111;border-radius:6px;padding:14px;width:100%;font-family:'Malgun Gothic',sans-serif;color:#111;background:#fff;}
    .wl-top{text-align:center;font-size:11px;font-weight:700;margin-bottom:6px;}
    .wl-name-box{border:2.5px solid #E30613;border-radius:5px;text-align:center;font-size:24px;font-weight:900;padding:8px;margin-bottom:10px;letter-spacing:3px;}
    .wl-picto-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:10px;align-items:flex-end;}
    .wl-signal-bar{text-align:center;font-size:15px;font-weight:900;color:#fff;padding:6px;border-radius:5px;margin-bottom:10px;}
    .wl-signal-bar.danger{background:#C0392B;} .wl-signal-bar.warning{background:#E67E22;}
    .wl-two-col{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:7px;}
    .wl-block{margin-bottom:7px;border:1px solid #ccc;border-radius:4px;overflow:hidden;}
    .wl-block.full{margin-bottom:7px;}
    .wl-block-head{background:#C0392B;color:#fff;font-size:10px;font-weight:800;padding:3px 10px;}
    .wl-list{margin:0;padding:5px 10px 5px 22px;font-size:9px;line-height:1.7;columns:2;column-gap:12px;}
    .wl-list li{break-inside:avoid;}
    .wl-pe{padding:5px 10px;font-size:9px;font-weight:600;columns:2;column-gap:12px;}
    .wl-special{background:#FFF3CD;border:1.5px solid #FFC107;border-radius:4px;padding:6px;margin:6px 0;font-size:9px;font-weight:800;color:#856404;text-align:center;}
    .wl-foot{border-top:1px solid #ddd;padding-top:6px;margin-top:8px;font-size:9px;color:#555;line-height:1.7;}
    .wl-foot b{color:#333;margin-right:3px;}
  </style></head><body>${htmlPages.join('')}</body></html>`);
  toast(`협력사 ${groups.length}곳 · 물질 ${sorted.length}건 인쇄 준비 완료 (양면인쇄 설정을 켜주세요)`, 'success');
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
  const filtered = getFilteredMsds()
    .sort((a,b) => {
      const conSort = a.contractor.localeCompare(b.contractor, 'ko');
      if (conSort !== 0) return conSort;
      return a.product_name.localeCompare(b.product_name, 'ko');
    });
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
  const filtered = getFilteredMsds()
    .sort((a,b) => {
      const conSort = a.contractor.localeCompare(b.contractor, 'ko');
      if (conSort !== 0) return conSort;
      return a.product_name.localeCompare(b.product_name, 'ko'); // 같은 협력사면 제품명순
    });
  if (filtered.length === 0) { toast('인쇄할 데이터가 없습니다', 'error'); return; }
  const YN = v => v === 'Y' ? '●' : '';
  const title = `MSDS 관리대장 — ${currentWS.name}`;
  const rows = [];
  let no = 0;
  filtered.forEach(r => {
    no++;
    const comps = splitComponents(r);
    comps.forEach((comp, idx) => {
      rows.push(`<tr>
        <td class="ctr">${idx===0?no:''}</td>
        <td>${idx===0?r.contractor:''}</td>
        <td>${idx===0?(r.work_type||'-'):''}</td>
        <td class="pname">${idx===0?r.product_name:''}</td>
        <td>${idx===0?(r.supplier||'-'):''}</td>
        <td>${idx===0?(r.supplier_contact||'-'):''}</td>
        <td class="ctr">${idx===0?(r.issue_date||'-'):''}</td>
        <td>${comp.cas||'-'}</td>
        <td style="font-size:8px;">${comp.name||'-'}</td>
        <td class="ctr">${idx===0?YN(r.legal_measurement):''}</td>
        <td class="ctr">${idx===0?(r.legal_exam==='Y'?(r.legal_exam_cycle||'●'):''):''}</td>
        <td class="ctr">${idx===0?YN(r.legal_manage):''}</td>
        <td class="ctr">${idx===0?YN(r.legal_permit):''}</td>
        <td class="ctr">${idx===0?YN(r.legal_special):''}</td>
        <td class="ctr">${idx===0?YN(r.legal_dangerous):''}</td>
        <td style="font-size:8px;">${idx===0?(r.protective_equipment||'-'):''}</td>
      </tr>`);
    });
  });
  openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
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
    <thead><tr><th>No</th><th>협력사</th><th>공종</th><th>제품명</th><th>공급업체</th><th>연락처</th><th>개정일</th><th>CAS No.</th><th>구성성분명</th><th>측정</th><th>특수검진</th><th>관리</th><th>허가</th><th>특별</th><th>위험</th><th>보호구</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </body></html>`);
};

// ═══════════════════════════════════════════════
// Package
// ═══════════════════════════════════════════════
window.openPackageModal = function() {
  const sel = document.getElementById('pkgContractor');
  sel.innerHTML = '<option value="">선택하세요</option>' + contractors.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  const fc = window.selectedContractor || '';
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
    let no = 0;
    filtered.forEach(r => {
      no++;
      const comps = splitComponents(r);
      comps.forEach((comp, idx) => {
        rows.push(`<tr style="${idx > 0 ? 'background:#fafafa;' : ''}">
          <td class="ctr">${idx===0 ? no : ''}</td>
          <td>${idx===0 ? r.contractor : ''}</td>
          <td>${idx===0 ? (r.work_type||'-') : ''}</td>
          <td class="pname">${idx===0 ? r.product_name : ''}</td>
          <td>${idx===0 ? (r.supplier||'-') : ''}</td>
          <td>${idx===0 ? (r.supplier_contact||'-') : ''}</td>
          <td class="ctr">${idx===0 ? (r.issue_date||'-') : ''}</td>
          <td>${comp.cas||'-'}</td>
          <td>${comp.name||'-'}</td>
          <td class="ctr">${idx===0 ? YN(r.legal_measurement) : ''}</td>
          <td class="ctr">${idx===0 ? (r.legal_exam==='Y' ? (r.legal_exam_cycle||'●') : '') : ''}</td>
          <td class="ctr">${idx===0 ? YN(r.legal_manage) : ''}</td>
          <td class="ctr">${idx===0 ? YN(r.legal_permit) : ''}</td>
          <td class="ctr">${idx===0 ? YN(r.legal_special) : ''}</td>
          <td class="ctr">${idx===0 ? YN(r.legal_dangerous) : ''}</td>
          <td style="font-size:8px;">${idx===0 ? (r.protective_equipment||'-') : ''}</td>
        </tr>`);
      });
    });
    const rowsHtml = rows.join('');
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
// MSDS 전문 인쇄 (협력사별 표지 포함, 양면인쇄 대응)
// ═══════════════════════════════════════════════
window.openMsdsFullPrintModal = function() {
  const el = document.getElementById('fullPrintContractorList');
  const sorted = [...contractors].sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  el.innerHTML = sorted.map(c => {
    const items = msdsRecords.filter(r => r.contractor === c.name);
    const withPdf = items.filter(r => r.has_pdf && r.pdf_path).length;
    return `<label style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:6px;cursor:pointer;">
      <input type="checkbox" class="fpc-check" value="${c.name}" onchange="updateFullPrintCount()">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${c.name}</div>
        <div style="font-size:11px;color:var(--text3);">물질 ${items.length}건 · 원본 파일 ${withPdf}건</div>
      </div>
    </label>`;
  }).join('') || '<div style="padding:14px;text-align:center;color:var(--text3);font-size:13px;">등록된 협력사가 없습니다</div>';
  document.getElementById('fullPrintSelectAll').checked = false;
  updateFullPrintCount();
  openModal('msdsFullPrintModal');
};

window.toggleAllFullPrintContractors = function(checked) {
  document.querySelectorAll('.fpc-check').forEach(cb => cb.checked = checked);
  updateFullPrintCount();
};

window.updateFullPrintCount = function() {
  const selected = [...document.querySelectorAll('.fpc-check:checked')].map(cb => cb.value);
  const targets = msdsRecords.filter(r => selected.includes(r.contractor));
  const withPdf = targets.filter(r => r.has_pdf && r.pdf_path);
  const el = document.getElementById('fullPrintCount');
  el.textContent = selected.length === 0 ? '' : `협력사 ${selected.length}곳 · 물질 ${targets.length}건 (원본 파일 ${withPdf.length}건 인쇄됨)`;
};

function renderContractorCoverImage(contractorName, siteName) {
  const W = 1240, H = 1754; // A4 @ ~150dpi
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#888888';
  ctx.font = '700 38px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  ctx.fillText('협      력      사', W/2, H/2 - 170);
  ctx.font = '900 96px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  const boxW = Math.min(W - 140, Math.max(600, ctx.measureText(contractorName).width + 140));
  ctx.strokeStyle = '#111111'; ctx.lineWidth = 6;
  ctx.strokeRect(W/2 - boxW/2, H/2 - 110, boxW, 210);
  ctx.fillStyle = '#111111';
  ctx.fillText(contractorName, W/2, H/2 - 2);
  ctx.fillStyle = '#555555';
  ctx.font = '600 34px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  ctx.fillText(siteName || '', W/2, H/2 + 170);
  return canvas.toDataURL('image/png');
}

function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function drawItemFitted(page, item, box, marginPt) {
  const m = marginPt || 0;
  const availW = box.w - m*2, availH = box.h - m*2;
  const scale = Math.min(availW / item.width, availH / item.height);
  const w = item.width * scale, h = item.height * scale;
  const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
  if (item.kind === 'pdf') page.drawPage(item.obj, { x, y, width: w, height: h });
  else page.drawImage(item.obj, { x, y, width: w, height: h });
}

window.printMsdsFullDocs = async function() {
  const selected = [...document.querySelectorAll('.fpc-check:checked')].map(cb => cb.value);
  if (selected.length === 0) { toast('협력사를 선택하세요', 'error'); return; }
  const targets = msdsRecords.filter(r => selected.includes(r.contractor) && r.has_pdf && r.pdf_path);
  if (targets.length === 0) { toast('선택한 협력사에 원본 파일이 없습니다', 'error'); return; }
  const layout = document.querySelector('input[name="fullPrintLayout"]:checked')?.value || '1';

  const sorted = [...targets].sort((a,b) => {
    const c = a.contractor.localeCompare(b.contractor, 'ko');
    return c !== 0 ? c : a.product_name.localeCompare(b.product_name, 'ko');
  });
  const groups = [];
  sorted.forEach(r => {
    const last = groups[groups.length-1];
    if (last && last.contractor === r.contractor) last.items.push(r);
    else groups.push({ contractor: r.contractor, items: [r] });
  });

  const btn = document.getElementById('fullPrintGoBtn');
  btn.disabled = true;
  const site = currentWS?.name || '현장명';
  const A4W = 595.28, A4H = 841.89;
  const failed = [];
  let processed = 0;
  let printedGroups = 0;

  try {
    const { PDFDocument, rgb } = PDFLib;
    const merged = await PDFDocument.create();
    let pageCount = 0;

    for (const g of groups) {
      // 1) 협력사의 원본 파일들을 먼저 전부 불러와서 페이지 항목으로 변환
      const renderItems = [];
      for (const r of g.items) {
        processed++;
        btn.textContent = `불러오는 중... (${processed}/${targets.length})`;
        try {
          const { data, error } = await supabase.storage.from('msds-pdfs').download(r.pdf_path);
          if (error || !data) { failed.push(r.product_name); continue; }
          const bytes = new Uint8Array(await data.arrayBuffer());
          const ext = (r.pdf_path.split('.').pop() || '').toLowerCase();
          if (ext === 'pdf') {
            const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
            for (const srcPage of srcDoc.getPages()) {
              if (!srcPage.node.Contents()) continue; // 내용 없는 빈 페이지는 embed 시 저장 단계에서 에러가 나므로 건너뜀
              try {
                const embedded = await merged.embedPage(srcPage);
                renderItems.push({ kind: 'pdf', obj: embedded, width: embedded.width, height: embedded.height });
              } catch (pageErr) { /* 이 페이지만 건너뜀 */ }
            }
          } else if (['jpg','jpeg','png'].includes(ext)) {
            const img = ext === 'png' ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
            renderItems.push({ kind: 'image', obj: img, width: img.width, height: img.height });
          } else { failed.push(r.product_name); }
        } catch (e) { failed.push(r.product_name); }
      }
      if (renderItems.length === 0) continue; // 실제로 실을 내용이 없으면 표지도 생략

      // 2) 표지가 항상 홀수(앞면) 페이지가 되도록 필요하면 빈 페이지로 보정
      if (pageCount % 2 === 1) { merged.addPage([A4W, A4H]); pageCount++; }
      const coverPage = merged.addPage([A4W, A4H]);
      const pngBytes = dataUrlToBytes(renderContractorCoverImage(g.contractor, site));
      const pngImage = await merged.embedPng(pngBytes);
      coverPage.drawImage(pngImage, { x: 0, y: 0, width: A4W, height: A4H });
      pageCount++;
      printedGroups++;

      // 3) 내용 페이지 배치 (1페이지씩 / 2페이지씩)
      if (layout === '2') {
        for (let i = 0; i < renderItems.length; i += 2) {
          const page = merged.addPage([A4H, A4W]); // 가로(landscape)로 눕혀서 좌/우로 배치
          drawItemFitted(page, renderItems[i], { x:0, y:0, w:A4H/2, h:A4W }, 12);
          if (renderItems[i+1]) {
            drawItemFitted(page, renderItems[i+1], { x:A4H/2, y:0, w:A4H/2, h:A4W }, 12);
            page.drawLine({ start:{x:A4H/2,y:20}, end:{x:A4H/2,y:A4W-20}, thickness:0.5, dashArray:[3,3], color: rgb(0.7,0.7,0.7) });
          }
          pageCount++;
        }
      } else {
        for (const item of renderItems) {
          const page = merged.addPage([A4W, A4H]);
          drawItemFitted(page, item, { x:0, y:0, w:A4W, h:A4H }, 0);
          pageCount++;
        }
      }
    }

    if (pageCount === 0) { toast('인쇄할 원본 파일을 하나도 열지 못했습니다', 'error'); return; }

    const pdfBytes = await merged.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    closeModal('msdsFullPrintModal');
    toast(`협력사 ${printedGroups}곳 · 총 ${pageCount}페이지 준비 완료${failed.length ? ` (원본 열기 실패 ${failed.length}건)` : ''}`, failed.length ? 'error' : 'success');
  } catch (e) {
    toast('인쇄 파일 생성 실패: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📄 인쇄';
  }
};


window.selectContractorSidebar = function(name) {
  window.selectedContractor = name;
  // 사이드바 활성화 표시
  document.querySelectorAll('.sidebar-con-item').forEach(el => {
    el.classList.toggle('active', el.dataset.name === name);
  });
  // 공종 필터 업데이트
  const con = contractors.find(c => c.name === name);
  const wts = con ? getWorkTypesForContractor(con.id) : [];
  const wtSel = document.getElementById('filterWorkType');
  if (wtSel) {
    wtSel.innerHTML = '<option value="">전체 공종</option>' + wts.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
  }
  // 서브타이틀 업데이트
  const filtered = getFilteredMsds();
  document.getElementById('msdsSubtitle').textContent = name ? `${name} · ${filtered.length}건` : `총 ${msdsRecords.length}건`;
  renderMsdsTable();
};

function renderContractorSidebar() {
  const el = document.getElementById('contractorSidebar');
  if (!el) return;
  // 협력사별 물질 수 계산
  const counts = {};
  msdsRecords.forEach(r => { counts[r.contractor] = (counts[r.contractor]||0) + 1; });
  const sortedContractors = [...contractors].sort((a,b) => a.name.localeCompare(b.name, 'ko'));
  el.innerHTML = `
    <div class="sidebar-con-item ${!window.selectedContractor?'active':''}" data-name="" onclick="selectContractorSidebar('')">
      <span class="sidebar-con-name">전체 보기</span>
      <span class="sidebar-con-count">${msdsRecords.length}</span>
    </div>
    ${sortedContractors.map(c => `
      <div class="sidebar-con-item ${window.selectedContractor===c.name?'active':''}" data-name="${c.name}" onclick="selectContractorSidebar('${c.name}')">
        <span class="sidebar-con-name">${c.name}</span>
        <span class="sidebar-con-count">${counts[c.name]||0}</span>
      </div>`).join('')}`;
}
// ═══════════════════════════════════════════════
// 작업환경측정
// ═══════════════════════════════════════════════
let measureFileB64 = null;

window.openMeasureUpload = function() {
  measureFileB64 = null; measureFileName_val = null;
  document.getElementById('measureFileInfo').style.display = 'none';
  document.getElementById('measureUploadZone').style.display = 'block';
  document.getElementById('measureYear').value = new Date().getFullYear().toString();
  document.getElementById('measureHalf').value = '';
  document.getElementById('measureDateFrom').value = '';
  document.getElementById('measureDateTo').value = '';
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
  const year = document.getElementById('measureYear').value;
  const half = document.getElementById('measureHalf').value;
  const dateFrom = document.getElementById('measureDateFrom').value;
  const dateTo = document.getElementById('measureDateTo').value;
  if (!year || !half) { toast('연도와 상/하반기를 선택하세요', 'error'); return; }
  if (!dateFrom || !dateTo) { toast('측정 기간을 선택하세요', 'error'); return; }
  const round = `${year}년 ${half}`;
  const period = `${dateFrom} ~ ${dateTo}`;
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

    // DB 저장 + 원본 PDF 보관 (백그라운드, 실패해도 결과 화면은 그대로 유지)
    btn.textContent = '💾 저장 중...';
    try {
      const recId = await saveMeasureResult(currentMeasureData, measureFileName_val);
      await uploadMeasurePdf(recId, measureFileName_val, measureFileB64);
      currentMeasureData.id = recId;
      currentMeasureData.file_name = measureFileName_val;
      await loadMeasureResults();
    } catch (saveErr) {
      console.error('측정결과 저장 실패:', saveErr);
      toast('분석은 완료됐지만 저장에 실패했습니다. 다운로드로 결과를 보관해주세요.', 'warn');
    }
  } catch (err) { toast('분석 실패: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '🤖 AI 분석 시작'; }
};

async function saveMeasureResult(d, fileName) {
  const { data, error } = await supabase.from('measure_results').insert({
    workspace_id: currentWS.id, uploaded_by: user.id,
    round: d.round, period: d.period,
    dust: d.dust || [], noise: d.noise || [], work_types: d.workTypes || [],
    dust_exceeded: !!d.dustExceeded, noise_exceeded: !!d.noiseExceeded, mixed_exceeded: !!d.mixedExceeded,
    file_name: fileName || null,
  }).select().single();
  if (error) throw new Error('DB 저장 실패: ' + error.message);
  return data.id;
}

async function uploadMeasurePdf(recId, fileName, base64Data) {
  if (!base64Data) return;
  const path = `${currentWS.id}/${recId}.pdf`;
  const blob = base64ToBlob(base64Data, 'application/pdf');
  const { error } = await supabase.storage.from('measure-pdfs').upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (error) { console.warn('PDF 업로드 실패:', error.message); return; }
  await supabase.from('measure_results').update({ file_path: path }).eq('id', recId);
}

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
    ${d.file_path ? `<button class="btn btn-outline btn-sm" onclick="viewMeasureOriginalPdf()">📄 원본 PDF 보기</button>` : ''}
    <button class="btn btn-primary btn-sm" onclick="downloadMeasureDust()">📥 분진 결과표</button>
    <button class="btn btn-primary btn-sm" onclick="downloadMeasureNoise()">📥 소음 결과표</button>
    <button class="btn btn-primary btn-sm" onclick="downloadMeasureAfter()">📥 사후관리 결과표</button>`;
  openModal('measureResultModal');
}

// ─── 작업환경측정 결과 영구 저장 목록 (DB 기반) ───
let measureResults = [];

async function loadMeasureResults() {
  const { data, error } = await supabase.from('measure_results')
    .select('*').eq('workspace_id', currentWS.id).order('created_at', { ascending: false });
  if (error) { console.error(error); measureResults = []; return; }
  measureResults = data || [];
  renderMeasureList();
}

function renderMeasureList() {
  const list = document.getElementById('measureList');
  if (!list) return;
  if (!measureResults.length) {
    list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text3);">
      <div style="font-size:40px;margin-bottom:12px;">📊</div>
      <div style="font-size:15px;font-weight:600;color:var(--text2);margin-bottom:6px;">등록된 측정 결과가 없습니다</div>
      <div style="font-size:13px;margin-bottom:20px;">측정 결과 PDF를 업로드하면 자동으로 분석됩니다</div>
      <button class="btn btn-primary btn-lg" onclick="openMeasureUpload()">+ 측정결과 업로드</button>
    </div>`;
    return;
  }
  list.innerHTML = measureResults.map(r => `
    <div class="measure-card" onclick="openSavedMeasureResult('${r.id}')">
      <div class="measure-round">${r.round}</div>
      <div class="measure-date">측정 기간: ${r.period}${r.file_name ? ' · ' + r.file_name : ''}</div>
      <div class="measure-badges">
        <span class="badge badge-primary">분진 ${r.dust?.length||0}건</span>
        <span class="badge badge-primary">소음 ${r.noise?.length||0}건</span>
        ${r.dust_exceeded||r.noise_exceeded ? '<span class="badge badge-danger">기준 초과 있음</span>' : '<span class="badge badge-ok">전체 기준 이하</span>'}
        ${r.file_path ? '<span class="badge badge-gray">📄 원본 보관됨</span>' : ''}
      </div>
      <button class="btn btn-danger btn-sm" style="position:absolute;top:14px;right:14px;" onclick="event.stopPropagation();deleteMeasureResult('${r.id}')">🗑</button>
    </div>
  `).join('');
}

window.openSavedMeasureResult = function(id) {
  const r = measureResults.find(x => x.id === id);
  if (!r) return;
  currentMeasureData = {
    id: r.id, round: r.round, period: r.period,
    dust: r.dust || [], noise: r.noise || [], workTypes: r.work_types || [],
    dustExceeded: r.dust_exceeded, noiseExceeded: r.noise_exceeded, mixedExceeded: r.mixed_exceeded,
    file_name: r.file_name, file_path: r.file_path,
  };
  showMeasureResult(currentMeasureData);
};

window.viewMeasureOriginalPdf = async function() {
  if (!currentMeasureData?.file_path) { toast('보관된 원본 파일이 없습니다', 'error'); return; }
  const { data, error } = await supabase.storage.from('measure-pdfs').createSignedUrl(currentMeasureData.file_path, 3600);
  if (error) { toast('파일을 열 수 없습니다: ' + error.message, 'error'); return; }
  window.open(data.signedUrl, '_blank');
};

window.deleteMeasureResult = async function(id) {
  const r = measureResults.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`"${r.round}" 측정 결과를 삭제하시겠습니까? (원본 PDF도 함께 삭제됩니다)`)) return;
  if (r.file_path) await supabase.storage.from('measure-pdfs').remove([r.file_path]);
  await supabase.from('measure_results').delete().eq('id', id);
  await loadMeasureResults();
  toast('삭제됐습니다');
};


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
  if (healthFileQueue.length === 0) { toast('파일을 먼저 업로드하세요', 'error'); return; }
  const btn = document.getElementById('healthAnalyzeBtn');
  btn.disabled = true; btn.textContent = '🤖 AI 분석 중...';
  healthCurrentRound = new Date().toLocaleDateString('ko-KR');
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
          <option value="1" ${String(item.examType)==='1'?'selected':''}>1 일반</option>
          <option value="2" ${String(item.examType)==='2'?'selected':''}>2 특수</option>
          <option value="3" ${String(item.examType)==='3'?'selected':''}>3 배치전</option>
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

    // L=11, M=12, N=13, O=14 (0-indexed) — 셀 단위로만 기입해 병합·컬럼폭 등 시트 구조 보존
    const nameCol = findNameColumn(allData);

    let written = 0;
    healthConfirmData.forEach(item => {
      if (!item.name) return;
      const rowIdx = allData.findIndex((row, ri) => ri > 0 && String(row[nameCol]||'').trim() === item.name.trim());
      if (rowIdx < 0) return;
      [[11, item.examDate], [12, item.examType], [13, item.resultCode], [14, item.hazardResult]].forEach(([col, val]) => {
        const addr = XLSX.utils.encode_cell({ r: rowIdx, c: col });
        ws[addr] = { t: 's', v: String(val || '') };
      });
      written++;
    });
    // 기입 범위가 기존 !ref 밖이면 확장
    const ref = XLSX.utils.decode_range(ws['!ref']);
    if (ref.e.c < 14) { ref.e.c = 14; ws['!ref'] = XLSX.utils.encode_range(ref); }

    XLSX.writeFile(wb, `건강진단_${healthCurrentRound}_${today()}.xlsx`);
    toast(`엑셀 다운로드 완료 (${written}명 기입${written < healthConfirmData.length ? `, ${healthConfirmData.length - written}명은 이름 불일치로 미기입` : ''})`, written < healthConfirmData.length ? 'warn' : 'success');
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

let healthRecordsList = [];

async function loadHealthRecords() {
  const { data } = await supabase.from('health_records')
    .select('*').eq('workspace_id', currentWS.id).order('created_at', { ascending: false });
  healthRecordsList = data || [];
  renderHealthRecordsList();
}

function renderHealthRecordsList() {
  const list = document.getElementById('healthList');
  if (!list) return;
  if (!healthRecordsList.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:20px;">저장된 분석 결과가 없습니다</div>';
    return;
  }
  list.innerHTML = healthRecordsList.map(rec => `
    <div class="health-card" onclick="openHealthRecord('${rec.id}')">
      <div class="measure-round">${rec.round}</div>
      <div class="measure-date">${(rec.created_at||'').split('T')[0]}</div>
      <div class="measure-badges">
        <span class="badge badge-primary">총 ${(rec.entries||[]).length}명</span>
        <button class="btn btn-danger btn-sm btn-icon" onclick="event.stopPropagation();deleteHealthRecord('${rec.id}')" title="삭제">🗑</button>
      </div>
    </div>`).join('');
}

window.openHealthRecord = function(id) {
  const rec = healthRecordsList.find(r => r.id === id);
  if (!rec) return;
  healthConfirmData = rec.entries || [];
  healthCurrentRound = rec.round;
  showHealthConfirm();
};

window.deleteHealthRecord = async function(id) {
  if (!confirm('이 분석 결과를 삭제할까요?')) return;
  await supabase.from('health_records').delete().eq('id', id);
  healthRecordsList = healthRecordsList.filter(r => r.id !== id);
  renderHealthRecordsList();
  toast('삭제됐습니다');
};

window.saveHealthRecord = async function() {
  closeModal('healthConfirmModal');
  const { error } = await supabase.from('health_records').insert({
    workspace_id: currentWS.id, uploaded_by: user.id,
    round: healthCurrentRound, entries: healthConfirmData,
  });
  if (error) { toast('저장 실패: ' + error.message + ' — health_records.sql 실행 여부를 확인하세요', 'error'); return; }
  await loadHealthRecords();
  toast(`건강진단 결과 ${healthConfirmData.length}명 저장 완료`, 'success');
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
// ═══════════════════════════════════════════════
// CAS 기반 법정물질 일괄 재판정
// ═══════════════════════════════════════════════

// 산안법 CAS 데이터베이스
const CAS_MEASUREMENT = new Set(["100-00-5","100-01-6","100-37-8","100-41-4","100-42-5","10028-15-6","10035-10-6","101-68-8","10102-43-9","10102-44-0","106-42-3","106-44-8","106-89-8","106-92-3","106-94-5","106-99-0","107-06-2","107-07-3","107-13-1","107-21-1","108-05-4","108-10-1","108-21-4","108-24-7","108-31-6","108-38-3","108-39-4","108-83-8","108-88-3","108-93-0","108-94-1","108-95-2","109-60-4","109-86-4","109-89-7","109-99-9","10102-44-0","110-19-0","110-43-0","110-49-6","110-54-3","110-80-5","110-82-7","110-83-8","110-86-1","111-15-9","111-40-0","111-42-2","111-76-2","112-07-2","119-90-4","119-93-7","121-44-8","121-69-7","123-31-9","123-51-3","123-86-4","123-91-1","123-92-2","124-40-3","127-18-4","127-19-5","12001-26-2","12035-72-2","13530-65-9","134-32-7","1309-37-1","1309-48-4","1310-58-3","1310-73-2","1314-13-2","1314-62-1","1332-21-4","1717-00-6","14464-46-1","14807-96-6","14808-60-7","151-50-8","151-56-4","156-60-5","16812-54-7","25321-14-6","25639-42-3","302-01-2","540-59-0","556-52-5","583-59-8","583-60-8","591-23-1","591-78-6","592-01-8","60-29-7","62-53-3","628-96-6","630-08-0","64-18-6","64-19-7","65996-93-2","65997-15-1","67-56-1","67-63-0","67-64-1","68-12-2","71-36-3","71-43-2","71-55-6","74-83-9","74-87-3","74-88-4","74-89-5","74-90-8","74-93-1","75-01-4","75-04-7","75-05-8","75-07-0","75-09-2","75-15-0","75-26-3","75-43-4","75-44-5","75-52-5","75-55-8","75-56-9","76-03-9","78-83-1","78-87-5","78-92-2","78-93-3","79-00-5","79-06-1","79-20-9","79-34-5","8052-41-3","822-06-0","85-44-9","91-08-7","91-94-1","95-47-9","95-48-7","95-50-1","96-18-4","98-07-7","100-00-5","106-42-3","108-38-3","108-39-4"]);

const CAS_HEALTH_EXAM = new Set(["100-00-5","100-01-6","100-37-8","100-41-4","100-42-5","101-68-8","10102-43-9","10102-44-0","106-44-8","106-89-8","106-92-3","106-94-5","106-99-0","107-06-2","107-07-3","107-13-1","107-21-1","108-05-4","108-10-1","108-21-4","108-31-6","108-83-8","108-88-3","108-93-0","108-94-1","108-95-2","109-86-4","109-89-7","109-99-9","110-19-0","110-43-0","110-49-6","110-54-3","110-80-5","110-82-7","110-83-8","111-15-9","111-40-0","111-42-2","111-76-2","112-07-2","119-90-4","119-93-7","121-44-8","121-69-7","123-31-9","123-51-3","123-86-4","123-91-1","123-92-2","124-40-3","127-18-4","127-19-5","12001-26-2","13530-65-9","134-32-7","1309-37-1","1309-48-4","1310-58-3","1310-73-2","1314-13-2","1314-62-1","1332-21-4","14464-46-1","14807-96-6","14808-60-7","151-56-4","16812-54-7","25321-14-6","25639-42-3","302-01-2","540-59-0","556-52-5","583-60-8","591-78-6","60-29-7","62-53-3","628-96-6","630-08-0","64-18-6","65996-93-2","65997-15-1","67-56-1","67-63-0","67-64-1","68-12-2","71-36-3","71-43-2","74-83-9","74-87-3","74-88-4","74-89-5","74-90-8","75-01-4","75-04-7","75-05-8","75-07-0","75-09-2","75-15-0","75-26-3","75-44-5","75-52-5","75-55-8","75-56-9","78-83-1","78-87-5","78-93-3","79-06-1","79-20-9","8052-41-3","85-44-9","91-08-7","91-94-1","95-47-9","95-50-1","96-18-4","98-07-7","100-42-5","106-99-0","108-24-7","583-59-8","591-23-1"]);

const CAS_MANAGE = new Set(["100-00-5","100-01-6","100-37-8","100-41-4","100-42-5","101-68-8","10102-43-9","10102-44-0","106-44-8","106-89-8","106-92-3","106-94-5","106-99-0","107-06-2","107-07-3","107-13-1","107-21-1","108-05-4","108-10-1","108-21-4","108-31-6","108-83-8","108-88-3","108-93-0","108-94-1","108-95-2","109-86-4","109-89-7","109-99-9","110-19-0","110-43-0","110-49-6","110-54-3","110-80-5","110-82-7","110-83-8","111-15-9","111-40-0","111-42-2","111-76-2","112-07-2","119-90-4","119-93-7","121-44-8","121-69-7","123-31-9","123-51-3","123-86-4","123-91-1","123-92-2","124-40-3","127-18-4","127-19-5","12001-26-2","13530-65-9","134-32-7","1309-37-1","1309-48-4","1310-58-3","1310-73-2","1314-13-2","1314-62-1","1332-21-4","14464-46-1","14807-96-6","14808-60-7","151-56-4","16812-54-7","25321-14-6","25639-42-3","302-01-2","540-59-0","556-52-5","583-60-8","591-78-6","60-29-7","62-53-3","628-96-6","630-08-0","64-18-6","65996-93-2","65997-15-1","67-56-1","67-63-0","67-64-1","68-12-2","71-36-3","71-43-2","74-83-9","74-87-3","74-88-4","74-89-5","74-90-8","75-01-4","75-04-7","75-05-8","75-07-0","75-09-2","75-15-0","75-26-3","75-44-5","75-52-5","75-55-8","75-56-9","78-83-1","78-87-5","78-93-3","79-06-1","79-20-9","8052-41-3","85-44-9","91-08-7","91-94-1","95-47-9","95-50-1","96-18-4","98-07-7"]);

const CAS_PERMIT = new Set(["134-32-7","16812-54-7","65996-93-2","91-94-1","7440-38-2","7440-41-7","7440-43-9","119-93-7","91-08-7","98-07-7","7440-02-0","7782-42-5"]);

const CAS_SPECIAL = new Set(["107-06-2","302-01-2","7439-92-1","109-86-4","71-43-2","106-99-0","75-01-4","75-09-2","7440-38-2","7440-43-9","7440-47-3","7782-49-2","134-32-7","119-93-7","91-94-1","98-07-7","7440-02-0","79-06-1","107-13-1","75-26-3","151-56-4","75-55-8","7553-56-2","7440-36-0","1332-21-4","14808-60-7","14464-46-1","65997-15-1","65996-93-2","7440-41-7","25321-14-6","91-08-7","16812-54-7","7439-96-5","7440-50-8","7439-97-6","7782-42-5","12035-72-2","7440-31-5","7440-67-7","7440-74-6","7440-06-4","7440-39-3","7440-22-4","7440-33-7"]);

const CAS_EXAM_CYCLE = {
  // 1개월 이내 / 6개월마다
  "127-19-5":"배치후 1차: 1개월 이내, 이후: 6개월마다",  // N,N-디메틸아세트아미드
  "68-12-2":"배치후 1차: 1개월 이내, 이후: 6개월마다",   // N,N-디메틸포름아미드
  // 2개월 이내 / 6개월마다
  "71-43-2":"배치후 1차: 2개월 이내, 이후: 6개월마다",   // 벤젠
  // 3개월 이내 / 6개월마다
  "79-34-5":"배치후 1차: 3개월 이내, 이후: 6개월마다",   // 1,1,2,2-테트라클로로에탄
  "56-23-5":"배치후 1차: 3개월 이내, 이후: 6개월마다",   // 사염화탄소
  "107-13-1":"배치후 1차: 3개월 이내, 이후: 6개월마다",  // 아크릴로니트릴
  "75-01-4":"배치후 1차: 3개월 이내, 이후: 6개월마다",   // 염화비닐
  "75-09-2":"배치후 1차: 3개월 이내, 이후: 6개월마다",   // 디클로로메탄
  "75-26-3":"배치후 1차: 3개월 이내, 이후: 6개월마다",   // 2-브로모프로판
  "151-56-4":"배치후 1차: 3개월 이내, 이후: 6개월마다",  // 에틸렌이민
  "106-99-0":"배치후 1차: 3개월 이내, 이후: 6개월마다",  // 1,3-부타디엔
  "79-06-1":"배치후 1차: 3개월 이내, 이후: 6개월마다",   // 아크릴아미드
  "302-01-2":"배치후 1차: 3개월 이내, 이후: 6개월마다",  // 히드라진
  // 12개월 이내 / 12개월마다
  "1332-21-4":"배치후 1차: 12개월 이내, 이후: 12개월마다", // 석면
  "14808-60-7":"배치후 1차: 12개월 이내, 이후: 24개월마다", // 결정체 실리카(석영)
  "14464-46-1":"배치후 1차: 12개월 이내, 이후: 24개월마다", // 결정체 실리카(크리스토발석)
  "65997-15-1":"배치후 1차: 12개월 이내, 이후: 24개월마다", // 포틀랜드시멘트
  "65996-93-2":"배치후 1차: 12개월 이내, 이후: 24개월마다", // 콜타르피치 휘발물
  "7440-38-2":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 비소
  "7440-43-9":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 카드뮴
  "7440-47-3":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 크롬
  "7782-49-2":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 셀레늄
  "7439-92-1":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 납
  "7439-96-5":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 망간
  "7439-97-6":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 수은
  "7440-02-0":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 니켈
  "7440-06-4":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 백금
  "7440-22-4":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 은
  "7440-31-5":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 주석
  "7440-33-7":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 텅스텐
  "7440-36-0":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 안티몬
  "7440-39-3":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 바륨
  "7440-41-7":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 베릴륨
  "7440-50-8":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 구리
  "7440-67-7":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 지르코늄
  "7440-74-6":"배치후 1차: 12개월 이내, 이후: 12개월마다",  // 인듐
  "12035-72-2":"배치후 1차: 12개월 이내, 이후: 12개월마다", // 황화니켈
  // 6개월 이내 / 12개월마다 (나머지 대부분)
  "67-64-1":"배치후 1차: 6개월 이내, 이후: 12개월마다",   // 아세톤
  "108-88-3":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 톨루엔
  "108-10-1":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 메틸이소부틸케톤
  "67-56-1":"배치후 1차: 6개월 이내, 이후: 12개월마다",   // 메탄올
  "111-76-2":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 2-부톡시에탄올
  "71-36-3":"배치후 1차: 6개월 이내, 이후: 12개월마다",   // n-부탄올
  "108-94-1":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 시클로헥사논
  "109-99-9":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 테트라히드로푸란
  "78-93-3":"배치후 1차: 6개월 이내, 이후: 12개월마다",   // 메틸에틸케톤
  "110-54-3":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // n-헥산
  "100-42-5":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 스티렌
  "100-41-4":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 에틸벤젠
  "123-86-4":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // n-부틸아세테이트
  "141-78-6":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 에틸아세테이트
  "79-20-9":"배치후 1차: 6개월 이내, 이후: 12개월마다",   // 메틸아세테이트
  "110-43-0":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 메틸n-아밀케톤
  "123-92-2":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 이소아밀아세테이트
  "108-21-4":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 이소프로필아세테이트
  "67-63-0":"배치후 1차: 6개월 이내, 이후: 12개월마다",   // 이소프로필알코올
  "78-83-1":"배치후 1차: 6개월 이내, 이후: 12개월마다",   // 이소부틸알코올
  "123-51-3":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 이소아밀알코올
  "110-19-0":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 이소부틸아세테이트
  "109-86-4":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // 2-메톡시에탄올
  "134-32-7":"배치후 1차: 6개월 이내, 이후: 12개월마다",  // α-나프틸아민
};

function checkCasList(casStr) {
  const casList = (casStr||'').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  return {
    measurement: casList.some(c => CAS_MEASUREMENT.has(c)) ? 'Y' : 'N',
    healthExam: casList.some(c => CAS_HEALTH_EXAM.has(c)) ? 'Y' : 'N',
    manage: casList.some(c => CAS_MANAGE.has(c)) ? 'Y' : 'N',
    permit: casList.some(c => CAS_PERMIT.has(c)) ? 'Y' : 'N',
    special: casList.some(c => CAS_SPECIAL.has(c)) ? 'Y' : 'N',
    examCycle: casList.map(c => CAS_EXAM_CYCLE[c]).filter(Boolean)[0] || '',
  };
}

window.reanalyzeLegal = async function() {
  if (!confirm(`등록된 ${msdsRecords.length}건의 법정물질 판정을 CAS 번호 기준으로 일괄 업데이트합니다.\n비용 없이 빠르게 처리됩니다. 계속하시겠습니까?`)) return;
  const btn = document.getElementById('reanalyzeLegalBtn');
  btn.disabled = true;
  btn.textContent = '업데이트 중...';
  let updated = 0, skipped = 0;
  for (const r of msdsRecords) {
    if (!r.cas_no) { skipped++; continue; }
    const check = checkCasList(r.cas_no);
    const { error } = await supabase.from('msds_records').update({
      legal_measurement: check.measurement,
      legal_exam: check.healthExam,
      legal_exam_cycle: check.examCycle,
      legal_manage: check.manage,
      legal_permit: check.permit,
      legal_special: check.special,
      special: check.special === 'Y' ? 'Y_special' : 'N',
    }).eq('id', r.id);
    if (!error) updated++;
    // 진행상황 표시
    btn.textContent = `업데이트 중... (${updated}/${msdsRecords.length})`;
    await new Promise(res => setTimeout(res, 50));
  }
  await loadMsdsRecords();
  btn.disabled = false;
  btn.textContent = '✅ 법정물질 일괄 재판정';
  toast(`${updated}건 업데이트 완료 (CAS 없음 ${skipped}건 제외)`, 'success');
};

// ═══════════════════════════════════════════════
// 건강진단 — 배치전 확인서 추적
// ═══════════════════════════════════════════════
let placementRawRows = [];   // 재직자만, 원본 파싱 결과
let placementCodeSet = [];   // 발견된 판정코드 목록
let placementFiltered = [];  // 추출 결과

window.switchHealthSub = function(which) {
  document.getElementById('hsub-result').classList.toggle('active', which === 'result');
  document.getElementById('hsub-placement').classList.toggle('active', which === 'placement');
  document.getElementById('hsub-sorting').classList.toggle('active', which === 'sorting');
  document.getElementById('healthSubResult').style.display = which === 'result' ? '' : 'none';
  document.getElementById('healthSubPlacement').style.display = which === 'placement' ? '' : 'none';
  document.getElementById('healthSubSorting').style.display = which === 'sorting' ? '' : 'none';
  const headerActions = document.getElementById('healthHeaderActions');
  if (headerActions) headerActions.style.display = which === 'result' ? '' : 'none';
};

// 배치전 셀 값에서 판정코드 추출. 예: "2026.06.25 (V)" -> "V" / "" -> null(누락)
function extractPlacementCode(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/\(([^)]+)\)\s*$/);
  if (m) return m[1].trim();
  // 괄호 없이 코드만 있는 경우 대비
  if (/^[A-Za-z0-9]+$/.test(s)) return s;
  return null;
}

window.handlePlacementExcel = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('placementFileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { toast('데이터가 없습니다', 'error'); return; }

      // 헤더 유연 매칭
      const headerKeys = Object.keys(rows[0]);
      const findKey = (cands) => headerKeys.find(h => cands.some(c => h.includes(c)));
      const kCon = findKey(['협력회사','협력사']);
      const kJob = findKey(['직종']);
      const kName = findKey(['성명']);
      const kStatus = findKey(['재직상태']);
      const kPlacement = findKey(['배치전']) && !findKey(['배치전']).includes('판정코드')
        ? headerKeys.find(h => h === '배치전') || findKey(['배치전'])
        : findKey(['배치전']);
      const kPhone = findKey(['휴대전화','연락처','전화']);

      if (!kCon || !kName || !kStatus || !kPlacement) {
        toast('필수 열(협력회사/성명/재직상태/배치전)을 찾을 수 없습니다. 양식을 확인하세요.', 'error');
        return;
      }

      // 재직자만 필터
      const active = rows.filter(r => String(r[kStatus] || '').trim() === '재직');

      placementRawRows = active.map(r => ({
        contractor: String(r[kCon] || '').trim(),
        job: kJob ? String(r[kJob] || '').trim() : '',
        name: String(r[kName] || '').trim(),
        phone: kPhone ? String(r[kPhone] || '').trim() : '',
        placementRaw: r[kPlacement],
        code: extractPlacementCode(r[kPlacement]),
      }));

      // 발견된 코드 집계
      const codeCount = {};
      placementRawRows.forEach(r => {
        if (r.code) codeCount[r.code] = (codeCount[r.code] || 0) + 1;
      });
      placementCodeSet = Object.keys(codeCount).sort();

      const missingCount = placementRawRows.filter(r => !r.code).length;

      // 체크박스 렌더링
      const wrap = document.getElementById('placementCodeChecks');
      wrap.innerHTML = placementCodeSet.map(code => `
        <label class="placement-code-chip">
          <input type="checkbox" class="placement-code-cb" value="${code}" ${code === 'V' ? 'checked' : ''}>
          <span>${code} (${codeCount[code]}명)</span>
        </label>
      `).join('');
      document.getElementById('placementMissingCheck').nextSibling && null;
      const missingLabel = document.getElementById('placementMissingCheck').closest('.legal-check');
      if (missingLabel) missingLabel.lastChild.textContent = ` 배치전 누락(공백)자 포함 (${missingCount}명)`;

      document.getElementById('placementFilterCard').style.display = '';
      document.getElementById('placementResultArea').style.display = 'none';
      toast(`재직자 ${active.length}명 불러옴 (전체 ${rows.length}명 중)`, 'success');
    } catch (err) {
      console.error(err);
      toast('엑셀 파싱 실패: ' + err.message, 'error');
    }
  };
  reader.readAsBinaryString(file);
};

window.runPlacementFilter = function() {
  activeSnapshotId = null;
  const checkedCodes = Array.from(document.querySelectorAll('.placement-code-cb:checked')).map(cb => cb.value);
  const includeMissing = document.getElementById('placementMissingCheck').checked;

  if (!checkedCodes.length && !includeMissing) {
    toast('판정코드를 1개 이상 선택하거나 누락자 포함을 체크하세요', 'error');
    return;
  }

  placementFiltered = placementRawRows.filter(r => {
    if (r.code && checkedCodes.includes(r.code)) return true;
    if (!r.code && includeMissing) return true;
    return false;
  });

  // 협력사별, 가나다순 정렬
  placementFiltered.sort((a, b) => {
    if (a.contractor !== b.contractor) return a.contractor.localeCompare(b.contractor, 'ko');
    return a.name.localeCompare(b.name, 'ko');
  });

  const body = document.getElementById('placementResultBody');
  if (!placementFiltered.length) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:30px;">선택한 조건에 해당하는 재직자가 없습니다</td></tr>`;
  } else {
    body.innerHTML = placementFiltered.map(r => `
      <tr>
        <td>${r.contractor}</td>
        <td>${r.job || '-'}</td>
        <td>${r.name}</td>
        <td>${r.code ? r.code : '<span style="color:#DC2626;font-weight:700;">누락</span>'}</td>
        <td>${r.phone || '-'}</td>
      </tr>
    `).join('');
  }

  const contractorCount = new Set(placementFiltered.map(r => r.contractor)).size;
  document.getElementById('placementResultSummary').textContent =
    `결과지 미수령 대상: 총 ${placementFiltered.length}명 (${contractorCount}개 협력사)`;
  document.getElementById('placementResultArea').style.display = '';
  document.querySelector('#placementResultArea .btn-ok')?.style.setProperty('display', '');
};

window.downloadPlacementExcel = function() {
  if (!placementFiltered.length) { toast('추출된 명단이 없습니다', 'error'); return; }
  const wb = XLSX.utils.book_new();

  // 전체 통합 시트
  const allRows = placementFiltered.map(r => ({
    '협력회사': r.contractor, '직종': r.job, '성명': r.name,
    '배치전 상태': r.code || '누락', '연락처': r.phone,
  }));
  const wsAll = XLSX.utils.json_to_sheet(allRows);
  XLSX.utils.book_append_sheet(wb, wsAll, '전체');

  // 협력사별 시트
  const byContractor = {};
  placementFiltered.forEach(r => {
    if (!byContractor[r.contractor]) byContractor[r.contractor] = [];
    byContractor[r.contractor].push(r);
  });
  Object.entries(byContractor).forEach(([con, list]) => {
    const rows = list.map(r => ({
      '직종': r.job, '성명': r.name, '배치전 상태': r.code || '누락', '연락처': r.phone,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, con.slice(0, 30));
  });

  XLSX.writeFile(wb, `배치전_확인서_미수령_${today()}.xlsx`);
};

// Canvas로 명단 이미지 생성 (제목, 협력사명 옵션, 데이터 배열)
function renderPlacementImageCanvas(title, list, subtitle) {
  const rowH = 40, headerH = 56, titleH = subtitle ? 96 : 70, padX = 28, footerH = 24;
  const colW = [70, 200, 130, 100, 140]; // No, 협력회사, 직종, 성명, 상태
  const width = colW.reduce((a, b) => a + b, 0) + padX * 2;
  const height = titleH + headerH + rowH * list.length + footerH + 20;

  const canvas = document.createElement('canvas');
  const scale = 2; // 고해상도
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // 배경
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // 타이틀
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(title, padX, 38);
  if (subtitle) {
    ctx.fillStyle = '#475569';
    ctx.font = '14px sans-serif';
    ctx.fillText(subtitle, padX, 62);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '12px sans-serif';
    ctx.fillText(`생성일: ${today()}`, padX, 82);
  } else {
    ctx.fillStyle = '#94A3B8';
    ctx.font = '12px sans-serif';
    ctx.fillText(`생성일: ${today()}`, padX, 58);
  }

  let y = titleH;
  // 헤더 행
  ctx.fillStyle = '#EFF6FF';
  ctx.fillRect(padX, y, width - padX * 2, headerH);
  ctx.fillStyle = '#2563EB';
  ctx.font = 'bold 14px sans-serif';
  const headers = ['No', '협력회사', '직종', '성명', '배치전 상태'];
  let x = padX;
  headers.forEach((h, i) => {
    ctx.fillText(h, x + 12, y + headerH / 2 + 5);
    x += colW[i];
  });
  y += headerH;

  // 데이터 행
  list.forEach((r, idx) => {
    if (idx % 2 === 1) {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(padX, y, width - padX * 2, rowH);
    }
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, y + rowH);
    ctx.lineTo(width - padX, y + rowH);
    ctx.stroke();

    let cx = padX;
    const vals = [String(idx + 1), r.contractor, r.job || '-', r.name, r.code || '누락'];
    vals.forEach((v, i) => {
      if (i === 4 && !r.code) {
        ctx.fillStyle = '#DC2626';
        ctx.font = 'bold 14px sans-serif';
      } else {
        ctx.fillStyle = '#0F172A';
        ctx.font = i === 3 ? 'bold 14px sans-serif' : '14px sans-serif';
      }
      const text = colW[i] && v.length > 14 ? v.slice(0, 13) + '…' : v;
      ctx.fillText(text, cx + 12, y + rowH / 2 + 5);
      cx += colW[i];
    });
    y += rowH;
  });

  // 테두리
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(padX, titleH, width - padX * 2, headerH + rowH * list.length);

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

window.downloadPlacementImageAll = async function() {
  if (!placementFiltered.length) { toast('추출된 명단이 없습니다', 'error'); return; }
  const contractorCount = new Set(placementFiltered.map(r => r.contractor)).size;
  const canvas = renderPlacementImageCanvas(
    '🏥 배치전 건강진단 결과지 미수령 명단',
    placementFiltered,
    `전체 ${placementFiltered.length}명 · ${contractorCount}개 협력사`
  );
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, `배치전_확인서_미수령_전체_${today()}.png`);
};

window.downloadPlacementImagesByContractor = async function() {
  if (!placementFiltered.length) { toast('추출된 명단이 없습니다', 'error'); return; }
  const byContractor = {};
  placementFiltered.forEach(r => {
    if (!byContractor[r.contractor]) byContractor[r.contractor] = [];
    byContractor[r.contractor].push(r);
  });

  const zip = new JSZip();
  const folder = zip.folder(`배치전_확인서_미수령_협력사별_${today()}`);

  for (const [con, list] of Object.entries(byContractor)) {
    const canvas = renderPlacementImageCanvas(
      `🏥 배치전 건강진단 결과지 미수령 명단`,
      list,
      `${con} · ${list.length}명`
    );
    const blob = await canvasToBlob(canvas);
    folder.file(`${con}.png`, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipBlob, `배치전_확인서_미수령_협력사별_${today()}.zip`);
};

// ─── 스냅샷 저장/불러오기 ───
let placementSnapshots = [];
let activeSnapshotId = null; // null이면 현재 작업 중인(미저장) 데이터

window.savePlacementSnapshot = async function() {
  if (!placementFiltered.length) { toast('저장할 명단이 없습니다', 'error'); return; }
  const checkedCodes = Array.from(document.querySelectorAll('.placement-code-cb:checked')).map(cb => cb.value);
  const includeMissing = document.getElementById('placementMissingCheck').checked;
  const label = new Date().toLocaleString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });

  const { error } = await supabase.from('placement_snapshots').insert({
    workspace_id: currentWS.id,
    created_by: user.id,
    snapshot_label: label,
    filter_codes: checkedCodes,
    include_missing: includeMissing,
    total_active: placementRawRows.length,
    matched_count: placementFiltered.length,
    data: placementFiltered,
  });
  if (error) { toast('저장 실패: ' + error.message, 'error'); return; }
  toast('스냅샷이 저장됐습니다', 'success');
  await loadPlacementSnapshots();
};

async function loadPlacementSnapshots() {
  const { data, error } = await supabase.from('placement_snapshots')
    .select('*').eq('workspace_id', currentWS.id).order('created_at', { ascending: false });
  if (error) { console.error(error); return; }
  placementSnapshots = data || [];
  renderPlacementSnapshotList();
}

function renderPlacementSnapshotList() {
  const el = document.getElementById('placementSnapshotList');
  if (!el) return;
  if (!placementSnapshots.length) {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">저장된 스냅샷이 없습니다</div>`;
    return;
  }
  el.innerHTML = placementSnapshots.map(s => `
    <div class="snapshot-item" onclick="openSnapshot('${s.id}')">
      <div>
        <div style="font-weight:700;font-size:13.5px;">${s.snapshot_label}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px;">
          미수령 ${s.matched_count}명 · 코드 ${s.filter_codes.join(', ') || '-'}${s.include_missing ? ' + 누락' : ''}
        </div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteSnapshot('${s.id}')">삭제</button>
    </div>
  `).join('');
}

window.openSnapshot = function(id) {
  const snap = placementSnapshots.find(s => s.id === id);
  if (!snap) return;
  placementFiltered = snap.data;
  activeSnapshotId = id;

  const body = document.getElementById('placementResultBody');
  body.innerHTML = placementFiltered.map(r => `
    <tr>
      <td>${r.contractor}</td>
      <td>${r.job || '-'}</td>
      <td>${r.name}</td>
      <td>${r.code ? r.code : '<span style="color:#DC2626;font-weight:700;">누락</span>'}</td>
      <td>${r.phone || '-'}</td>
    </tr>
  `).join('');

  const contractorCount = new Set(placementFiltered.map(r => r.contractor)).size;
  document.getElementById('placementResultSummary').textContent =
    `[${snap.snapshot_label} 스냅샷] 미수령 ${placementFiltered.length}명 (${contractorCount}개 협력사)`;
  document.getElementById('placementResultArea').style.display = '';
  // 저장된 스냅샷을 다시 저장할 필요는 없으니 저장 버튼 숨김
  document.querySelector('#placementResultArea .btn-ok')?.style.setProperty('display', 'none');
  document.getElementById('placementResultArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deleteSnapshot = async function(id) {
  if (!confirm('이 스냅샷을 삭제하시겠습니까?')) return;
  await supabase.from('placement_snapshots').delete().eq('id', id);
  await loadPlacementSnapshots();
  toast('삭제됐습니다');
};

// ═══════════════════════════════════════════════
// 일정관리 (캘린더)
// ═══════════════════════════════════════════════
let calendarEvents = [];
let calViewYear, calViewMonth; // 0-indexed month
let calSelectedDate = null;

const CAL_CATEGORY_COLOR = { general: '#64748B', meeting: '#2563EB', inspection: '#DC2626', contractor: '#D97706' };
const CAL_CATEGORY_LABEL = { general: '일반', meeting: '협력사 미팅', inspection: '점검일', contractor: '협력사 일정' };

function initCalView() {
  const now = new Date();
  calViewYear = now.getFullYear();
  calViewMonth = now.getMonth();
}

async function loadCalendarEvents() {
  if (!calViewYear) initCalView();
  const { data, error } = await supabase.from('calendar_events')
    .select('*').eq('workspace_id', currentWS.id).order('event_date');
  if (error) { console.error(error); calendarEvents = []; return; }
  calendarEvents = data || [];
  renderUpcomingEvents();
}

window.calShiftMonth = function(delta) {
  calViewMonth += delta;
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
  renderCalendar();
};

function renderCalendar() {
  if (!calViewYear) initCalView();
  document.getElementById('calMonthLabel').textContent = `${calViewYear}년 ${calViewMonth + 1}월`;

  const firstDay = new Date(calViewYear, calViewMonth, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calViewYear, calViewMonth, 0).getDate();
  const todayStr = today();

  const eventsByDate = {};
  calendarEvents.forEach(ev => {
    if (!eventsByDate[ev.event_date]) eventsByDate[ev.event_date] = [];
    eventsByDate[ev.event_date].push(ev);
  });

  const cells = [];
  // 이전달 채우기
  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, dim: true, dateStr: null });
  }
  // 이번달
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day: d, dim: false, dateStr, isToday: dateStr === todayStr });
  }
  // 다음달 채우기 (7의 배수로)
  let nextDay = 1;
  while (cells.length % 7 !== 0) { cells.push({ day: nextDay++, dim: true, dateStr: null }); }

  const grid = document.getElementById('calGrid');
  grid.innerHTML = cells.map((c, i) => {
    const weekday = i % 7;
    const numClass = weekday === 0 ? 'sun' : (weekday === 6 ? 'sat' : '');
    if (c.dim) {
      return `<div class="cal-cell dim"><div class="cal-cell-num">${c.day}</div></div>`;
    }
    const evs = eventsByDate[c.dateStr] || [];
    const evHtml = evs.slice(0, 3).map(ev =>
      `<div class="cal-event-pill" style="background:${ev.color || CAL_CATEGORY_COLOR[ev.category] || '#64748B'}">${ev.title}</div>`
    ).join('');
    const moreHtml = evs.length > 3 ? `<div class="cal-event-more">+${evs.length - 3}개 더보기</div>` : '';
    return `<div class="cal-cell ${c.isToday ? 'today' : ''}" onclick="selectCalDay('${c.dateStr}')">
      <div class="cal-cell-num ${numClass}">${c.day}</div>
      ${evHtml}${moreHtml}
    </div>`;
  }).join('');
}

window.selectCalDay = function(dateStr) {
  calSelectedDate = dateStr;
  const evs = calendarEvents.filter(e => e.event_date === dateStr).sort((a,b) => (a.start_time||'').localeCompare(b.start_time||''));
  const d = new Date(dateStr + 'T00:00:00');
  document.getElementById('calSelectedDayTitle').innerHTML =
    `<span class="card-title-icon">📌</span> ${d.toLocaleDateString('ko-KR', { month:'long', day:'numeric', weekday:'long' })}
     <button class="btn btn-primary btn-sm" style="float:right;" onclick="openEventModal('${dateStr}')">+ 일정 추가</button>`;
  const list = document.getElementById('calSelectedDayEvents');
  if (!evs.length) {
    list.innerHTML = `<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px;">이 날짜에 등록된 일정이 없습니다</div>`;
  } else {
    list.innerHTML = evs.map(ev => `
      <div class="cal-day-event-item" onclick="openEventModal(null,'${ev.id}')">
        <div class="cal-day-event-dot" style="background:${ev.color || CAL_CATEGORY_COLOR[ev.category] || '#64748B'}"></div>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:13.5px;">${ev.title}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">
            ${ev.start_time ? `${ev.start_time.slice(0,5)}${ev.end_time ? '–'+ev.end_time.slice(0,5) : ''}` : '종일'} · ${CAL_CATEGORY_LABEL[ev.category] || '일반'}
          </div>
        </div>
      </div>
    `).join('');
  }
  document.getElementById('calSelectedDayCard').style.display = '';
};

window.openEventModal = function(presetDate, editId) {
  document.getElementById('ev_id').value = '';
  document.getElementById('ev_title').value = '';
  document.getElementById('ev_category').value = 'general';
  document.getElementById('ev_date').value = presetDate || calSelectedDate || today();
  document.getElementById('ev_start').value = '';
  document.getElementById('ev_end').value = '';
  document.getElementById('ev_desc').value = '';
  document.getElementById('ev_deleteBtn').style.display = 'none';
  document.getElementById('eventModalTitle').textContent = '일정 추가';

  if (editId) {
    const ev = calendarEvents.find(e => e.id === editId);
    if (ev) {
      document.getElementById('ev_id').value = ev.id;
      document.getElementById('ev_title').value = ev.title;
      document.getElementById('ev_category').value = ev.category || 'general';
      document.getElementById('ev_date').value = ev.event_date;
      document.getElementById('ev_start').value = ev.start_time ? ev.start_time.slice(0,5) : '';
      document.getElementById('ev_end').value = ev.end_time ? ev.end_time.slice(0,5) : '';
      document.getElementById('ev_desc').value = ev.description || '';
      document.getElementById('ev_deleteBtn').style.display = '';
      document.getElementById('eventModalTitle').textContent = '일정 수정';
    }
  }
  openModal('eventModal');
};

window.saveEvent = async function() {
  const id = document.getElementById('ev_id').value;
  const title = document.getElementById('ev_title').value.trim();
  const category = document.getElementById('ev_category').value;
  const event_date = document.getElementById('ev_date').value;
  const start_time = document.getElementById('ev_start').value || null;
  const end_time = document.getElementById('ev_end').value || null;
  const description = document.getElementById('ev_desc').value.trim() || null;

  if (!title) { toast('제목을 입력하세요', 'error'); return; }
  if (!event_date) { toast('날짜를 선택하세요', 'error'); return; }

  const payload = {
    workspace_id: currentWS.id, title, category, event_date, start_time, end_time, description,
    color: CAL_CATEGORY_COLOR[category] || '#64748B',
  };

  let error;
  if (id) {
    ({ error } = await supabase.from('calendar_events').update(payload).eq('id', id));
  } else {
    ({ error } = await supabase.from('calendar_events').insert({ ...payload, created_by: user.id }));
  }
  if (error) { toast('저장 실패: ' + error.message, 'error'); return; }

  closeModal('eventModal');
  await loadCalendarEvents();
  renderCalendar();
  if (calSelectedDate) selectCalDay(calSelectedDate);
  toast('일정이 저장됐습니다', 'success');
};

window.deleteEvent = async function() {
  const id = document.getElementById('ev_id').value;
  if (!id) return;
  if (!confirm('이 일정을 삭제하시겠습니까?')) return;
  await supabase.from('calendar_events').delete().eq('id', id);
  closeModal('eventModal');
  await loadCalendarEvents();
  renderCalendar();
  if (calSelectedDate) selectCalDay(calSelectedDate);
  toast('삭제됐습니다');
};

function renderUpcomingEvents() {
  const el = document.getElementById('upcomingEventsList');
  if (!el) return;
  const todayStr = today();
  const upcoming = calendarEvents
    .filter(e => e.event_date >= todayStr)
    .sort((a,b) => a.event_date.localeCompare(b.event_date) || (a.start_time||'').localeCompare(b.start_time||''))
    .slice(0, 5);
  if (!upcoming.length) {
    el.innerHTML = `<div style="color:var(--text3);font-size:13px;text-align:center;padding:20px;">예정된 일정이 없습니다</div>`;
    return;
  }
  el.innerHTML = upcoming.map(ev => {
    const d = new Date(ev.event_date + 'T00:00:00');
    const dLabel = d.toLocaleDateString('ko-KR', { month:'numeric', day:'numeric', weekday:'short' });
    return `<div class="cal-day-event-item" onclick="showPage('calendar')">
      <div class="cal-day-event-dot" style="background:${ev.color || CAL_CATEGORY_COLOR[ev.category] || '#64748B'}"></div>
      <div style="flex:1;">
        <div style="font-weight:700;font-size:13.5px;">${ev.title}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px;">${dLabel}${ev.start_time ? ' · '+ev.start_time.slice(0,5) : ''}</div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════
// 투두리스트 (개인용)
// ═══════════════════════════════════════════════
let todos = [];

async function loadTodos() {
  const { data, error } = await supabase.from('todos')
    .select('*').eq('workspace_id', currentWS.id).eq('user_id', user.id).order('sort_order');
  if (error) { console.error(error); todos = []; return; }
  todos = data || [];
  renderTodos();
}

function renderTodos() {
  const el = document.getElementById('todoList');
  if (!el) return;
  if (!todos.length) {
    el.innerHTML = `<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px;">할 일을 추가해보세요</div>`;
    return;
  }
  el.innerHTML = todos.map(t => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border);">
      <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTodo('${t.id}', this.checked)" style="width:17px;height:17px;cursor:pointer;flex-shrink:0;">
      <div style="flex:1;font-size:13.5px;${t.done ? 'text-decoration:line-through;color:var(--text3);' : ''}">${t.content}</div>
      <button class="btn btn-danger btn-sm" onclick="deleteTodo('${t.id}')" style="padding:4px 9px;">✕</button>
    </div>
  `).join('');
}

window.addTodo = async function() {
  const input = document.getElementById('newTodoInput');
  const content = input.value.trim();
  if (!content) return;
  const maxOrder = todos.reduce((m, t) => Math.max(m, t.sort_order), 0);
  const { error } = await supabase.from('todos').insert({
    workspace_id: currentWS.id, user_id: user.id, content, sort_order: maxOrder + 1,
  });
  if (error) { toast('추가 실패: ' + error.message, 'error'); return; }
  input.value = '';
  await loadTodos();
};

window.toggleTodo = async function(id, done) {
  await supabase.from('todos').update({ done }).eq('id', id);
  await loadTodos();
};

window.deleteTodo = async function(id) {
  await supabase.from('todos').delete().eq('id', id);
  await loadTodos();
};

// ═══════════════════════════════════════════════
// 루틴 업무 (반복 체크리스트)
// ═══════════════════════════════════════════════
let routineTasks = [];
let routineCompletions = []; // 현재 활성 주기에 대한 완료 기록만 보유

function getISOWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
function getMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function periodKeyFor(task, d = new Date()) {
  return task.frequency === 'monthly' ? getMonthKey(d) : getISOWeekKey(d);
}

window.toggleRoutineFreqInput = function() {
  const freq = document.getElementById('newRoutineFreq').value;
  document.getElementById('routineWeekdayField').style.display = freq === 'weekly' ? '' : 'none';
  document.getElementById('routineDayField').style.display = freq === 'monthly' ? '' : 'none';
};

async function loadRoutineTasks() {
  const { data, error } = await supabase.from('routine_tasks')
    .select('*').eq('workspace_id', currentWS.id).eq('active', true).order('sort_order');
  if (error) { console.error(error); routineTasks = []; return; }
  routineTasks = data || [];

  // 현재 주기들의 완료 기록 조회 (주간 태스크는 이번주 키, 월간 태스크는 이번달 키)
  const periodKeys = [...new Set(routineTasks.map(t => periodKeyFor(t)))];
  if (periodKeys.length) {
    const { data: comps } = await supabase.from('routine_task_completions')
      .select('*').eq('workspace_id', currentWS.id).in('period_key', periodKeys);
    routineCompletions = comps || [];
  } else {
    routineCompletions = [];
  }

  renderRoutineTaskSettingsList();
  renderRoutineTaskDashboard();
}

function renderRoutineTaskSettingsList() {
  const el = document.getElementById('routineTaskList');
  if (!el) return;
  if (!routineTasks.length) {
    el.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:8px 0;">등록된 루틴 업무가 없습니다</div>`;
    return;
  }
  el.innerHTML = routineTasks.map(t => {
    const freqLabel = t.frequency === 'monthly' ? `매월 ${t.day_of_month}일` : `매주 ${['일','월','화','수','목','금','토'][t.weekday]}요일`;
    return `<div class="snapshot-item" style="cursor:default;">
      <div>
        <div style="font-weight:700;font-size:13.5px;">${t.title}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px;">${freqLabel}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteRoutineTask('${t.id}')">삭제</button>
    </div>`;
  }).join('');
}

function renderRoutineTaskDashboard() {
  const el = document.getElementById('routineTaskDashList');
  if (!el) return;
  if (!routineTasks.length) {
    el.innerHTML = `<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px;">등록된 루틴 업무가 없습니다</div>`;
    return;
  }
  el.innerHTML = routineTasks.map(t => {
    const pk = periodKeyFor(t);
    const done = routineCompletions.some(c => c.task_id === t.id && c.period_key === pk);
    const freqLabel = t.frequency === 'monthly' ? `매월 ${t.day_of_month}일` : `매주 ${['일','월','화','수','목','금','토'][t.weekday]}요일`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border);">
      <input type="checkbox" ${done ? 'checked' : ''} onchange="toggleRoutineDone('${t.id}', this.checked)" style="width:17px;height:17px;cursor:pointer;flex-shrink:0;">
      <div style="flex:1;">
        <div style="font-size:13.5px;font-weight:600;${done ? 'text-decoration:line-through;color:var(--text3);' : ''}">${t.title}</div>
        <div style="font-size:11.5px;color:var(--text3);">${freqLabel}</div>
      </div>
    </div>`;
  }).join('');
}

window.addRoutineTask = async function() {
  const title = document.getElementById('newRoutineTitle').value.trim();
  const frequency = document.getElementById('newRoutineFreq').value;
  if (!title) { toast('업무 내용을 입력하세요', 'error'); return; }

  const payload = { workspace_id: currentWS.id, created_by: user.id, title, frequency };
  if (frequency === 'weekly') {
    payload.weekday = parseInt(document.getElementById('newRoutineWeekday').value, 10);
  } else {
    const dom = parseInt(document.getElementById('newRoutineDay').value, 10);
    if (!dom || dom < 1 || dom > 31) { toast('1~31 사이 날짜를 입력하세요', 'error'); return; }
    payload.day_of_month = dom;
  }

  const { error } = await supabase.from('routine_tasks').insert(payload);
  if (error) { toast('추가 실패: ' + error.message, 'error'); return; }
  document.getElementById('newRoutineTitle').value = '';
  await loadRoutineTasks();
  toast('루틴 업무가 추가됐습니다', 'success');
};

window.deleteRoutineTask = async function(id) {
  if (!confirm('이 루틴 업무를 삭제하시겠습니까? (완료 기록도 함께 삭제됩니다)')) return;
  await supabase.from('routine_tasks').delete().eq('id', id);
  await loadRoutineTasks();
  toast('삭제됐습니다');
};

window.toggleRoutineDone = async function(taskId, done) {
  const task = routineTasks.find(t => t.id === taskId);
  if (!task) return;
  const pk = periodKeyFor(task);
  if (done) {
    const { error } = await supabase.from('routine_task_completions')
      .insert({ task_id: taskId, workspace_id: currentWS.id, period_key: pk, completed_by: user.id });
    if (error) { toast('처리 실패: ' + error.message, 'error'); return; }
  } else {
    await supabase.from('routine_task_completions').delete().eq('task_id', taskId).eq('period_key', pk);
  }
  await loadRoutineTasks();
};

// ═══════════════════════════════════════════════
// 사업자등록증 관리
// ═══════════════════════════════════════════════
let businessLicenses = [];

async function loadBusinessLicenses() {
  const { data, error } = await supabase.from('business_licenses')
    .select('*, contractor:contractor_id(name)').eq('workspace_id', currentWS.id);
  if (error) { console.error(error); businessLicenses = []; return; }
  businessLicenses = data || [];
  renderBusinessLicenseStatus();
  renderLicenseAlert();
}

function renderBusinessLicenseStatus() {
  const statusEl = document.getElementById('businessLicenseStatus');
  const listEl = document.getElementById('businessLicenseList');
  if (!statusEl || !listEl) return;

  const submittedIds = new Set(businessLicenses.map(l => l.contractor_id));
  const missing = contractors.filter(c => !submittedIds.has(c.id));

  statusEl.innerHTML = `<span style="color:var(--ok);">제출 ${businessLicenses.length}개</span> / 전체 ${contractors.length}개 협력사
    ${missing.length ? `<span style="color:var(--danger);margin-left:8px;">미제출 ${missing.length}개</span>` : ''}`;

  let html = '';
  if (missing.length) {
    html += `<div style="margin-bottom:14px;">
      <div style="font-size:12.5px;font-weight:700;color:var(--danger);margin-bottom:6px;">⚠️ 미제출 협력사</div>
      <div class="tag-list">${missing.map(c => `<span class="tag" style="border-color:#FECACA;color:var(--danger);background:var(--danger-light);">${c.name}
        <button onclick="event.stopPropagation();document.getElementById('manualLicenseContractor').value='${c.id}';document.getElementById('manualLicenseInput').click()" style="background:none;border:none;color:inherit;cursor:pointer;margin-left:4px;font-weight:700;">+업로드</button>
      </span>`).join('')}</div>
    </div>`;
  }
  if (businessLicenses.length) {
    html += `<div style="font-size:12.5px;font-weight:700;color:var(--text2);margin-bottom:6px;">✅ 제출 완료</div>`;
    html += businessLicenses.map(l => `
      <div class="snapshot-item" style="cursor:default;">
        <div>
          <div style="font-weight:700;font-size:13.5px;">${l.contractor?.name || '알 수 없음'}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">${l.file_name} · ${l.uploaded_by === 'contractor' ? '협력사 제출' : '관리자 업로드'} · ${new Date(l.uploaded_at).toLocaleDateString('ko-KR')}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-outline btn-sm" onclick="viewLicense('${l.id}')">보기</button>
          <button class="btn btn-danger btn-sm" onclick="deleteLicense('${l.id}')">삭제</button>
        </div>
      </div>
    `).join('');
  }
  listEl.innerHTML = html || `<div style="color:var(--text3);font-size:13px;padding:8px 0;">데이터가 없습니다</div>`;

  // hidden input for manual upload contractor targeting
  if (!document.getElementById('manualLicenseContractor')) {
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'manualLicenseContractor';
    listEl.appendChild(hidden);
  }
}

function renderLicenseAlert() {
  const wrap = document.getElementById('licenseAlertWrap');
  const list = document.getElementById('licenseAlertList');
  if (!wrap || !list) return;
  const submittedIds = new Set(businessLicenses.map(l => l.contractor_id));
  const missing = contractors.filter(c => !submittedIds.has(c.id));
  if (!missing.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  list.innerHTML = `<div style="font-size:13px;color:var(--text2);">
    ${missing.map(c => c.name).join(', ')} — 사업자등록증 미제출
    <button class="btn btn-outline btn-sm" style="margin-left:8px;" onclick="showPage('settings')">관리</button>
  </div>`;
}

window.handleManualLicenseUpload = async function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const conId = document.getElementById('manualLicenseContractor')?.value;
  if (!conId) { toast('업로드할 협력사를 먼저 선택하세요', 'error'); e.target.value=''; return; }

  const ext = file.name.split('.').pop();
  const path = `${currentWS.id}/${conId}_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('business-licenses').upload(path, file, { contentType: file.type, upsert: true });
  if (upErr) { toast('업로드 실패: ' + upErr.message, 'error'); e.target.value=''; return; }

  const { error } = await supabase.from('business_licenses').upsert({
    workspace_id: currentWS.id, contractor_id: conId, file_name: file.name, file_path: path, uploaded_by: 'manager',
  }, { onConflict: 'contractor_id' });
  if (error) { toast('저장 실패: ' + error.message, 'error'); e.target.value=''; return; }

  e.target.value = '';
  await loadBusinessLicenses();
  toast('사업자등록증이 업로드됐습니다', 'success');
};

window.viewLicense = async function(id) {
  const lic = businessLicenses.find(l => l.id === id);
  if (!lic) return;
  const { data, error } = await supabase.storage.from('business-licenses').createSignedUrl(lic.file_path, 3600);
  if (error) { toast('파일을 열 수 없습니다: ' + error.message, 'error'); return; }
  window.open(data.signedUrl, '_blank');
};

window.deleteLicense = async function(id) {
  const lic = businessLicenses.find(l => l.id === id);
  if (!lic) return;
  if (!confirm(`${lic.contractor?.name} 사업자등록증을 삭제하시겠습니까?`)) return;
  await supabase.storage.from('business-licenses').remove([lic.file_path]);
  await supabase.from('business_licenses').delete().eq('id', id);
  await loadBusinessLicenses();
  toast('삭제됐습니다');
};

window.downloadAllLicenses = async function() {
  if (!businessLicenses.length) { toast('다운로드할 사업자등록증이 없습니다', 'error'); return; }
  const zip = new JSZip();
  const folder = zip.folder(`사업자등록증_${currentWS.name}_${today()}`);
  for (const lic of businessLicenses) {
    const { data, error } = await supabase.storage.from('business-licenses').download(lic.file_path);
    if (error) continue;
    const ext = lic.file_name.split('.').pop();
    folder.file(`${lic.contractor?.name || '알수없음'}.${ext}`, data);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `사업자등록증_전체_${today()}.zip`);
};

// ═══════════════════════════════════════════════
// 사진 클라우드 (폴더 트리 + 무한 뎁스)
// ═══════════════════════════════════════════════
const PHOTO_FOLDER_PRESETS = ['혹서기', '휴게시간', '휴게실', '보냉장구', '그늘막', '식염포도당/음용수', '안전보건교육', '추락방지', '안전보건교육'];

let photoFolders = [];      // 전체 폴더 목록 (flat)
let photos = [];            // 전체 사진 목록
let activeFolderId = null;  // 현재 선택된 폴더
let openFolderIds = new Set(); // 펼쳐진 폴더 집합
let photoThumbUrlCache = {};
let pendingUploadFiles = [];
let draggedPhotoId = null;
let addFolderParentId = null; // 폴더 추가 시 부모 폴더

async function loadPhotoFolders() {
  const { data, error } = await supabase.from('photo_folders')
    .select('*').eq('workspace_id', currentWS.id).order('sort_order');
  if (error) { console.error(error); photoFolders = []; return; }
  photoFolders = data || [];
}

async function loadPhotos() {
  const { data, error } = await supabase.from('photos')
    .select('*').eq('workspace_id', currentWS.id).order('shot_date', { ascending: false });
  if (error) { console.error(error); photos = []; return; }
  photos = data || [];
}

// ─── 폴더 트리 렌더링 ───
function renderPhotoFolderTree() {
  const el = document.getElementById('photoFolderTree');
  if (!el) return;
  const roots = photoFolders.filter(f => !f.parent_id);
  if (!roots.length) {
    el.innerHTML = `<div style="padding:20px 14px;font-size:12.5px;color:var(--text3);text-align:center;">폴더가 없습니다<br>위 + 버튼으로 만들어보세요</div>`;
    document.getElementById('photoMainEmpty').style.display = '';
    document.getElementById('photoMainContent').style.display = 'none';
    document.getElementById('photoUploadBtn').disabled = true;
    return;
  }
  document.getElementById('photoUploadBtn').disabled = !activeFolderId;
  el.innerHTML = `<div class="photo-folder-tree">${renderFolderItems(roots, 0)}</div>`;
}

function renderFolderItems(items, depth) {
  return items.map(f => {
    const children = photoFolders.filter(c => c.parent_id === f.id);
    const hasChildren = children.length > 0;
    const isOpen = openFolderIds.has(f.id);
    const isActive = f.id === activeFolderId;
    const photoCount = getDescendantPhotoCount(f.id);
    const indent = depth * 14;
    return `<div>
      <div class="tree-item ${isActive ? 'active' : ''}" style="padding-left:${12 + indent}px;"
          onclick="selectPhotoFolder('${f.id}')"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="handleDropOnFolder(event,'${f.id}')">
        <span class="tree-toggle" onclick="event.stopPropagation();toggleFolderOpen('${f.id}')">
          ${hasChildren ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span style="margin-right:4px;">📁</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
        <span style="font-size:11px;color:var(--text3);margin-left:4px;">${photoCount||''}</span>
      </div>
      <div class="tree-children ${isOpen ? 'open' : ''}">
        ${hasChildren ? renderFolderItems(children, depth + 1) : ''}
      </div>
    </div>`;
  }).join('');
}

function getDescendantPhotoCount(folderId) {
  const childIds = getAllDescendantIds(folderId);
  childIds.push(folderId);
  return photos.filter(p => childIds.includes(p.folder_id)).length;
}

function getAllDescendantIds(folderId) {
  const children = photoFolders.filter(f => f.parent_id === folderId);
  let ids = children.map(f => f.id);
  children.forEach(c => { ids = ids.concat(getAllDescendantIds(c.id)); });
  return ids;
}

window.toggleFolderOpen = function(id) {
  if (openFolderIds.has(id)) openFolderIds.delete(id);
  else openFolderIds.add(id);
  renderPhotoFolderTree();
};

window.selectPhotoFolder = function(id) {
  activeFolderId = id;
  openFolderIds.add(id);
  document.getElementById('photoUploadBtn').disabled = false;
  renderPhotoFolderTree();
  renderPhotoMain();
};

function renderPhotoMain() {
  const emptyEl = document.getElementById('photoMainEmpty');
  const contentEl = document.getElementById('photoMainContent');
  if (!activeFolderId) {
    emptyEl.style.display = '';
    contentEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  contentEl.style.display = '';

  const folder = photoFolders.find(f => f.id === activeFolderId);
  const breadcrumb = getFolderBreadcrumb(activeFolderId).join(' / ');
  document.getElementById('photoMainTitle').textContent = breadcrumb;

  // 날짜별 그룹
  const folderPhotos = photos.filter(p => p.folder_id === activeFolderId);
  const dateGroups = document.getElementById('photoDateGroups');
  if (!folderPhotos.length) {
    dateGroups.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text3);">
      <div style="font-size:32px;margin-bottom:8px;">🖼️</div>
      <div style="font-size:14px;">이 폴더에 사진이 없습니다</div>
    </div>`;
    return;
  }
  const byDate = {};
  folderPhotos.forEach(p => { (byDate[p.shot_date] ||= []).push(p); });
  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));
  dateGroups.innerHTML = dates.map(d => {
    const dLabel = new Date(d + 'T00:00:00').toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'short' });
    return `<div class="photo-date-group">
      <div class="photo-date-label">${dLabel} <span style="font-weight:500;color:var(--text3);">(${byDate[d].length}장)</span></div>
      <div class="photo-grid">${byDate[d].map(p => `
        <div class="photo-thumb" draggable="true" id="photo_${p.id}"
            onclick="openPhotoViewer('${p.id}')"
            ondragstart="handlePhotoDragStart(event,'${p.id}')"
            ondragend="handlePhotoDragEnd(event)">
          <img src="${photoThumbUrlCache[p.id]||''}" data-photo-id="${p.id}" loading="lazy">
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
  loadPhotoThumbnails(folderPhotos);
}

function getFolderBreadcrumb(folderId) {
  const f = photoFolders.find(x => x.id === folderId);
  if (!f) return [];
  if (!f.parent_id) return [f.name];
  return [...getFolderBreadcrumb(f.parent_id), f.name];
}

async function loadPhotoThumbnails(list) {
  for (const p of list) {
    if (photoThumbUrlCache[p.id]) {
      const img = document.querySelector(`img[data-photo-id="${p.id}"]`);
      if (img) img.src = photoThumbUrlCache[p.id];
      continue;
    }
    const { data } = await supabase.storage.from('site-photos').createSignedUrl(p.file_path, 3600);
    if (data) {
      photoThumbUrlCache[p.id] = data.signedUrl;
      const img = document.querySelector(`img[data-photo-id="${p.id}"]`);
      if (img) img.src = data.signedUrl;
    }
  }
}

// ─── 드래그앤드롭 ───
window.handlePhotoDragStart = function(e, photoId) {
  draggedPhotoId = photoId;
  e.dataTransfer.effectAllowed = 'move';
  document.getElementById(`photo_${photoId}`)?.classList.add('dragging');
};
window.handlePhotoDragEnd = function() {
  document.getElementById(`photo_${draggedPhotoId}`)?.classList.remove('dragging');
  draggedPhotoId = null;
};

window.handleDropOnFolder = async function(e, targetFolderId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!draggedPhotoId) return;
  const p = photos.find(x => x.id === draggedPhotoId);
  if (!p || p.folder_id === targetFolderId) return;
  await supabase.from('photos').update({ folder_id: targetFolderId }).eq('id', draggedPhotoId);
  await loadPhotos();
  renderPhotoFolderTree();
  renderPhotoMain();
  toast('사진을 이동했습니다', 'success');
};

// ─── 폴더 추가/삭제 ───
window.openAddFolderModal = function(parentId) {
  addFolderParentId = parentId;
  const parent = parentId ? photoFolders.find(f => f.id === parentId) : null;
  document.getElementById('addFolderModalTitle').textContent = parent ? `"${parent.name}" 안에 새 폴더` : '새 폴더';
  document.getElementById('newFolderName').value = '';

  // 사전 정의 폴더 칩 (이미 있는 것 제외)
  const existing = new Set(photoFolders.filter(f => f.parent_id === parentId).map(f => f.name));
  const chips = PHOTO_FOLDER_PRESETS.filter(n => !existing.has(n));
  document.getElementById('folderPresetChips').innerHTML = chips.map(n =>
    `<span class="tag" style="cursor:pointer;" onclick="document.getElementById('newFolderName').value='${n}'">${n}</span>`
  ).join('');
  openModal('addFolderModal');
};

window.confirmAddFolder = async function() {
  const name = document.getElementById('newFolderName').value.trim();
  if (!name) { toast('폴더 이름을 입력하세요', 'error'); return; }
  const { error } = await supabase.from('photo_folders').insert({
    workspace_id: currentWS.id, name, parent_id: addFolderParentId || null,
    sort_order: photoFolders.filter(f => f.parent_id === (addFolderParentId || null)).length,
  });
  if (error) { toast('추가 실패: ' + error.message, 'error'); return; }
  if (addFolderParentId) openFolderIds.add(addFolderParentId);
  await loadPhotoFolders();
  renderPhotoFolderTree();
  closeModal('addFolderModal');
  toast(`"${name}" 폴더가 추가됐습니다`, 'success');
};

window.deleteCurrentFolder = async function() {
  if (!activeFolderId) return;
  const f = photoFolders.find(x => x.id === activeFolderId);
  if (!f) return;
  const descIds = getAllDescendantIds(activeFolderId);
  descIds.push(activeFolderId);
  const totalPhotos = photos.filter(p => descIds.includes(p.folder_id)).length;
  if (!confirm(`"${f.name}" 폴더${descIds.length > 1 ? ` (하위 폴더 ${descIds.length - 1}개 포함)` : ''}를 삭제하시겠습니까?${totalPhotos ? ` 사진 ${totalPhotos}장도 함께 삭제됩니다.` : ''}`)) return;

  // 사진 스토리지 삭제
  const toDelete = photos.filter(p => descIds.includes(p.folder_id));
  if (toDelete.length) await supabase.storage.from('site-photos').remove(toDelete.map(p => p.file_path));
  // 폴더 삭제 (cascade로 하위 폴더+사진 DB 레코드도 삭제됨)
  await supabase.from('photo_folders').delete().eq('id', activeFolderId);
  activeFolderId = null;
  await loadPhotoFolders();
  await loadPhotos();
  renderPhotoFolderTree();
  renderPhotoMain();
  toast('폴더가 삭제됐습니다');
};

// ─── 사진 업로드 (날짜 지정) ───
window.openPhotoUploadModal = function() {
  if (!activeFolderId) { toast('먼저 폴더를 선택하세요', 'error'); return; }
  pendingUploadFiles = [];
  document.getElementById('photoUploadDate').value = today();
  document.getElementById('photoUploadFileList').innerHTML = '';
  document.getElementById('photoUploadConfirmBtn').disabled = true;
  document.getElementById('photoUploadFileInput').value = '';
  openModal('photoUploadModal');
  setTimeout(() => document.getElementById('photoUploadDropZone')?.focus(), 50);
};

function renderPendingUploadList() {
  const listEl = document.getElementById('photoUploadFileList');
  if (!pendingUploadFiles.length) { listEl.innerHTML = ''; document.getElementById('photoUploadConfirmBtn').disabled = true; return; }
  listEl.innerHTML = `선택됨 ${pendingUploadFiles.length}개: ` + pendingUploadFiles.map(f => f.name).join(', ') +
    ` <button onclick="clearPendingUploads()" style="margin-left:6px;background:none;border:none;color:var(--danger);cursor:pointer;font-weight:700;">전체 삭제</button>`;
  document.getElementById('photoUploadConfirmBtn').disabled = false;
}

window.clearPendingUploads = function() {
  pendingUploadFiles = [];
  document.getElementById('photoUploadFileInput').value = '';
  renderPendingUploadList();
};

window.handlePhotoFilesSelected = function(e) {
  const newFiles = Array.from(e.target.files || []);
  pendingUploadFiles = pendingUploadFiles.concat(newFiles);
  renderPendingUploadList();
};

window.handlePhotoPaste = function(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  let added = 0;
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        const ext = file.type.split('/')[1] || 'png';
        const named = new File([file], `붙여넣기_${Date.now()}_${added}.${ext}`, { type: file.type });
        pendingUploadFiles.push(named);
        added++;
      }
    }
  }
  if (added > 0) { e.preventDefault(); renderPendingUploadList(); toast(`이미지 ${added}장이 추가됐습니다`, 'success'); }
};

window.confirmPhotoUpload = async function() {
  const shotDate = document.getElementById('photoUploadDate').value;
  if (!shotDate) { toast('날짜를 선택하세요', 'error'); return; }
  if (!pendingUploadFiles.length) { toast('파일을 선택하거나 붙여넣으세요', 'error'); return; }
  if (!activeFolderId) { toast('폴더를 먼저 선택하세요', 'error'); return; }

  const btn = document.getElementById('photoUploadConfirmBtn');
  btn.disabled = true; btn.textContent = '업로드 중...';

  let success = 0;
  for (const file of pendingUploadFiles) {
    try {
      const ext = file.name.split('.').pop();
      const path = `${currentWS.id}/${activeFolderId}/${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('site-photos').upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from('photos').insert({
        workspace_id: currentWS.id, folder_id: activeFolderId, uploaded_by: user.id,
        file_path: path, file_name: file.name, shot_date: shotDate,
      });
      if (dbErr) throw dbErr;
      success++;
    } catch (err) { console.error(err); }
  }

  btn.disabled = false; btn.textContent = '업로드';
  closeModal('photoUploadModal');
  await loadPhotos();
  renderPhotoFolderTree();
  renderPhotoMain();
  toast(`${success}장 업로드 완료`, success === pendingUploadFiles.length ? 'success' : 'warn');
};

// ─── 사진 뷰어 ───
let viewingPhotoId = null;
window.openPhotoViewer = async function(photoId) {
  const p = photos.find(x => x.id === photoId);
  if (!p) return;
  viewingPhotoId = photoId;
  const folder = photoFolders.find(f => f.id === p.folder_id);
  document.getElementById('photoViewTitle').textContent = `${folder?.name || ''} · ${p.shot_date}`;
  document.getElementById('photoViewImg').src = photoThumbUrlCache[p.id] || '';
  document.getElementById('photoViewMeta').textContent = `촬영일: ${p.shot_date} · 업로드: ${new Date(p.created_at).toLocaleString('ko-KR')} · ${p.file_name}`;
  if (!photoThumbUrlCache[p.id]) {
    const { data } = await supabase.storage.from('site-photos').createSignedUrl(p.file_path, 3600);
    if (data) { photoThumbUrlCache[p.id] = data.signedUrl; document.getElementById('photoViewImg').src = data.signedUrl; }
  }
  openModal('photoViewModal');
};

window.deletePhotoFromViewer = async function() {
  if (!viewingPhotoId) return;
  const p = photos.find(x => x.id === viewingPhotoId);
  if (!p) return;
  if (!confirm('이 사진을 삭제하시겠습니까?')) return;
  await supabase.storage.from('site-photos').remove([p.file_path]);
  await supabase.from('photos').delete().eq('id', p.id);
  closeModal('photoViewModal');
  await loadPhotos();
  renderPhotoFolderTree();
  renderPhotoMain();
  toast('삭제됐습니다');
};

// ─── 사진대지 인쇄 ───
window.openPhotoPrintModal = function() {
  if (!photoFolders.length) { toast('먼저 폴더를 추가하세요', 'error'); return; }
  const sel = document.getElementById('printAlbumSelect');
  sel.innerHTML = photoFolders.map(f => {
    const breadcrumb = getFolderBreadcrumb(f.id).join(' / ');
    return `<option value="${f.id}">${breadcrumb}</option>`;
  }).join('');
  if (activeFolderId) sel.value = activeFolderId;

  const fPhotos = photos.filter(p => p.folder_id === sel.value);
  if (fPhotos.length) {
    const dates = fPhotos.map(p => p.shot_date).sort();
    document.getElementById('printDateFrom').value = dates[0];
    document.getElementById('printDateTo').value = dates[dates.length - 1];
  } else {
    document.getElementById('printDateFrom').value = today();
    document.getElementById('printDateTo').value = today();
  }
  updatePrintPreviewCount();
  sel.onchange = updatePrintPreviewCount;
  document.getElementById('printDateFrom').onchange = updatePrintPreviewCount;
  document.getElementById('printDateTo').onchange = updatePrintPreviewCount;
  openModal('photoPrintModal');
};

function getPrintTargetPhotos() {
  const folderId = document.getElementById('printAlbumSelect').value;
  const from = document.getElementById('printDateFrom').value;
  const to = document.getElementById('printDateTo').value;
  if (!folderId || !from || !to) return [];
  return photos.filter(p => p.folder_id === folderId && p.shot_date >= from && p.shot_date <= to);
}

function updatePrintPreviewCount() {
  const list = getPrintTargetPhotos();
  const dateCount = new Set(list.map(p => p.shot_date)).size;
  document.getElementById('printPreviewCount').textContent =
    list.length ? `대상: 사진 ${list.length}장 · ${dateCount}일치` : '선택한 기간에 사진이 없습니다';
}

async function resizeImageForDocx(blob, maxDim = 900) {
  const bitmap = await createImageBitmap(blob);
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * ratio); height = Math.round(height * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  const outBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
  const buf = await outBlob.arrayBuffer();
  return { buffer: new Uint8Array(buf), width, height };
}

window.generatePhotoLedgerDocx = async function() {
  const list = getPrintTargetPhotos();
  if (!list.length) { toast('선택한 기간에 사진이 없습니다', 'error'); return; }
  const layout = document.querySelector('input[name="printLayout"]:checked').value;
  const cols = 2, rows = layout === '2x4' ? 4 : 3, perPage = cols * rows;
  const folderId = document.getElementById('printAlbumSelect').value;
  const folderName = getFolderBreadcrumb(folderId).join(' / ');
  const btn = document.getElementById('photoPrintConfirmBtn');
  btn.disabled = true; btn.textContent = '생성 중... (0%)';
  try {
    const docx = await import('https://esm.sh/docx@9');
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
            AlignmentType, WidthType, HeadingLevel, BorderStyle, ShadingType, PageBreak } = docx;
    const byDate = {};
    list.forEach(p => { (byDate[p.shot_date] ||= []).push(p); });
    const dates = Object.keys(byDate).sort();
    const imageCache = {};
    let done = 0;
    for (const p of list) {
      const { data, error } = await supabase.storage.from('site-photos').download(p.file_path);
      if (!error && data) { try { imageCache[p.id] = await resizeImageForDocx(data); } catch(e) { console.error(e); } }
      done++;
      btn.textContent = `생성 중... (${Math.round(done/list.length*90)}%)`;
    }
    const contentWidthDxa = 9360, cellWidthDxa = Math.floor(contentWidthDxa/cols);
    const imgMaxWidthPx = layout === '2x4' ? 220 : 260;
    const children = [];
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`${currentWS.name} — ${folderName} 사진대지`)] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `기간: ${document.getElementById('printDateFrom').value} ~ ${document.getElementById('printDateTo').value}  ·  생성일: ${today()}`, size: 20, color: '64748B' })], spacing: { after: 300 } }));
    dates.forEach((d, dIdx) => {
      if (dIdx > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
      const dLabel = new Date(d + 'T00:00:00').toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'long' });
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(dLabel)], spacing: { before: dIdx > 0 ? 0 : 100, after: 200 } }));
      const dayPhotos = byDate[d];
      for (let pageStart = 0; pageStart < dayPhotos.length; pageStart += perPage) {
        if (pageStart > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
        const pagePhotos = dayPhotos.slice(pageStart, pageStart + perPage);
        const tableRows = [];
        for (let r = 0; r < rows; r++) {
          const rowCells = [];
          for (let c = 0; c < cols; c++) {
            const idx = r*cols+c; const p = pagePhotos[idx]; const img = p ? imageCache[p.id] : null;
            const cellChildren = [];
            if (img) {
              const dispW = imgMaxWidthPx, dispH = Math.round(img.height*(dispW/img.width));
              cellChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: img.buffer, transformation: { width: dispW, height: dispH }, type: 'jpg' })] }));
              cellChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p.file_name, size: 14, color: '94A3B8' })] }));
            } else { cellChildren.push(new Paragraph({ children: [new TextRun('')] })); }
            rowCells.push(new TableCell({ width: { size: cellWidthDxa, type: WidthType.DXA }, borders: { top:{style:BorderStyle.SINGLE,size:4,color:'E2E8F0'}, bottom:{style:BorderStyle.SINGLE,size:4,color:'E2E8F0'}, left:{style:BorderStyle.SINGLE,size:4,color:'E2E8F0'}, right:{style:BorderStyle.SINGLE,size:4,color:'E2E8F0'} }, margins: { top:120, bottom:120, left:100, right:100 }, shading: { fill:'FFFFFF', type:ShadingType.CLEAR }, children: cellChildren }));
          }
          tableRows.push(new TableRow({ children: rowCells }));
        }
        children.push(new Table({ width: { size: contentWidthDxa, type: WidthType.DXA }, columnWidths: Array(cols).fill(cellWidthDxa), rows: tableRows }));
      }
    });
    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 24 } } }, paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, font: 'Arial' }, paragraph: { spacing: { before: 0, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, font: 'Arial', color: '1D4ED8' }, paragraph: { spacing: { before: 200, after: 160 }, outlineLevel: 1 } },
      ] },
      sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
    });
    btn.textContent = '생성 중... (95%)';
    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, `사진대지_${folderName.replace(/\//g,'_')}_${document.getElementById('printDateFrom').value}~${document.getElementById('printDateTo').value}.docx`);
    closeModal('photoPrintModal');
    toast('Word 파일이 생성됐습니다', 'success');
  } catch (err) { console.error(err); toast('생성 실패: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '📄 Word 생성'; }
};

// ═══════════════════════════════════════════════
// 작업환경측정 연간 체크리스트 (상/하반기)
// ═══════════════════════════════════════════════
let measureRounds = [];

async function loadMeasureRounds() {
  const year = new Date().getFullYear();
  const { data, error } = await supabase.from('measure_rounds')
    .select('*').eq('workspace_id', currentWS.id).eq('year', year);
  if (error) { console.error(error); measureRounds = []; return; }
  measureRounds = data || [];
  renderMeasureRoundsChecklist();
}

function renderMeasureRoundsChecklist() {
  const el = document.getElementById('measureRoundsChecklist');
  if (!el) return;
  const year = new Date().getFullYear();
  const h1 = measureRounds.find(r => r.half === 'H1');
  const h2 = measureRounds.find(r => r.half === 'H2');

  const row = (half, label, rec) => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--border);">
      <input type="checkbox" ${rec?.done ? 'checked' : ''} onchange="toggleMeasureRound('${half}', this.checked)" style="width:18px;height:18px;cursor:pointer;flex-shrink:0;">
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:700;${rec?.done ? 'color:var(--ok);' : ''}">${year}년 ${label} 작업환경측정</div>
        ${rec?.done && rec.done_date ? `<div style="font-size:12px;color:var(--text3);margin-top:2px;">완료일: ${rec.done_date}</div>` : `<div style="font-size:12px;color:var(--text3);margin-top:2px;">미완료</div>`}
      </div>
    </div>`;

  el.innerHTML = row('H1', '상반기', h1) + row('H2', '하반기', h2);
}

window.toggleMeasureRound = async function(half, done) {
  const year = new Date().getFullYear();
  const payload = {
    workspace_id: currentWS.id, year, half, done,
    done_date: done ? today() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('measure_rounds').upsert(payload, { onConflict: 'workspace_id,year,half' });
  if (error) { toast('저장 실패: ' + error.message, 'error'); return; }
  await loadMeasureRounds();
  toast(done ? '완료 처리됐습니다' : '미완료로 변경됐습니다', 'success');
};

// ═══════════════════════════════════════════════
// 전체 협력사용 공용 업로드 링크
// ═══════════════════════════════════════════════
let publicLink = null;

async function loadPublicLink() {
  const { data, error } = await supabase.from('public_upload_links')
    .select('*').eq('workspace_id', currentWS.id).maybeSingle();
  if (error) { console.error(error); publicLink = null; return; }
  publicLink = data || null;
}

function renderPublicLinkUI() {
  const emptyEl = document.getElementById('publicLinkEmptyState');
  const activeEl = document.getElementById('publicLinkActiveState');
  if (!emptyEl || !activeEl) return;

  if (!publicLink) {
    emptyEl.style.display = '';
    activeEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  activeEl.style.display = '';

  const url = `${window.location.origin}/upload.html?ptoken=${publicLink.token}`;
  document.getElementById('publicLinkUrl').textContent = url;
  document.getElementById('publicLinkMeta').textContent = `발급일: ${new Date(publicLink.created_at).toLocaleDateString('ko-KR')}`;
  document.getElementById('publicLinkAllowMsdsEdit').checked = publicLink.allow_msds;
  document.getElementById('publicLinkAllowLicenseEdit').checked = publicLink.allow_license;
}

window.generatePublicUploadLink = async function() {
  const allowMsds = document.getElementById('publicLinkAllowMsds').checked;
  const allowLicense = document.getElementById('publicLinkAllowLicense').checked;
  if (!allowMsds && !allowLicense) { toast('최소 하나는 선택해야 합니다', 'error'); return; }

  const token = generateToken();
  const { data, error } = await supabase.from('public_upload_links').insert({
    workspace_id: currentWS.id, token, allow_msds: allowMsds, allow_license: allowLicense, created_by: user.id,
  }).select().single();
  if (error) { toast('발급 실패: ' + error.message, 'error'); return; }
  publicLink = data;
  renderPublicLinkUI();
  toast('공용 링크가 발급됐습니다', 'success');
};

window.copyPublicLink = function() {
  if (!publicLink) return;
  const url = `${window.location.origin}/upload.html?ptoken=${publicLink.token}`;
  copyLink(url);
};

window.revokePublicLink = async function() {
  if (!publicLink) return;
  if (!confirm('공용 링크를 삭제하면 더 이상 사용할 수 없습니다. 계속하시겠습니까?')) return;
  await supabase.from('public_upload_links').delete().eq('id', publicLink.id);
  publicLink = null;
  renderPublicLinkUI();
  toast('공용 링크가 삭제됐습니다');
};

window.updatePublicLinkSettings = async function() {
  if (!publicLink) return;
  const allowMsds = document.getElementById('publicLinkAllowMsdsEdit').checked;
  const allowLicense = document.getElementById('publicLinkAllowLicenseEdit').checked;
  if (!allowMsds && !allowLicense) {
    toast('최소 하나는 선택해야 합니다', 'error');
    document.getElementById('publicLinkAllowMsdsEdit').checked = publicLink.allow_msds;
    document.getElementById('publicLinkAllowLicenseEdit').checked = publicLink.allow_license;
    return;
  }
  const { error } = await supabase.from('public_upload_links')
    .update({ allow_msds: allowMsds, allow_license: allowLicense }).eq('id', publicLink.id);
  if (error) { toast('설정 변경 실패: ' + error.message, 'error'); return; }
  publicLink.allow_msds = allowMsds;
  publicLink.allow_license = allowLicense;
  toast('설정이 변경됐습니다', 'success');
};
// ═══════════════════════════════════════════════
// 검진 대상자 소팅
// ═══════════════════════════════════════════════
let sortingRows = [];

function parseSortingDate(val) {
  if (!val && val !== 0) return null;
  const s = String(val).trim();
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

function fmtDate(d) {
  if (!d) return '';
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}

function addMonths(d, n) {
  const r = new Date(d); r.setMonth(r.getMonth() + n); return r;
}

function diffDays(a, b) {
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

window.handleSortingExcel = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('sortingFileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!raw.length) { toast('데이터가 없습니다', 'error'); return; }

      const hKeys = Object.keys(raw[0]);
      const findKey = (...cands) => hKeys.find(h => cands.some(c => h.includes(c)));
      const kCon     = findKey('협력회사','협력사','업체');
      const kJob     = findKey('직종');
      const kName    = findKey('성명','이름');
      const kStatus  = findKey('재직상태','재직');
      const kJoin    = findKey('최초전입일','전입일','입사');
      const kGeneral = findKey('일반');
      const kSpecial = findKey('특수');
      const kPlace   = findKey('배치전');

      if (!kCon || !kName || !kStatus) { toast('필수 컬럼(협력회사/성명/재직상태)을 찾을 수 없습니다', 'error'); return; }

      const TODAY = new Date(); TODAY.setHours(0,0,0,0);
      const SPEC_ORDER = {'배치전검진 필요':0,'특수검진 기한초과':1,'특수검진 임박':2,'특수검진 주의':3,'정상':4};
      sortingRows = [];

      for (const r of raw) {
        const status = String(r[kStatus]||'').trim();
        if (status !== '재직') continue;
        const name = String(r[kName]||'').trim();
        if (!name) continue;

        const company   = String(r[kCon]||'').trim();
        const job       = String(r[kJob]||'').trim();
        const joinDate  = parseSortingDate(r[kJoin]);
        const generalD  = parseSortingDate(r[kGeneral]);
        const specialD  = parseSortingDate(r[kSpecial]);
        const placeD    = parseSortingDate(r[kPlace]);

        let basisD, nextD, basisLabel, specStatus, specRemain;
        if (specialD) { basisD=specialD; nextD=addMonths(basisD,12); basisLabel='특수(정기)'; }
        else if (placeD) { basisD=placeD; nextD=addMonths(basisD,6); basisLabel='배치전'; }
        else { basisD=null; nextD=null; basisLabel='-'; }

        if (!basisD) {
          specStatus='배치전검진 필요'; specRemain=null;
        } else {
          specRemain=diffDays(nextD,TODAY);
          if (specRemain<0) specStatus='특수검진 기한초과';
          else if (specRemain<=30) specStatus='특수검진 임박';
          else if (specRemain<=60) specStatus='특수검진 주의';
          else specStatus='정상';
        }

        let genStatus;
        if (generalD) {
          genStatus=(TODAY.getFullYear()-generalD.getFullYear())<=1?'정상':'일반검진 필요';
        } else {
          const daysIn=joinDate?diffDays(TODAY,joinDate):0;
          genStatus=daysIn>365?'일반검진 필요':'해당없음(입사 1년 미만)';
        }

        const needs=[];
        if (specStatus!=='정상') needs.push(specStatus==='배치전검진 필요'?'배치전검진':'특수검진');
        if (genStatus==='일반검진 필요') needs.push('일반검진');
        const action=needs.length?needs.join(' + '):'없음 (정상)';

        const descs=[];
        if (specStatus==='배치전검진 필요') descs.push('배치전검진을 아직 받지 않았습니다. 배치전검진부터 받아야 합니다.');
        else if (specStatus!=='정상'&&nextD) {
          const kw=specRemain<0?`기한이 ${Math.abs(specRemain)}일 지났습니다`:`예정일이 ${specRemain}일 남았습니다`;
          descs.push(`특수검진 ${kw}. (예정일 ${fmtDate(nextD)})`);
        }
        if (genStatus==='일반검진 필요') descs.push('일반건강검진이 필요합니다.'+(generalD?` (최근: ${fmtDate(generalD)})`:''));

        sortingRows.push({
          company, name, job, action,
          description: descs.join(' / ')||'정상',
          specStatus, basisDate:fmtDate(basisD), basisLabel,
          nextDate:fmtDate(nextD)||'-',
          specRemain:specRemain!==null?specRemain:'',
          generalDate:fmtDate(generalD), genStatus,
          _so:SPEC_ORDER[specStatus]??5,
          _sr:specRemain!==null?specRemain:9999,
        });
      }

      sortingRows.sort((a,b)=>
        a.company.localeCompare(b.company,'ko')||a._so-b._so||a._sr-b._sr||a.name.localeCompare(b.name,'ko')
      );

      renderSortingResult();
      toast(`${sortingRows.length}명 분석 완료`, 'success');
    } catch(err) { console.error(err); toast('파싱 실패: '+err.message,'error'); }
  };
  reader.readAsBinaryString(file);
};

function renderSortingResult() {
  const cnt=s=>sortingRows.filter(r=>r.specStatus===s).length;
  document.getElementById('sortStat0').textContent=cnt('배치전검진 필요');
  document.getElementById('sortStat1').textContent=cnt('특수검진 기한초과');
  document.getElementById('sortStat2').textContent=cnt('특수검진 임박');
  document.getElementById('sortStat3').textContent=cnt('특수검진 주의');
  document.getElementById('sortStat4').textContent=sortingRows.filter(r=>r.genStatus==='일반검진 필요').length;
  document.getElementById('sortingResultTitle').textContent=
    `재직자 ${sortingRows.length}명 분석 완료 (기준일: ${new Date().toLocaleDateString('ko-KR')})`;

  const SC={'배치전검진 필요':'#FF6B6B','특수검진 기한초과':'#FFC7CE','특수검진 임박':'#FFEB9C','특수검진 주의':'#FFF2CC','정상':'#C6EFCE'};
  const GC={'일반검진 필요':'#FFC7CE','정상':'#C6EFCE','해당없음(입사 1년 미만)':'#F2F2F2'};

  document.getElementById('sortingResultBody').innerHTML=sortingRows.map(r=>`<tr>
    <td>${r.company}</td><td>${r.name}</td><td>${r.job||'-'}</td>
    <td style="${r.action!=='없음 (정상)'?'font-weight:700;color:var(--danger);':'color:var(--text3);'}">${r.action}</td>
    <td style="background:${SC[r.specStatus]||''};">${r.specStatus}</td>
    <td>${r.basisDate||'-'}</td><td>${r.nextDate}</td>
    <td>${r.specRemain!==''?r.specRemain+'일':'-'}</td>
    <td>${r.generalDate||'-'}</td>
    <td style="background:${GC[r.genStatus]||''};">${r.genStatus}</td>
  </tr>`).join('');

  document.getElementById('sortingSummaryArea').style.display='';
}

window.downloadSortingExcel = function() {
  if (!sortingRows.length) { toast('분석된 데이터가 없습니다','error'); return; }
  const headers=['협력회사','성명','직종','지금 수검해야 할 것','설명',
    '특수검진 상태','특수검진 기준일','특수검진 기준구분',
    '특수검진 다음 예정일','특수검진 잔여일','일반검진 최근일','일반검진 상태'];
  const data=sortingRows.map(r=>[
    r.company,r.name,r.job,r.action,r.description,
    r.specStatus,r.basisDate,r.basisLabel,
    r.nextDate,r.specRemain!==''?r.specRemain:'',r.generalDate,r.genStatus,
  ]);

  const ws=XLSX.utils.aoa_to_sheet([headers,...data]);
  ws['!cols']=[18,10,18,26,52,18,13,12,16,10,13,18].map(w=>({wch:w}));
  ws['!autofilter']={ref:'A1:L1'};

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'검진대상자 소팅');

  const cnt=s=>sortingRows.filter(r=>r.specStatus===s).length;
  const sumData=[
    ['검진 현황 요약',''],['',''],['특수검진','건수'],
    ['배치전검진 필요',cnt('배치전검진 필요')],
    ['특수검진 기한초과',cnt('특수검진 기한초과')],
    ['특수검진 임박',cnt('특수검진 임박')],
    ['특수검진 주의',cnt('특수검진 주의')],
    ['정상',cnt('정상')],['',''],['일반건강검진','건수'],
    ['일반검진 필요',sortingRows.filter(r=>r.genStatus==='일반검진 필요').length],
    ['정상',sortingRows.filter(r=>r.genStatus==='정상').length],
    ['해당없음(입사 1년 미만)',sortingRows.filter(r=>r.genStatus==='해당없음(입사 1년 미만)').length],
    ['',''],
    [`총 재직자: ${sortingRows.length}명 / 기준일: ${new Date().toLocaleDateString('ko-KR')}`,''],
  ];
  const ws2=XLSX.utils.aoa_to_sheet(sumData);
  ws2['!cols']=[{wch:28},{wch:10}];
  XLSX.utils.book_append_sheet(wb,ws2,'요약');

  XLSX.writeFile(wb,`검진대상자_소팅_${today()}.xlsx`);
};
// ═══════════════════════════════════════════════
// 투입인원 (Manpower)
// ═══════════════════════════════════════════════
const MP_TYPE_COLORS = {
  "건축":"#2563eb","전기":"#d97706","설비":"#059669","공통":"#7c3aed",
  "토목":"#dc2626","자재":"#0891b2","기술":"#be185d","설계":"#78350f"
};
let mpMonth = '';        // 'YYYY-MM'
let mpRecords = [];      // 현재 월 DB rows
let mpSelected = new Set();
let mpFilter = '전체';

function mpSelStorageKey() { return `fms_mp_sel_${currentWS?.id||''}`; }
function mpDaysInMonth(ym) { const [y,m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }

function initManpowerPage() {
  if (!mpMonth) {
    const now = new Date();
    mpMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  const up = document.getElementById('mpUploadMonth');
  if (up && !up.value) up.value = mpMonth;
  loadManpower();
}

window.mpShiftMonth = function(delta) {
  const [y,m] = mpMonth.split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  mpMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  loadManpower();
};

async function loadManpower() {
  document.getElementById('mpMonthLabel').textContent = mpMonth.replace('-', '년 ') + '월';
  const start = `${mpMonth}-01`;
  const end = `${mpMonth}-${String(mpDaysInMonth(mpMonth)).padStart(2,'0')}`;
  const { data, error } = await supabase.from('manpower_records')
    .select('*').eq('workspace_id', currentWS.id)
    .gte('work_date', start).lte('work_date', end);
  if (error) { toast('투입인원 로드 실패: ' + error.message, 'error'); mpRecords = []; }
  else mpRecords = data || [];
  // 선택 복원 (저장분 ∩ 이번 달 실제 협력사), 없으면 전체 선택
  const companies = new Set(mpRecords.map(r => r.company));
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(mpSelStorageKey()) || '[]'); } catch {}
  const restored = saved.filter(c => companies.has(c));
  mpSelected = new Set(restored.length ? restored : companies);
  renderManpower();
}

function mpGrouped() {
  const map = new Map();
  for (const r of mpRecords) {
    if (!map.has(r.company)) map.set(r.company, { company: r.company, type: r.work_type || '기타', days: {} });
    map.get(r.company).days[new Date(r.work_date + 'T00:00:00').getDate()] = r.headcount;
  }
  return [...map.values()].sort((a,b) => a.company.localeCompare(b.company, 'ko'));
}

function mpActiveDays(groups) {
  const s = new Set();
  for (const g of groups) for (const [d,v] of Object.entries(g.days)) if (v > 0) s.add(Number(d));
  return [...s].sort((a,b)=>a-b);
}

function mpSaveSel() { localStorage.setItem(mpSelStorageKey(), JSON.stringify([...mpSelected])); }

function renderManpower() {
  const groups = mpGrouped();
  const activeDays = mpActiveDays(groups);
  const dailySums = {};
  for (const d of activeDays) dailySums[d] = groups.filter(g => mpSelected.has(g.company)).reduce((s,g) => s + (g.days[d]||0), 0);
  const totalSum = Object.values(dailySums).reduce((a,b)=>a+b,0);
  const daysWithWork = activeDays.filter(d => dailySums[d] > 0);
  const maxVal = Math.max(...Object.values(dailySums), 1);

  document.getElementById('mpSumCount').textContent = mpSelected.size;
  document.getElementById('mpSumTotal').textContent = totalSum.toLocaleString();
  document.getElementById('mpSumAvgLabel').textContent = `일평균 (${daysWithWork.length}일)`;
  document.getElementById('mpSumAvg').textContent = daysWithWork.length ? Math.round(totalSum / daysWithWork.length) : 0;
  document.getElementById('mpSelCount').textContent = `(${mpSelected.size}/${groups.length})`;

  const chartArea = document.getElementById('mpChartArea');
  if (!groups.length) {
    chartArea.innerHTML = '<div class="mp-empty">이 달에 저장된 데이터가 없습니다. 오른쪽 위에서 월을 선택하고 엑셀을 업로드하세요.</div>';
  } else if (!mpSelected.size) {
    chartArea.innerHTML = '<div class="mp-empty">왼쪽에서 협력사를 선택하세요</div>';
  } else {
    const bars = activeDays.map(d => {
      const v = dailySums[d] || 0;
      const h = Math.max((v / maxVal) * 130, v > 0 ? 4 : 0);
      const bg = v > 0 ? 'linear-gradient(180deg,#60a5fa,var(--primary))' : 'var(--surface2)';
      return `<div class="mp-bar-col"><div class="mp-bar-label" style="${v?'':'visibility:hidden'}">${v}</div><div class="mp-bar-body" style="height:${h}px;background:${bg}"></div></div>`;
    }).join('');
    const labels = activeDays.map(d => `<div class="mp-bar-day">${d}</div>`).join('');
    chartArea.innerHTML = `<div class="mp-bar-container">${bars}</div><div class="mp-bar-days">${labels}</div>`;
  }

  const detailCard = document.getElementById('mpDetailCard');
  if (groups.length && mpSelected.size) {
    detailCard.style.display = 'block';
    document.getElementById('mpDetailGrid').innerHTML = activeDays.map(d => {
      const v = dailySums[d] || 0;
      return `<div class="mp-detail-item" style="background:${v?'var(--primary-light)':'var(--surface2)'};border:1.5px solid ${v?'#bfdbfe':'var(--border)'}">
        <div class="mp-detail-day">${d}일</div><div class="mp-detail-val" style="color:${v?'var(--primary)':'var(--border2)'}">${v}</div></div>`;
    }).join('');
  } else detailCard.style.display = 'none';

  renderMpTypeFilters(groups);
  renderMpCompanyList();
}

function renderMpTypeFilters(groups) {
  groups = groups || mpGrouped();
  const present = new Set(groups.map(g => g.type));
  const types = ['전체', ...Object.keys(MP_TYPE_COLORS).filter(t => present.has(t)), ...[...present].filter(t => !MP_TYPE_COLORS[t])];
  document.getElementById('mpTypeFilters').innerHTML = types.map(t => {
    const color = MP_TYPE_COLORS[t] || 'var(--primary)';
    const on = mpFilter === t;
    return `<button class="mp-type-btn" onclick="mpSetFilter('${t.replace(/'/g,"\\'")}')" style="${on?`background:${color};border-color:${color};color:#fff;font-weight:700`:''}">${t}</button>`;
  }).join('');
}

window.mpSetFilter = function(t) { mpFilter = t; renderMpTypeFilters(); renderMpCompanyList(); };

window.renderMpCompanyList = function() {
  const q = document.getElementById('mpSearchInput').value.trim();
  const groups = mpGrouped().filter(g => g.company.includes(q) && (mpFilter === '전체' || g.type === mpFilter));
  const el = document.getElementById('mpCompanyList');
  if (!groups.length) { el.innerHTML = '<div class="mp-empty" style="padding:16px;">협력사가 없습니다</div>'; return; }
  el.innerHTML = groups.map(g => {
    const on = mpSelected.has(g.company);
    const color = MP_TYPE_COLORS[g.type] || '#64748b';
    return `<div class="mp-company-item" onclick="mpToggleCompany('${g.company.replace(/'/g,"\\'")}')" >
      <div class="mp-company-check" style="border-color:${on?color:'var(--border2)'};background:${on?color:'var(--surface)'}">${on?'✓':''}</div>
      <div class="mp-company-name">${g.company}</div>
      <span class="mp-type-badge" style="background:${color}18;color:${color}">${g.type}</span>
    </div>`;
  }).join('');
};

window.mpToggleCompany = function(c) {
  mpSelected.has(c) ? mpSelected.delete(c) : mpSelected.add(c);
  mpSaveSel(); renderManpower();
};
window.mpSelectAll = function() {
  const q = document.getElementById('mpSearchInput').value.trim();
  mpGrouped().filter(g => g.company.includes(q) && (mpFilter === '전체' || g.type === mpFilter)).forEach(g => mpSelected.add(g.company));
  mpSaveSel(); renderManpower();
};
window.mpClearSel = function() { mpSelected.clear(); mpSaveSel(); renderManpower(); };

// ── 엑셀 파싱 (협력사[공종] + 직종='전체' 행 + 1~31 일자 컬럼) ──
function parseMpXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        let headerIdx = -1;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].map(String);
          if (r.includes('협력사') && r.includes('직종') && r.some(c => /^1$/.test(c))) { headerIdx = i; break; }
        }
        if (headerIdx === -1) throw new Error('헤더 행(협력사·직종·일자)을 찾을 수 없습니다');
        const headers = rows[headerIdx].map(String);
        const companyIdx = headers.indexOf('협력사');
        const jobIdx = headers.indexOf('직종');
        const dayColumns = [];
        for (let c = 0; c < headers.length; c++) {
          const m = headers[c].match(/^(\d+)$/);
          if (m) { const d = parseInt(m[1]); if (d >= 1 && d <= 31) dayColumns.push({ col: c, day: d }); }
        }
        const data = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          if (String(row[jobIdx] || '').trim() !== '전체') continue;
          const rawCompany = String(row[companyIdx] || '').trim();
          if (!rawCompany) continue;
          const match = rawCompany.match(/^(.+?)\[(.+?)\]$/);
          const company = match ? match[1] : rawCompany;
          const type = match ? match[2] : '기타';
          const days = {};
          for (const { col, day } of dayColumns) { const v = Number(row[col]); if (!isNaN(v) && String(row[col]).trim() !== '') days[day] = v; }
          data.push({ company, type, days });
        }
        if (!data.length) throw new Error("'전체' 직종 행이 있는 협력사를 찾지 못했습니다");
        resolve(data);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

window.handleMpFile = async function(file) {
  if (!file) return;
  if (!file.name.match(/\.xlsx?$/i)) { toast('xlsx 파일만 지원됩니다', 'error'); return; }
  const month = document.getElementById('mpUploadMonth').value;
  if (!month) { toast('먼저 파일의 해당 월을 선택하세요', 'error'); return; }
  try {
    const parsed = await parseMpXlsx(file);
    const dim = mpDaysInMonth(month);
    // 같은 협력사가 여러 공종으로 나뉘어 여러 행에 등장하는 경우(예: "OO건설[건축]"+"OO건설[전기]")
    // company 기준으로는 동일 키가 되므로, upsert 전에 (협력사, 날짜) 단위로 합산 병합한다.
    // (병합 안 하면 같은 배치 안에 동일 충돌키가 두 번 들어가 Postgres가 'ON CONFLICT DO UPDATE
    //  command cannot affect row a second time' 오류를 낸다.)
    const merged = new Map(); // company -> { types:Set, days:{day:sum} }
    for (const p of parsed) {
      if (!merged.has(p.company)) merged.set(p.company, { types: new Set(), days: {} });
      const m = merged.get(p.company);
      if (p.type) m.types.add(p.type);
      for (const [d, v] of Object.entries(p.days)) m.days[d] = (m.days[d] || 0) + v;
    }
    const mergedCount = [...merged.values()].filter(m => m.types.size > 1).length;
    const upserts = [];
    for (const [company, m] of merged) {
      const type = [...m.types].slice(0, 3).join('/') || '기타';
      for (const [d, v] of Object.entries(m.days)) {
        const day = Number(d);
        if (day < 1 || day > dim) continue; // 존재하지 않는 날짜(예: 6월 31일)는 건너뜀
        upserts.push({
          workspace_id: currentWS.id,
          work_date: `${month}-${String(day).padStart(2,'0')}`,
          company, work_type: type, headcount: v,
          updated_at: new Date().toISOString()
        });
      }
    }
    if (!upserts.length) { toast('저장할 인원 데이터가 없습니다', 'error'); return; }
    toast(`저장 중... (${upserts.length}건)`);
    for (let i = 0; i < upserts.length; i += 500) {
      const { error } = await supabase.from('manpower_records')
        .upsert(upserts.slice(i, i + 500), { onConflict: 'workspace_id,work_date,company' });
      if (error) throw error;
    }
    toast(`${month} 투입인원 ${upserts.length}건 저장 완료${mergedCount ? ` (여러 공종 협력사 ${mergedCount}곳은 공수 합산 병합)` : ''}`, 'success');
    mpMonth = month;
    await loadManpower();
  } catch (err) {
    toast('업로드 실패: ' + (err?.message || err), 'error');
  }
};

window.deleteMpMonth = async function() {
  if (!mpRecords.length) { toast('삭제할 데이터가 없습니다', 'error'); return; }
  if (!confirm(`${mpMonth} 투입인원 데이터 ${mpRecords.length}건을 모두 삭제할까요?\n(엑셀을 다시 올리면 복구됩니다)`)) return;
  const start = `${mpMonth}-01`;
  const end = `${mpMonth}-${String(mpDaysInMonth(mpMonth)).padStart(2,'0')}`;
  const { error } = await supabase.from('manpower_records').delete()
    .eq('workspace_id', currentWS.id).gte('work_date', start).lte('work_date', end);
  if (error) { toast('삭제 실패: ' + error.message, 'error'); return; }
  toast('삭제됐습니다');
  await loadManpower();
};

// ═══════════════════════════════════════════════
// 알림 (협력사 재업로드 등)
// ═══════════════════════════════════════════════
let notifs = [];
let notifChannel = null;

async function loadNotifications() {
  const { data } = await supabase.from('notifications')
    .select('*').eq('workspace_id', currentWS.id)
    .order('created_at', { ascending: false }).limit(50);
  notifs = data || [];
}

function subscribeNotifications() {
  if (notifChannel) { supabase.removeChannel(notifChannel); notifChannel = null; }
  notifChannel = supabase.channel('notif-' + currentWS.id)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `workspace_id=eq.${currentWS.id}` },
      payload => {
        notifs.unshift(payload.new);
        toast(`🔁 ${payload.new.title} — ${payload.new.body || '재업로드 도착'}`, 'success');
        renderHomeDashboard();
        loadMsdsRecords(); // 버전업 반영
      })
    .subscribe();
}

window.markNotifRead = async function(id) {
  await supabase.from('notifications').update({ read: true }).eq('id', id);
  const n = notifs.find(x => x.id === id);
  if (n) n.read = true;
  renderHomeDashboard();
};

window.openNotifRecord = async function(notifId, recordId) {
  await window.markNotifRead(notifId);
  if (msdsRecords.some(r => r.id === recordId)) {
    showPage('msds');
    showMsdsDetail(recordId);
  }
};

// ═══════════════════════════════════════════════
// MSDS 재업로드 요청
// ═══════════════════════════════════════════════
window.requestReupload = async function(id) {
  const r = msdsRecords.find(x => x.id === id);
  if (!r) return;
  const reason = prompt(`'${r.product_name}' (${r.contractor})\n협력사에 전달할 재업로드 사유를 입력하세요.\n예) 최신 개정본 필요, 제출번호 누락, 스캔 상태 불량`, r.reupload_reason || '');
  if (reason === null) return;
  const { error } = await supabase.from('msds_records').update({
    reupload_requested: true,
    reupload_reason: reason.trim() || '재업로드 필요',
    reupload_requested_at: new Date().toISOString()
  }).eq('id', id);
  if (error) { toast('요청 실패: ' + error.message, 'error'); return; }
  r.reupload_requested = true; r.reupload_reason = reason.trim() || '재업로드 필요';
  renderMsdsTable();
  toast(`재업로드 요청됨 — ${r.contractor}가 업로드 링크에 접속하면 표시됩니다`, 'success');
};

window.cancelReupload = async function(id) {
  const r = msdsRecords.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`'${r.product_name}' 재업로드 요청을 취소할까요?`)) return;
  const { error } = await supabase.from('msds_records').update({
    reupload_requested: false, reupload_reason: null, reupload_requested_at: null
  }).eq('id', id);
  if (error) { toast('취소 실패: ' + error.message, 'error'); return; }
  r.reupload_requested = false;
  renderMsdsTable();
  toast('요청이 취소됐습니다');
};

// ═══════════════════════════════════════════════
// 혹서기 날씨 (예보 포스터 + 기상청 A48 예보)
// ═══════════════════════════════════════════════
const WX_REPO = 'dhdh09080/seongdongxi';
// 기상청 건설현장(A48) 기준: <31 파랑 / 31~34.9 주황 / 35↑ 빨강(옥외중지) / 38↑ 전면중지
function wxColor(fl) { return fl >= 35 ? '#ef4444' : fl >= 31 ? '#f97316' : '#3b82f6'; }
function wxStage(fl) {
  if (fl >= 38) return { label: '전면 작업중지', color: '#b91c1c' };
  if (fl >= 35) return { label: '옥외작업 중지', color: '#ef4444' };
  if (fl >= 33) return { label: '2시간마다 20분 휴식', color: '#f97316' };
  if (fl >= 31) return { label: '주의 · 휴식 준비', color: '#f59e0b' };
  return { label: '정상', color: '#3b82f6' };
}

let wxForecast = null;   // {hours:[{hour,feel}]} — 기상청 예보 (엣지펑션)
let wxTab = 'forecast';
let wxPosterCache = {};

async function fetchWxForecast() {
  const { data, error } = await supabase.functions.invoke('kma-senta', { body: {} });
  if (error || data?.error) throw new Error(error?.message || data.error);
  return data.result;
}

async function fetchWxPosterList(kind) {
  if (!wxPosterCache[kind]) {
    const res = await fetch(`https://api.github.com/repos/${WX_REPO}/contents/snapshots/${kind}`);
    if (!res.ok) throw new Error(res.status === 403 ? 'GitHub 조회 한도 초과 — 잠시 후 다시 시도하세요' : '포스터 목록 조회 실패');
    const files = await res.json();
    wxPosterCache[kind] = (files || [])
      .filter(f => /\.(png|jpe?g)$/i.test(f.name))
      .sort((a, b) => b.name.localeCompare(a.name));
  }
  return wxPosterCache[kind];
}

function wxHourlyHtml(fc) {
  const nowH = new Date(Date.now() + 9*3600*1000).getUTCHours();
  const cur = fc.hours.reduce((best, h) => Math.abs(h.hour - nowH) < Math.abs(best.hour - nowH) ? h : best, fc.hours[0]);
  const max = fc.hours.reduce((m, h) => h.feel > m.feel ? h : m, fc.hours[0]);
  const st = wxStage(cur.feel);
  const strip = fc.hours.map(h => `
    <div class="wx-hour" style="background:${wxColor(h.feel)};${h.hour===cur.hour?'outline:2.5px solid var(--text);':''}">
      <div class="wx-hour-t">${Math.round(h.feel)}°</div>
      <div class="wx-hour-h">${h.hour}시</div>
    </div>`).join('');
  return `
    <div class="wx-now" style="margin-bottom:8px;">
      <div class="wx-big" style="color:${wxColor(cur.feel)}">${cur.feel.toFixed(1)}°C</div>
      <div>
        <span class="wx-stage-badge" style="background:${st.color}">${st.label}</span>
        <div style="font-size:12px;color:var(--text2);margin-top:4px;">${cur.hour}시 예보 기준 · 오늘 최고 <b style="color:${wxColor(max.feel)}">${max.feel.toFixed(1)}°C</b> (${max.hour}시)</div>
      </div>
    </div>
    <div class="wx-hours">${strip}</div>
    <div style="font-size:11.5px;color:var(--text3);margin-top:8px;">기준: 체감 31°C↑ 주의 · 33°C↑ 매 2시간 20분 휴식 · 35°C↑ 옥외작업 중지 · 38°C↑ 전면중지 · 출처: 기상청 건설현장 체감온도(A48)</div>`;
}

async function loadDashWeather() {
  const card = document.getElementById('dashWeatherCard');
  const body = document.getElementById('dashWeatherBody');
  if (!card || !body) return;
  const head = `<div class="dash-section-header" style="margin-bottom:8px;"><div class="dash-section-title">☀️ 오늘 체감온도 예보</div><span style="font-size:12px;color:var(--text3);">혹서기 날씨 →</span></div>`;
  try {
    if (!wxForecast) wxForecast = await fetchWxForecast();
    card.style.display = 'block';
    body.innerHTML = head + wxHourlyHtml(wxForecast);
  } catch {
    // 엣지펑션 미배포/키 미설정 시 → 최신 예보 포스터 썸네일로 대체
    try {
      const list = await fetchWxPosterList('forecast');
      if (!list.length) { card.style.display = 'none'; return; }
      card.style.display = 'block';
      body.innerHTML = head + `<div style="display:flex;gap:12px;align-items:center;">
        <img src="${list[0].download_url}" style="width:120px;border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:13px;color:var(--text2);">최신 예보 포스터가 도착했어요.<br>클릭해서 크게 보고 카톡으로 공유하세요.</div>
      </div>`;
    } catch { card.style.display = 'none'; }
  }
}

window.loadWeatherPage = async function(force) {
  if (force) { wxForecast = null; wxPosterCache = {}; }
  // ① 최신 예보 포스터 크게
  const latest = document.getElementById('wxLatestPoster');
  try {
    const list = await fetchWxPosterList('forecast');
    if (list.length) {
      latest.innerHTML = `<img src="${list[0].download_url}" style="max-width:min(480px,100%);border-radius:12px;border:1.5px solid var(--border);cursor:pointer;" onclick="window.open('${list[0].download_url}','_blank')">
        <div style="font-size:12px;color:var(--text3);margin-top:6px;">${list[0].name} · 클릭하면 원본 (길게 눌러 카톡 공유)</div>`;
    } else latest.innerHTML = '<div class="mp-empty">예보 포스터가 아직 없습니다</div>';
  } catch (e) { latest.innerHTML = `<div class="mp-empty">${e.message}</div>`; }
  // ② 시간별 예보 (엣지펑션 있을 때만)
  const el = document.getElementById('wxTodayBody');
  try {
    if (!wxForecast) wxForecast = await fetchWxForecast();
    document.getElementById('wxHourlyCard').style.display = 'block';
    el.innerHTML = wxHourlyHtml(wxForecast);
  } catch (e) {
    el.innerHTML = `<div class="mp-empty" style="padding:14px;">시간별 예보 미사용 — kma-senta 엣지펑션 배포 + KMA_API_KEY 등록 시 표시됩니다<br><span style="font-size:11px;color:var(--text3);">(${e.message})</span></div>`;
  }
  // ③ 아카이브
  loadWxPosters(force);
};

async function loadWxPosters() {
  const grid = document.getElementById('wxPosterGrid');
  document.getElementById('wxTabForecast').className = 'btn btn-sm ' + (wxTab==='forecast'?'btn-primary':'btn-secondary');
  document.getElementById('wxTabDaily').className = 'btn btn-sm ' + (wxTab==='daily'?'btn-primary':'btn-secondary');
  try {
    const list = (await fetchWxPosterList(wxTab)).slice(0, 30);
    if (!list.length) { grid.innerHTML = '<div class="mp-empty">포스터가 없습니다</div>'; return; }
    grid.innerHTML = list.map(f => {
      const m = f.name.match(/(\d{4})(\d{2})(\d{2})[_-]?(\d{2})?(\d{2})?/);
      const label = m ? `${m[1]}.${m[2]}.${m[3]}${m[4] ? ` ${m[4]}:${m[5]||'00'}` : ''}` : f.name;
      return `<div class="wx-poster" onclick="window.open('${f.download_url}','_blank')">
        <img src="${f.download_url}" loading="lazy" alt="${label}">
        <div class="wx-poster-label">${label}</div>
      </div>`;
    }).join('');
  } catch (e) { grid.innerHTML = `<div class="mp-empty">${e.message}</div>`; }
}
window.wxSetTab = function(t) { wxTab = t; loadWxPosters(); };

// ═══════════════════════════════════════════════
// 취약자 명단 (전입 5일 / 혈압 소견 / 고령자)
// ═══════════════════════════════════════════════
let vulGroups = null; // {g1,g2,g3, baseDate}
const VUL_DEFS = [
  { key:'g1', title:'전입 5일 이내 근로자', sub:'열순응 프로그램 적용 · 배치전 검진 확인', color:'#1d4ed8', fname:'전입5일이내' },
  { key:'g2', title:'혈압 관련 소견자', sub:'고온 작업 배치 시 특별 주의 · 우선 보호', color:'#c2410c', fname:'혈압소견자' },
  { key:'g3', title:'고령 근로자 (만 60세 이상)', sub:'폭염·중량물 작업 시 우선 보호 대상', color:'#6d28d9', fname:'고령근로자' },
];

window.handleVulFile = function(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const active = rows.filter(r => String(r['재직상태']||'').trim() === '재직');
      if (!active.length) throw new Error("'재직상태' 컬럼에서 재직자를 찾지 못했습니다 — 건강진단 목록 원본 엑셀인지 확인하세요");
      const now = new Date();
      const g1 = active.filter(r => {
        const d = new Date(r['최초전입일']);
        return !isNaN(d) && (now - d) / 86400000 <= 5;
      });
      const g2 = active.filter(r => /혈압|고혈압/.test(String(r['메모']||'')) || String(r['혈압']||'').trim() === 'Y');
      const g3 = active.filter(r => String(r['고령근로자여부']||'').trim() === 'Y' || String(r['만나이']||'').includes('고령'));
      const byName = (a,b) => String(a['협력회사']).localeCompare(String(b['협력회사']),'ko') || String(a['성명']).localeCompare(String(b['성명']),'ko');
      vulGroups = { g1: g1.sort(byName), g2: g2.sort(byName), g3: g3.sort(byName), baseDate: today() };
      renderVulGroups();
      toast(`재직 ${active.length}명 분석 완료`, 'success');
    } catch (err) { toast('분석 실패: ' + err.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
};

function vulAge(r) { return String(r['만나이']||'').replace('(고령자)','').trim(); }

function renderVulGroups() {
  const { g1, g2, g3, baseDate } = vulGroups;
  document.getElementById('vulEmpty').style.display = 'none';
  document.getElementById('vulResult').style.display = 'block';
  document.getElementById('vulExcelBtn').style.display = 'inline-block';
  document.getElementById('vulCnt1').textContent = g1.length;
  document.getElementById('vulCnt2').textContent = g2.length;
  document.getElementById('vulCnt3').textContent = g3.length;
  const groups = { g1, g2, g3 };
  document.getElementById('vulGroups').innerHTML = VUL_DEFS.map(def => {
    const rows = groups[def.key];
    const body = rows.length ? rows.map((r, i) => `<tr>
        <td style="text-align:center;color:var(--text3);">${i+1}</td>
        <td>${r['협력회사']||'-'}</td>
        <td style="font-weight:700;">${r['성명']||'-'}</td>
        <td>${r['직종']||'-'}</td>
        <td style="color:${def.color};font-weight:700;">${vulAge(r)}</td>
        <td>${r['국적']||'-'}</td>
        <td>${def.key==='g1' ? (String(r['최초전입일']).split(' ')[0]||'-') : (String(r['혈압']).trim()==='Y'?'혈압 Y':'-')}</td>
        <td style="font-size:11.5px;color:var(--text2);">${String(r['메모']||'').slice(0,30)}</td>
      </tr>`).join('') : `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:14px;">해당 없음</td></tr>`;
    return `<div class="card vul-card" style="border-top-color:${def.color};">
      <div class="dash-section-header">
        <div>
          <div class="dash-section-title" style="color:${def.color};">${def.title} <span style="color:var(--text3);font-weight:400;font-size:13px;">${rows.length}명 · 기준일 ${baseDate}</span></div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">${def.sub}</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="downloadVulImage('${def.key}')" ${rows.length?'':'disabled'}>📷 카톡용 이미지</button>
      </div>
      <div id="vulCapture-${def.key}" style="background:#fff;padding:6px 2px;">
        <div style="display:none;font-weight:800;font-size:16px;color:${def.color};padding:8px 6px;" class="vul-cap-title">${def.title} — ${rows.length}명 (기준일 ${baseDate}) · 성동자이리버뷰</div>
        <table class="vul-table">
          <thead><tr><th style="width:30px;">No</th><th>협력회사</th><th>성명</th><th>직종</th><th>나이</th><th>국적</th><th>${VUL_DEFS[0].key==='g1'?'':''}${def.key==='g1'?'전입일':'혈압'}</th><th>메모</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

window.downloadVulImage = async function(key) {
  const el = document.getElementById('vulCapture-' + key);
  if (!el || typeof html2canvas === 'undefined') { toast('이미지 모듈 로드 실패 — 새로고침 후 시도하세요', 'error'); return; }
  const title = el.querySelector('.vul-cap-title');
  title.style.display = 'block';
  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
    const def = VUL_DEFS.find(d => d.key === key);
    const a = document.createElement('a');
    a.download = `${def.fname}_${vulGroups.baseDate}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    toast('이미지가 저장됐습니다 — 카톡에 바로 올리세요', 'success');
  } catch (e) { toast('이미지 생성 실패: ' + e.message, 'error'); }
  title.style.display = 'none';
};

window.downloadVulSignSheet = function() {
  if (!vulGroups) return;
  const wb = XLSX.utils.book_new();
  const groups = { g1: vulGroups.g1, g2: vulGroups.g2, g3: vulGroups.g3 };
  VUL_DEFS.forEach(def => {
    const rows = groups[def.key];
    const aoa = [
      [`${def.title} 확인 서명대지`],
      [`현장: 성동자이리버뷰 · 기준일: ${vulGroups.baseDate} · 대상 ${rows.length}명`],
      [],
      ['No', '협력회사', '성명', '직종', '나이', '국적', '서명'],
      ...rows.map((r, i) => [i+1, r['협력회사']||'', r['성명']||'', r['직종']||'', vulAge(r), r['국적']||'', '']),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:5},{wch:16},{wch:10},{wch:12},{wch:8},{wch:8},{wch:22}];
    ws['!merges'] = [ {s:{r:0,c:0},e:{r:0,c:6}}, {s:{r:1,c:0},e:{r:1,c:6}} ];
    ws['!rows'] = aoa.map((_, i) => ({ hpt: i >= 4 ? 26 : undefined })); // 서명 공간 확보
    XLSX.utils.book_append_sheet(wb, ws, def.fname.slice(0, 28));
  });
  XLSX.writeFile(wb, `취약자_서명대지_${vulGroups.baseDate}.xlsx`);
  toast('서명대지 엑셀 저장 완료 (그룹별 3개 시트)', 'success');
};

// ═══════════════════════════════════════════════
// KOSHA 화학물질정보 연계
// ═══════════════════════════════════════════════
window.openKosha = function(cas) {
  const c = (cas || '').trim();
  if (c) {
    navigator.clipboard?.writeText(c).then(
      () => toast(`CAS ${c} 복사됨 — KOSHA 검색창에 붙여넣으세요`, 'success'),
      () => {}
    );
  }
  window.open('https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchAll.do', '_blank');
};

// ═══════════════════════════════════════════════
// 고령자 혈압측정 (매주 월·화)
// ═══════════════════════════════════════════════
let bpList = null; // 고령자 rows
let bpBaseDate = null;

function extractElderly(activeRows) {
  return activeRows
    .filter(r => String(r['고령근로자여부']||'').trim() === 'Y' || String(r['만나이']||'').includes('고령'))
    .sort((a,b) => String(a['협력회사']).localeCompare(String(b['협력회사']),'ko') || String(a['성명']).localeCompare(String(b['성명']),'ko'));
}

window.handleBpFile = function(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const active = rows.filter(r => String(r['재직상태']||'').trim() === '재직');
      if (!active.length) throw new Error("'재직상태' 컬럼에서 재직자를 찾지 못했습니다");
      bpList = extractElderly(active);
      bpBaseDate = today();
      renderBpPage();
      toast(`고령근로자 ${bpList.length}명 추출 완료`, 'success');
    } catch (err) { toast('분석 실패: ' + err.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
};

function initBpPage() {
  // 취약자 명단에서 이미 분석했으면 이어받기
  if (!bpList && vulGroups?.g3?.length) { bpList = vulGroups.g3; bpBaseDate = vulGroups.baseDate; }
  // 이번 주 월요일 기본값
  const inp = document.getElementById('bpMonday');
  if (inp && !inp.value) {
    const d = new Date();
    const day = d.getDay(); // 0=일
    d.setDate(d.getDate() - ((day + 6) % 7)); // 이번 주 월요일
    inp.value = d.toISOString().slice(0, 10);
  }
  if (bpList) renderBpPage();
}

function renderBpPage() {
  if (!bpList) return;
  document.getElementById('bpEmpty').style.display = 'none';
  document.getElementById('bpResult').style.display = 'block';
  document.getElementById('bpSheetBtn').style.display = 'inline-block';
  document.getElementById('bpCount').textContent = `${bpList.length}명 · 기준일 ${bpBaseDate}`;
  document.getElementById('bpTableBody').innerHTML = bpList.length ? bpList.map((r, i) => `<tr>
      <td style="text-align:center;color:var(--text3);">${i+1}</td>
      <td>${r['협력회사']||'-'}</td>
      <td style="font-weight:700;">${r['성명']||'-'}</td>
      <td>${r['직종']||'-'}</td>
      <td style="color:#6d28d9;font-weight:700;">${vulAge(r)}</td>
      <td>${r['국적']||'-'}</td>
      <td style="text-align:center;">${String(r['혈압']||'').trim()==='Y' ? '<b style="color:var(--danger)">Y</b>' : '-'}</td>
      <td style="font-size:11.5px;color:var(--text2);">${String(r['메모']||'').slice(0,26)}</td>
    </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:14px;">고령근로자가 없습니다</td></tr>';
}

window.downloadBpImage = async function() {
  const el = document.getElementById('bpCapture');
  if (!el || typeof html2canvas === 'undefined') { toast('이미지 모듈 로드 실패 — 새로고침 후 시도하세요', 'error'); return; }
  const t = document.getElementById('bpCapTitle');
  t.textContent = `🩺 고령근로자 혈압측정 대상 명단 — ${bpList.length}명 (매주 월·화 측정 · 기준일 ${bpBaseDate}) · 성동자이리버뷰`;
  t.style.display = 'block';
  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
    const a = document.createElement('a');
    a.download = `고령자_혈압측정명단_${bpBaseDate}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    toast('이미지 저장 완료 — 카톡에 올리세요', 'success');
  } catch (e) { toast('이미지 생성 실패: ' + e.message, 'error'); }
  t.style.display = 'none';
};

window.downloadBpSheet = function() {
  if (!bpList?.length) { toast('고령근로자 명단이 없습니다', 'error'); return; }
  const mon = document.getElementById('bpMonday').value;
  if (!mon) { toast('측정 주간의 월요일을 선택하세요', 'error'); return; }
  const monD = new Date(mon + 'T00:00:00');
  const tueD = new Date(monD.getTime() + 86400000);
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
  const aoa = [
    ['고령근로자 주간 혈압측정 기록지'],
    [`현장: 성동자이리버뷰 · 측정주간: ${fmt(monD)}(월) ~ ${fmt(tueD)}(화) · 대상 ${bpList.length}명`],
    [],
    ['No','협력회사','성명','직종','나이', `${fmt(monD)}(월) 혈압`, '서명', `${fmt(tueD)}(화) 혈압`, '서명'],
    ...bpList.map((r, i) => [i+1, r['협력회사']||'', r['성명']||'', r['직종']||'', vulAge(r), '', '', '', '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:5},{wch:15},{wch:9},{wch:11},{wch:7},{wch:13},{wch:12},{wch:13},{wch:12}];
  ws['!merges'] = [ {s:{r:0,c:0},e:{r:0,c:8}}, {s:{r:1,c:0},e:{r:1,c:8}} ];
  ws['!rows'] = aoa.map((_, i) => ({ hpt: i >= 4 ? 27 : undefined }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '혈압측정');
  XLSX.writeFile(wb, `고령자_혈압측정기록지_${mon}.xlsx`);
  toast('측정 기록지 저장 완료 (월·화 혈압/서명란 포함)', 'success');
};

// ═══════════════════════════════════════════════
// KOSHA 물질 검색 (kosha-search 엣지펑션)
// ═══════════════════════════════════════════════
window.openKoshaSearch = function() {
  document.getElementById('koshaResults').innerHTML = '<div class="mp-empty" style="padding:20px;">검색어를 입력하세요</div>';
  openModal('koshaModal');
  setTimeout(() => document.getElementById('koshaQuery')?.focus(), 100);
};

window.runKoshaSearch = async function() {
  const q = document.getElementById('koshaQuery').value.trim();
  const mode = document.getElementById('koshaMode').value;
  const out = document.getElementById('koshaResults');
  const btn = document.getElementById('koshaSearchBtn');
  if (!q) { toast('검색어를 입력하세요', 'error'); return; }
  btn.disabled = true; btn.textContent = '검색 중...';
  out.innerHTML = '<div class="mp-empty" style="padding:20px;">KOSHA 데이터베이스 조회 중...</div>';
  try {
    const { data, error } = await supabase.functions.invoke('kosha-search', { body: { query: q, mode } });
    if (error || data?.error) throw new Error(error?.message || data.error);
    const { list, firstDetail } = data.result;
    if (!list.length) { out.innerHTML = '<div class="mp-empty" style="padding:20px;">검색 결과가 없습니다 — 다른 이름이나 CAS로 시도해보세요</div>'; return; }
    out.innerHTML = list.map((c, i) => `
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <b style="font-size:14px;">${c.name}</b>
          <span class="badge badge-gray">CAS ${c.casNo||'-'}</span>
          ${c.keNo ? `<span class="badge badge-gray">${c.keNo}</span>` : ''}
          <a href="https://msds.kosha.or.kr/MSDSInfo/kcic/msdsdetail.do?chem_id=${c.chemId}" target="_blank" class="btn btn-outline btn-sm" style="margin-left:auto;">KOSHA 원문 →</a>
        </div>
        ${i === 0 && firstDetail?.lines?.length ? `<div style="margin-top:8px;font-size:12px;color:var(--text2);border-top:1px dashed var(--border);padding-top:8px;">${firstDetail.lines.map(l => `<div style="padding:2px 0;">· ${l}</div>`).join('')}</div>` : ''}
      </div>`).join('');
  } catch (e) {
    out.innerHTML = `<div class="mp-empty" style="padding:20px;">${e.message}</div>`;
  } finally { btn.disabled = false; btn.textContent = '검색'; }
};

// ═══════════════════════════════════════════════
// 자료실: 법령 검색 (법제처) + KOSHA GUIDE 카탈로그
// ═══════════════════════════════════════════════
window.lawQuick = function(q) {
  document.getElementById('lawQuery').value = q;
  runLawSearch();
};

window.runLawSearch = async function() {
  const q = document.getElementById('lawQuery').value.trim();
  const out = document.getElementById('lawResults');
  const btn = document.getElementById('lawSearchBtn');
  if (!q) { toast('법령명을 입력하세요', 'error'); return; }
  btn.disabled = true; btn.textContent = '검색 중...';
  out.innerHTML = '<div class="mp-empty" style="padding:16px;">법제처 조회 중...</div>';
  try {
    const { data, error } = await supabase.functions.invoke('law-search', { body: { query: q } });
    if (error || data?.error) throw new Error(error?.message || data.error);
    const { list, totalCnt, oc } = data.result;
    if (!list.length) { out.innerHTML = '<div class="mp-empty" style="padding:16px;">검색 결과가 없습니다</div>'; return; }
    out.innerHTML = `<div style="font-size:12px;color:var(--text3);margin-bottom:8px;">총 ${totalCnt}건 · 시행일 최신순${oc==='test' ? ' · 공용 계정(test) 사용 중 — 안정적 사용을 위해 open.law.go.kr에서 무료 OC 발급 권장' : ''}</div>` +
      list.map(l => `
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <b style="font-size:14px;">${l.name}</b>
          ${l.abbr ? `<span style="font-size:12px;color:var(--text3);">(${l.abbr})</span>` : ''}
          <span class="badge badge-gray">${l.kind}</span>
          ${l.link ? `<a href="${l.link}" target="_blank" class="btn btn-outline btn-sm" style="margin-left:auto;">원문 보기 →</a>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text2);margin-top:4px;">
          시행 <b>${l.efDate}</b> · 공포 ${l.ancDate} · ${l.revision} · ${l.dept}
        </div>
      </div>`).join('');
  } catch (e) {
    out.innerHTML = `<div class="mp-empty" style="padding:16px;">${e.message}<br><span style="font-size:11px;">law-search 엣지펑션 배포 여부를 확인하세요 (supabase functions deploy law-search)</span></div>`;
  } finally { btn.disabled = false; btn.textContent = '검색'; }
};

// ── KOSHA GUIDE ──
let kgCatalog = null; // [{guide_no,title,committee,category,code}]

async function loadKgCatalog() {
  if (kgCatalog) return;
  const { data, error } = await supabase.from('kosha_guides')
    .select('guide_no,title,committee,category,code').eq('workspace_id', currentWS.id).order('guide_no');
  kgCatalog = error ? [] : (data || []);
}

async function initLibraryPage() {
  await loadKgCatalog();
  document.getElementById('kgCount').textContent = kgCatalog.length ? `(${kgCatalog.length}건 등록됨)` : '';
  document.getElementById('kgSetup').style.display = kgCatalog.length ? 'none' : 'block';
  renderKgResults();
}

window.kgQuick = function(q) {
  document.getElementById('kgQuery').value = q;
  renderKgResults();
};

function kgKoshaLink(q) {
  // KOSHA 기술지침 공식 검색 페이지 딥링크 (검색어는 자동 복사)
  return `navigator.clipboard&&navigator.clipboard.writeText('${q.replace(/'/g,"\\'")}');window.open('https://www.kosha.or.kr/kosha/info/searchTechnicalGuidelines.do','_blank');toast('검색어가 복사됐습니다 — KOSHA 검색창에 붙여넣으세요','success')`;
}

window.renderKgResults = function() {
  const out = document.getElementById('kgResults');
  const q = (document.getElementById('kgQuery').value || '').trim().toLowerCase();
  if (!kgCatalog || !kgCatalog.length) {
    out.innerHTML = `<div class="mp-empty" style="padding:16px;">카탈로그가 아직 없어요 — 위에서 공식 CSV를 올리면 앱 안에서 검색됩니다.<br>지금은 주제 버튼을 누르면 KOSHA 공식 검색으로 연결돼요.</div>`;
    // 카탈로그 없으면 토픽 버튼이 외부 검색으로 동작
    document.querySelectorAll('#kgTopics button').forEach(b => {
      const kw = b.textContent.replace(/^[^\s]+\s/, '');
      b.setAttribute('onclick', kgKoshaLink(kw));
    });
    return;
  }
  document.querySelectorAll('#kgTopics button').forEach(b => {
    const kw = b.textContent.replace(/^[^\s]+\s/, '');
    b.setAttribute('onclick', `kgQuick('${kw}')`);
  });
  const list = !q ? kgCatalog.slice(0, 50)
    : kgCatalog.filter(g => [g.guide_no, g.title, g.category, g.committee, g.code].join(' ').toLowerCase().includes(q)).slice(0, 100);
  if (!list.length) { out.innerHTML = '<div class="mp-empty" style="padding:16px;">검색 결과가 없습니다</div>'; return; }
  out.innerHTML = (!q ? `<div style="font-size:12px;color:var(--text3);margin-bottom:6px;">전체 ${kgCatalog.length}건 중 앞 50건 — 검색어를 입력해 좁혀보세요</div>` : '') +
    list.map(g => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);">
      <span class="badge badge-primary" style="flex-shrink:0;font-family:monospace;">${g.guide_no}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;">${g.title}</div>
        <div style="font-size:11px;color:var(--text3);">${[g.committee, g.category].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="btn btn-outline btn-sm" style="flex-shrink:0;" onclick="${kgKoshaLink(g.guide_no)}">원문 찾기</button>
    </div>`).join('');
};

window.handleKgFile = function(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      // 공식 CSV 컬럼: 연번/위원회/등록일/분류기호/분류내용/공표순/년도/지침번호/명칭
      const items = rows.map(r => ({
        workspace_id: currentWS.id,
        guide_no: String(r['지침번호'] || '').trim(),
        title: String(r['명칭'] || '').trim(),
        committee: String(r['위원회'] || '').trim(),
        category: String(r['분류내용'] || '').trim(),
        code: String(r['분류기호'] || '').trim(),
        reg_date: String(r['등록일'] || '').trim(),
      })).filter(x => x.guide_no && x.title);
      if (!items.length) throw new Error("'지침번호'와 '명칭' 컬럼을 찾지 못했습니다 — data.go.kr의 공식 KOSHA Guide 목록 CSV인지 확인하세요");
      toast(`저장 중... (${items.length}건)`);
      for (let i = 0; i < items.length; i += 500) {
        const { error } = await supabase.from('kosha_guides')
          .upsert(items.slice(i, i + 500), { onConflict: 'workspace_id,guide_no' });
        if (error) throw error;
      }
      kgCatalog = null;
      await initLibraryPage();
      toast(`KOSHA GUIDE ${items.length}건 등록 완료 — 팀 전체가 검색할 수 있어요`, 'success');
    } catch (err) { toast('업로드 실패: ' + (err?.message || err), 'error'); }
  };
  reader.readAsArrayBuffer(file);
};

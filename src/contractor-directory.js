import { createClient } from '@supabase/supabase-js';
import './contractor-portal.css';
import './contractor-directory.css';
const db = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (url, options = {}) => fetch(url, {...options, signal: options.signal || AbortSignal.timeout(20000)}) },
});
const token = new URLSearchParams(location.search).get('dtoken') || '';
const el = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let contractors = [], loading = false;
function errorText(error) {
  if (/invalid or expired/.test(error.message)) return '만료되었거나 해제된 목록 링크입니다. 현장 담당자에게 새 링크를 요청해주세요.';
  if (/already exists/.test(error.message)) return '이미 등록된 협력사입니다. 목록에서 협력사명을 검색해주세요.';
  if (/invalid contact/.test(error.message)) return '관리자명과 전화번호를 확인해주세요. 전화번호는 숫자, +, 괄호, 하이픈으로 입력할 수 있습니다.';
  return '저장하거나 불러오지 못했습니다. 연결을 확인하고 다시 시도해주세요.';
}
async function refresh() {
  if (loading) return false;
  loading = true; el('directoryRefresh').disabled = true;
  try {
    if (!token) throw new Error('invalid or expired');
    const {data,error} = await db.rpc('get_contractor_directory',{p_token:token});
    if (error) throw error;
    contractors = data.contractors || [];
    document.title = `${data.workspace.name} 전체 협력사 리스트`;
    el('directoryTitle').textContent = document.title;
    el('directoryError').hidden = true; el('directoryContent').hidden = false;
    render(); return true;
  } catch (error) {
    if (/invalid or expired/.test(error.message)) el('directoryContent').hidden = true;
    el('directoryError').textContent = errorText(error); el('directoryError').hidden = false; return false;
  } finally { loading = false; el('directoryLoading').hidden = true; el('directoryRefresh').disabled = false; }
}
function render() {
  const q = el('directorySearch').value.trim().toLowerCase(), filter = el('directoryFilter').value;
  const list = contractors.filter(c => (!q || [c.name,c.manager_name,c.manager_phone].some(v => (v || '').toLowerCase().includes(q)))
    && (filter !== 'license' || !c.license_submitted) && (filter !== 'msds' || !c.msds_count));
  el('directoryTotal').textContent = `${contractors.length}개사`;
  el('directoryLicenseTotal').textContent = `${contractors.filter(c=>c.license_submitted).length}개사`;
  el('directoryMsdsTotal').textContent = `${contractors.filter(c=>c.msds_count>0).length}개사`;
  el('directoryResultCount').textContent = `전체 ${contractors.length}개사 중 ${list.length}개사`;
  el('directoryList').innerHTML = list.length ? list.map(c => `<tr><td data-label="협력사명"><a class="directory-company" href="/upload.html?dtoken=${encodeURIComponent(token)}&contractor_id=${encodeURIComponent(c.id)}">${escape(c.name)} <span aria-hidden="true">↗</span></a></td><td data-label="사업자등록증"><div class="directory-document-actions"><span class="directory-badge ${c.license_submitted?'done':''}">${c.license_submitted?'제출 완료':'미제출'}</span>${!c.license_submitted ? `<a class="btn btn-secondary directory-register-license" href="/upload.html?dtoken=${encodeURIComponent(token)}&contractor_id=${encodeURIComponent(c.id)}&panel=license" aria-label="${escape(c.name)} 사업자등록증 등록하기">등록하기</a>` : ''}</div></td><td data-label="MSDS"><div class="directory-document-actions"><span class="directory-badge ${c.msds_count>0?'done':''}">${c.msds_count>0?`제출 완료 · ${c.msds_count}건`:'미제출'}</span><a class="btn btn-secondary directory-add-msds" href="/upload.html?dtoken=${encodeURIComponent(token)}&contractor_id=${encodeURIComponent(c.id)}&panel=upload" aria-label="${escape(c.name)} MSDS 추가" title="MSDS 추가">+</a></div></td><td data-label="관리자명">${escape(c.manager_name || '미등록')}</td><td data-label="전화번호">${c.manager_phone ? `<a href="tel:${escape(c.manager_phone.replace(/[^+0-9]/g,''))}">${escape(c.manager_phone)}</a>`:'미등록'}</td><td data-label="관리"><button class="btn btn-secondary" data-edit="${escape(c.id)}" aria-label="${escape(c.name)} 연락처 수정">수정</button></td></tr>`).join('') : '<tr><td colspan="6" class="portal-empty">조건에 맞는 협력사가 없습니다. 협력사 등록하기로 추가할 수 있습니다.</td></tr>';
}
function openForm(id='') {
  const c=contractors.find(c=>c.id===id);
  el('directoryEditingId').value=id; el('directoryName').value=c?.name || ''; el('directoryName').readOnly=Boolean(c);
  el('directoryManager').value=c?.manager_name || ''; el('directoryPhone').value=c?.manager_phone || '';
  el('directoryFormTitle').textContent=c?'협력사 연락처 수정':'협력사 등록하기'; el('directorySave').textContent=c?'저장하기':'등록하기';
  el('directoryFormError').textContent=''; el('directoryDialog').showModal();
  (c?el('directoryManager'):el('directoryName')).focus();
}
el('directoryRegister').addEventListener('click',()=>openForm());
el('directoryCancel').addEventListener('click',()=>el('directoryDialog').close());
el('directoryList').addEventListener('click',e=>{ const btn=e.target.closest('[data-edit]'); if(btn) openForm(btn.dataset.edit); });
el('directorySearch').addEventListener('input',render);
el('directoryFilter').addEventListener('change',render);
el('directoryRefresh').addEventListener('click',refresh);
window.addEventListener('pageshow',e=>{if(e.persisted)refresh();});
el('directoryForm').addEventListener('submit',async e=>{
  e.preventDefault(); el('directorySave').disabled=true; el('directoryFormError').textContent='';
  try {
    const {data:id,error}=await db.rpc('save_directory_contractor',{p_token:token,p_contractor_id:el('directoryEditingId').value||null,
      p_name:el('directoryName').value.trim(),p_manager_name:el('directoryManager').value.trim(),p_manager_phone:el('directoryPhone').value.trim()});
    if(error)throw error;
    el('directoryDialog').close();
    el('directorySearch').value=''; el('directoryFilter').value='all'; await refresh();
    const btn=[...document.querySelectorAll('[data-edit]')].find(btn=>btn.dataset.edit===id); btn?.focus();
  } catch(error){el('directoryFormError').textContent=errorText(error);}
  finally{el('directorySave').disabled=false;}
});
refresh();

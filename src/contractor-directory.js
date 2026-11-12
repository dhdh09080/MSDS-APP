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
  el('directoryResultCount').textContent = q || filter!=='all' ? `검색된 업체 ${list.length}곳` : `전체 업체 ${contractors.length}곳`;
  el('directoryClear').hidden=!q && filter==='all';
  el('directoryList').innerHTML = list.length ? list.map(c => {
    const base=`/upload.html?dtoken=${encodeURIComponent(token)}&contractor_id=${encodeURIComponent(c.id)}`;
    return `<li class="directory-company-card"><div class="directory-company-main"><h3>${escape(c.name)}</h3><a class="btn btn-primary directory-open-workspace" href="${base}" aria-label="${escape(c.name)} 업체 페이지 열기">업체 페이지 열기 <span aria-hidden="true">→</span></a></div><details class="directory-company-details"><summary aria-label="${escape(c.name)} 서류·연락처 보기">서류·연락처 보기</summary><div class="directory-detail-content"><section><h4>MSDS</h4><p>${c.msds_count>0?`등록된 자료 ${Number(c.msds_count)}건`:'아직 등록된 자료가 없습니다'}</p><div class="directory-detail-actions"><a href="${base}&panel=records" aria-label="${escape(c.name)} MSDS 보기·인쇄">MSDS 보기·인쇄</a><a class="directory-add-msds" href="${base}&panel=upload" aria-label="${escape(c.name)} MSDS 추가">MSDS 추가</a><a href="${base}&panel=warnings" aria-label="${escape(c.name)} 경고표지 인쇄">경고표지 인쇄</a></div></section><section><h4>사업자등록증</h4><p>${c.license_submitted?'제출 완료':'미제출'}</p>${!c.license_submitted?`<a class="directory-register-license" href="${base}&panel=license" aria-label="${escape(c.name)} 사업자등록증 등록하기">사업자등록증 등록하기</a>`:''}</section><section><h4>담당자 연락처</h4><p>${escape(c.manager_name || '담당자 미등록')}</p>${c.manager_phone?`<a href="tel:${escape(c.manager_phone.replace(/[^+0-9]/g,''))}">${escape(c.manager_phone)}</a>`:'<p>전화번호 미등록</p>'}<button type="button" class="btn btn-secondary" data-edit="${escape(c.id)}" aria-label="${escape(c.name)} 연락처 수정">연락처 수정</button></section></div></details></li>`;
  }).join('') : '<li class="directory-empty"><strong>찾는 업체가 없습니다</strong><p>업체명 일부만 입력해보세요. 제출 현황 필터를 사용했다면 전체 업체 보기를 눌러주세요.</p></li>';

}
function openForm(id='') {
  const c=contractors.find(c=>c.id===id);
  el('directoryEditingId').value=id; el('directoryName').value=c?.name || ''; el('directoryName').readOnly=Boolean(c);
  el('directoryManager').value=c?.manager_name || ''; el('directoryPhone').value=c?.manager_phone || '';
  el('directoryFormTitle').textContent=c?'협력사 연락처 수정':'협력사 등록하기'; el('directorySave').textContent=c?'저장하기':'등록하기';
  el('directoryFormError').textContent=''; el('directoryDialog').showModal();
  (c?el('directoryManager'):el('directoryName')).focus();
}
el('directoryClear').addEventListener('click',()=>{el('directorySearch').value='';el('directoryFilter').value='all';render();el('directorySearch').focus();});
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
    const btn=[...document.querySelectorAll('[data-edit]')].find(btn=>btn.dataset.edit===id); btn?.closest('.directory-company-card')?.querySelector('.directory-open-workspace')?.focus();
  } catch(error){el('directoryFormError').textContent=errorText(error);}
  finally{el('directorySave').disabled=false;}
});
refresh();

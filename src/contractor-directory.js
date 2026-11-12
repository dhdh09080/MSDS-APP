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
const directoryIcons={upload:'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',arrow:'M5 12h14m-5-5 5 5-5 5',document:'M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h6',print:'M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7Z',phone:'M7 3H3c0 10 8 18 18 18v-4l-5-2-2 2c-3-1-6-4-7-7l2-2Z'};
const directoryIcon=name=>`<svg class="directory-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${directoryIcons[name]}"/></svg>`;
function displayPhone(value){const digits=String(value).replace(/[^0-9]/g,'');return /^01[0-9]\d{8}$/.test(digits)?digits.replace(/(\d{3})(\d{4})(\d{4})/,'$1-$2-$3'):value;}
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
    return `<tr class="directory-company-row"><th scope="row"><div class="directory-company-identity"><span class="directory-company-mark" aria-hidden="true">${escape(c.name.replace(/^\(주\)|^주식회사/g,'').trim().slice(0,1))}</span><strong class="directory-company-name">${escape(c.name)}</strong></div><a class="directory-open-workspace" href="${base}" aria-label="${escape(c.name)} 업체 페이지 열기">업체 페이지 열기 ${directoryIcon('arrow')}</a></th><td><span class="directory-status ${c.msds_count>0?'is-submitted':'is-missing'}"><span aria-hidden="true"></span>${c.msds_count>0?`등록 ${Number(c.msds_count)}건`:'미등록'}</span><div class="directory-msds-actions"><a class="directory-action directory-action-primary directory-add-msds" href="${base}&panel=upload" aria-label="${escape(c.name)} MSDS 업로드">${directoryIcon('upload')}MSDS 업로드</a><a class="directory-action" href="${base}&panel=records" aria-label="${escape(c.name)} MSDS 보기·인쇄">${directoryIcon('document')}보기·인쇄</a><a class="directory-action directory-warning-link" href="${base}&panel=warnings" aria-label="${escape(c.name)} 경고표지 인쇄">${directoryIcon('print')}경고표지 인쇄</a></div></td><td><span class="directory-status ${c.license_submitted?'is-submitted':'is-missing'}"><span aria-hidden="true"></span>${c.license_submitted?'제출 완료':'미제출'}</span><a class="directory-action directory-register-license" href="${base}&panel=license" aria-label="${escape(c.name)} 사업자등록증 업로드">${directoryIcon('upload')}사업자등록증 업로드</a></td><td><p class="directory-contact-name ${c.manager_name?'':'is-unset'}">${escape(c.manager_name || '담당자 미등록')}</p>${c.manager_phone?`<a class="directory-phone" href="tel:${escape(c.manager_phone.replace(/[^+0-9]/g,''))}">${directoryIcon('phone')}${escape(displayPhone(c.manager_phone))}</a>`:'<p class="directory-contact-empty">전화번호 미등록</p>'}<button type="button" class="directory-contact-edit" data-edit="${escape(c.id)}" aria-label="${escape(c.name)} 연락처 수정">연락처 수정</button></td></tr>`;

  }).join('') : '<tr><td colspan="4" class="directory-empty"><strong>찾는 업체가 없습니다</strong><p>업체명 일부만 입력해보세요. 제출 현황 필터를 사용했다면 전체 업체 보기를 눌러주세요.</p></td></tr>';


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
    const btn=[...document.querySelectorAll('[data-edit]')].find(btn=>btn.dataset.edit===id); btn?.closest('.directory-company-row')?.querySelector('.directory-open-workspace')?.focus();
  } catch(error){el('directoryFormError').textContent=errorText(error);}
  finally{el('directorySave').disabled=false;}
});
refresh();

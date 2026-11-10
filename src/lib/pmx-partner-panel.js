import {validatePartnerSnapshot,makePartnerBookmarklet} from './pmx-partners.js';
import {kstDay,PMX_URL} from './pmx.js';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createPartnerPanel({client,getWorkspace,getUser,canManage,onUpdate,toast}) {
 function dialog(id){document.getElementById(id)?.remove();const d=document.createElement('dialog');d.id=id;d.className='pmx-picker';document.body.append(d);return d;}
 function open(){
  const ws=getWorkspace();if(!canManage())return toast('현장 관리자만 가져올 수 있습니다.','error');
  if(!ws?.pmx_prj_cd)return toast('먼저 이 현장에 PMX 현장코드를 연결해주세요.','error');
  const d=dialog('partnerGuide');
  d.innerHTML=`<h2>PMX 협력사 가져오기</h2><p><strong>${escape(ws.name)}</strong> · 현장코드 ${escape(ws.pmx_prj_cd)}</p><label>조회일<input class="form-input" id="partnerDate" type="date" value="${kstDay()}"></label><ol><li>아래 버튼을 즐겨찾기 모음으로 끌어 등록하세요. 현장이나 날짜를 바꾸면 다시 등록하세요.</li><li>PMX에 로그인한 뒤 등록한 즐겨찾기를 실행하세요.</li><li>돌아온 목록을 확인하고 등록하세요.</li></ol><a id="partnerBookmark" class="btn btn-primary" draggable="true">이 현장 협력사 보내기</a><details><summary>즐겨찾기 주소 직접 복사</summary><textarea id="partnerCode" class="form-input" readonly aria-label="협력사 즐겨찾기 주소"></textarea></details><p class="form-note">선택한 날짜의 사용 업체 조회 결과입니다. 현장 전체 계약업체 목록과 다를 수 있습니다. 가져오기에 없는 업체는 자동 변경하지 않습니다.</p><label>내려받은 협력사 JSON 파일<input id="partnerFile" type="file" accept=".json,application/json"></label><p id="partnerGuideError" role="alert"></p><div class="pmx-actions"><a href="${PMX_URL}" class="btn btn-secondary" target="_blank" rel="noopener noreferrer">PMX 열기 ↗</a><button id="partnerClose" class="btn btn-secondary">닫기</button></div>`;
  const refresh=()=>{try{const code=makePartnerBookmarklet(location.origin,ws.pmx_prj_cd,d.querySelector('#partnerDate').value);d.querySelector('#partnerBookmark').href=code;d.querySelector('#partnerCode').value=code;}catch(e){d.querySelector('#partnerBookmark').removeAttribute('href');d.querySelector('#partnerCode').value='';}};
  refresh();d.querySelector('#partnerDate').onchange=refresh;
  d.querySelector('#partnerBookmark').onclick=e=>{e.preventDefault();toast('즐겨찾기에 등록한 뒤 PMX 화면에서 실행해주세요.');};
  d.querySelector('#partnerClose').onclick=()=>d.close();
  d.querySelector('#partnerFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>500000)throw new Error('파일이 너무 큽니다.');const data=validatePartnerSnapshot(JSON.parse(await f.text()));d.close();review(data);}catch(err){d.querySelector('#partnerGuideError').textContent=err.message;}};
  d.showModal();
 }
 function review(snapshot){
  let data;try{data=validatePartnerSnapshot(snapshot);}catch(e){return toast(e.message,'error');}
  const ws=getWorkspace(),account=getUser()?.id;
  if(!canManage() || !ws || ws.pmx_prj_cd!==data.projectCode)return toast('받은 협력사 목록의 PMX 현장코드와 현재 현장이 다릅니다. 해당 현장을 선택하고 다시 가져와주세요.','error');
  const d=dialog('partnerReview');
  d.innerHTML=`<h2>받은 협력사 확인</h2><p>${escape(ws.name)} · ${escape(data.projectCode)}<br>조회일 ${escape(data.date)} · ${data.partners.length}개사</p><p>업체명이 정확히 같은 기존 업체는 그대로 연결합니다. 이름이 다른 업체는 새로 등록한 뒤 ‘문서 이관’에서 기존 자료를 옮길 수 있습니다. 미사용 설정은 유지됩니다.</p><div class="pmx-review-data">${data.partners.map(p=>`<article><b>${escape(p.companyNm)}</b><p>${escape(p.contracts.join(' · ')||'공종 정보 없음')}</p></article>`).join('')||'<p>조회된 업체가 없습니다. 기존 목록을 유지합니다.</p>'}</div><p id="partnerReviewError" role="alert"></p><div class="pmx-actions"><button class="btn btn-primary" id="partnerApply" ${data.partners.length?'':'disabled'}>확인하고 등록</button><button class="btn btn-secondary" id="partnerCancel">취소</button></div>`;
  d.querySelector('#partnerCancel').onclick=()=>d.close();
  d.querySelector('#partnerApply').onclick=async e=>{
   if(getWorkspace()?.id!==ws.id || getWorkspace()?.pmx_prj_cd!==data.projectCode || getUser()?.id!==account || !canManage()){d.close();return toast('현장 또는 계정이 변경됐습니다. 다시 가져와주세요.','error');}
   e.target.disabled=true;
   try{validatePartnerSnapshot(data);const {error}=await client.rpc('import_pmx_partners',{p_workspace:ws.id,p_project_code:data.projectCode,p_date:data.date,p_fetched_at:data.fetchedAt,p_partners:data.partners});if(error)throw error;d.close();if(getWorkspace()?.id===ws.id && getUser()?.id===account)await onUpdate();toast('PMX 협력사 목록을 반영했습니다.');}
   catch(err){d.querySelector('#partnerReviewError').textContent='가져오기 실패: '+err.message;e.target.disabled=false;}
  };
  d.showModal();
 }
 return {open,review};
}

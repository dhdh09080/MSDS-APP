import { makePmxBookmarklet } from './pmx-bookmarklet.js';
import { parsePmxSnapshot, validatePmxSnapshot, PMX_INCOMING_KEY, PMX_MAX_SNAPSHOT_BYTES } from './pmx-snapshot.js';
import { mountProjectCombobox } from './pmx-combobox.js';
import initialProjects from '../data/pmx-projects.json';
import { PMX_URL, normalizeProject, estimatedCare, kstDay, manualProject } from './pmx.js';
import './pmx.css';

export function createPmxPanel({client,getWorkspace,getUser,canManage,onUpdate,toast}) {
  let projects = initialProjects.map(normalizeProject), busy = false, lastResponse = null, applying = false, status = '';
  let approvedAccount = null, approvedWorkspace = null, incoming = null, reviewOpen = false;
  const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render() {
    checkIncoming();
    const el=document.getElementById('pmxDashboard'); if(!el) return;
    const ws=getWorkspace(); if(!ws) {el.innerHTML='';return;}
    const care=estimatedCare(ws.pmx_progress, ws.pmx_category);
    const manager=canManage(), linked=Boolean(ws.pmx_prj_cd), hasProgress=ws.pmx_progress != null;
    const stamp=ws.pmx_synced_at ? new Date(ws.pmx_synced_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '';
    const stale=ws.pmx_synced_at && kstDay(ws.pmx_synced_at)!==kstDay();
    const shortStamp=ws.pmx_synced_at ? (kstDay(ws.pmx_synced_at)===kstDay()?'오늘 ':new Date(ws.pmx_synced_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'})+' ') + new Date(ws.pmx_synced_at).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}) : '';
    const careParts=care.care.split('. '), lead=careParts.shift();
    const refreshIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17"/></svg>';
    const feedback=status && (status.startsWith('저장 실패') || status.includes('없습니다')) ? status : '';
    el.classList.add('pmx-compact');
    el.innerHTML=`<header class="pmx-card-header"><div><h2>현장 공정</h2><p class="pmx-card-dates"><span>착공 ${escape(ws.pmx_start_date || '정보 없음')}</span><i aria-hidden="true">·</i><span>준공 ${escape(ws.pmx_end_date || '정보 없음')}</span></p></div>
      ${manager ? `<div class="pmx-header-actions"><button type="button" class="btn btn-primary btn-sm pmx-main-action" id="${linked?'pmxSyncBtn':'pmxLinkBtn'}" ${busy || applying?'disabled':''}>${refreshIcon}${linked?'정보 가져오기':'현장 연결'}</button>
      <details class="pmx-more" id="pmxMore"><summary aria-label="현장 공정 더보기" title="더보기"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></summary><div class="pmx-more-items">
      <button type="button" id="pmxSetupBtn">즐겨찾기 설정</button><button type="button" id="pmxFileBtn">파일 가져오기</button><button type="button" id="${linked?'pmxLinkBtn':'pmxSyncBtn'}">${linked?'연결 현장 변경':'PMX에서 목록 가져오기'}</button><a href="${PMX_URL}" target="_blank" rel="noopener noreferrer">PMX 사이트 열기 ↗</a></div></details></div>` : ''}</header>
      <div class="pmx-card-body"><div class="pmx-progress-block"><div class="pmx-progress-overview"><span>전체 공정률</span><strong>${hasProgress?escape(ws.pmx_progress)+'<small>%</small>':'<span class="pmx-no-value">—</span>'}</strong></div>
      ${hasProgress ? `<progress id="pmxProgress" class="pmx-meter" max="100" value="${Number(ws.pmx_progress)}" aria-label="전체 공정률">${Number(ws.pmx_progress)}%</progress>` : '<div class="pmx-meter-empty" aria-label="공정률 정보 없음"></div>'}
      </div><section class="pmx-care-brief" aria-label="공정별 보건관리"><div class="pmx-care-title"><span class="pmx-care-dot" aria-hidden="true"></span><b>${hasProgress?escape(care.stage):(manager?'현장 정보를 연결해주세요':'현장 정보 준비 중')}</b></div><p>${hasProgress?escape(lead)+(careParts.length?'.':''):(manager?'현장을 연결하고 정보를 가져오면 공정률과 보건관리 안내를 확인할 수 있습니다.':'담당자가 현장 정보를 반영하면 공정률과 보건관리 안내를 확인할 수 있습니다.')}</p></section></div>
      <footer class="pmx-card-footer"><span class="pmx-updated" id="pmxUpdated">${stamp?`<span class="pmx-freshness-dot${stale?' is-stale':''}" aria-hidden="true"></span><time datetime="${escape(ws.pmx_synced_at)}" title="${escape(stamp)}">${escape(shortStamp)} 업데이트</time>`:'아직 업데이트 전'}</span>
      <details class="pmx-care-details"><summary>관리 안내</summary><div>${careParts.length?`<p>${escape(careParts.join('. '))}</p>`:''}<p>공정률에 따른 일반적인 예상입니다. 실제 작업계획과 함께 확인해주세요.</p><p>PMX에서 보낸 정보를 확인하고 반영하면 업데이트됩니다.</p></div></details></footer>
      ${feedback?`<p class="pmx-feedback" role="status">${escape(feedback)}</p>`:''}`;
    const menu=el.querySelector('#pmxMore');
    const act=(id,handler)=>el.querySelector('#'+id)?.addEventListener('click',()=>{if(menu)menu.open=false;handler();});
    act('pmxSyncBtn',sync);
    act('pmxSetupBtn',openSyncGuide);
    act('pmxFileBtn',()=>{openSyncGuide();document.getElementById('pmxSnapshotFile').click();});
    act('pmxLinkBtn',()=>openPicker(true));
    menu?.querySelector('a')?.addEventListener('click',()=>menu.open=false);
    menu?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();menu.open=false;menu.querySelector('summary').focus();}});
    menu?.addEventListener('focusout',event=>{if(event.relatedTarget && !menu.contains(event.relatedTarget))menu.open=false;});
  }
  document.addEventListener('pointerdown',event=>{const menu=document.getElementById('pmxMore');if(menu?.open && !menu.contains(event.target))menu.open=false;});

  let selected = null, createSearch, linkSearch;
  function creationFields(id) {
    return `<div class="pmx-manual-fields"><b>현장 정보</b>
      <label for="${id}Category">분류 <span class="required">*</span></label><select class="form-input" id="${id}Category"><option value="">분류 선택</option><option>주택</option><option>플랜트</option><option>인프라</option><option>기타</option></select>
      <label for="${id}Code">현장코드 (선택)</label><input class="form-input" id="${id}Code" placeholder="알고 있는 PMX 현장코드" maxlength="32" autocomplete="off">
      <div class="pmx-manual-dates"><div><label for="${id}Start">착공일 (선택)</label><input class="form-input" type="date" id="${id}Start"></div><div><label for="${id}End">준공일 (선택)</label><input class="form-input" type="date" id="${id}End"></div></div>
      <p class="form-note">현장코드를 모르면 비워두세요. 나중에 PMX 현장을 연결할 수 있습니다.</p></div>`;
  }
  function readManual(name, id) {
    return manualProject({name,code:document.getElementById(id+'Code').value,category:document.getElementById(id+'Category').value,start:document.getElementById(id+'Start').value,end:document.getElementById(id+'End').value});
  }
  function catalogNote() {
    if (!lastResponse) return '현재 제공된 PMX 목록은 주택 현장입니다. 최신 목록은 PMX에서 가져와 확인할 수 있습니다.';
    return lastResponse.notice || 'PMX에서 가져온 최신 현장 목록입니다.';
  }
  function refreshSearches() {
    createSearch?.refresh(); linkSearch?.refresh();
    for (const id of ['pmxCreateCatalogNote','pmxPickerNote']) {
      const el=document.getElementById(id);if(el)el.textContent=catalogNote();
    }
  }
  function mountCreateSearch() {
    const input=document.getElementById('wsNameInput');if(!input)return;
    const form=document.getElementById('pmxCreateManual');
    form.innerHTML=creationFields('pmxManual');form.hidden=false;
    createSearch=mountProjectCombobox({input,dropdown:document.getElementById('pmxCreateDropdown'),getProjects:()=>projects,
      emptyMessage:'일치하는 PMX 현장이 없습니다. 아래 정보를 입력하고 ‘현장 추가’를 눌러주세요.',
      onChange:()=>{
        if(selected)form.querySelectorAll('input,select').forEach(el=>el.value='');
        selected=null;document.getElementById('pmxSelectedProject').textContent='';
      },
      onSelect:p=>{
        selected=p;input.value=p.prjNm;
        document.getElementById('pmxManualCategory').value=p.bizFldNm;
        document.getElementById('pmxManualCode').value=p.prjCd;
        document.getElementById('pmxManualStart').value=p.cstrnStrtYmd || '';
        document.getElementById('pmxManualEnd').value=p.cstrnEndYmd || '';
        document.getElementById('pmxSelectedProject').textContent='PMX 현장 정보를 불러왔습니다. 확인 후 현장을 추가해주세요.';
      }
    });
    form.addEventListener('input',()=>{selected=null;document.getElementById('pmxSelectedProject').textContent='입력한 정보로 새 현장을 추가합니다.';});
  }
  function resetSelection() {
    selected=null;createSearch?.hide();
    document.getElementById('wsNameInput').value='';
    document.getElementById('pmxSelectedProject').textContent='';
    const form=document.getElementById('pmxCreateManual');form.hidden=false;
    form.querySelectorAll('input,select').forEach(el=>el.value='');
  }
  async function linkProject(project, dialog) {
    if(!canManage())return;
    if(!project.prjCd)return toast('PMX 연결에는 현장코드가 필요합니다.','error');
    const ws=getWorkspace(),account=getUser()?.id;
    const {data,error}=await client.from('workspaces').update({...fields(project),pmx_synced_at:null}).eq('id',ws.id).select().single();
    if(error)return toast('현장 연결 실패: '+error.message,'error');
    if(getWorkspace()?.id!==ws.id || getUser()?.id!==account)return;
    onUpdate(data);await applyLatest();render();dialog.close();
  }
  function openPicker(link=false) {
    if(!link) {document.getElementById('wsNameInput').focus();createSearch?.show();return;}
    let dialog=document.getElementById('pmxPicker');
    if(!dialog) {
      dialog=document.createElement('dialog');dialog.id='pmxPicker';dialog.className='pmx-picker';
      dialog.innerHTML='<h2>PMX 현장 연결</h2><label for="pmxProjectSearch">현장명·코드 검색</label><div class="pmx-combobox"><input class="form-input" id="pmxProjectSearch" placeholder="현장명 또는 현장코드를 입력하세요" autocomplete="off"><div class="pmx-dropdown" id="pmxLinkDropdown" hidden><div id="pmxLinkOptions" role="listbox" aria-label="연결할 현장 검색 결과"></div></div></div><p class="form-note" id="pmxPickerNote"></p><div class="pmx-actions"><button type="button" class="btn btn-secondary" id="pmxPickerSync">최신 목록 동기화</button><button type="button" class="btn btn-secondary" id="pmxPickerClose">닫기</button></div>';
      document.body.append(dialog);
      const input=dialog.querySelector('#pmxProjectSearch');
      linkSearch=mountProjectCombobox({input,dropdown:dialog.querySelector('#pmxLinkDropdown'),getProjects:()=>projects,
        onSelect:project=>linkProject(project,dialog).catch(error=>toast(error.message,'error')),
        emptyMessage:'검색 결과가 없습니다. PMX에서 최신 목록을 가져온 뒤 다시 검색해주세요.'
      });
      dialog.querySelector('#pmxPickerClose').onclick=()=>dialog.close();
      dialog.querySelector('#pmxPickerSync').onclick=async()=>{
        const btn=dialog.querySelector('#pmxPickerSync');btn.disabled=true;
        try {await sync();refreshSearches();} finally {btn.disabled=false;}
      };
    }
    document.getElementById('pmxProjectSearch').value='';
    refreshSearches();dialog.showModal();
  }
  function fields(p) {return {name:p.prjNm,pmx_prj_cd:p.prjCd,pmx_category:p.bizFldNm,pmx_start_date:p.cstrnStrtYmd,pmx_end_date:p.cstrnEndYmd,pmx_progress:p.actlTProgrt};}
  async function applyLatest() {
    const ws=getWorkspace(), account=getUser()?.id;
    if(!lastResponse || !ws?.pmx_prj_cd || !canManage() || applying || approvedAccount !== account || approvedWorkspace !== ws.id)return;
    if(ws.pmx_synced_at && new Date(ws.pmx_synced_at)>=new Date(lastResponse.fetchedAt))return;
    const p=projects.find(p=>p.prjCd===ws.pmx_prj_cd);
    if(!p) {status='PMX 응답에 이 현장코드가 없습니다. 마지막 데이터를 유지합니다.';render();return;}
    applying=true;render();
    try {
      const {data,error}=await client.rpc('sync_pmx_project',{p_workspace:ws.id,p_project:p,p_fetched_at:lastResponse.fetchedAt});
      if(error)throw error;
      if(getWorkspace()?.id!==ws.id || getUser()?.id!==account)return;
      onUpdate(data);status='';toast('현장 정보를 업데이트했습니다.','success');
    } catch(error) {status='저장 실패: '+error.message;} finally {applying=false;render();}
  }
  function clearIncoming() {
    incoming=null;reviewOpen=false;
    try {sessionStorage.removeItem(PMX_INCOMING_KEY);} catch {}
  }
  function resetData() {
    clearIncoming();lastResponse=null;approvedAccount=null;approvedWorkspace=null;
    projects=initialProjects.map(normalizeProject);refreshSearches();
    document.getElementById('pmxReview')?.close();
  }
  function checkIncoming() {
    if(approvedAccount && getUser()?.id !== approvedAccount)resetData();
    if(!getUser()?.id || reviewOpen)return;
    try {
      const raw=sessionStorage.getItem(PMX_INCOMING_KEY);
      if(raw){incoming=parsePmxSnapshot(raw);sessionStorage.removeItem(PMX_INCOMING_KEY);}
    } catch(error){clearIncoming();toast(error.message,'error');return;}
    if(!incoming)return;
    openReview(incoming);
  }
  function openReview(snapshot) {
    let data;
    try {data=validatePmxSnapshot(snapshot);}catch(error){clearIncoming();return toast(error.message,'error');}
    const account=getUser()?.id,workspace=getWorkspace()?.id || null;
    if(!account){incoming=data;return;}
    let dialog=document.getElementById('pmxReview');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='pmxReview';dialog.className='pmx-picker';document.body.append(dialog);dialog.addEventListener('cancel',clearIncoming);}
    const matching=data.projects.find(p=>p.prjCd===getWorkspace()?.pmx_prj_cd);
    const save=Boolean(workspace && matching && canManage());
    dialog.innerHTML=`<h2>받은 현장 정보 확인</h2><p class="form-note">PMX에서 가져온 정보가 맞는지 확인해주세요. 확인 버튼을 누르기 전에는 저장하지 않습니다.</p>
      <p class="pmx-meta">반영 계정: ${escape(getUser()?.email || '')}<br>대상 현장: ${escape(getWorkspace()?.name || '현장 선택 목록')}<br>조회 시각: ${escape(new Date(data.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}<br>받은 현장: ${data.projects.length}개</p>
      <div class="pmx-review-data">${(matching?[matching]:data.projects).map(p=>`<article><b>${escape(p.prjNm)}</b><p>현장코드 ${escape(p.prjCd)} · ${escape(p.bizFldNm)}<br>착공 ${escape(p.cstrnStrtYmd || '정보 없음')} · 준공 ${escape(p.cstrnEndYmd || '정보 없음')}<br>공정률 ${p.actlTProgrt == null?'정보 없음':escape(p.actlTProgrt)+'%'}</p></article>`).join('')}</div>
      <p class="form-note">${save?'표시된 현장의 현장명·분류·일정·공정률을 반영합니다. 다른 현장은 검색 목록에만 추가합니다.':'현장 선택 목록에만 반영합니다. 공정률 저장에는 담당자 권한과 일치하는 현장 연결이 필요합니다.'}</p>
      <div class="pmx-actions"><button type="button" class="btn btn-secondary" id="pmxReviewCancel">취소</button><button type="button" class="btn btn-primary" id="pmxReviewConfirm">${save?'확인하고 현장에 반영':'확인하고 목록에 반영'}</button></div>`;
    dialog.querySelector('#pmxReviewCancel').onclick=()=>{clearIncoming();dialog.close();};
    dialog.querySelector('#pmxReviewConfirm').onclick=async()=>{
      if(getUser()?.id!==account || (getWorkspace()?.id || null)!==workspace){clearIncoming();dialog.close();return toast('로그인 계정 또는 현장이 변경됐습니다. 다시 가져와주세요.','error');}
      const button=dialog.querySelector('#pmxReviewConfirm');button.disabled=true;
      try {
        const validated=validatePmxSnapshot(data);
        approvedAccount=account;approvedWorkspace=save?workspace:null;
        projects=validated.projects;lastResponse=validated;
        clearIncoming();dialog.close();refreshSearches();
        status='';
        if(!save)toast('현장 목록을 가져왔습니다.','success');
        await applyLatest();render();
      } catch(error){toast(error.message,'error');button.disabled=false;}
    };
    reviewOpen=true;if(!dialog.open)dialog.showModal();
  }
  function openSyncGuide() {
    let dialog=document.getElementById('pmxSyncGuide');
    if(!dialog) {
      dialog=document.createElement('dialog');dialog.id='pmxSyncGuide';dialog.className='pmx-picker';document.body.append(dialog);
      dialog.innerHTML=`<h2>설치 없이 PMX 정보 가져오기</h2><ol class="pmx-guide-steps"><li>아래 ‘보건관리로 보내기’를 브라우저 즐겨찾기 모음으로 끌어다 놓습니다. 처음 한 번만 등록하면 됩니다.</li><li>PMX를 열어 로그인한 뒤, 등록한 즐겨찾기를 누릅니다.</li><li>보건관리 사이트로 돌아오면 받은 정보를 확인하고 반영합니다.</li></ol>
        <a class="btn btn-primary" id="pmxBookmark" draggable="true">보건관리로 보내기</a>
        <p class="form-note">이 버튼은 PMX 화면에서 실행하는 즐겨찾기입니다. PMX의 현장 목록을 한 번 조회하며 로그인 정보는 전송하지 않습니다. 현재 확인된 API는 주택 현장 조회입니다.</p>
        <details class="pmx-help"><summary>드래그로 등록되지 않을 때</summary><p>즐겨찾기를 새로 만들고 이름은 ‘보건관리로 보내기’, 주소는 아래 복사한 내용으로 저장해주세요.</p><button type="button" class="btn btn-secondary btn-sm" id="pmxBookmarkCopy">즐겨찾기 주소 복사</button><textarea class="form-input" id="pmxBookmarkCode" readonly aria-label="즐겨찾기 주소"></textarea></details>
        <p class="form-note">PMX 보안 설정에서 즐겨찾기 실행을 제한하면 동작하지 않을 수 있습니다. 보안 설정을 해제하지 말고 사내 담당자에게 확인해주세요.</p>
        <label class="form-label" for="pmxSnapshotFile">파일로 받은 경우</label><input class="form-input" id="pmxSnapshotFile" type="file" accept=".json,application/json"><p class="form-note">PMX에서 내려받은 현장 정보 JSON 파일을 선택하면 내용을 확인할 수 있습니다.</p>
        <div class="pmx-actions"><a class="btn btn-primary" id="pmxGuideOpen" href="${PMX_URL}" target="_blank" rel="noopener noreferrer">PMX 열기 ↗</a><button type="button" class="btn btn-secondary" id="pmxGuideClose">닫기</button></div>`;
      const code=makePmxBookmarklet(location.origin),link=dialog.querySelector('#pmxBookmark');
      link.href=code;dialog.querySelector('#pmxBookmarkCode').value=code;
      link.onclick=event=>{event.preventDefault();toast('버튼을 즐겨찾기 모음으로 끌어다 놓은 뒤 PMX에서 눌러주세요.');};
      dialog.querySelector('#pmxBookmarkCopy').onclick=async()=>{
        try {await navigator.clipboard.writeText(code);toast('즐겨찾기 주소를 복사했습니다.');}
        catch {dialog.querySelector('#pmxBookmarkCode').select();toast('즐겨찾기 주소를 선택했습니다. 복사해주세요.');}
      };
      dialog.querySelector('#pmxGuideClose').onclick=()=>dialog.close();
      dialog.querySelector('#pmxGuideOpen').onclick=()=>{
        try {localStorage.setItem('gs_pmx_bookmark_ready_'+getUser()?.id,'1');}catch{}
        dialog.close();
      };
      dialog.querySelector('#pmxSnapshotFile').onchange=async event=>{
        const file=event.target.files?.[0];event.target.value='';if(!file)return;
        try {if(file.size>PMX_MAX_SNAPSHOT_BYTES)throw new Error('파일 크기가 너무 큽니다.');const data=parsePmxSnapshot(await file.text());dialog.close();incoming=data;checkIncoming();}
        catch(error){toast(error.message,'error');}
      };
    }
    if(!dialog.open)dialog.showModal();
  }
  function sync() {
    let ready=false;
    try {ready=localStorage.getItem('gs_pmx_bookmark_ready_'+getUser()?.id)==='1';}catch{}
    if(!ready){openSyncGuide();return;}
    // Open a separate tab without retaining a PMX window handle.
    window.open(PMX_URL,'_blank','noopener,noreferrer');
    toast('PMX에서 ‘보건관리로 보내기’ 즐겨찾기를 눌러주세요.');
  }
  mountCreateSearch();
  return {render,openPicker,applyLatest,sync,resetSelection,checkIncoming,resetData,selectedFields:()=>{
    const name=document.getElementById('wsNameInput').value.trim();
    return selected && selected.prjNm===name ? fields(selected) : fields(readManual(name,'pmxManual'));
  }};
}

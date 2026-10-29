import { createContractorRoster } from './contractor-roster.js';
import { createHazardMap } from './lib/hazard-map.js';
import { mountManagerSignWorkbench } from './lib/manager-sign-workbench.js';
import './contractor-workspace.css';
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
const paths = {home:'M3 10 12 3l9 7v11H3ZM9 21v-8h6v8',contacts:'M6 3h12v18H6ZM9 7h6M9 11h6M9 15h4',license:'M5 3h10l4 4v14H5ZM14 3v5h5M8 12h8M8 16h8',records:'M4 4h16v16H4ZM4 9h16M9 9v11',warnings:'m12 3 10 18H2ZM12 9v5m0 3v1',hazard:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM9 10a3 3 0 1 0 6 0 3 3 0 0 0-6 0',workers:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M17 4a4 4 0 0 1 0 7m2 3a4 4 0 0 1 3 4v3',changes:'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4'};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
export function createContractorWorkspace({supabase,getContext,navigate,toast}) {
  let mounted=false, metadata=null, loadSequence=0, saving=false, hazard=null, roster=null, setMenuOpen=()=>{};
  let managerSignKey=null;
  const key=()=>{const c=getContext();return `${c.token}:${c.contractor?.id}`;};
  const args=()=>({p_token:getContext().token,p_contractor_id:getContext().contractor.id});
  async function rpc(name,extra={}) {
    const result=await supabase.rpc(name,{...args(),...extra});
    if(result.error) throw result.error;
    return result.data;
  }
  async function loadMetadata() {
    const seq=++loadSequence, current=key();
    $('workspaceLoadError').textContent='';
    try {
      const data=await rpc('get_contractor_workspace');
      if(current!==key() || seq!==loadSequence) return;
      metadata=data; renderMetadata();
    } catch(error) {
      if(current===key() && seq===loadSequence) $('workspaceLoadError').textContent='협력사 정보를 불러오지 못했습니다. 새로고침으로 다시 시도해주세요.';
    }
  }
  function mount({allowMsds,allowLicense}) {
    if(!mounted) {
      mounted=true;
      document.body.classList.add('contractor-workspace');
      const sidebar=document.createElement('aside'); sidebar.id='contractorWorkspaceSidebar';
      sidebar.setAttribute('aria-label','협력사 메뉴');
      sidebar.innerHTML=`<div class="cw-brand"><b>GS</b><div>협력사 현장관리<small>PARTNER WORKSPACE</small></div><button type="button" id="cwClose" aria-label="메뉴 닫기">✕</button></div><div class="cw-site"><small id="cwSiteName"></small><strong id="cwCompanyName"></strong><a id="cwDirectoryLink" hidden>← 현장 전체 협력사 리스트</a></div><nav class="cw-navigation"><div class="cw-menu-label">메인</div><button data-workspace-nav="dashboard">${icon('home')}홈 (대시보드)</button><div class="cw-menu-label">협력사 정보</div><button data-workspace-nav="contacts">${icon('contacts')}관리자 전화번호</button><div id="cwLicenseSlot"></div><button data-workspace-nav="manager-signs">${icon('license')}관리책임자 표지</button><div class="cw-menu-label" data-msds>MSDS</div><div id="cwRecordsSlot"></div><div id="cwWarningsSlot"></div><button data-workspace-nav="hazard" data-msds>${icon('hazard')}위험물 저장소 위치도</button><div class="cw-menu-label">인력 관리</div><button data-workspace-nav="workers">${icon('workers')}현장 근로자 등록 목록</button><button data-workspace-nav="worker-changes">${icon('changes')}근로자 정보변경 신청</button></nav><div class="cw-footer">현장과 함께하는 안전한 하루</div>`;
      document.body.prepend(sidebar);
      const overlay=document.createElement('button'); overlay.id='cwOverlay'; overlay.type='button';overlay.hidden=true;overlay.setAttribute('aria-label','메뉴 닫기');document.body.append(overlay);
      const menu=document.createElement('button');menu.id='cwMenuToggle';menu.type='button';menu.className='btn btn-secondary';menu.setAttribute('aria-controls',sidebar.id);menu.setAttribute('aria-expanded','false');menu.textContent='☰ 메뉴';document.querySelector('.header').prepend(menu);
      for(const [id,slot,label,type] of [['recordsTab','cwRecordsSlot','MSDS 대장 및 업로드','records'],['warningsTab','cwWarningsSlot','경고표지','warnings'],['licenseTab','cwLicenseSlot','사업자등록증','license']]) {
        const button=$(id);button.removeAttribute('role');button.removeAttribute('aria-selected');button.dataset.workspaceNav=type;button.innerHTML=icon(type)+label;$(slot).append(button);
        if(type==='records'){button.setAttribute('onclick',"switchPortalPanel('upload')");button.setAttribute('aria-controls','uploadPanel');}
      }
      $('portalTabs').remove();
      document.querySelectorAll('[data-portal-panel]').forEach(panel=>{if(panel.getAttribute('role')==='tabpanel')panel.setAttribute('role','region');});
      const home=document.createElement('section');home.id='dashboardPanel';home.dataset.portalPanel='dashboard';home.setAttribute('aria-label','협력사 대시보드');
      $('portalView').prepend(home);home.append(document.querySelector('.portal-overview'),document.querySelector('.portal-stats'));
      home.insertAdjacentHTML('beforeend',`<div class="cw-dashboard-grid"><section class="cw-card"><h2>바로가기</h2><div class="cw-shortcuts"><button type="button" data-workspace-nav="upload" data-msds>${icon('records')}<span>MSDS 확인 · 업로드<small>기존 자료를 확인하고 빠진 자료를 추가하세요</small></span>→</button><button type="button" data-workspace-nav="hazard" data-msds>${icon('hazard')}<span>위험물 저장소 위치도<small>우리 협력사의 저장소와 물질을 관리하세요</small></span>→</button><button type="button" data-workspace-nav="manager-signs">${icon('license')}<span>관리책임자 표지<small>정·부 연락처와 문구를 넣고 A3·A4로 인쇄하세요</small></span>→</button><button type="button" data-workspace-nav="worker-changes">${icon('changes')}<span>근로자 정보변경 신청<small>업체·재직 상태 변경 신청</small></span>→</button></div></section><section class="cw-card"><h2>협력사 대표 연락처</h2><div id="dashboardContact" class="cw-primary-contact">연락처를 불러오는 중입니다…</div><button type="button" class="btn btn-secondary" data-workspace-nav="contacts">연락처 관리</button></section></div>`);
      $('portalView').insertAdjacentHTML('beforeend',`<p id="workspaceLoadError" role="alert"></p><section id="managerSignsPanel" data-portal-panel="manager-signs" hidden><div class="portal-section-heading"><div><h2>관리책임자 표지</h2><p>우리 협력사의 관리책임자 정·부 연락처와 문구를 입력하고 A3·A4로 인쇄하세요.</p></div></div><div id="portalManagerSignWorkbench"></div></section><section id="contactsPanel" data-portal-panel="contacts" hidden><div class="portal-section-heading"><div><h2>관리자 전화번호</h2><p>대표 번호가 가장 먼저 표시되고 현장 관리자 화면에도 함께 반영됩니다.</p></div><button type="button" id="cwContactRefresh" class="btn btn-secondary">새로고침</button></div><div id="cwContactList" class="cw-contact-list"></div><form id="cwContactForm" class="cw-card"><h3 id="cwContactFormTitle">연락처 추가</h3><input type="hidden" id="cwContactId"><div class="cw-form-grid"><label>관리자명<input id="cwContactName" maxlength="100" autocomplete="name" placeholder="예: 홍길동"></label><label>전화번호<input id="cwContactPhone" type="tel" required maxlength="30" autocomplete="tel" placeholder="예: 010-1234-5678"></label></div><label class="cw-checkbox"><input id="cwContactPrimary" type="checkbox">대표 연락처로 설정</label><p id="cwContactError" role="alert"></p><div class="cw-form-actions"><button class="btn btn-primary" id="cwContactSave" type="submit">저장하기</button><button class="btn btn-secondary" id="cwContactCancel" type="button">입력 취소</button></div></form></section><section id="hazardPanel" data-portal-panel="hazard" hidden><div class="portal-section-heading"><div><h2>위험물 저장소 위치도</h2><p>우리 협력사의 저장소를 수정하면 현장 관리자의 위치도에도 반영됩니다.</p></div></div><div id="hazardMapRoot"></div></section><section id="workersPanel" data-portal-panel="workers" hidden><div class="portal-section-heading"><div><h2>현장 근로자 등록 목록</h2><p>우리 협력사의 현장 근로자 정보를 확인하세요.</p></div></div><div id="cwWorkerContent"></div></section><section id="workerChangesPanel" data-portal-panel="worker-changes" hidden><div class="portal-section-heading"><div><h2>근로자 정보변경 신청</h2><p>현장코드에 맞는 정보변경 신청 페이지로 연결됩니다.</p></div><a id="cwWorkerChangeLink" referrerpolicy="no-referrer" class="btn btn-secondary" target="_blank" rel="noopener noreferrer" hidden>새 창에서 열기 ↗</a></div><p id="cwWorkerSiteNotice" role="status"></p><iframe id="cwWorkerChangeFrame" referrerpolicy="no-referrer" title="근로자 정보변경 신청" loading="lazy" hidden></iframe></section>`);
      document.querySelectorAll('[data-workspace-nav]').forEach(button=>{
        if(!button.hasAttribute('onclick'))button.addEventListener('click',()=>navigate(button.dataset.workspaceNav));
      });
      const mobile=window.matchMedia('(max-width:768px)');
      setMenuOpen=(open,returnFocus=false)=>{
        open=Boolean(open&&mobile.matches);
        document.body.classList.toggle('cw-menu-open',open);menu.setAttribute('aria-expanded',String(open));overlay.hidden=!open;
        sidebar.inert=mobile.matches&&!open;
        document.querySelector('.header').inert=open;document.querySelector('.content').inert=open;
        if(open)sidebar.querySelector('nav button').focus();else if(returnFocus)menu.focus();
      };
      setMenuOpen(false);
      menu.addEventListener('click',()=>setMenuOpen(true));
      $('cwClose').addEventListener('click',()=>setMenuOpen(false,true));overlay.addEventListener('click',()=>setMenuOpen(false,true));
      mobile.addEventListener('change',()=>setMenuOpen(false));
      document.addEventListener('keydown',event=>{if(event.key==='Escape' && document.body.classList.contains('cw-menu-open'))setMenuOpen(false,true);});
      $('cwContactForm').addEventListener('submit',saveContact);
      $('cwContactCancel').addEventListener('click',resetContactForm);
      $('cwContactRefresh').addEventListener('click',loadMetadata);
      $('cwContactList').addEventListener('click',contactAction);
      $('portalView').append(document.querySelector('.portal-footer'));
      roster=createContractorRoster({root:$('cwWorkerContent'),rpc,getKey:key,navigate,toast});
    }
    const context=getContext();metadata=null;++loadSequence;
    managerSignKey=null;
    $('portalManagerSignWorkbench').managerSignToken={};
    $('portalManagerSignWorkbench').replaceChildren();
    resetContactForm();setSaving(false);$('cwContactList').replaceChildren();$('dashboardContact').textContent='연락처를 불러오는 중입니다…';$('cwWorkerChangeFrame').removeAttribute('src');$('cwWorkerChangeFrame').hidden=true;$('cwWorkerChangeLink').hidden=true;
    document.querySelector('.portal-overview h2').textContent=`${context.contractor.name}, 오늘 하루도 좋은 하루 되세요!`;
    document.querySelector('.portal-overview p').textContent='서류 제출부터 현장 근로자 관리까지, 왼쪽 메뉴에서 확인하세요.';
    $('cwSiteName').textContent=context.workspace.name;$('cwCompanyName').textContent=context.contractor.name;
    const back=$('directoryBackLink');
    if(!back.hidden){$('cwDirectoryLink').href=back.href;$('cwDirectoryLink').hidden=false;back.hidden=true;}
    $('licenseTab').hidden=!allowLicense;
    document.querySelectorAll('[data-msds]').forEach(element=>element.hidden=!allowMsds);
    hazard?.reset();hazard=null;
    if(allowMsds) {
      const params=extra=>({...args(),...extra});
      const mutation=(id,mapId,action,values={})=>supabase.rpc('save_contractor_hazard_marker',params({p_marker_id:id,p_map_id:mapId,p_action:action,p_values:values}));
      const repository={
        listMaps:async()=>{const r=await supabase.rpc('get_contractor_hazard_maps',params());return {data:r.data?.maps,error:r.error};},
        listMarkers:async mapId=>{const r=await supabase.rpc('get_contractor_hazard_maps',params({p_map_id:mapId}));return {data:r.data?.markers,error:r.error};},
        image:async mapId=>{const r=await supabase.functions.invoke('contractor-map-photo',{body:{token:getContext().token,contractor_id:getContext().contractor.id,map_id:mapId}});return {data:r.data ? {signedUrl:r.data.signed_url} : null,error:r.error};},
        save:(id,mapId,values)=>mutation(id,mapId,'save',values),move:(id,mapId,point)=>mutation(id,mapId,'move',point),remove:(id,mapId)=>mutation(id,mapId,'delete'),
      };
      hazard=createHazardMap({supabase,getWorkspace:()=>getContext().workspace,getUser:()=>null,getContractors:()=>[getContext().contractor],toast,repository,contractorId:context.contractor.id});
    }
    roster.reset();
    loadMetadata();
  }
  function activate(panel) {
    if(!mounted)return;
    const active=panel==='upload'?'records':panel;
    document.querySelectorAll('[data-workspace-nav]').forEach(button=>{
      button.classList.toggle('active',button.dataset.workspaceNav===active);
      if(button.closest('nav')){button.tabIndex=0;if(button.dataset.workspaceNav===active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
    });
    setMenuOpen(false);
    if(panel==='hazard')hazard?.show();
    if(panel==='manager-signs' && managerSignKey!==key()) {
      managerSignKey=key();
      const context=getContext();
      const primary=metadata?.contacts?.find(contact=>contact.is_primary);
      const contractor={...context.contractor};
      if(primary){contractor.manager_name=primary.name;contractor.manager_phone=primary.phone;}
      mountManagerSignWorkbench($('portalManagerSignWorkbench'), {
        workspace:context.workspace,userId:`contractor-link:${contractor.id}`,
        contractors:[contractor],lockedContractorId:contractor.id,
      });
    }
    if(panel==='workers')roster?.load();
    if(panel==='worker-changes' && metadata)renderWorkerLink();
    window.scrollTo({top:0,behavior:'instant'});
  }
  function renderMetadata() {
    const contacts=metadata.contacts||[];
    $('cwContactList').innerHTML=contacts.length?contacts.map(c=>`<article class="cw-contact ${c.is_primary?'is-primary':''}"><div><strong>${escape(c.name||'관리자')}${c.is_primary?'<span class="cw-primary-badge">대표</span>':''}</strong><a href="tel:${escape(c.phone.replace(/[^+0-9]/g,''))}">${escape(c.phone)}</a></div><div class="cw-form-actions">${!c.is_primary?`<button type="button" class="btn btn-secondary" data-contact-action="primary" data-id="${c.id}">대표로 설정</button>`:''}<button type="button" class="btn btn-secondary" data-contact-action="edit" data-id="${c.id}">수정</button><button type="button" class="btn btn-secondary" data-contact-action="delete" data-id="${c.id}">삭제</button></div></article>`).join(''):'<div class="portal-empty">등록된 연락처가 없습니다. 아래에서 관리자 전화번호를 추가하세요.</div>';
    const primary=contacts.find(contact=>contact.is_primary)||contacts[0];
    $('dashboardContact').innerHTML=primary?`<strong>${escape(primary.name||'관리자')}</strong><a href="tel:${escape(primary.phone.replace(/[^+0-9]/g,''))}">${escape(primary.phone)}</a>`:'<p>관리자 전화번호를 등록해주세요.</p>';
    renderWorkerLink();
  }
  function renderWorkerLink() {
    const code=metadata?.worker_site_code||'';
    const ready=/^\d{6}$/.test(code);
    const link=$('cwWorkerChangeLink'),frame=$('cwWorkerChangeFrame');link.hidden=!ready;
    $('cwWorkerSiteNotice').textContent=ready?`현장코드 ${code} · 신청 내용은 기존 정보변경 신청 시스템에 접수됩니다.`:'현장코드가 아직 연결되지 않았습니다. 현장 담당자에게 확인해주세요.';
    if(ready){link.href=`https://pmx-worker-change.vercel.app/?site=${encodeURIComponent(code)}`;if(!$('workerChangesPanel').hidden && frame.src!==link.href)frame.src=link.href;frame.hidden=false;}
  }
  function resetContactForm(){ $('cwContactForm').reset();$('cwContactId').value='';$('cwContactFormTitle').textContent='연락처 추가';$('cwContactError').textContent=''; }
  function setSaving(value){saving=value;$('cwContactForm').querySelectorAll('input,button').forEach(el=>el.disabled=value);$('cwContactList').querySelectorAll('button').forEach(el=>el.disabled=value);}
  async function saveContact(event){
    event.preventDefault();if(saving)return;
    const phone=$('cwContactPhone').value.trim();
    if(!/^[0-9+() .-]{7,30}$/.test(phone)){$('cwContactError').textContent='전화번호 형식을 확인해주세요.';return;}
    const current=key();setSaving(true);++loadSequence;
    try{const data=await rpc('save_contractor_contact',{p_action:'save',p_contact_id:$('cwContactId').value||null,p_name:$('cwContactName').value.trim(),p_phone:phone,p_primary:$('cwContactPrimary').checked});if(current!==key())return;metadata=data;renderMetadata();resetContactForm();toast('연락처를 저장했습니다','success');}
    catch(error){if(current===key())$('cwContactError').textContent='저장 실패: '+error.message;}
    finally{if(current===key())setSaving(false);}
  }
  async function contactAction(event){
    const button=event.target.closest('[data-contact-action]');if(!button||saving)return;
    const contact=metadata?.contacts?.find(c=>c.id===button.dataset.id);if(!contact)return;
    if(button.dataset.contactAction==='edit'){$('cwContactId').value=contact.id;$('cwContactName').value=contact.name;$('cwContactPhone').value=contact.phone;$('cwContactPrimary').checked=contact.is_primary;$('cwContactFormTitle').textContent='연락처 수정';$('cwContactPhone').focus();return;}
    if(button.dataset.contactAction==='delete'&&!confirm(`${contact.name||'관리자'} 연락처를 삭제하시겠습니까?`))return;
    const current=key();setSaving(true);++loadSequence;
    try{const data=await rpc('save_contractor_contact',{p_action:button.dataset.contactAction,p_contact_id:contact.id});if(current!==key())return;metadata=data;renderMetadata();resetContactForm();}
    catch(error){if(current===key())$('cwContactError').textContent='변경 실패: '+error.message;}
    finally{if(current===key())setSaving(false);}
  }
  return {mount,activate};
}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createContractorRoster({root,rpc,getKey,navigate,toast}) {
  let workers=[],busy=false,sequence=0;
  const $=id=>root.querySelector('#'+id);
  root.innerHTML=`<p class="cw-data-note">협력사가 이 화면에서 등록한 근로자 목록입니다. PMX의 등록·재직 상태와는 별도로 관리됩니다.</p><div class="portal-toolbar"><input id="cwWorkerSearch" type="search" aria-label="근로자 검색" placeholder="이름, 직종, 전화번호 끝 4자리 검색"><button class="btn btn-secondary" id="cwWorkerRefresh" type="button">새로고침</button></div><p id="cwWorkerCount" class="muted" role="status"></p><p id="cwWorkerError" role="alert"></p><div class="cw-worker-table-wrap"><table class="cw-worker-table"><thead><tr><th>이름</th><th>직종</th><th>전화번호 끝 4자리</th><th>등록일</th><th>관리</th></tr></thead><tbody id="cwWorkerList"></tbody></table></div><form id="cwWorkerForm" class="cw-card"><h3 id="cwWorkerFormTitle">근로자 등록</h3><input id="cwWorkerId" type="hidden"><div class="cw-form-grid"><label>이름<input id="cwWorkerName" maxlength="50" required autocomplete="off"></label><label>전화번호 끝 4자리<input id="cwWorkerPhone4" required inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off" placeholder="숫자 4자리"></label><label>직종<input id="cwWorkerJob" maxlength="100" placeholder="예: 형틀목공"></label><label>등록일<input id="cwWorkerDate" type="date" required></label></div><p id="cwWorkerFormError" role="alert"></p><div class="cw-form-actions"><button class="btn btn-primary" id="cwWorkerSave" type="submit">등록하기</button><button class="btn btn-secondary" id="cwWorkerCancel" type="button">입력 취소</button></div></form>`;
  function resetForm(){ $('cwWorkerForm').reset();$('cwWorkerId').value='';$('cwWorkerDate').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('cwWorkerFormError').textContent='';$('cwWorkerFormTitle').textContent='근로자 등록';$('cwWorkerSave').textContent='등록하기'; }
  function setBusy(value){busy=value;root.querySelectorAll('input,button').forEach(element=>element.disabled=value);}
  function render(){
    const query=$('cwWorkerSearch').value.trim().toLowerCase();
    const rows=workers.filter(w=>[w.name,w.job,w.phone_last4].some(value=>(value||'').toLowerCase().includes(query)));
    $('cwWorkerCount').textContent=`전체 ${workers.length}명 · 조회 ${rows.length}명`;
    $('cwWorkerList').innerHTML=rows.length?rows.map(w=>`<tr><td data-label="이름">${escape(w.name)}</td><td data-label="직종">${escape(w.job||'미입력')}</td><td data-label="전화번호 끝 4자리">${escape(w.phone_last4)}</td><td data-label="등록일">${escape(w.registered_on)}</td><td data-label="관리"><div class="cw-form-actions"><button type="button" class="btn btn-secondary" data-worker-action="edit" data-id="${w.id}">수정</button><button type="button" class="btn btn-secondary" data-worker-action="change" data-id="${w.id}">정보변경 신청</button><button type="button" class="btn btn-secondary" data-worker-action="delete" data-id="${w.id}">삭제</button></div></td></tr>`).join(''):`<tr><td colspan="5" class="portal-empty">${query?'검색 결과가 없습니다.':'등록된 근로자가 없습니다. 아래에서 근로자를 등록하세요.'}</td></tr>`;
    setBusy(busy);
  }
  async function load(){if(busy)return;const key=getKey(),seq=++sequence;setBusy(true);$('cwWorkerError').textContent='';
    try{const data=await rpc('get_contractor_workers');if(key!==getKey()||seq!==sequence)return;workers=data||[];render();}
    catch(error){if(key===getKey()&&seq===sequence)$('cwWorkerError').textContent='근로자 목록을 불러오지 못했습니다. 새로고침으로 다시 시도해주세요.';}
    finally{if(key===getKey()&&seq===sequence)setBusy(false);}
  }
  async function save(event){event.preventDefault();if(busy)return;const key=getKey();setBusy(true);++sequence;$('cwWorkerFormError').textContent='';
    try{const data=await rpc('save_contractor_worker',{p_action:'save',p_worker_id:$('cwWorkerId').value||null,p_name:$('cwWorkerName').value.trim(),p_phone_last4:$('cwWorkerPhone4').value,p_job:$('cwWorkerJob').value.trim(),p_registered_on:$('cwWorkerDate').value});if(key!==getKey())return;workers=data;render();resetForm();toast('근로자 목록을 저장했습니다','success');}
    catch(error){if(key===getKey())$('cwWorkerFormError').textContent=/already registered/.test(error.message)?'같은 이름과 전화번호 끝 4자리로 이미 등록된 근로자입니다.':'저장 실패: '+error.message;}
    finally{if(key===getKey())setBusy(false);}
  }
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-worker-action]');if(!button||busy)return;const worker=workers.find(w=>w.id===button.dataset.id);if(!worker)return;
    if(button.dataset.workerAction==='change'){navigate('worker-changes');return;}
    if(button.dataset.workerAction==='edit'){$('cwWorkerId').value=worker.id;$('cwWorkerName').value=worker.name;$('cwWorkerPhone4').value=worker.phone_last4;$('cwWorkerJob').value=worker.job;$('cwWorkerDate').value=worker.registered_on;$('cwWorkerFormTitle').textContent='근로자 목록 수정';$('cwWorkerSave').textContent='수정하기';$('cwWorkerName').focus();return;}
    if(!confirm(`${worker.name}님을 이 협력사 목록에서 삭제하시겠습니까?`))return;
    const key=getKey();setBusy(true);++sequence;
    try{const data=await rpc('save_contractor_worker',{p_action:'delete',p_worker_id:worker.id});if(key!==getKey())return;workers=data;render();resetForm();}
    catch(error){if(key===getKey())$('cwWorkerError').textContent='삭제 실패: '+error.message;}
    finally{if(key===getKey())setBusy(false);}
  });
  $('cwWorkerSearch').addEventListener('input',render);$('cwWorkerRefresh').addEventListener('click',load);$('cwWorkerForm').addEventListener('submit',save);$('cwWorkerCancel').addEventListener('click',resetForm);
  function reset(){++sequence;workers=[];busy=false;resetForm();render();$('cwWorkerError').textContent='';}
  reset();return {load,reset};
}

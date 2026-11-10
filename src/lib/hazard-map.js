import './hazard-map.css';
import { createLocationPhotos } from './location-photos.js';
import { REVIEW_STATES, reviewState, emptyFilters, filterHazardMarkers, issueSummary } from './hazard-map-filters.js';

const BUCKET = 'hazard-map-photos';
const MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TYPES = {
  locker: { label: '락카 보관함', short: '락카', icon: 'M5 3h14v18H5ZM5 10h14M9 6h6M9 14v3' },
  hazard: { label: '위험물 저장소', short: '위험', icon: 'm12 3 10 18H2ZM12 9v5M12 17v1' },
  fuel: { label: '유류 저장소', short: '유류', icon: 'M4 21V3h11v18M4 10h11M2 21h15M15 7h3l3 4v6a2 2 0 0 1-4 0v-4M18 4l3 3v4' },
  warehouse: { label: '창고 위치', short: '창고', icon: 'M3 21V8l9-5 9 5v13M7 21V11h10v10M7 15h10' },
  issue: { label: '부적합 사항', short: '부적합', icon: 'm12 3 10 18H2ZM12 9v5M12 17v1' },
  building: { label: '동', short: '동', icon: 'M4 21V3h16v18M2 21h20M8 7h2M14 7h2M8 11h2M14 11h2M10 21v-5h4v5' },
  gate: { label: '게이트', short: '게이트', icon: 'M3 21V5h18v16M3 9h18M7 9v12M12 9v12M17 9v12M1 21h22' },
};
const markerType = marker => Object.hasOwn(TYPES, marker.marker_type) ? marker.marker_type : 'hazard';
const isStorage = type => ['locker', 'hazard', 'fuel', 'warehouse'].includes(type);
const icon = type => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${TYPES[type].icon}"/></svg>`;
const markerItems = marker => Array.isArray(marker.items) ? marker.items : marker.material || marker.quantity ? [{ name: marker.material || '(기존 물질명 미입력)', quantity: marker.quantity || '' }] : [];

export function relativePoint(clientX, clientY, rect) {
  if (!rect.width || !rect.height) return null;
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

// Each async operation belongs to one workspace and selection. Late responses
// cannot restore a previous site's photo, form, or markers after navigation.
export function createHazardMap({ supabase, getWorkspace, getUser, getContractors = () => [], toast, repository = null, contractorId = null, canReview = () => false }) {
  let root, workspaceId = null, revision = 0;
  let maps = [], markers = [], selectedId = null, imageUrl = '';
  let draft = null, movingId = null, busy = false, loading = false, errorText = '';
  let uploadTargetId = null, drag = null, suppressClickUntil = 0;
  let filters = emptyFilters(), viewMode = 'all', highlightedId = null;
  const current = () => maps.find(map => map.id === selectedId);
  const editable = marker => !repository || (marker.contractor_id === contractorId && isStorage(markerType(marker)));
  const photos = createLocationPhotos({ supabase, getWorkspace, getUser, repository, canReview, toast, onChange: async id => { await show(); return markers.find(row => row.id === id); } });
  const context = () => ({ workspaceId, revision });
  const isCurrent = ctx => ctx.workspaceId === workspaceId && ctx.workspaceId === getWorkspace()?.id && ctx.revision === revision;

  function reset() {
    photos.reset();
    cancelDrag();
    revision++;
    workspaceId = null;
    maps = []; markers = []; selectedId = null; imageUrl = '';
    draft = null; movingId = null; busy = false; loading = false; errorText = '';
    uploadTargetId = null; suppressClickUntil = 0; filters = emptyFilters(); viewMode = 'all'; highlightedId = null;
    root?.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    if (root) root.innerHTML = '';
    root = null;
  }

  function mount() {
    root = document.getElementById('hazardMapRoot');
    root.innerHTML = `
      <details class="hm-help"><summary>처음 사용하시나요? 관리 순서 보기</summary>
        <ol>${repository ? '<li><b>담당 위치 찾기</b><span>도면을 고르고, 분류나 조치 상태로 우리 업체의 항목을 찾으세요.</span></li><li><b>조치 사진 제출</b><span>위치 카드의 사진 / 조치 관리에서 조치 후 사진과 설명을 올리세요.</span></li><li><b>확인 결과 보기</b><span>관리자 확인 완료를 확인하세요. 재조치 의견이 있으면 보완 사진을 제출하세요.</span></li>' : '<li><b>도면 등록</b><span>도면·전경 업로드에서 PIT층 도면이나 현장 사진을 올리세요.</span></li><li><b>위치와 사진 등록</b><span>도면을 눌러 분류·이름·담당 업체를 지정하고 발견 사진을 첨부하세요.</span></li><li><b>업체 조치 → 관리자 확인</b><span>업체가 전용 사이트에서 조치 사진을 올리면, 관리자가 확인 완료하거나 재조치를 요청하세요.</span></li>'}</ol>
      </details>
      <div class="hm-toolbar">
        <div><label for="hmMapSelect">도면 / 전경 사진</label><select class="form-input" id="hmMapSelect" aria-label="전경 사진 선택"></select></div>
        <div class="hm-actions"><button type="button" class="btn btn-outline" id="hmRefresh">새로고침</button><button type="button" class="btn btn-primary" id="hmUpload">도면·전경 업로드</button></div>
      </div>
      <section id="hmOverview" class="hm-overview" aria-labelledby="hmOverviewTitle" hidden><div class="hm-overview-heading"><h2 id="hmOverviewTitle">부적합 진행 현황</h2><span>선택한 위치도 기준 · 누르면 모아보기</span></div><div class="hm-summary-grid">${[['all','부적합 전체'],['open','조치 전'],['pending','관리자 확인 전'],['verified','확인 완료']].map(([key,label])=>`<button class="hm-summary hm-state-${key}" type="button" data-quick-status="${key}" aria-pressed="false"><span>${label}</span><strong data-count="${key}">0</strong><small>${({all:'등록된 부적합',open:'조치가 필요해요',pending:repository?'검토를 기다려 주세요':'사진을 검토해 주세요',verified:'조치 확인을 마쳤어요'})[key]}</small></button>`).join('')}</div></section>
      <section id="hmFilters" class="hm-filters" aria-label="위치 검색 및 분류" hidden>
        <label class="hm-search-label">위치 찾기<input class="form-input" type="search" id="hmSearch" placeholder="위치명·업체·관리사항·물질명 검색" maxlength="200" /></label>
        <div class="hm-filter-fields"><label>위치 분류<select class="form-input" id="hmTypeFilter"><option value="all">모든 분류</option>${Object.entries(TYPES).map(([key,type])=>`<option value="${key}">${type.label}</option>`).join('')}</select></label><label>조치 상태<select class="form-input" id="hmStateFilter"><option value="all">모든 상태</option>${Object.entries(REVIEW_STATES).map(([key,state])=>`<option value="${key}">${state.label}</option>`).join('')}</select></label><label ${repository ? 'hidden' : ''}>담당 업체<select class="form-input" id="hmContractorFilter"></select></label></div>
        <div class="hm-filter-footer"><p id="hmFilterResult" role="status" aria-live="polite"></p><div class="hm-view-controls" role="group" aria-label="보기 방식"><button type="button" class="btn btn-outline" data-hm-view="all" aria-pressed="true">도면·목록</button><button type="button" class="btn btn-outline" data-hm-view="list" aria-pressed="false">목록만 보기</button><button type="button" class="btn btn-outline" id="hmClearFilters">조건 초기화</button></div></div>
      </section>
      <p id="hmStatus" class="hm-status" role="status" aria-live="polite"></p>
      <div id="hmBody"></div>
      <dialog class="hm-dialog" id="hmUploadDialog" aria-labelledby="hmUploadTitle">
        <form id="hmUploadForm">
          <div class="hm-dialog-heading"><h2 id="hmUploadTitle">전경 사진 업로드</h2><button type="button" class="btn btn-outline" data-close>닫기</button></div>
          <label>사진 이름 <span aria-hidden="true">*</span><input class="form-input" name="title" required maxlength="120" placeholder="예: PIT층 도면 / 현장 전체 전경 / 지하 1층" /></label>
          <label for="hmPhotoInput">도면 이미지 / 전경 사진 <span aria-hidden="true">*</span></label><div class="upload-dropzone upload-dropzone--field" data-upload-input="hmPhotoInput" role="button" tabindex="0"><strong>사진 선택 또는 여기에 드래그</strong><span>JPG · PNG · WebP · 최대 20MB</span><input id="hmPhotoInput" name="photo" type="file" accept="image/jpeg,image/png,image/webp" hidden /><span data-upload-status>선택된 파일 없음</span></div>
          <p class="hm-hint" id="hmUploadHint"></p>
          <p class="hm-form-error" role="alert"></p><button type="submit" class="btn btn-primary">업로드하기</button>
        </form>
      </dialog>
      <dialog class="hm-dialog" id="hmMarkerDialog" aria-labelledby="hmMarkerTitle">
        <form id="hmMarkerForm">
          <div class="hm-dialog-heading"><h2 id="hmMarkerTitle">스티커 등록</h2><button type="button" class="btn btn-outline" data-close>닫기</button></div>
          <p class="hm-hint">선택한 사진 위치에 저장됩니다.</p>
          <label>스티커 종류<select class="form-input" name="marker_type">${Object.entries(TYPES).map(([key, type]) => `<option value="${key}">${type.label}</option>`).join('')}</select></label>
          <p id="hmTypeHelp" class="hm-hint"></p>
          <label>이름 / 위치 <span aria-hidden="true">*</span><input class="form-input" name="storage_name" required maxlength="120" placeholder="예: 동측 위험물 저장소 / 101동 / 정문" /></label>
          <div>
            <label>담당 협력사<select class="form-input" name="contractor_id" aria-describedby="hmContractorHint"></select></label>
            <p class="hm-hint" id="hmContractorHint"></p>
          </div>
          <div id="hmStorageFields">
            <label>저장소 비밀번호<input class="form-input" name="access_code" type="text" maxlength="100" autocomplete="off" placeholder="예: 1234 (입력한 그대로 표시됩니다)" /></label>
            <fieldset class="hm-items-fieldset"><legend>물질별 수량</legend><div id="hmItemRows"></div><button type="button" class="btn btn-outline btn-sm" id="hmAddItem">+ 물질 추가</button></fieldset>
          </div>
          <label>내용 / 관리사항<textarea class="form-input" name="content" rows="4" maxlength="3000" placeholder="보관 내용, 주의사항, 점검사항 등을 입력하세요."></textarea></label>
          <label class="hm-save-photo-option"><input type="checkbox" name="add_photos" />저장 후 바로 사진 추가하기</label>
          <p class="hm-form-error" role="alert"></p><button type="submit" class="btn btn-primary">저장하기</button>
        </form>
      </dialog>`;
    if (repository) root.querySelector('#hmUpload').hidden = true;
    root.querySelector('#hmMapSelect').addEventListener('change', e => selectMap(e.target.value));
    root.querySelector('#hmSearch').addEventListener('input', e => { filters.query = e.target.value; render(); });
    for (const [id,key] of [['hmTypeFilter','type'],['hmStateFilter','status'],['hmContractorFilter','contractor']]) root.querySelector('#'+id).addEventListener('change',e=>{ filters[key]=e.target.value; render(); });
    root.querySelector('#hmClearFilters').addEventListener('click',()=>{ filters=emptyFilters(); render(); });
    root.querySelectorAll('[data-quick-status]').forEach(button=>button.addEventListener('click',()=>{ filters={...emptyFilters(),type:'issue',status:button.dataset.quickStatus}; render(); }));
    root.querySelectorAll('[data-hm-view]').forEach(button=>button.addEventListener('click',()=>{ viewMode=button.dataset.hmView; render(); }));
    root.querySelector('#hmRefresh').addEventListener('click', () => show());
    root.querySelector('#hmUpload').addEventListener('click', () => openUpload());
    root.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    root.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); }));
    root.querySelector('#hmUploadForm').addEventListener('submit', upload);
    root.querySelector('#hmMarkerForm').addEventListener('submit', saveMarker);
    root.querySelector('[name="marker_type"]').addEventListener('change', updateEditorType);
    root.querySelector('#hmAddItem').addEventListener('click', () => {
      if (root.querySelectorAll('.hm-item-row').length >= 50) { toast('물질은 최대 50개까지 입력할 수 있습니다.', 'warn'); return; }
      addItemRow(); root.querySelector('.hm-item-row:last-child input').focus();
    });
    root.querySelector('#hmItemRows').addEventListener('click', e => {
      if (e.target.closest('[data-remove-item]')) {
        e.target.closest('.hm-item-row').remove();
        if (!root.querySelector('.hm-item-row')) addItemRow();
      }
    });
    root.querySelector('#hmBody').addEventListener('click', handleBodyClick);
    root.querySelector('#hmBody').addEventListener('pointerdown', startDrag);
    root.querySelector('#hmBody').addEventListener('pointermove', moveDrag);
    root.querySelector('#hmBody').addEventListener('pointerup', endDrag);
    root.querySelector('#hmBody').addEventListener('pointercancel', cancelDrag);
    root.querySelector('#hmBody').addEventListener('lostpointercapture', cancelDrag);
    root.querySelector('#hmBody').addEventListener('keydown', e => {
      if (e.target.id === 'hmStage' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault(); placePoint({ x: 0.5, y: 0.5 });
      }
    });
  }

  function setBusy(value) {
    busy = value;
    root?.querySelectorAll('button, select, input, textarea').forEach(el => { el.disabled = value; });
  }

  function renderPin(marker, i) {
    const type = markerType(marker);
    const label = marker.storage_name;
    return `<button type="button" class="hm-pin hm-type-${type} ${marker.id === movingId || marker.id === highlightedId ? 'is-selected' : ''}" style="left:${marker.x * 100}%;top:${marker.y * 100}%;transform:translate(${marker.x < .25 ? 0 : marker.x > .75 ? -100 : -50}%,${marker.y < .2 ? 0 : marker.y > .8 ? -100 : -50}%)" data-action="${editable(marker) ? 'edit' : marker.contractor_id === contractorId ? 'photos' : 'view'}" data-id="${escape(marker.id)}" title="${escape(marker.storage_name)}${editable(marker) ? ' · 드래그하여 이동' : marker.contractor_id === contractorId ? ' · 조치 사진 관리' : ' · 공용 위치'}" aria-label="${i + 1}번 ${TYPES[type].label} ${escape(marker.storage_name)} ${editable(marker) ? '정보 수정' : marker.contractor_id === contractorId ? '조치 사진 관리' : '공용 위치'}">${icon(type)}<span>${escape(label)}</span></button>`;
  }

  function renderCard(marker, i) {
    const type = markerType(marker), items = markerItems(marker);
    const contractor = getContractors().find(row => row.id === marker.contractor_id);
    return `<article class="hm-storage-card ${marker.id === highlightedId ? 'is-highlighted' : ''}" data-location-id="${escape(marker.id)}" tabindex="-1"><div class="hm-storage-title"><span class="hm-number hm-type-${type}">${i + 1}</span><div><span class="hm-type-label">${TYPES[type].label}</span><h3>${escape(marker.storage_name)}</h3></div></div>
      ${isStorage(type) ? `<dl><div><dt>협력사</dt><dd>${escape(contractor?.name || (marker.contractor_id ? '목록에서 확인할 수 없는 협력사' : '미선택'))}</dd></div><div><dt>비밀번호</dt><dd>${escape(marker.access_code || '미입력')}</dd></div></dl>
      ${items.length ? `<table class="hm-items-table"><caption class="hm-sr-only">물질별 수량</caption><thead><tr><th scope="col">물질</th><th scope="col">수량</th></tr></thead><tbody>${items.map(item => `<tr><td>${escape(item.name)}</td><td>${escape(item.quantity || '미입력')}</td></tr>`).join('')}</tbody></table>` : '<p class="hm-hint">등록된 물질 없음</p>'}` : ''}
      ${!isStorage(type) && marker.contractor_id ? `<p class="hm-hint">담당 협력사: ${escape(contractor?.name || '지정 업체')}</p>` : ''}
      <p class="hm-review-status hm-badge-${reviewState(marker)}">${REVIEW_STATES[reviewState(marker)].label}${marker.reviewed_at ? ` · ${escape(new Date(marker.reviewed_at).toLocaleString('ko-KR'))}` : ''}</p>
      ${marker.review_note ? `<p class="hm-review-note"><b>관리자 의견</b> ${escape(marker.review_note)}</p>` : ''}
      ${marker.content ? `<p class="hm-content">${escape(marker.content)}</p>` : ''}
      ${!repository || marker.contractor_id === contractorId ? `<p class="hm-next-step">${markerType(marker) === 'issue' ? repository && reviewState(marker)==='pending' ? '사진 제출 완료 · 관리자의 확인을 기다려 주세요' : REVIEW_STATES[reviewState(marker)].hint : '위치별 발견 사진과 조치 이력을 관리하세요'}</p><button type="button" class="btn btn-outline hm-photo-button" data-action="photos" data-id="${escape(marker.id)}">📷 사진 / 조치 관리</button>` : ''}
      <button type="button" class="btn btn-outline btn-sm hm-locate" data-action="locate" data-id="${escape(marker.id)}">도면에서 위치 보기</button>
      ${editable(marker) ? `<div class="hm-actions"><button type="button" class="btn btn-outline btn-sm" data-action="edit" data-id="${escape(marker.id)}">정보 수정</button><button type="button" class="btn btn-outline btn-sm" data-action="move" data-id="${escape(marker.id)}">위치 이동</button><button type="button" class="btn btn-outline btn-sm" data-action="delete" data-id="${escape(marker.id)}">삭제</button></div>` : `<p class="hm-hint">${marker.contractor_id === contractorId ? '부적합 정보는 현장 관리자가 수정합니다. 조치 사진을 제출해 주세요.' : '현장 공용 위치'}</p>`}</article>`;
  }

  function syncFilters(visible) {
    const available = Boolean(current()) && !loading && !errorText;
    root.querySelector('#hmOverview').hidden = !available;
    root.querySelector('#hmFilters').hidden = !available;
    const counts=issueSummary(markers);
    root.querySelectorAll('[data-count]').forEach(el=>{ el.textContent=counts[el.dataset.count]; });
    root.querySelectorAll('[data-quick-status]').forEach(el=>el.setAttribute('aria-pressed',String(filters.type==='issue' && filters.status===el.dataset.quickStatus)));
    root.querySelector('#hmSearch').value=filters.query;
    root.querySelector('#hmTypeFilter').value=filters.type;
    root.querySelector('#hmStateFilter').value=filters.status;
    const companySelect=root.querySelector('#hmContractorFilter');
    companySelect.innerHTML='<option value="all">모든 업체</option><option value="unassigned">담당 업체 미지정</option>'+getContractors().map(row=>`<option value="${escape(row.id)}">${escape(row.name)}</option>`).join('');
    companySelect.value=filters.contractor;
    root.querySelector('#hmFilterResult').textContent=`${markers.length}개 중 ${visible.length}개 표시`;
    root.querySelectorAll('[data-hm-view]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.hmView===viewMode)));
  }

  function render() {
    if (!root) return;
    const select = root.querySelector('#hmMapSelect');
    select.innerHTML = maps.length ? maps.map(map => `<option value="${escape(map.id)}">${escape(map.title)}</option>`).join('') : '<option value="">등록된 사진 없음</option>';
    select.value = selectedId || '';
    select.disabled = busy || loading || !maps.length;
    root.querySelector('#hmRefresh').disabled = busy || loading;
    root.querySelector('#hmUpload').disabled = busy || loading;
    root.querySelector('#hmStatus').textContent = errorText || (loading ? '위치도를 불러오는 중입니다…' : movingId ? '사진에서 새 위치를 클릭하세요. Esc 키 또는 취소 버튼으로 취소할 수 있습니다.' : maps.length ? '사진을 클릭해 스티커를 추가하고, 스티커를 드래그해 위치를 옮기세요.' : '도면 이미지나 전경 사진을 올리고 저장소·창고·PIT층 부적합 위치를 표시하세요.');
    const visible=filterHazardMarkers(markers,filters,getContractors());
    syncFilters(visible);
    const body = root.querySelector('#hmBody');
    if (errorText) { body.innerHTML = '<div class="hm-empty"><p>위치도를 불러오지 못했습니다.</p><p>새로고침으로 다시 시도해 주세요.</p></div>'; return; }
    if (loading) { body.innerHTML = '<div class="hm-empty" aria-busy="true">사진과 저장소 정보를 불러오고 있습니다…</div>'; return; }
    if (!current()) {
      body.innerHTML = repository ? '<div class="hm-empty"><h2>등록된 위치도가 없습니다</h2><p>현장 담당자가 전경 사진을 등록하면 우리 협력사의 저장소 위치를 표시할 수 있습니다.</p></div>' : '<div class="hm-empty"><span class="hm-empty-icon" aria-hidden="true">📍</span><h2>사진 위에 표시하는 현장 위치도</h2><p>전경 사진 업로드 → 위치 클릭 → 스티커 정보 입력</p><p>물질별 수량과 협력사, 관리사항을 한곳에서 확인하세요.</p><button type="button" class="btn btn-primary" data-action="upload">첫 전경 사진 업로드</button></div>';
      return;
    }
    body.innerHTML = `<div class="hm-layout ${viewMode === 'list' ? 'hm-list-view' : ''}">
      <section class="hm-photo-card" aria-label="위험물 위치도 사진" ${viewMode === 'list' ? 'hidden' : ''}>
        <div class="hm-card-heading"><div><h2>${escape(current().title)}</h2><span>스티커 ${markers.length}개</span></div><div class="hm-actions"><button type="button" class="btn btn-outline btn-sm" data-action="add">+ 스티커 추가</button><button type="button" class="btn btn-outline btn-sm" data-action="replace-photo">사진 변경 (스티커 유지)</button><button type="button" class="btn btn-outline btn-sm" data-action="delete-map">위치도 삭제</button></div></div>
        <div class="hm-legend" aria-label="스티커 종류">${Object.entries(TYPES).map(([key, type]) => `<span class="hm-legend-item"><span class="hm-legend-icon hm-type-${key}">${icon(key)}</span>${type.label}</span>`).join('')}</div>
        ${movingId ? '<div class="hm-move-banner">이동할 위치를 클릭하세요.<button type="button" class="btn btn-outline btn-sm" data-action="cancel-move">이동 취소</button></div>' : ''}
        ${imageUrl ? `<div class="hm-photo-padding"><div class="hm-stage ${movingId ? 'is-moving' : ''}" id="hmStage" tabindex="0" role="group" aria-label="현장 위치도. 클릭하여 위치 선택. 키보드는 Enter로 중앙에 등록 후 위치 이동." aria-describedby="hmStatus"><img id="hmPhoto" src="${escape(imageUrl)}" width="${Number(current().width)}" height="${Number(current().height)}" alt="${escape(current().title)} 현장 전경" draggable="false" />${visible.map(marker=>renderPin(marker,markers.indexOf(marker))).join('')}</div></div>` : '<p class="hm-empty">사진을 표시할 수 없습니다. 새로고침을 눌러 주세요.</p>'}
        <p class="hm-photo-caption">스티커를 누르면 정보 수정, 드래그하면 위치 이동. 사진을 변경해도 스티커와 입력 정보는 유지됩니다.</p>
      </section>
      <section class="hm-list" aria-labelledby="hmListTitle"><h2 id="hmListTitle">위치별 관리 목록 <span>${visible.length}</span></h2>
        ${visible.length ? visible.map(marker=>renderCard(marker,markers.indexOf(marker))).join('') : markers.length ? '<div class="hm-list-empty"><b>조건에 맞는 위치가 없습니다.</b><p>다른 분류·상태를 선택하거나 검색 조건을 초기화해 주세요.</p><button type="button" class="btn btn-outline" data-action="clear-filters">모든 위치 보기</button></div>' : '<div class="hm-list-empty">아직 등록된 스티커가 없습니다.<br>사진에서 표시할 위치를 클릭해 주세요.</div>'}
      </section></div>`;
    if (repository) root.querySelectorAll('[data-action="replace-photo"],[data-action="delete-map"]').forEach(button => { button.hidden = true; });
    const photo = root.querySelector('#hmPhoto');
    if (photo) photo.addEventListener('error', () => {
      if (!photo.isConnected || root?.querySelector('#hmPhoto') !== photo) return;
      root.querySelector('#hmStatus').textContent = '사진을 표시할 수 없습니다. 새로고침을 눌러 주세요.';
    }, { once: true });
    if (busy) setBusy(true);
  }

  function report(error) {
    if (['42P01', 'PGRST205'].includes(error?.code)) return '위험물 위치도 저장 기능이 아직 준비되지 않았습니다. 데이터베이스 설정을 확인해 주세요.';
    return error?.message || '잠시 후 다시 시도해 주세요.';
  }

  async function show() {
    const ws = getWorkspace();
    if (!ws?.id) return;
    if (busy) return;
    if (workspaceId !== ws.id) { reset(); workspaceId = ws.id; }
    if (!root) mount();
    revision++;
    const ctx = context();
    loading = true; errorText = ''; movingId = null; render();
    try {
      const { data, error } = await (repository ? repository.listMaps() : supabase.from('hazard_maps').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }));
      if (error) throw error;
      if (!isCurrent(ctx)) return;
      maps = data || [];
      await selectMap(maps.some(map => map.id === selectedId) ? selectedId : maps[0]?.id);
    } catch (error) {
      if (isCurrent(ctx)) { loading = false; errorText = report(error); render(); }
    }
  }

  async function selectMap(id) {
    if (busy) return;
    revision++;
    const ctx = context();
    if (selectedId !== (id || null)) filters = emptyFilters();
    selectedId = id || null; markers = []; imageUrl = ''; movingId = null; draft = null; errorText = '';
    loading = Boolean(current()); render();
    if (!current()) return;
    try {
      const map = current();
      const [rows, signed] = await Promise.all([
        repository ? repository.listMarkers(map.id) : supabase.from('hazard_markers').select('*').eq('workspace_id', workspaceId).eq('map_id', map.id).order('created_at').order('id'),
        repository ? repository.image(map.id) : supabase.storage.from(BUCKET).createSignedUrl(map.storage_path, 3600),
      ]);
      if (rows.error) throw rows.error;
      if (signed.error) throw signed.error;
      if (!isCurrent(ctx)) return;
      markers = rows.data || []; imageUrl = signed.data.signedUrl;
      loading = false; render();
    } catch (error) {
      if (isCurrent(ctx)) { loading = false; errorText = report(error); render(); }
    }
  }

  function openEditor(marker) {
    if (busy || loading || !current() || (marker.id && !editable(marker))) return;
    draft = { ...marker };
    const form = root.querySelector('#hmMarkerForm');
    form.reset();
    for (const key of ['storage_name', 'access_code', 'content']) form.elements[key].value = marker[key] || '';
    form.elements.marker_type.value = marker.id ? markerType(marker) : (filters.type !== 'all' && (!repository || isStorage(filters.type)) ? filters.type : markerType(marker));
    const companies = getContractors();
    const unavailable = marker.contractor_id && !companies.some(row => row.id === marker.contractor_id);
    form.elements.contractor_id.innerHTML = '<option value="">협력사 선택</option>' + companies.map(row => `<option value="${escape(row.id)}">${escape(row.name)}</option>`).join('') + (unavailable ? `<option value="${escape(marker.contractor_id)}">목록에서 확인할 수 없는 협력사 (다시 선택해 주세요)</option>` : '');
    form.elements.contractor_id.value = repository ? contractorId : marker.contractor_id || '';
    if (repository) {
      form.elements.contractor_id.closest('label').hidden = true;
      for (const option of form.elements.marker_type.options) option.hidden = !isStorage(option.value);
    }
    root.querySelector('#hmContractorHint').textContent = companies.length ? '협력사 관리에 등록된 현장 협력사를 선택하세요.' : '등록된 협력사가 없습니다. 협력사 관리에서 등록한 뒤 선택할 수 있습니다.';
    root.querySelector('#hmItemRows').innerHTML = '';
    const items = markerItems(marker);
    (items.length ? items : [{}]).forEach(addItemRow);
    updateEditorType();
    form.querySelector('.hm-form-error').textContent = '';
    root.querySelector('#hmMarkerTitle').textContent = marker.id ? '스티커 정보 수정' : '스티커 등록';
    root.querySelector('#hmMarkerDialog').showModal();
    form.elements.storage_name.focus();
  }

  function addItemRow(item = {}) {
    root.querySelector('#hmItemRows').insertAdjacentHTML('beforeend', `<div class="hm-item-row"><label>물질명<input class="form-input" name="item_name" maxlength="200" placeholder="예: 신나" value="${escape(item.name || '')}" /></label><label>수량 (단위 포함)<input class="form-input" name="item_quantity" maxlength="120" placeholder="예: 20 L × 10통" value="${escape(item.quantity || '')}" /></label><button type="button" class="btn btn-outline btn-sm" data-remove-item aria-label="물질 삭제">삭제</button></div>`);
  }

  function updateEditorType() {
    const type=root.querySelector('#hmMarkerForm').elements.marker_type.value;
    root.querySelector('#hmStorageFields').hidden = !isStorage(type);
    root.querySelector('#hmTypeHelp').textContent=type==='issue'?'부적합 위치와 내용을 적고 담당 업체를 지정하세요. 업체 전용 사이트에서 조치 사진을 제출할 수 있습니다.':isStorage(type)?'저장소·창고의 담당 업체와 관리 정보를 입력하고 위치별 사진을 추가하세요.':'현장에서 찾기 쉬운 이름을 입력하세요. 동·게이트는 공용 위치로 안내할 수 있습니다.';
  }

  function openUpload(replace = false) {
    if (repository || busy || loading) return;
    const form = root.querySelector('#hmUploadForm');
    form.reset(); form.querySelector('.hm-form-error').textContent = '';
    uploadTargetId = replace ? selectedId : null;
    if (replace) form.elements.title.value = current().title;
    root.querySelector('#hmUploadTitle').textContent = replace ? '전경 사진 변경' : '전경 사진 업로드';
    root.querySelector('#hmUploadHint').textContent = replace
      ? '스티커 위치와 입력 정보는 그대로 유지됩니다. 사진 구도가 달라졌다면 변경 후 스티커를 드래그해 조정하세요. JPG, PNG, WebP · 최대 20 MB.'
      : 'JPG, PNG, WebP · 최대 20 MB. 도면 이미지도 업로드할 수 있습니다. 새 이미지는 별도 위치도로 저장됩니다.';
    form.querySelector('button[type="submit"]').textContent = replace ? '사진 변경하기' : '업로드하기';
    root.querySelector('#hmUploadDialog').showModal();
    (replace ? form.elements.photo : form.elements.title).focus();
  }

  async function placePoint(point) {
    if (!point || busy || loading || !current()) return;
    if (!movingId) { openEditor(point); return; }
    await updatePosition(movingId, point);
  }

  async function updatePosition(id, point) {
    const ctx = context();
    setBusy(true);
    try {
      const { data, error } = await (repository ? repository.move(id, selectedId, point) : supabase.from('hazard_markers').update(point).eq('id', id).eq('workspace_id', workspaceId).eq('map_id', selectedId).select().single());
      if (error) throw error;
      if (!isCurrent(ctx)) return;
      markers = markers.map(marker => marker.id === id ? data : marker);
      movingId = null; toast('스티커 위치를 변경했습니다', 'success');
    } catch (error) { if (isCurrent(ctx)) toast('위치 변경 실패: ' + report(error), 'error'); }
    finally { if (isCurrent(ctx)) { setBusy(false); render(); } }
  }

  function startDrag(e) {
    const pin = e.target.closest('.hm-pin');
    if (!pin || busy || loading || drag || !e.isPrimary || e.button !== 0) return;
    const marker = markers.find(row => row.id === pin.dataset.id);
    if (!marker || !editable(marker) || !root.querySelector('#hmPhoto')?.naturalWidth) return;
    e.preventDefault();
    suppressClickUntil = 0;
    pin.focus({ preventScroll: true });
    drag = { id: marker.id, element: pin, pointerId: e.pointerId, ctx: context(), startX: e.clientX, startY: e.clientY, x: marker.x, y: marker.y, point: { x: marker.x, y: marker.y }, moved: false };
    pin.setPointerCapture(e.pointerId);
  }

  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId || !isCurrent(drag.ctx)) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    e.preventDefault();
    const rect = root.querySelector('#hmPhoto').getBoundingClientRect();
    drag.point = relativePoint(rect.left + drag.x * rect.width + dx, rect.top + drag.y * rect.height + dy, rect);
    if (!drag.point) return;
    drag.moved = true;
    drag.element.classList.add('is-dragging');
    drag.element.style.left = `${drag.point.x * 100}%`;
    drag.element.style.top = `${drag.point.y * 100}%`;
  }

  function releaseDrag() {
    const previous = drag;
    drag = null;
    if (previous?.element.hasPointerCapture(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId);
    return previous;
  }

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const previous = releaseDrag();
    if (!previous.moved || !isCurrent(previous.ctx)) return;
    e.preventDefault();
    suppressClickUntil = performance.now() + 700;
    updatePosition(previous.id, previous.point);
  }

  function cancelDrag() {
    if (!drag) return;
    const previous = releaseDrag();
    if (previous.moved && isCurrent(previous.ctx)) { suppressClickUntil = performance.now() + 700; render(); }
  }

  function handleBodyClick(e) {
    if (busy || loading || (performance.now() < suppressClickUntil && e.target.closest('.hm-pin'))) return;
    const button = e.target.closest('[data-action]');
    if (button) {
      const marker = markers.find(row => row.id === button.dataset.id);
      switch (button.dataset.action) {
        case 'locate': if (marker) { highlightedId=marker.id; viewMode='all'; render(); root.querySelector('#hmStage')?.scrollIntoView({behavior:'smooth',block:'center'}); root.querySelector('#hmStage')?.focus({preventScroll:true}); } break;
        case 'view': if(marker) { highlightedId=marker.id; render(); const card=[...root.querySelectorAll('[data-location-id]')].find(el=>el.dataset.locationId===marker.id); card?.scrollIntoView({behavior:'smooth',block:'center'}); card?.focus({preventScroll:true}); } break;
        case 'clear-filters': filters=emptyFilters(); render(); break;
        case 'photos': if (marker) photos.open(marker); break;
        case 'upload': root.querySelector('#hmUpload').click(); break;
        case 'add': openEditor({ x: 0.5, y: 0.5 }); break;
        case 'replace-photo': openUpload(true); break;
        case 'edit': if (marker) openEditor(marker); break;
        case 'move': if (marker && !editable(marker)) return; movingId = marker?.id || null; viewMode = 'all'; render(); root.querySelector('#hmStage')?.focus(); break;
        case 'cancel-move': movingId = null; render(); break;
        case 'delete': if (marker) deleteMarker(marker); break;
        case 'delete-map': deleteMap(); break;
      }
      return;
    }
    const stage = e.target.closest('#hmStage'), photo = root.querySelector('#hmPhoto');
    if (stage && photo?.complete && photo.naturalWidth) placePoint(relativePoint(e.clientX, e.clientY, photo.getBoundingClientRect()));
  }

  async function saveMarker(e) {
    e.preventDefault();
    if (busy || !draft || !current()) return;
    const form = e.target, ctx = context();
    const values = Object.fromEntries(['storage_name', 'access_code', 'content', 'marker_type'].map(key => [key, form.elements[key].value.trim()]));
    values.contractor_id = form.elements.contractor_id.value || null;
    values.items = [...form.querySelectorAll('.hm-item-row')].map(row => ({ name: row.querySelector('[name="item_name"]').value.trim(), quantity: row.querySelector('[name="item_quantity"]').value.trim() })).filter(item => item.name || item.quantity);
    if (!values.storage_name) { form.elements.storage_name.focus(); return; }
    if (isStorage(values.marker_type) && values.items.some(item => !item.name)) {
      form.querySelector('.hm-form-error').textContent = '수량을 입력한 물질의 이름도 입력해 주세요.';
      return;
    }
    const id = draft.id;
    setBusy(true);
    try {
      const query = repository ? null : id
        ? supabase.from('hazard_markers').update(values).eq('id', id).eq('workspace_id', workspaceId).eq('map_id', selectedId)
        : supabase.from('hazard_markers').insert({ ...values, map_id: selectedId, workspace_id: workspaceId, x: draft.x, y: draft.y, created_by: getUser().id });
      const { data, error } = repository ? await repository.save(id, selectedId, { ...values, x: draft.x, y: draft.y }) : await query.select().single();
      if (error) throw error;
      if (!isCurrent(ctx)) return;
      if (id) markers = markers.map(marker => marker.id === id ? data : marker);
      else markers.push(data);
      root.querySelector('#hmMarkerDialog').close();
      toast('스티커 정보를 저장했습니다', 'success');
      if(form.elements.add_photos.checked) photos.open(data);

    } catch (error) { if (isCurrent(ctx)) form.querySelector('.hm-form-error').textContent = '저장 실패: ' + report(error); }
    finally { if (isCurrent(ctx)) { setBusy(false); render(); } }
  }

  async function upload(e) {
    e.preventDefault();
    if (busy) return;
    const form = e.target, file = form.elements.photo.files[0], title = form.elements.title.value.trim(), ctx = context();
    const message = form.querySelector('.hm-form-error');
    if (!title) { form.elements.title.focus(); return; }
    if (!file || !IMAGE_TYPES[file.type]) { message.textContent = 'JPG, PNG, WebP 사진을 선택해 주세요.'; return; }
    if (file.size > MAX_BYTES) { message.textContent = '20 MB 이하의 사진을 선택해 주세요.'; return; }
    message.textContent = '';
    setBusy(true);
    const userId = getUser().id;
    const replacement = uploadTargetId ? maps.find(map => map.id === uploadTargetId) : null;
    const id = replacement?.id || crypto.randomUUID(), path = `${workspaceId}/${id}/${crypto.randomUUID()}.${IMAGE_TYPES[file.type]}`;
    let uploaded = false, committed = false;
    try {
      const image = await createImageBitmap(file);
      const width = image.width, height = image.height;
      image.close();
      if (!width || !height) throw new Error('사진을 읽을 수 없습니다.');
      if (!isCurrent(ctx)) return;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      uploaded = true;
      if (!isCurrent(ctx)) { await supabase.storage.from(BUCKET).remove([path]); return; }
      const query = replacement
        ? supabase.from('hazard_maps').update({ title, storage_path: path, width, height }).eq('id', id).eq('workspace_id', ctx.workspaceId).eq('storage_path', replacement.storage_path)
        : supabase.from('hazard_maps').insert({ id, workspace_id: ctx.workspaceId, title, storage_path: path, width, height, created_by: userId });
      const { data, error } = await query.select().single();
      if (error) throw error;
      committed = true;
      let cleanupError = null;
      if (replacement) {
        const cleanup = await supabase.storage.from(BUCKET).remove([replacement.storage_path]);
        cleanupError = cleanup.error;
      }
      if (!isCurrent(ctx)) return;
      if (replacement) maps = maps.map(map => map.id === id ? data : map);
      else maps.unshift(data);
      root.querySelector('#hmUploadDialog').close();
      setBusy(false);
      await selectMap(id);
      if (workspaceId === ctx.workspaceId) toast(cleanupError ? '사진은 변경했지만 이전 원본 파일 정리가 필요합니다.' : replacement ? '스티커를 유지하고 전경 사진을 변경했습니다.' : '전경 사진을 업로드했습니다. 사진에서 표시할 위치를 클릭하세요.', cleanupError ? 'warn' : 'success');
    } catch (error) {
      if (uploaded && !committed) await supabase.storage.from(BUCKET).remove([path]);
      if (isCurrent(ctx)) message.textContent = '업로드 실패: ' + report(error);
    } finally { if (isCurrent(ctx)) { setBusy(false); render(); } }
  }

  async function deleteMarker(marker) {
    if (!editable(marker) || !confirm(`“${marker.storage_name}” 스티커를 삭제하시겠습니까?`)) return;
    const ctx = context();
    setBusy(true);
    try {
      const attachments = repository ? {data:[]} : await supabase.from('hazard_location_photos').select('storage_path').eq('workspace_id', ctx.workspaceId).eq('marker_id', marker.id);
      if (attachments.error) throw attachments.error;
      const { data, error } = await (repository ? repository.remove(marker.id, selectedId) : supabase.from('hazard_markers').delete().eq('id', marker.id).eq('workspace_id', workspaceId).eq('map_id', selectedId).select('id').single());
      if (error || !data) throw error || new Error('이미 삭제되었거나 삭제 권한이 없습니다.');
      const cleanup = attachments.data.length ? await supabase.storage.from('hazard-location-photos').remove(attachments.data.map(row => row.storage_path)) : {};
      if (!isCurrent(ctx)) return;
      markers = markers.filter(row => row.id !== marker.id);
      if (movingId === marker.id) movingId = null;
      toast(cleanup.error ? '스티커는 삭제했지만 사진 파일 정리가 필요합니다.' : '스티커와 첨부 사진을 삭제했습니다', cleanup.error ? 'warn' : 'success');
    } catch (error) { if (isCurrent(ctx)) toast('삭제 실패: ' + report(error), 'error'); }
    finally { if (isCurrent(ctx)) { setBusy(false); render(); } }
  }

  async function deleteMap() {
    const map = current();
    if (repository || !map || !confirm(`“${map.title}” 사진과 스티커 ${markers.length}개를 모두 삭제하시겠습니까? 사진만 바꾸려면 ‘사진 변경’을 이용하세요.`)) return;
    const ctx = context();
    setBusy(true);
    try {
      const attachments = markers.length ? await supabase.from('hazard_location_photos').select('storage_path').eq('workspace_id', ctx.workspaceId).in('marker_id', markers.map(row => row.id)) : {data:[]};
      if (attachments.error) throw attachments.error;
      const { data, error } = await supabase.from('hazard_maps').delete().eq('id', map.id).eq('workspace_id', workspaceId).select('id').single();
      if (error || !data) throw error || new Error('이미 삭제되었거나 삭제 권한이 없습니다.');
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([map.storage_path]);
      const cleanup = attachments.data.length ? await supabase.storage.from('hazard-location-photos').remove(attachments.data.map(row => row.storage_path)) : {};
      if (!isCurrent(ctx)) return;
      maps = maps.filter(row => row.id !== map.id);
      setBusy(false);
      await selectMap(maps[0]?.id);
      toast(storageError || cleanup.error ? '위치도는 삭제했지만 사진 파일 정리가 필요합니다.' : '위치도와 스티커, 첨부 사진을 삭제했습니다', storageError || cleanup.error ? 'warn' : 'success');
    } catch (error) { if (isCurrent(ctx)) toast('사진 삭제 실패: ' + report(error), 'error'); }
    finally { if (isCurrent(ctx)) { setBusy(false); render(); } }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drag) { cancelDrag(); return; }
    if (e.key === 'Escape' && movingId && !busy) { movingId = null; render(); }
  });
  return { show, reset };
}

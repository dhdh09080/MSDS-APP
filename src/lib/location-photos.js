import { REVIEW_STATES, reviewState } from './hazard-map-filters.js';
const BUCKET = 'hazard-location-photos';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Resize one image at a time to bound memory and upload traffic on phones.
export async function prepareLocationPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일을 선택해 주세요.');
  if (file.size > 20 * 1024 * 1024) throw new Error('사진 한 장은 20 MB 이하여야 합니다.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('이 사진 형식을 읽을 수 없습니다. JPG·PNG로 변환하거나 카메라 호환성 모드로 촬영해 주세요.'); }
  try {
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .85));
    if (!blob) throw new Error('사진을 변환하지 못했습니다.');
    return blob;
  } finally { bitmap.close(); }
}

export function createLocationPhotos({supabase, getWorkspace, getUser, repository, canReview = () => false, toast, onChange}) {
  let dialog, marker, generation = 0, busy = false, entries = [], photoFilter = 'all';
  const current = (seq, ws) => seq === generation && ws === getWorkspace()?.id;
  function reset() { generation++; dialog?.remove(); dialog = null; marker = null; busy = false; entries = []; photoFilter = 'all'; }
  function lock(value) { busy = value; dialog?.querySelectorAll('button,input,select,textarea').forEach(el => { el.disabled = value; });
    const verify=dialog?.querySelector('[data-review=verified]');
    if(verify) verify.disabled=value || !entries.some(row=>row.kind==='remedy');
  }
  function message(value) { if (dialog) dialog.querySelector('[data-message]').textContent = value; }
  async function load(seq, ws) {
    const result = repository ? await repository.listPhotos(marker) : await supabase.from('hazard_location_photos').select('*').eq('workspace_id', ws).eq('marker_id', marker.id).order('created_at');
    if (result.error) throw result.error;
    const rows = await Promise.all((result.data || []).map(async row => {
      if (row.signed_url) return row;
      const r = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 3600);
      if (r.error) throw r.error;
      return {...row, signed_url:r.data.signedUrl};
    }));
    if (!current(seq, ws)) return;
    entries = rows;
    renderGallery();
  }
  function renderGallery() {
    const rows=entries.filter(row=>photoFilter==='all' || row.kind===photoFilter);
    dialog.querySelectorAll('[data-photo-filter]').forEach(button=>{
      const key=button.dataset.photoFilter;
      button.setAttribute('aria-pressed',String(key===photoFilter));
      button.querySelector('span').textContent=entries.filter(row=>key==='all'||row.kind===key).length;
    });
    dialog.querySelector('[data-gallery]').innerHTML = rows.length ? rows.map(row => `<figure><a href="${escape(row.signed_url)}" target="_blank" rel="noopener noreferrer"><img src="${escape(row.signed_url)}" alt="${row.kind === 'remedy' ? '조치' : '발견'} 사진" loading="lazy"></a><figcaption><b class="lp-kind lp-kind-${row.kind==='remedy'?'remedy':'finding'}">${row.kind === 'remedy' ? '조치 후' : '발견 현장'}</b><time>${escape(new Date(row.created_at).toLocaleString('ko-KR'))}</time><p class="lp-note">${escape(row.note)}</p></figcaption>${!repository ? `<button class="btn btn-outline" type="button" data-delete="${escape(row.id)}">사진 삭제</button>` : ''}</figure>`).join('') : '<p class="hm-hint lp-empty">이 분류에 등록된 사진이 없습니다. 위에서 사진을 촬영하거나 선택해 주세요.</p>';
    const hint=dialog.querySelector('[data-review-hint]');
    if(hint) hint.textContent=entries.some(row=>row.kind==='remedy')?'조치 사진을 확인한 후 아래에서 확인 결과를 저장하세요.':'조치 사진이 등록되면 확인 완료할 수 있습니다.';
  }
  function updateStatus() {
    if(!dialog || !marker) return;
    const state=reviewState(marker), el=dialog.querySelector('[data-status]');
    el.textContent=REVIEW_STATES[state].label;
    el.className=`hm-review-status hm-badge-${state}`;
    const note=dialog.querySelector('[data-review-note-display]');
    note.textContent=marker.review_note ? '관리자 의견: '+marker.review_note : '';
    note.hidden=!marker.review_note;
  }

  async function open(row) {
    if (busy) return;
    reset(); marker = {...row};
    const seq = generation, ws = getWorkspace()?.id;
    dialog = document.createElement('dialog'); dialog.className = 'hm-dialog lp-dialog';
    dialog.setAttribute('aria-label', '위치별 사진 및 조치 관리');
    dialog.innerHTML = `
      <div class="hm-dialog-heading"><div><span class="lp-eyebrow">위치별 사진 · 조치 이력</span><h2>${escape(row.storage_name)}</h2></div><button type="button" class="btn btn-outline" data-close>닫기</button></div>
      <div class="lp-status-panel"><p data-status></p><p class="hm-hint">${repository ? '조치 사진 제출 → 관리자 검토 → 확인 완료' : '발견 사진 등록 → 업체 조치 사진 제출 → 관리자 확인'}</p><p data-review-note-display class="hm-review-note" hidden></p></div>
      <section class="lp-upload-panel" aria-labelledby="lpUploadHeading"><h3 id="lpUploadHeading">사진 등록하기</h3><p class="hm-hint">${repository ? '현장 조치 후 사진을 올려 주세요. ' : ''}촬영하거나 사진을 선택하면 바로 저장됩니다.</p>
        <label>어떤 사진인가요?<select class="form-input" data-kind><option value="finding">발견 현장 사진 · 조치 전 모습</option><option value="remedy" ${repository ? 'selected' : ''}>조치 후 사진 · 개선한 모습</option></select></label>
        <label>사진 설명 / 조치 내용<textarea class="form-input" data-note maxlength="2000" rows="2" placeholder="예: PIT층 통로 적치물 제거 완료"></textarea></label>
        <div class="lp-controls"><button type="button" class="btn btn-primary" data-camera>📷 바로 촬영</button><button type="button" class="btn btn-outline" data-album>사진 여러 장 선택</button></div>
        <input type="file" data-camera-input accept="image/*" capture="environment" hidden><input type="file" data-album-input accept="image/*" multiple hidden>
        <p class="hm-hint">한 번에 최대 30장 · 한 장 최대 20 MB · 전송 전 크기 자동 조정</p><p data-message class="lp-progress" role="status" aria-live="polite"></p>
      </section>
      <section class="lp-history" aria-labelledby="lpHistoryHeading"><h3 id="lpHistoryHeading">등록된 사진 확인</h3><p class="hm-hint">사진을 누르면 크게 볼 수 있습니다. 새 창에서 열립니다.</p><div class="lp-photo-filters" role="group" aria-label="사진 분류">${[['all','전체'],['finding','발견 사진'],['remedy','조치 사진']].map(([key,label])=>`<button class="btn btn-outline" type="button" data-photo-filter="${key}" aria-pressed="${key==='all'}">${label} <span>0</span></button>`).join('')}</div><div data-gallery class="lp-gallery"></div></section>
      ${!repository && canReview() ? '<section class="lp-review-panel" aria-labelledby="lpReviewHeading"><h3 id="lpReviewHeading">관리자 확인</h3><p class="hm-hint" data-review-hint></p><label>관리자 확인 의견<textarea class="form-input" data-review-note maxlength="2000" rows="2" placeholder="확인 의견 또는 재조치가 필요한 내용을 입력하세요"></textarea></label><div class="lp-controls"><button type="button" class="btn btn-primary" data-review="verified">확인 완료</button><button type="button" class="btn btn-outline" data-review="open">재조치 요청</button></div></section>' : ''}`;
    document.body.append(dialog);
    dialog.querySelector('[data-close]').onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.querySelector('[data-camera]').onclick = () => dialog.querySelector('[data-camera-input]').click();
    dialog.querySelector('[data-album]').onclick = () => dialog.querySelector('[data-album-input]').click();
    dialog.querySelectorAll('input[type=file]').forEach(input => input.addEventListener('change', () => upload([...input.files], seq, ws).finally(() => { input.value = ''; })));
    dialog.addEventListener('click', e => {
      const filter=e.target.closest('[data-photo-filter]');
      if(filter && !busy) { photoFilter=filter.dataset.photoFilter; renderGallery(); }
      const review = e.target.closest('[data-review]');
      if (review) reviewMarker(review.dataset.review, seq, ws);
      const remove = e.target.closest('[data-delete]');
      if (remove) removePhoto(remove.dataset.delete, seq, ws);
    });
    updateStatus();
    dialog.showModal(); lock(true); message('사진을 불러오는 중입니다…');
    try { await load(seq, ws); if (current(seq, ws)) message(''); }
    catch (error) { if (current(seq, ws)) message('사진 조회 실패: ' + error.message); }
    finally { if (current(seq, ws)) lock(false); }
  }
  async function upload(files, seq, ws) {
    if (busy || !files.length) return;
    if (files.length > 30) { message('한 번에 최대 30장까지 선택해 주세요.'); return; }
    const kind = dialog.querySelector('[data-kind]').value, note = dialog.querySelector('[data-note]').value.trim();
    lock(true); let saved = 0; const failed = [];
    for (const [i, file] of files.entries()) {
      if (!current(seq, ws)) break;
      message(`${i + 1} / ${files.length}장 업로드 중…`);
      let path, uploaded = false, committed = false;
      try {
        const blob = await prepareLocationPhoto(file);
        if (!current(seq, ws)) break;
        if (repository) {
          const r = await repository.uploadPhoto(marker, blob, kind, note);
          if (r.error) throw r.error;
        } else {
          path = `${ws}/${marker.id}/${crypto.randomUUID()}.jpg`;
          const r = await supabase.storage.from(BUCKET).upload(path, blob, {contentType:'image/jpeg', upsert:false});
          if (r.error) throw r.error;
          uploaded = true;
          const result = await supabase.from('hazard_location_photos').insert({workspace_id:ws, marker_id:marker.id, storage_path:path, kind, note, created_by:getUser().id});
          if (result.error) throw result.error;
          committed = true;
        }
        saved++;
      } catch (error) { failed.push(`${file.name}: ${error.message}`); }
      finally { if (uploaded && !committed) await supabase.storage.from(BUCKET).remove([path]); }
    }
    try {
      if (current(seq, ws)) {
        await load(seq, ws);
        message(`${saved}장 저장 완료${failed.length ? `\n실패 ${failed.length}장 (실패한 사진만 다시 선택해 주세요)\n${failed.join('\n')}` : ''}`);
        if (saved) {
          dialog.querySelector('[data-status]').textContent = kind === 'remedy' ? '관리자 확인 전' : '조치 전';
          marker = await onChange(marker.id) || marker; updateStatus();
        }
      }
    } catch (error) { if (current(seq, ws)) message('사진은 저장됐지만 새로고침이 필요합니다: ' + error.message); }
    finally { if (current(seq, ws)) lock(false); }
  }
  async function reviewMarker(status, seq, ws) {
    if (busy || repository) return;
    if (status === 'open' && !dialog.querySelector('[data-review-note]').value.trim()) { message('재조치 요청 내용을 입력해 주세요.'); return; }
    lock(true);
    try {
      const r = await supabase.rpc('review_hazard_marker', {p_marker_id:marker.id, p_status:status, p_note:dialog.querySelector('[data-review-note]').value.trim(), p_photo_revision:marker.photo_revision || 0});
      if (r.error) throw r.error;
      if (!current(seq, ws)) return;
      marker = r.data;
      dialog.querySelector('[data-status]').textContent = status === 'verified' ? '관리자 확인 완료' : '조치 전 · 재조치 요청';
      message('관리자 확인 상태를 저장했습니다.'); marker = await onChange(marker.id) || marker; updateStatus();
    } catch (error) { if (current(seq, ws)) message('확인 실패: ' + error.message); }
    finally { if (current(seq, ws)) lock(false); }
  }
  async function removePhoto(id, seq, ws) {
    if (busy || repository || !confirm('이 사진을 삭제하시겠습니까?')) return;
    const row = entries.find(r => r.id === id); if (!row) return;
    lock(true);
    try {
      const r = await supabase.from('hazard_location_photos').delete().eq('id', id).eq('workspace_id', ws).select('id').single();
      if (r.error) throw r.error;
      const cleanup = await supabase.storage.from(BUCKET).remove([row.storage_path]);
      if (!current(seq, ws)) return;
      await load(seq, ws); message(cleanup.error ? '사진은 삭제했지만 파일 정리가 필요합니다.' : '사진을 삭제했습니다.'); marker = await onChange(marker.id) || marker; updateStatus();
    } catch (error) { if (current(seq, ws)) message('삭제 실패: ' + error.message); }
    finally { if (current(seq, ws)) lock(false); }
  }
  return {open, reset};
}

import {saveLocationPhoto} from './location-photos.js';
import {PHOTO_KINDS} from './hazard-map-filters.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Files stay on the device until the sticker form is saved. Only failed files
// remain queued after a partial save; retrying never duplicates successful ones.
export function createMarkerPhotoDraft({supabase,repository,getUser}) {
  let root, entries=[];
  function remove(id) {
    const entry=entries.find(row=>row.id===id);
    if(entry) URL.revokeObjectURL(entry.url);
    entries=entries.filter(row=>row.id!==id);
  }
  function render() {
    if(!root) return;
    root.querySelector('[data-draft-count]').textContent=`첨부할 사진 ${entries.length}장`;
    root.querySelector('[data-draft-previews]').innerHTML=entries.map(entry=>`<figure><img src="${entry.url}" alt="${escape(entry.file.name)} 미리보기"><figcaption>${PHOTO_KINDS[entry.kind]} · ${escape(entry.file.name)}${entry.note?`<span>${escape(entry.note)}</span>`:''}</figcaption><button type="button" class="btn btn-outline" data-remove-photo="${entry.id}" aria-label="${escape(entry.file.name)} 첨부 취소">첨부 취소</button></figure>`).join('');
  }
  function reset() {
    entries.forEach(entry=>URL.revokeObjectURL(entry.url)); entries=[];
    if(root) {
      root.querySelectorAll('input[type=file]').forEach(input=>{input.value='';});
      root.querySelector('[data-draft-kind]').value='record';
      root.querySelector('[data-draft-note]').value='';
      root.querySelector('[data-draft-message]').textContent='';
    }
    render();
  }
  function add(files) {
    const errors=[];
    for(const file of files) {
      if(entries.length>=30) {errors.push('사진은 최대 30장까지 첨부할 수 있습니다.');break;}
      if(!file.type.startsWith('image/')) {errors.push(`${file.name}: 이미지 파일을 선택해 주세요.`);continue;}
      if(file.size>20*1024*1024) {errors.push(`${file.name}: 한 장당 20 MB 이하로 선택해 주세요.`);continue;}
      entries.push({id:crypto.randomUUID(),file,url:URL.createObjectURL(file),kind:root.querySelector('[data-draft-kind]').value,note:root.querySelector('[data-draft-note]').value.trim()});
    }
    root.querySelector('[data-draft-message]').textContent=errors.join('\n'); render();
  }
  function mount(element) {
    reset(); root=element;
    root.innerHTML=`<h3>사진 첨부 <small>선택 사항</small></h3><p class="hm-hint">여기서 촬영하거나 사진을 선택하세요. 아래 저장하기를 누르면 스티커와 함께 저장됩니다.</p><div class="hm-draft-fields"><label>사진 구분<select class="form-input" data-draft-kind><option value="record">일반 기록 · 조치 요청 안 함</option><option value="finding">조치 요청 · 조치 전으로 등록</option><option value="remedy">조치 후 사진</option></select></label><label>첨부할 사진 설명<input class="form-input" data-draft-note maxlength="2000" placeholder="예: PIT층 통로 적치 상태"></label></div><div class="lp-controls"><button type="button" class="btn btn-primary" data-draft-camera>📷 바로 촬영</button><button type="button" class="btn btn-outline" data-draft-album>사진 여러 장 선택</button></div><input type="file" data-draft-camera-input accept="image/*" capture="environment" hidden><input type="file" data-draft-album-input accept="image/*" multiple hidden><p class="hm-hint">‘조치 요청’을 선택한 사진만 조치 전으로 등록됩니다. 최대 30장 · 한 장 20 MB 이하 · 구분과 설명은 사진 선택 시 적용됩니다.</p><p data-draft-count class="hm-draft-count" aria-live="polite"></p><div data-draft-previews class="hm-draft-previews"></div><p data-draft-message class="hm-draft-message" role="status" aria-live="polite"></p>`;
    root.querySelector('[data-draft-camera]').onclick=()=>root.querySelector('[data-draft-camera-input]').click();
    root.querySelector('[data-draft-album]').onclick=()=>root.querySelector('[data-draft-album-input]').click();
    root.querySelectorAll('input[type=file]').forEach(input=>input.addEventListener('change',()=>{add([...input.files]);input.value='';}));
    root.addEventListener('click',e=>{const button=e.target.closest('[data-remove-photo]');if(button){remove(button.dataset.removePhoto);render();}});
    render();
  }
  async function save(marker,isActive,onProgress) {
    const pending=[...entries],failed=[];let saved=0;
    const userId=getUser()?.id;
    for(const [i,entry] of pending.entries()) {
      if(!isActive()) break;
      onProgress(`스티커 저장 완료 · 사진 ${i+1}/${pending.length}장 저장 중…`);
      try {
        await saveLocationPhoto({supabase,repository,marker,file:entry.file,kind:entry.kind,note:entry.note,userId,isActive});
        saved++;
        if(isActive()) remove(entry.id);
      } catch(error) {failed.push(`${entry.file.name}: ${error.message}`);}
    }
    if(isActive()) render();
    return {saved,failed};
  }
  return {mount,reset,save,get count(){return entries.length;}};
}

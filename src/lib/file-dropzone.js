import { acceptsUpload, collectDroppedFiles } from './upload-files.js';
import './file-dropzone.css';

const installed = new WeakSet();
/** Delegate to dynamic upload areas as well as initial HTML; existing change handlers do the work. */
export function installFileDropzones({root = document, onError = () => {}} = {}) {
  if (installed.has(root)) return;
  installed.add(root);
  const doc = root.ownerDocument || root;
  const pending = new WeakSet();
  const zoneFor = event => event.target instanceof Element ? event.target.closest('[data-upload-input]') : null;
  const inputFor = zone => doc.getElementById(zone.dataset.uploadInput);
  const ready = (zone, input) => input?.type === 'file' && !input.matches(':disabled')
    && !zone.matches(':disabled,[aria-disabled="true"]') && !zone.closest('[inert],[hidden]')
    && zone.isConnected && zone.getClientRects().length > 0;
  function prepare(zone) {
    const target = zone.dataset.uploadValueTarget;
    if (target) {
      const field = doc.getElementById(target);
      if (!field) throw new Error('업로드 대상을 찾을 수 없습니다. 화면을 새로고침해주세요.');
      field.value = zone.dataset.uploadValue || '';
    }
  }
  root.addEventListener('click', event => {
    const zone = zoneFor(event);
    if (!zone || event.defaultPrevented) return;
    const input = inputFor(zone);
    if (event.target === input || zone.hasAttribute('onclick') || zone.tagName === 'LABEL') return;
    const control = event.target.closest('button,a,input,select,textarea');
    if (control && control !== zone) return;
    if (!ready(zone, input)) return;
    try { prepare(zone); input.value = ''; input.click(); }
    catch (error) { onError(error.message); }
  });
  root.addEventListener('keydown', event => {
    const zone = zoneFor(event);
    if (!zone || event.defaultPrevented || !['Enter',' '].includes(event.key)
      || zone.matches('button,input,select,textarea,a[href]') || event.target !== zone) return;
    const input = inputFor(zone);
    if (!ready(zone, input)) return;
    event.preventDefault();
    try { prepare(zone); input.value = ''; input.click(); }
    catch (error) { onError(error.message); }
  });
  root.addEventListener('dragover', event => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    const zone = zoneFor(event), input = zone && inputFor(zone);
    if (zone && ready(zone, input)) { zone.classList.add('upload-dragover'); event.dataTransfer.dropEffect = 'copy'; }
  });
  root.addEventListener('dragleave', event => {
    const zone = zoneFor(event);
    if (zone && !(event.relatedTarget instanceof Node && zone.contains(event.relatedTarget))) zone.classList.remove('upload-dragover');
  });
  root.addEventListener('drop', async event => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    // Dropping outside an upload area must not navigate away from unsaved work.
    event.preventDefault();
    const zone = zoneFor(event);
    if (!zone) return;
    event.stopPropagation(); zone.classList.remove('upload-dragover');
    const input = inputFor(zone);
    if (!ready(zone, input) || pending.has(input)) return;
    pending.add(input);
    try {
      const files = await collectDroppedFiles(event.dataTransfer);
      if (!ready(zone, input)) return;
      const supported = files.filter(file => acceptsUpload(file, input.accept));
      if (!supported.length) throw new Error(`지원하는 파일을 놓아주세요. (${input.accept || '선택 가능한 파일'})`);
      if (!input.multiple && supported.length > 1) throw new Error('이 업로드에는 파일을 한 개씩 놓아주세요.');
      prepare(zone);
      const selected = new DataTransfer();
      supported.forEach(file => selected.items.add(file));
      input.files = selected.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
      if (supported.length < files.length) onError(`지원하지 않는 파일 ${files.length - supported.length}개를 제외했습니다.`);
    } catch (error) { onError(error.message || '파일을 읽지 못했습니다. 다시 선택해주세요.'); }
    finally { pending.delete(input); }
  });
  function refreshSelection(input) {
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.id) return;
    root.querySelectorAll(`[data-upload-input="${CSS.escape(input.id)}"] [data-upload-status]`).forEach(status => {
      status.textContent = input.files.length ? [...input.files].map(file => file.name).join(', ') : '선택된 파일 없음';
    });
  }
  root.addEventListener('change', event => refreshSelection(event.target), true);
  root.addEventListener('reset', event => {
    // The reset event fires before the browser clears the inputs.
    queueMicrotask(() => event.target.querySelectorAll('input[type="file"]').forEach(refreshSelection));
  });
}

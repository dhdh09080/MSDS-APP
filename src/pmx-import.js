import {parsePmxSnapshot, PMX_INCOMING_KEY} from './lib/pmx-snapshot.js';
import './style.css';
import './gs-design.css';

const fragment = location.hash;
history.replaceState(null, '', location.pathname);
try {
  window.opener = null;
  window.name = '';
  if (window.opener !== null) throw new Error('새 탭에서 보건관리 사이트를 열고 다시 가져와주세요.');
  if (!fragment.startsWith('#snapshot=')) throw new Error('전달된 PMX 정보가 없습니다.');
  const snapshot = parsePmxSnapshot(decodeURIComponent(fragment.slice('#snapshot='.length)));
  // Only inert, validated project data survives; no PMX WindowProxy or auth state.
  sessionStorage.setItem(PMX_INCOMING_KEY, JSON.stringify(snapshot));
  location.replace('/?pmx-review=1');
} catch (error) {
  document.getElementById('pmxImportStatus').textContent = error.message || 'PMX 정보를 확인할 수 없습니다.';
}

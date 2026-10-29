import { escapeBinderText as esc } from './binder-document.js';
import { MANAGER_SIGN_FIELDS, MANAGER_SIGN_PHRASES, buildManagerSignHtml, validateManagerSign } from './manager-sign-print.js';
import { openPrintWindow } from './ui.js';
import './manager-sign-workbench.css';

let assetsPromise;
function loadAssets() {
  if (!assetsPromise) assetsPromise = (async () => {
    const loadData = async path => {
      const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
      if (!response.ok) throw new Error('표지 글꼴 또는 그림을 불러오지 못했습니다.');
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('표지 파일을 읽지 못했습니다.'));
        reader.readAsDataURL(blob);
      });
    };
    const [font, characterUrl] = await Promise.all([loadData('fonts/hy-kyeongothic.woff'), loadData('templates/manager-sign-character.png')]);
    const face = new FontFace('ManagerHY', `url("${font}")`);
    await face.load();
    document.fonts.add(face);
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    return {
      characterUrl,
      fontCss: `@font-face{font-family:ManagerHY;src:url("${font}");font-weight:400;font-style:normal;}`,
      measure(text, size) { context.font = `${size}px ManagerHY`; return context.measureText(text).width; },
    };
  })().catch(error => { assetsPromise = null; throw error; });
  return assetsPromise;
}

export async function mountManagerSignWorkbench(root, { workspace, userId, contractors = [], lockedContractorId = null }) {
  const token = {}; root.managerSignToken = token;
  const storageKey = `manager-sign:v1:${userId || ''}:${workspace.id}`;
  let saved = {}, storageWarning = '';
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; }
  catch { storageWarning = '이 브라우저의 저장 내용을 읽지 못했습니다.'; }
  const phrases = [...new Set([...MANAGER_SIGN_PHRASES, ...(Array.isArray(saved.phrases) ? saved.phrases.filter(v => typeof v === 'string' && v.trim() && v.length <= 100) : [])])];
  const drafts = saved.drafts && typeof saved.drafts === 'object' && !Array.isArray(saved.drafts) ? saved.drafts : {};
  let selectedId = contractors.some(c => c.id === lockedContractorId) ? lockedContractorId : contractors.some(c => c.id === saved.selectedId) ? saved.selectedId : '';
  root.innerHTML = `<div class="manager-workbench"><form id="managerSignForm" class="manager-editor">
    <h3>표지 내용</h3><label>협력사<select id="managerCompany" class="form-input" required><option value="">협력사 선택</option>${contractors.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
    ${contractors.length ? '' : '<p>협력사 관리에서 협력사를 먼저 등록해주세요.</p>'}
    <fieldset class="manager-contacts"><legend>관리책임자 정</legend><label>성명<input id="manager-primaryName" class="form-input" maxlength="30" required autocomplete="off"></label><label>전화번호<input id="manager-primaryPhone" class="form-input" type="tel" maxlength="30" required autocomplete="off"></label></fieldset>
    <fieldset class="manager-contacts"><legend>관리책임자 부</legend><label>성명<input id="manager-deputyName" class="form-input" maxlength="30" required autocomplete="off"></label><label>전화번호<input id="manager-deputyPhone" class="form-input" type="tel" maxlength="30" required autocomplete="off"></label></fieldset>
    <div class="manager-phrase-picker"><label>문구 검색 · 선택<textarea id="manager-phrase" class="form-input" rows="3" aria-autocomplete="list" aria-expanded="false" aria-controls="managerPhraseOptions" aria-describedby="managerPhraseHelp" placeholder="문구 검색 또는 새 문구 입력" maxlength="100" required autocomplete="off"></textarea></label>
    <div id="managerPhraseOptions" class="manager-phrase-options" role="listbox" aria-label="문구 목록" hidden><div id="managerPhraseMatches" role="presentation"></div><button id="managerPhraseAdd" class="manager-phrase-option manager-phrase-add" role="option" aria-selected="false" type="button" tabindex="-1" hidden></button></div></div>
    <p id="managerPhraseHelp">Enter로 줄바꿈할 수 있고 ‘/’는 그대로 표시됩니다. 추가한 문구와 협력사별 입력 내용은 이 브라우저에 저장됩니다.</p>
    <div class="manager-actions"><label>인쇄 용지<select id="managerPaper" class="form-input"><option value="A4">A4 가로</option><option value="A3">A3 가로</option></select></label><label>인쇄 매수<input id="managerCopies" class="form-input" type="number" min="1" max="20" step="1" value="1" required></label></div><button id="managerSignPrint" type="submit" class="btn btn-primary" disabled>인쇄 / PDF 저장</button>
    <div id="managerSignError" class="manager-error" role="alert"></div><p id="managerStorageNotice" role="status">${esc(storageWarning)}</p>
    </form><section class="manager-preview-panel"><h3>인쇄 미리보기</h3><p><span id="managerPaperNotice"></span><br>긴 내용은 칸에 맞춰 글자가 작아집니다. 인쇄 배율은 100%로 설정해주세요.</p><div id="managerSignPreview">글꼴과 양식을 불러오는 중입니다…</div></section></div>`;
  const el = id => root.querySelector(`#${id}`);
  el('managerPaper').value = saved.paper === 'A3' ? 'A3' : 'A4';
  let assets;
  const data = () => Object.fromEntries([['company', contractors.find(c => c.id === selectedId)?.name || ''], ...MANAGER_SIGN_FIELDS.map(key => [key, el(`manager-${key}`).value.trim()])]);
  const save = () => {
    if (selectedId) drafts[selectedId] = Object.fromEntries(MANAGER_SIGN_FIELDS.map(key => [key, el(`manager-${key}`).value]));
    try { localStorage.setItem(storageKey, JSON.stringify({ phrases, drafts, selectedId, paper: el('managerPaper').value })); }
    catch { el('managerStorageNotice').textContent = '브라우저에 저장하지 못했습니다. 현재 내용으로 인쇄는 가능합니다.'; }
  };
  let activePhrase = -1;
  const closePhrases = () => {
    el('managerPhraseOptions').hidden = true;
    el('manager-phrase').setAttribute('aria-expanded', 'false');
    el('manager-phrase').removeAttribute('aria-activedescendant');
    activePhrase = -1;
  };
  const showPhrases = (query = '') => {
    const matches = phrases.filter(v => v.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    el('managerPhraseMatches').innerHTML = matches.map((v, i) => `<button id="managerPhraseOption${i}" class="manager-phrase-option" type="button" role="option" aria-selected="false" tabindex="-1" data-phrase="${esc(v)}">${esc(v)}</button>`).join('');
    const phrase = el('manager-phrase').value.trim();
    el('managerPhraseAdd').hidden = !phrase || phrases.includes(phrase);
    el('managerPhraseAdd').textContent = `+ ${phrase} 추가`;
    el('managerPhraseOptions').hidden = false;
    el('manager-phrase').setAttribute('aria-expanded', 'true');
    el('manager-phrase').removeAttribute('aria-activedescendant');
    activePhrase = -1;
  };
  const update = () => {
    const paper = el('managerPaper').value;
    el('managerPaperNotice').textContent = `${paper} 가로 · HY견고딕 · ${paper === 'A3' ? 'PPT 원본 비율로 약 141% 확대' : 'PPT 원본 크기 기준'}`;
    save();
    if (assets) {
      const frame = document.createElement('iframe'); frame.title = '관리책임자 표지 미리보기';
      frame.srcdoc = buildManagerSignHtml(data(), { ...assets, paper, preview: true });
      el('managerSignPreview').replaceChildren(frame);
    }
  };
  const selectCompany = () => {
    closePhrases();
    selectedId = el('managerCompany').value;
    const company = contractors.find(c => c.id === selectedId);
    const draft = Object.hasOwn(drafts, selectedId) ? drafts[selectedId] : null;
    for (const key of MANAGER_SIGN_FIELDS) el(`manager-${key}`).value = typeof draft?.[key] === 'string' ? draft[key] : key === 'primaryName' ? company?.manager_name || '' : key === 'primaryPhone' ? company?.manager_phone || '' : key === 'phrase' ? phrases[0] : '';
    update();
  };
  el('managerCompany').value = selectedId;
  el('managerCompany').disabled = Boolean(lockedContractorId);
  el('managerCompany').onchange = selectCompany;
  for (const key of MANAGER_SIGN_FIELDS) el(`manager-${key}`).oninput = update;
  el('managerPaper').onchange = update;
  el('manager-phrase').onfocus = () => showPhrases();
  el('manager-phrase').onclick = () => { if (el('managerPhraseOptions').hidden) showPhrases(); };
  el('manager-phrase').oninput = () => { update(); showPhrases(el('manager-phrase').value); };
  el('managerPhraseOptions').onmousedown = event => event.preventDefault();
  el('managerPhraseMatches').onclick = event => {
    const option = event.target.closest('[data-phrase]');
    if (option) { el('manager-phrase').value = option.dataset.phrase; update(); closePhrases(); }
  };
  root.querySelector('.manager-phrase-picker').onfocusout = event => {
    if (!event.currentTarget.contains(event.relatedTarget)) closePhrases();
  };
  el('manager-phrase').onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') { closePhrases(); return; }
    if (event.key === 'Escape') { closePhrases(); return; }
    if (event.key === 'Tab' && activePhrase >= 0 && !el('managerPhraseOptions').hidden) {
      el('managerPhraseOptions').querySelectorAll('[role="option"]')[activePhrase]?.click();
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    if (el('managerPhraseOptions').hidden) {
      showPhrases();
    }
    const options = [...el('managerPhraseOptions').querySelectorAll('[role="option"]')].filter(option => !option.hidden);
    if (!options.length) return;
    event.preventDefault();
    activePhrase = (activePhrase + (event.key === 'ArrowDown' ? 1 : activePhrase < 0 ? 0 : -1) + options.length) % options.length;
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === activePhrase)));
    el('manager-phrase').setAttribute('aria-activedescendant', options[activePhrase].id);
    options[activePhrase].scrollIntoView({ block: 'nearest' });
  };
  el('managerPhraseAdd').onclick = () => {
    const phrase = el('manager-phrase').value.trim();
    if (phrase && !phrases.includes(phrase)) { phrases.push(phrase); update(); closePhrases(); }
  };
  el('managerSignForm').onsubmit = event => {
    event.preventDefault();
    try {
      if (!assets) throw new Error('글꼴과 양식이 준비될 때까지 기다려주세요.');
      validateManagerSign(data());
      const html = buildManagerSignHtml(data(), { ...assets, paper: el('managerPaper').value, copies: Number(el('managerCopies').value) });
      el('managerSignError').textContent = ''; openPrintWindow(html);
    } catch (error) { el('managerSignError').textContent = error.message; }
  };
  selectCompany();
  try {
    assets = await loadAssets();
    if (root.managerSignToken !== token) return;
    update(); el('managerSignPrint').disabled = !contractors.length;
  } catch (error) { if (root.managerSignToken === token) el('managerSignError').textContent = `${error.message} 화면을 다시 열어주세요.`; }
}

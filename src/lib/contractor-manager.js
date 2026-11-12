const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import './contractor-manager.css';

export function contractorTableHtml(rows, { workTypes, msdsRecords, businessLicenses }) {
  const licenses = new Set(businessLicenses.map(row => row.contractor_id));
  const counts = new Map();
  for (const row of msdsRecords) counts.set(row.contractor, (counts.get(row.contractor) || 0) + 1);
  return `<p class="con-table-scroll-hint">표를 좌우로 밀면 서류 현황과 관리 버튼을 확인할 수 있습니다.</p><div class="con-table-scroll" tabindex="0" role="region" aria-label="협력사 관리 목록"><table class="con-management-table"><thead><tr><th scope="col">협력사</th><th scope="col">담당자 · 연락처</th><th scope="col">공종</th><th scope="col">MSDS</th><th scope="col">사업자등록증</th><th scope="col">사용 여부</th><th scope="col">관리</th></tr></thead><tbody>${rows.map(c => {
    const trades = workTypes.filter(w => w.contractor_id === c.id);
    const count = counts.get(c.name) || 0;
    return `<tr class="contractor-row ${c.is_active === false ? 'con-is-inactive' : ''}"><th scope="row"><strong class="con-company-name">${escapeHtml(c.name)}</strong><small class="con-company-source">${c.pmx_company_name ? 'PMX 연동' : '직접 등록'}</small></th><td><span class="con-contact-name ${c.manager_name ? '' : 'con-unset'}">${escapeHtml(c.manager_name || '담당자 미등록')}</span>${c.manager_phone ? `<a class="con-phone" href="tel:${escapeHtml(c.manager_phone.replace(/[^+0-9]/g, ''))}">${escapeHtml(c.manager_phone)}</a>` : '<span class="con-contact-empty">전화번호 미등록</span>'}</td><td><span class="con-trades" title="${escapeHtml(trades.map(w => w.name).join(', '))}">${trades.length ? escapeHtml(trades.slice(0, 3).map(w => w.name).join(', ')) : '<span class="con-unset">미등록</span>'}${trades.length > 3 ? ` <small>외 ${trades.length - 3}개</small>` : ''}</span></td><td><button type="button" class="con-msds-link ${count ? '' : 'con-missing'}" onclick="openContractorMsds('${c.id}')" aria-label="${escapeHtml(c.name)} MSDS ${count}건 보기">${count ? `${count}건 보기` : '미등록'}</button></td><td><button type="button" class="con-license-link ${licenses.has(c.id) ? 'con-submitted' : 'con-missing'}" onclick="openContractorLicense('${c.id}')" aria-label="${escapeHtml(c.name)} 사업자등록증 ${licenses.has(c.id) ? '제출 완료' : '미제출'}">${licenses.has(c.id) ? '제출 완료' : '미제출'}</button></td><td><label class="con-usage"><input type="checkbox" role="switch" aria-label="${escapeHtml(c.name)} 사용 여부" ${c.is_active !== false ? 'checked' : ''} onchange="toggleContractorActive('${c.id}',this.checked)"><span class="con-switch-track" aria-hidden="true"></span><span>${c.is_active !== false ? '사용 중' : '미사용'}</span></label></td><td><div class="con-row-actions"><button type="button" class="btn btn-secondary" data-con-edit="${c.id}" aria-label="${escapeHtml(c.name)} 정보 수정">정보 수정</button><button type="button" class="con-more-button" data-con-more="${c.id}" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(c.name)} 추가 작업">⋯</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

export function installContractorEditor({ client, getWorkspace, getContractors, getWorkTypes, onChange, onRenamed, toast }) {
  let session = null;
  let menu = null;
  let returnFocus = null;
  const drawer = document.createElement('dialog');
  drawer.id = 'contractorEditor';
  drawer.className = 'con-editor';
  drawer.setAttribute('aria-labelledby', 'conEditorTitle');
  drawer.innerHTML = `<header class="con-editor-header"><div><span>협력사 관리</span><h2 id="conEditorTitle">협력사 정보 수정</h2></div><button type="button" data-con-close aria-label="정보 수정 닫기">✕</button></header><div class="con-editor-body"><form id="conProfileForm"><h3>기본 정보</h3><label>협력사명<input class="form-input" id="conEditName" required maxlength="200" autocomplete="organization"></label><p class="con-field-note">이름을 변경하면 MSDS 대장의 협력사명도 함께 변경됩니다.</p><label>담당자<input class="form-input" id="conEditManager" maxlength="100" autocomplete="name" placeholder="담당자 이름"></label><label>전화번호<input class="form-input" id="conEditPhone" type="tel" maxlength="30" autocomplete="tel" placeholder="전화번호"></label><p id="conProfileError" role="alert"></p><div class="con-profile-actions"><span id="conProfileStatus" role="status"></span><button class="btn btn-primary" id="conProfileSave" type="submit">기본 정보 저장</button></div></form><section class="con-editor-trades" aria-labelledby="conTradesTitle"><h3 id="conTradesTitle">공종 관리</h3><p class="con-field-note">공종 추가·삭제는 바로 반영됩니다.</p><ul id="conEditTrades"></ul><form id="conTradeForm"><label class="con-trade-label" for="conNewTrade">공종 추가</label><div><input class="form-input" id="conNewTrade" maxlength="200" placeholder="새 공종명" required><button class="btn btn-secondary" type="submit">추가</button></div></form><p id="conTradeError" role="alert"></p></section></div><footer class="con-editor-footer"><button type="button" class="btn btn-secondary" data-con-close>닫기</button></footer>`;
  document.body.append(drawer);
  const $ = id => drawer.querySelector('#' + id);
  const current = s => session === s && getWorkspace()?.id === s.workspace;
  const renderTrades = () => {
    if (!session) return;
    const trades = getWorkTypes().filter(w => w.contractor_id === session.id);
    $('conEditTrades').innerHTML = trades.length ? trades.map(w => `<li><span>${escapeHtml(w.name)}</span><button type="button" data-con-trade-delete="${w.id}" aria-label="${escapeHtml(w.name)} 공종 삭제">삭제</button></li>`).join('') : '<li class="con-unset">등록된 공종이 없습니다.</li>';
  };
  function setBusy(busy) {
    if (session) session.busy = busy;
    drawer.querySelectorAll('button,input').forEach(el => el.disabled = busy);
  }
  function close() {
    if (session?.busy) return;
    drawer.close();
  }
  drawer.addEventListener('close', () => { const target = returnFocus?.isConnected ? returnFocus : document.querySelector(`[data-con-edit="${CSS.escape(session?.id || '')}"]`); session = null; target?.focus(); });
  drawer.addEventListener('cancel', event => { if (session?.busy) event.preventDefault(); });
  drawer.addEventListener('click', event => { if (event.target.closest('[data-con-close]')) close(); });
  function open(id, trigger) {
    const c = getContractors().find(c => c.id === id);
    if (!c || !getWorkspace()) return;
    closeMenu(); returnFocus = trigger;
    session = { id, workspace: getWorkspace().id, name: c.name, manager: c.manager_name || '', phone: c.manager_phone || '', busy: false };
    $('conEditName').value = c.name;
    $('conEditManager').value = c.manager_name || '';
    $('conEditPhone').value = c.manager_phone || '';
    $('conProfileError').textContent = $('conTradeError').textContent = $('conProfileStatus').textContent = '';
    setBusy(false); renderTrades(); drawer.showModal(); $('conEditName').focus();
  }
  $('conProfileForm').addEventListener('input', () => { $('conProfileStatus').textContent = ''; });
  $('conProfileForm').addEventListener('submit', async event => {
    event.preventDefault(); const s = session; if (!s || s.busy) return;
    const name = $('conEditName').value.trim(), manager = $('conEditManager').value.trim(), phone = $('conEditPhone').value.trim();
    $('conProfileError').textContent = ''; $('conProfileStatus').textContent = '';
    if (!name) { $('conProfileError').textContent = '협력사명을 입력해주세요.'; return; }
    if (phone && !/^[0-9+() .-]{7,30}$/.test(phone)) { $('conProfileError').textContent = '전화번호 형식을 확인해주세요.'; return; }
    if (getContractors().some(c => c.id !== s.id && c.name === name)) { $('conProfileError').textContent = '이미 같은 이름의 협력사가 있습니다.'; return; }
    setBusy(true);
    let savedContact = false, renamed = false;
    try {
      if (manager !== s.manager || phone !== s.phone) {
        const { error } = await client.rpc('save_workspace_contractor_contact', { p_workspace: s.workspace, p_contractor_id: s.id, p_manager_name: manager, p_manager_phone: phone });
        if (error) throw error;
        s.manager = manager; s.phone = phone; savedContact = true;
      }
      if (name !== s.name) {
        const { error } = await client.from('contractors').update({ name }).eq('workspace_id', s.workspace).eq('id', s.id).select('id').single();
        if (error) throw error;
        const { error: recordsError } = await client.from('msds_records').update({ contractor: name }).eq('workspace_id', s.workspace).eq('contractor', s.name);
        if (recordsError) {
          const { error: rollbackError } = await client.from('contractors').update({ name: s.name }).eq('workspace_id', s.workspace).eq('id', s.id).eq('name', name).select('id').single();
          if (rollbackError) throw new Error('업체명은 저장됐으나 MSDS 반영에 실패했습니다. 이 창에서 저장을 다시 눌러주세요. ' + recordsError.message);
          throw new Error('MSDS 대장 반영에 실패해 업체명 변경을 취소했습니다. 다시 저장해주세요. ' + recordsError.message);
        }
        onRenamed(s.name, name); s.name = name; renamed = true;
      }
      if (!current(s)) return;
      await onChange();
      if (current(s)) { $('conProfileStatus').textContent = '저장했습니다'; toast('협력사 정보가 저장됐습니다', 'success'); }
    } catch (error) {
      if (current(s)) {
        $('conProfileError').textContent = `${savedContact ? '연락처는 저장됐습니다. ' : ''}${renamed ? '업체명은 저장됐습니다. ' : ''}${error.message}`;
        await onChange();
      }
    } finally { if (current(s)) setBusy(false); }
  });
  async function changeTrade(task) {
    const s = session; if (!s || s.busy) return;
    setBusy(true); $('conTradeError').textContent = '';
    try { await task(s); if (!current(s)) return; await onChange(); if (current(s)) { renderTrades(); $('conNewTrade').value = ''; } }
    catch (error) { if (current(s)) $('conTradeError').textContent = '공종 저장 실패: ' + error.message; }
    finally { if (current(s)) setBusy(false); }
  }
  $('conTradeForm').addEventListener('submit', event => {
    event.preventDefault(); const name = $('conNewTrade').value.trim(); if (!name) return;
    if (getWorkTypes().some(w => w.contractor_id === session?.id && w.name === name)) { $('conTradeError').textContent = '이미 등록된 공종입니다.'; return; }
    changeTrade(async s => { const { error } = await client.from('work_types').insert({ workspace_id: s.workspace, contractor_id: s.id, name }).select('id').single(); if (error) throw error; });
  });
  $('conEditTrades').addEventListener('click', event => {
    const button = event.target.closest('[data-con-trade-delete]'); if (!button) return;
    changeTrade(async s => { const { error } = await client.from('work_types').delete().eq('workspace_id', s.workspace).eq('contractor_id', s.id).eq('id', button.dataset.conTradeDelete).select('id').single(); if (error) throw error; });
  });
  function closeMenu() {
    if (!menu) return;
    menu.trigger.setAttribute('aria-expanded', 'false'); menu.element.remove(); menu = null;
  }
  function openMenu(trigger) {
    if (menu?.trigger === trigger) { closeMenu(); return; }
    closeMenu();
    const element = document.createElement('div'); element.id = 'conActionsMenu'; element.className = 'con-actions-menu'; element.setAttribute('role', 'menu');
    element.innerHTML = '<button type="button" role="menuitem" data-action="transfer">문서 이관</button><button type="button" role="menuitem" data-action="delete">협력사 삭제</button>';
    document.body.append(element); const rect = trigger.getBoundingClientRect();
    element.style.left = Math.max(8, Math.min(rect.right - 170, innerWidth - 178)) + 'px';
    element.style.top = (rect.bottom + 8 + 104 > innerHeight ? rect.top - 104 : rect.bottom + 8) + 'px';
    menu = { trigger, element }; trigger.setAttribute('aria-controls', 'conActionsMenu'); trigger.setAttribute('aria-expanded', 'true'); element.querySelector('button').focus();
    element.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
      const id = trigger.dataset.conMore; closeMenu(); trigger.focus();
      if (action === 'transfer') window.openContractorTransfer(id); else window.removeContractor(id);
    });
    element.addEventListener('keydown', event => {
      const items = [...element.querySelectorAll('button')];
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); items[(items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
    });
  }
  document.addEventListener('click', event => {
    const edit = event.target.closest('[data-con-edit]'); if (edit) { open(edit.dataset.conEdit, edit); return; }
    const more = event.target.closest('[data-con-more]'); if (more) { openMenu(more); return; }
    if (menu && !menu.element.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu) { const trigger = menu.trigger; closeMenu(); trigger.focus(); } });
  document.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);
  return { open, closeMenu };
}

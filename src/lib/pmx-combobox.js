import {searchProjects} from './pmx.js';

// Keep focus on the text input so keyboard and pointer selection share the same state.
export function mountProjectCombobox({input, dropdown, getProjects, onChange, onSelect, emptyMessage = '검색 결과가 없습니다.'}) {
  const list = dropdown.querySelector('[role="listbox"]');
  let matches = [], active = -1, expanded = false, blurTimer;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  function hide() {
    clearTimeout(blurTimer);
    expanded = false; dropdown.hidden = true;
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
  }
  function highlight() {
    [...list.querySelectorAll('[role="option"]')].forEach((item, i) => item.setAttribute('aria-selected', String(i === active)));
    if (active >= 0 && matches[active]) {
      input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
      document.getElementById(`${list.id}-${active}`)?.scrollIntoView({block:'nearest'});
    } else input.removeAttribute('aria-activedescendant');
  }
  function refresh() {
    if (!expanded) return;
    matches = searchProjects(getProjects(), input.value);
    active = matches.length && input.value.trim() ? 0 : -1;
    list.replaceChildren();
    matches.forEach((project, i) => {
      const item = document.createElement('div'); item.id = `${list.id}-${i}`;
      item.setAttribute('role', 'option'); item.className = 'pmx-search-option';
      const name = document.createElement('b'); name.textContent = project.prjNm;
      const meta = document.createElement('small'); meta.textContent = `${project.bizFldNm || '분류 없음'} · ${project.prjCd}`;
      item.append(name, meta); item.addEventListener('click', () => {hide(); onSelect(project);});
      list.append(item);
    });
    if (!matches.length) {
      const empty = document.createElement('p'); empty.className = 'pmx-search-empty'; empty.setAttribute('role', 'status');
      empty.textContent = emptyMessage; list.append(empty);
    }
    highlight();
  }
  function show() {clearTimeout(blurTimer);expanded = true; dropdown.hidden = false; input.setAttribute('aria-expanded', 'true'); refresh();}
  dropdown.addEventListener('pointerdown', e => e.preventDefault());
  input.addEventListener('input', () => {onChange?.(); show();});
  input.addEventListener('focus', show);
  input.addEventListener('blur', event => {
    if (!dropdown.contains(event.relatedTarget)) {
      // Let the pending click finish before collapsing an in-flow list changes modal geometry.
      blurTimer=setTimeout(hide,160);
    }
  });
  dropdown.addEventListener('focusout', event => {
    if (event.relatedTarget !== input && !dropdown.contains(event.relatedTarget)) hide();
  });
  dropdown.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();input.focus();hide();}
  });
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {if(expanded) {e.preventDefault();e.stopPropagation();hide();} return;}
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!expanded) show();
      if (matches.length) {active = e.key === 'ArrowDown' ? (active + 1) % matches.length : (active < 0 ? matches.length - 1 : (active + matches.length - 1) % matches.length); highlight();}
    }
    if (e.key === 'Enter' && expanded) {
      e.preventDefault(); hide();
      if (matches[active]) onSelect(matches[active]);
    }
  });
  return {refresh, hide, show};
}

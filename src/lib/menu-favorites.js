import './menu-favorites.css';

export function favoriteStorageKey(userId, workspaceId) {
  return userId ? `fms_menu_favorites:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId || 'system')}` : null;
}

export function readFavorites(storage, key, allowedIds) {
  if (!key) return [];
  try {
    const value = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(id => allowedIds.includes(id)))] : [];
  } catch { return []; }
}

export function installMenuFavorites({ getContext, onError }) {
  const sidebar = document.querySelector('.sidebar-nav');
  const mobile = document.querySelector('#moreSheet .modal-body');
  const entries = [...sidebar.querySelectorAll('button.nav-item')]
    .filter(button => button.id !== 'nav-admin')
    .map(button => {
      const label = button.cloneNode(true);
      label.querySelectorAll('.nav-icon, .nav-badge').forEach(node => node.remove());
      return { id: button.id.replace(/^nav-/, ''), button,
        label: label.textContent.trim(), icon: button.querySelector('.nav-icon')?.cloneNode(true) };
    });
  const allowed = entries.map(entry => entry.id);
  const toggles = [];
  let key = null;
  const panels = [sidebar, mobile].map(parent => {
    const section = document.createElement('section');
    section.className = 'menu-favorites';
    section.setAttribute('aria-label', '즐겨찾기');
    const heading = document.createElement('div');
    heading.className = 'nav-section';
    heading.textContent = '즐겨찾기';
    const list = document.createElement('div');
    section.append(heading, list);
    parent.prepend(section);
    return list;
  });

  function toggle(id) {
    refresh();
    if (!key) return;
    try {
      const selected = readFavorites(localStorage, key, allowed);
      const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
      localStorage.setItem(key, JSON.stringify(next));
    }
    catch {
      onError('즐겨찾기를 저장하지 못했습니다. 브라우저 저장 공간 설정을 확인해 주세요.');
      return;
    }
    refresh();
  }

  function addToggle(parent, entry, track = true) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-favorite-toggle';
    button.dataset.favoriteId = entry.id;
    button.addEventListener('click', () => toggle(entry.id));
    parent.append(button);
    if (track) toggles.push({ button, entry });
    return button;
  }

  entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'menu-favorite-row';
    entry.button.before(row);
    row.append(entry.button);
    addToggle(row, entry);
  });
  mobile.querySelectorAll('.more-item').forEach(button => {
    const page = button.getAttribute('onclick')?.match(/showPage\('([^']+)'\)/)?.[1];
    const entry = entries.find(item => item.id === page);
    if (!entry) return;
    const tile = document.createElement('div');
    tile.className = 'menu-favorite-tile';
    button.before(tile);
    tile.append(button);
    addToggle(tile, entry);
  });

  function updateToggle(button, entry, saved) {
    button.textContent = saved ? '★' : '☆';
    button.setAttribute('aria-pressed', String(saved));
    button.title = `${entry.label} 즐겨찾기 ${saved ? '해제' : '추가'}`;
    button.setAttribute('aria-label', button.title);
  }

  function refresh() {
    const context = getContext();
    key = favoriteStorageKey(context.userId, context.workspaceId);
    let selected = [];
    try { selected = readFavorites(localStorage, key, allowed); } catch { /* Storage may be disabled. */ }
    toggles.forEach(({ button, entry }) => updateToggle(button, entry, selected.includes(entry.id)));
    panels.forEach(list => {
      list.replaceChildren();
      if (!selected.length) {
        const empty = document.createElement('p');
        empty.className = 'menu-favorites-empty';
        empty.textContent = '메뉴 옆 ☆을 눌러 추가하세요.';
        list.append(empty);
      }
      selected.forEach(id => {
        const entry = entries.find(item => item.id === id);
        const row = document.createElement('div');
        row.className = 'menu-favorite-row';
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'nav-item';
        link.classList.toggle('active', entry.button.classList.contains('active'));
        if (entry.icon) link.append(entry.icon.cloneNode(true));
        link.append(document.createTextNode(entry.label));
        link.addEventListener('click', () => {
          entry.button.click();
          window.closeModal('moreSheet');
        });
        row.append(link);
        updateToggle(addToggle(row, entry, false), entry, true);
        list.append(row);
      });
    });
  }
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) refresh();
  });
  return { refresh };
}

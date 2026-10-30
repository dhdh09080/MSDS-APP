import './menu-favorites.css';

export const MENU_GROUPS = [
  { label: '시스템', pages: ['announcements', 'team', 'feedback', 'settings', 'admin'] },
  { label: 'MSDS', pages: ['msds', 'warning', 'hazard-map', 'requests'] },
  { label: '건강관리', pages: ['health', 'vulnerable', 'bp', 'measure'] },
  { label: '현장 관리', pages: ['contractors', 'manpower', 'photos', 'weather'] },
  { label: '자료 서식', pages: ['library', 'binders', 'manager-signs'] },
];

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
  const entries = new Map([...sidebar.querySelectorAll('button.nav-item')].map(button => {
    const label = document.createElement('span');
    label.className = 'menu-item-label';
    label.textContent = [...button.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent).join(' ').replace(/\s+/g, ' ').trim();
    [...button.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
    const icon = button.querySelector('.nav-icon');
    if (icon) icon.after(label); else button.prepend(label);
    button.title = label.textContent;
    const id = button.id.replace(/^nav-/, '');
    return [id, { id, button, label: label.textContent }];
  }));
  const allowed = [...entries.keys()].filter(id => !['home', 'admin'].includes(id));
  const oldMobile = new Map([...mobile.querySelectorAll('.more-item')].map(button => [
    button.getAttribute('onclick')?.match(/showPage\('([^']+)'\)/)?.[1], button,
  ]));
  const toggles = [];
  const views = [];
  let key = null, activeTab = 'all';

  function navigate(entry) {
    entry.button.click();
    window.closeModal('moreSheet');
  }

  function makeLink(entry) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'nav-item';
    link.title = entry.label;
    link.dataset.menuPage = entry.id;
    const icon = entry.button.querySelector('.nav-icon');
    if (icon) link.append(icon.cloneNode(true));
    const label = document.createElement('span');
    label.className = 'menu-item-label';
    label.textContent = entry.label;
    link.append(label);
    link.addEventListener('click', () => navigate(entry));
    return link;
  }

  function toggle(id) {
    refresh();
    if (!key) return;
    try {
      const selected = readFavorites(localStorage, key, allowed);
      const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id];
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      onError('즐겨찾기를 저장하지 못했습니다. 브라우저 저장 공간 설정을 확인해 주세요.');
      return;
    }
    refresh();
  }

  function updateToggle(button, entry, saved) {
    button.textContent = saved ? '★' : '☆';
    button.setAttribute('aria-pressed', String(saved));
    button.title = `${entry.label} 즐겨찾기 ${saved ? '해제' : '추가'}`;
    button.setAttribute('aria-label', button.title);
  }

  function makeRow(entry, link, favorite = false) {
    const row = document.createElement('div');
    row.className = 'menu-favorite-row';
    row.append(link);
    if (allowed.includes(entry.id)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu-favorite-toggle';
      button.dataset.favoriteId = entry.id;
      button.addEventListener('click', () => toggle(entry.id));
      row.append(button);
      if (favorite) updateToggle(button, entry, true);
      else toggles.push({ button, entry });
    }
    return row;
  }

  function selectTab(tab) {
    activeTab = tab;
    views.forEach(view => {
      view.tabs.forEach(button => {
        const selected = button.dataset.menuTab === tab;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      view.favorites.hidden = tab !== 'favorites';
      view.all.hidden = tab !== 'all';
    });
  }

  [sidebar, mobile].forEach((parent, index) => {
    const prefix = index ? 'mobile-menu' : 'sidebar-menu';
    parent.replaceChildren();
    const home = index ? makeLink(entries.get('home')) : entries.get('home').button;
    home.classList.add('menu-home');
    parent.append(home);
    const tablist = document.createElement('div');
    tablist.className = 'menu-tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', '메뉴 보기');
    const favorites = document.createElement('div');
    favorites.className = 'menu-favorites';
    const all = document.createElement('div');
    all.className = 'menu-all-panel';
    const tabs = ['favorites', 'all'].map((tab, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `${prefix}-tab-${tab}`;
      button.dataset.menuTab = tab;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `${prefix}-panel-${tab}`);
      button.textContent = i ? '전체메뉴' : '즐겨찾기';
      button.addEventListener('click', () => selectTab(tab));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs[1 - i];
        selectTab(target.dataset.menuTab);
        target.focus();
      });
      const panel = i ? all : favorites;
      panel.id = `${prefix}-panel-${tab}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      tablist.append(button);
      return button;
    });
    MENU_GROUPS.forEach(group => {
      const section = document.createElement('section');
      section.className = 'menu-group';
      section.setAttribute('aria-label', group.label);
      const heading = document.createElement('div');
      heading.className = 'nav-section';
      heading.textContent = group.label;
      section.append(heading);
      group.pages.forEach(id => {
        const entry = entries.get(id);
        // Keep original admin controls so existing permission visibility still applies.
        if (id === 'admin') section.append(index ? oldMobile.get(id) : entry.button);
        else section.append(makeRow(entry, index ? makeLink(entry) : entry.button));
      });
      all.append(section);
    });
    parent.append(tablist, favorites, all);
    views.push({ tabs, favorites, all });
  });
  selectTab(activeTab);

  function refresh() {
    const context = getContext();
    const nextKey = favoriteStorageKey(context.userId, context.workspaceId);
    if (key !== nextKey) selectTab('all');
    key = nextKey;
    let selected = [];
    try { selected = readFavorites(localStorage, key, allowed); } catch { /* Storage may be disabled. */ }
    toggles.forEach(({ button, entry }) => updateToggle(button, entry, selected.includes(entry.id)));
    views.forEach(view => {
      view.favorites.replaceChildren();
      if (!selected.length) {
        const empty = document.createElement('p');
        empty.className = 'menu-favorites-empty';
        empty.textContent = '전체메뉴에서 ☆을 눌러 자주 쓰는 메뉴를 추가하세요.';
        const browse = document.createElement('button');
        browse.type = 'button';
        browse.className = 'menu-browse';
        browse.textContent = '전체메뉴 보기';
        browse.addEventListener('click', () => selectTab('all'));
        view.favorites.append(empty, browse);
      }
      selected.forEach(id => {
        const entry = entries.get(id);
        view.favorites.append(makeRow(entry, makeLink(entry), true));
      });
    });
    document.querySelectorAll('[data-menu-page]').forEach(link => {
      link.classList.toggle('active', entries.get(link.dataset.menuPage).button.classList.contains('active'));
    });
  }
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) refresh();
  });
  return { refresh };
}

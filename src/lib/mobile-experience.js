import '../mobile-experience.css';

// Move the existing controls instead of copying them, so IDs, handlers and values
// survive orientation changes and desktop/mobile transitions.
function responsiveLayout() {
  const media = matchMedia('(max-width: 768px)');
  const moves = [];
  const apply = () => moves.forEach(({node, marker, target}) => {
    if (media.matches) { if (node.parentNode !== target) target.append(node); }
    else if (node.previousSibling !== marker) marker.after(node);
  });
  media.addEventListener('change', apply);
  return { media, apply, move(node, target) {
    if (!node || !target) return;
    const marker = document.createComment('desktop position');
    node.before(marker); moves.push({node, marker, target});
  }};
}
function disclosure(id, title, parent) {
  const el = document.createElement('details');
  el.id = id; el.className = 'mobile-disclosure mobile-only';
  const summary = document.createElement('summary'); summary.textContent = title;
  el.append(summary); parent.append(el); return el;
}
function installViewport() {
  document.body.classList.add('mobile-ui');
  document.querySelectorAll('.modal').forEach(modal => {
    if ([...modal.children].some(el => el.classList.contains('modal-body'))) modal.classList.add('mobile-scroll-modal');
  });
  let frame;
  const sync = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const viewport = window.visualViewport;
      if (!viewport || viewport.scale === 1) {
        document.documentElement.style.setProperty('--mobile-viewport-height', `${viewport?.height || innerHeight}px`);
        document.documentElement.style.setProperty('--mobile-viewport-top', `${viewport?.offsetTop || 0}px`);
      }
      document.body.classList.toggle('mobile-modal-open', !!document.querySelector('.modal-backdrop.open'));
    });
  };
  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);
  document.addEventListener('app-modal-change', sync);
  sync();
}

export function installMobileExperience({getWarningCount, refreshWarningPreview, message}) {
  installViewport();
  const layout = responsiveLayout();
  const page = document.getElementById('page-msds');
  const filters = disclosure('msdsFilters', '필터 · 업체 / 공종 / 상태', page.querySelector('.filter-bar'));
  const filterFields = document.createElement('div'); filterFields.className = 'mobile-filter-fields'; filters.append(filterFields);
  layout.move(page.querySelector('.msds-sidebar'), filters);
  ['filterWorkType','filterStatus','filterSpecial'].forEach(id => layout.move(document.getElementById(id), filterFields));
  const menu = page.querySelector('.msds-action-menu');
  layout.move(document.getElementById('msdsDownloadAllBtn'), menu);
  layout.move(page.querySelector('.msds-print-btn'), menu);
  const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn btn-outline'; clear.textContent = '필터 초기화';
  clear.onclick = () => {
    ['filterWorkType','filterStatus','filterSpecial'].forEach(id => document.getElementById(id).value = '');
    window.selectContractorSidebar('');
  };
  filterFields.append(clear);
  page.querySelector('.msds-more-actions').addEventListener('click', event => {
    if (event.target.closest('button')) page.querySelector('.msds-more-actions').open = false;
  });
  const shortcuts = document.querySelector('.gs-shortcuts');
  const upload = document.createElement('button'); upload.className = 'mobile-only mobile-home-register'; upload.type = 'button';
  upload.innerHTML = '<span class="gs-shortcut-icon">＋</span><div><b>자료 등록</b><small>MSDS 파일 추가</small></div><span>↗</span>';
  upload.onclick = () => window.openMsdsRegister(); shortcuts.prepend(upload);
  const weather = document.querySelector('.gs-home-grid');
  const homeDetails = disclosure('mobileHomeWeather', '날씨·계절별 보건 관리 보기', weather.parentNode);
  weather.before(homeDetails); layout.move(weather, homeDetails);
  const checks = document.querySelector('.gs-weather-checks')?.closest('section');
  layout.move(checks, homeDetails);
  const cameraInput = document.createElement('input'); cameraInput.id = 'msdsCameraInput'; cameraInput.type = 'file'; cameraInput.accept = 'image/*'; cameraInput.setAttribute('capture','environment'); cameraInput.hidden = true;
  cameraInput.onchange = event => window.handleMsdsFileSelect(event);
  const camera = document.createElement('button'); camera.type = 'button'; camera.className = 'btn btn-outline mobile-only mobile-camera-button'; camera.textContent = '사진 촬영해서 추가';
  camera.dataset.uploadInput = cameraInput.id;
  camera.onclick = event => { event.preventDefault(); cameraInput.value = ''; cameraInput.click(); };
  document.getElementById('pdfInput').after(cameraInput, camera);
  const uploadText = document.querySelector('#msdsUploadZone .upload-text');
  const originalUploadText = uploadText.textContent;

  const warning = document.getElementById('page-warning');
  const steps = document.createElement('nav'); steps.className = 'mobile-warning-steps mobile-only'; steps.setAttribute('aria-label','경고표지 작업 단계');
  const footer = document.createElement('div'); footer.className = 'mobile-warning-footer mobile-only';
  footer.innerHTML = '<span id="mobileWarnSelection" role="status"></span><div><button type="button" class="btn btn-outline" id="mobileWarnBack">이전</button><button type="button" class="btn btn-primary" id="mobileWarnNext">다음</button></div>';
  let step = 1;
  const refreshWarning = () => {
    const count = getWarningCount();
    warning.dataset.mobileStep = String(step);
    steps.querySelectorAll('button').forEach((button, i) => {
      button.setAttribute('aria-current', i + 1 === step ? 'step' : 'false');
      button.disabled = i > 0 && !count;
    });
    document.getElementById('mobileWarnSelection').textContent = count ? `${count}종 선택 · ${step}/3단계` : '인쇄할 물질을 선택하세요';
    document.getElementById('mobileWarnBack').hidden = step === 1;
    const next = document.getElementById('mobileWarnNext'); next.textContent = step === 3 ? '선택한 표지 인쇄' : '다음'; next.disabled = !count;
  };
  const setStep = value => {
    if (value > 1 && !getWarningCount()) { message('인쇄할 물질을 먼저 선택해주세요.'); return; }
    step = Math.min(3, Math.max(1, value)); refreshWarning();
    if (step === 3) requestAnimationFrame(refreshWarningPreview);
    document.getElementById('mainContent').scrollTo(0,0);
    const heading = warning.querySelector(step === 1 ? '#wbMaterialHeading' : step === 2 ? '#wbSettingsHeading' : '#wbPreviewHeading');
    heading.tabIndex = -1; heading.focus({preventScroll:true});
  };
  ['1 물질 선택','2 인쇄 설정','3 확인·인쇄'].forEach((title, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.onclick = () => setStep(index + 1); steps.append(button);
  });
  warning.querySelector('.page-header').after(steps); warning.append(footer);
  document.getElementById('mobileWarnBack').onclick = () => setStep(step - 1);
  document.getElementById('mobileWarnNext').onclick = () => step === 3 ? document.getElementById('warnPrintSelectedBtn').click() : setStep(step + 1);
  layout.media.addEventListener('change', () => {
    document.querySelectorAll('.msds-row-more').forEach(el => el.open = !layout.media.matches);
    uploadText.textContent = layout.media.matches ? 'PDF·사진 파일 선택' : originalUploadText;
    if (warning.classList.contains('active')) requestAnimationFrame(refreshWarningPreview);
  });
  uploadText.textContent = layout.media.matches ? 'PDF·사진 파일 선택' : originalUploadText;
  layout.apply(); refreshWarning();
  return {
    mountContractors() {
      if (document.getElementById('mobileDirectoryShortcut')) return;
      const share = document.createElement('button');
      share.id = 'mobileDirectoryShortcut'; share.type = 'button';
      share.className = 'btn btn-outline mobile-only'; share.textContent = '협력사 공유 링크';
      share.onclick = () => window.focusSiteContractorDirectory();
      document.querySelector('#page-contractors .page-header').append(share);
    },
    refreshFilters() {
      const count = ['filterWorkType','filterStatus','filterSpecial'].filter(id => document.getElementById(id).value).length + (window.selectedContractor ? 1 : 0);
      filters.querySelector('summary').textContent = count ? `필터 ${count}개 적용 · 변경하기` : '필터 · 업체 / 공종 / 상태';
    },
    revealContractorTools() { const el = document.getElementById('mobileContractorTools'); if (el) el.open = true; },
    refreshWarning,
    openWarning() { step = 1; refreshWarning(); },
  };
}

export function installPortalMobileExperience() {
  installViewport();
  const panel = document.getElementById('uploadPanel');
  const cameraInput = document.createElement('input'); cameraInput.type = 'file'; cameraInput.accept = 'image/*'; cameraInput.setAttribute('capture','environment'); cameraInput.hidden = true; cameraInput.id = 'portalCameraInput';
  cameraInput.onchange = event => window.onFileSelect(event);
  const camera = document.createElement('button'); camera.type = 'button'; camera.className = 'btn btn-outline mobile-only mobile-camera-button'; camera.textContent = '사진 촬영해서 추가'; camera.dataset.uploadInput = cameraInput.id; camera.onclick = event => { event.preventDefault(); cameraInput.value = ''; cameraInput.click(); };
  document.getElementById('uploadZone').after(cameraInput,camera);
  const actions = document.getElementById('uploadBtn').parentElement; actions.classList.add('portal-mobile-upload-actions');
  return { openExisting() {} };
}

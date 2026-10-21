import { loadPosterFont } from './lib/weather-poster-fonts.js';
import { posterLocale, localizeAdvice, localizeAlert, posterDateTitle } from './lib/weather-poster-i18n.js';
import { createWarningRenderer } from './lib/warning-print.js';
import { weatherAlertsHtml, A4_POSTER, buildHealthPosterSvg, hourlyWeatherHtml, posterModel, kstDate, riskMetric } from './lib/weather-poster.js';
import { loadWeatherDetail, loadWeatherObservations } from './lib/weather-detail.js';
import { labelSafetySections } from './lib/warning-label.js';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  supabase,
  isAutoLoginEnabled,
  setAutoLoginEnabled,
} from './lib/supabase.js';
import {
  generateCode,
  generateToken,
  base64ToBlob,
  downloadBlob,
  guessFromPath,
  today,
} from './lib/utils.js';
import {
  decodePCodes,
  GHS_NAMES,
} from './lib/ghs.js';
import {
  CAS_MEASUREMENT,
  CAS_HEALTH_EXAM,
  CAS_MANAGE,
  CAS_PERMIT,
  CAS_SPECIAL,
  CAS_EXAM_CYCLE,
} from './data/cas-lists.js';
import {
  openModal,
  closeModal,
  toast,
  openPrintWindow,
  buildPrintHtml,
} from './lib/ui.js';
import { createMeasureAftercareDocx } from './lib/measure-docx.js';
import { buildMeasureAftercare } from './lib/measure-aftercare.js';
import {
  PAGES,
  MOBILE_TABS,
  WARN_SIZES,
  PHOTO_FOLDER_PRESETS,
} from './data/constants.js';
import { analyzeMeasurePdf } from './lib/measure-analysis.js';
import { extractMeasurePages } from './lib/measure-pdf-text.js';
import { parseLocalMeasureReport } from './lib/measure-local.js';

// ═══════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════
let user = null,
  profile = null;
let workspaces = [],
  currentWS = null;
let contractors = [],
  workTypes = [],
  msdsRecords = [];
let tokens = [],
  members = [];
let businessLicenses = [];
let msdsFileQueue = [],
  healthFileQueue = [];
let editingMsdsId = null,
  currentDetailId = null,
  receiptEditId = null;
let warnSelected = new Set();
let warnLabelSize = 'a4'; // a4(전면) | a5(2분할) | a6(4분할) | mini(8분할 소분용기)
let warnQrEnabled = true;
let warnCopies = 1; // 표지당 인쇄 매수 (같은 표지를 반복 배치해 분할 시트의 빈칸을 없앰)
let pendingInvites = [];
let measureFileData = null,
  measureFileName_val = null;
let contractorFilter = 'all';
let activeHealthSub = 'result';
let aiSettingsState = null;
let pendingMsdsReanalysis = null;
let feedbackPosts = [],
  feedbackComments = [];
let feedbackLoaded = false,
  isSystemAdmin = false,
  feedbackCurrentId = null;
let adminConsoleState = null,
  adminConsoleTab = 'overview',
  adminConsoleLoading = false,
  adminStandalone = false;
const ANNOUNCEMENT_CACHE_TTL_MS = 60_000;
let announcements = [],
  announcementsLoaded = false,
  announcementCurrentId = null;
let announcementsLoadedAt = 0,
  announcementsWorkspaceId = null;

// 전역 붙여넣기 캐치: 사진 업로드 모달이 열려있을 때 어디서 Ctrl+V를 눌러도 잡히도록 보강
document.addEventListener('paste', (e) => {
  const modal = document.getElementById('photoUploadModal');
  if (
    modal &&
    modal.classList.contains('open') &&
    typeof window.handlePhotoPaste === 'function'
  ) {
    window.handlePhotoPaste(e);
  }
});
let healthConfirmData = [],
  healthExcelData = null,
  healthExcelName_val = null;
let healthCurrentRound = null;
let currentMeasureData = null;

// ═══════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════
let passwordRecoveryMode = false;
const TEAM_INVITE_STORAGE = 'gs_pending_team_invite';
let pendingTeamInvite = '';
let createdTeamInvite = null;
{
  const incoming = new URLSearchParams(location.hash.slice(1)).get('team-invite');
  if (incoming !== null) history.replaceState({}, '', location.pathname + location.search);
  try { pendingTeamInvite = incoming ?? sessionStorage.getItem(TEAM_INVITE_STORAGE) ?? ''; }
  catch { pendingTeamInvite = incoming || ''; }
  if (!/^[a-f0-9]{64}$/.test(pendingTeamInvite)) pendingTeamInvite = '';
  try {
    if (pendingTeamInvite) sessionStorage.setItem(TEAM_INVITE_STORAGE, pendingTeamInvite);
    else sessionStorage.removeItem(TEAM_INVITE_STORAGE);
  } catch { /* Keep the invitation in memory when browser storage is blocked. */ }
}

function isPasswordRecoveryUrl() {
  const query = new URLSearchParams(window.location.search);
  return (
    query.get('type') === 'recovery' ||
    window.location.hash.includes('type=recovery')
  );
}

function isDevAiPreview() {
  return getDevPreviewPage() === 'ai-settings';
}

function getDevPreviewPage() {
  return import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('preview')
    : null;
}

function showDevAiPreview() {
  user = {
    id: 'preview-user',
    email: 'preview@example.com',
    user_metadata: { name: '미리보기' },
  };
  currentWS = { id: 'preview-workspace', name: 'AI 설정 미리보기' };
  profile = { name: '미리보기 사용자' };
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('workspaceScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('sidebarWSName').textContent = currentWS.name;
  document.getElementById('sidebarName').textContent = profile.name;
  document.getElementById('sidebarEmail').textContent = user.email;
  document.getElementById('accountInfo').innerHTML =
    '<b>개발용 화면 미리보기</b><br>실제 계정이나 API 키는 사용하지 않습니다.';
  document.getElementById('memberList').innerHTML =
    '<div class="form-note">미리보기 모드</div>';
  aiSettingsState = {
    preferredProvider: 'claude',
    privacy: {
      allowSensitiveDocuments: false,
      geminiPaidDataProtectionConfirmed: false,
      monthlyRequestLimit: 0,
      monthlyUsed: 4,
    },
    providers: {
      claude: { configured: true, status: 'active', keyHint: 'sk-a••••1234' },
      openai: {
        configured: true,
        status: 'error',
        keyHint: 'sk-p••••5678',
        lastError:
          'GPT API 사용 한도에 도달했습니다. 토큰·크레딧·사용량 제한을 확인해주세요.',
      },
      gemini: { configured: false },
    },
  };
  showPage('settings');
  renderAiSettings();
}

function showDevFeaturePreview(page) {
  user = {
    id: 'preview-user',
    email: 'preview@example.com',
    user_metadata: { name: '미리보기' },
  };
  currentWS = {
    id: 'preview-workspace',
    name: '성동 안전현장',
    address: '서울특별시 성동구 천호대로 416',
    latitude: 37.5663,
    longitude: 127.0541,
  };
  profile = { name: '현장 관리자' };
  contractors = [
    { id: 'con-1', name: '대한건설' },
    { id: 'con-2', name: '한빛전기' },
    { id: 'con-3', name: '성우도장' },
    { id: 'con-4', name: '새길설비' },
  ];
  workTypes = [
    { id: 'wt-1', contractor_id: 'con-1', name: '골조' },
    { id: 'wt-2', contractor_id: 'con-2', name: '전기' },
    { id: 'wt-3', contractor_id: 'con-3', name: '도장' },
  ];
  msdsRecords = [
    {
      id: 'msds-1',
      product_name: '에폭시 프라이머',
      contractor: '성우도장',
      receipt_status: 'received',
      supplier: '안전화학',
      supplier_contact: '02-1234-5678',
      signal_word: '위험',
      pictograms: 'GHS02 GHS05 GHS07 GHS08',
      h_codes: 'H225 H304 H315 H317 H318 H336 H351 H373 H411',
      p_codes:
        'P201 P202 P210 P233 P240 P241 P242 P243 P260 P273 P280 P301+P310 P304+P340 P305+P351+P338 P403 P405 P501',
      protective_equipment: '보호장갑, 보안경, 방독마스크',
      legal_special: 'Y',
      has_pdf: true,
      handling_precautions:
        '충분히 환기되는 장소에서 사용하고, 열·불꽃·스파크와의 접촉을 피하십시오. 용기를 밀폐하여 보관하십시오.',
      first_aid:
        '눈에 들어가면 물로 조심해서 씻고, 흡입 시 신선한 공기가 있는 곳으로 옮긴 뒤 의학적인 조언을 구하십시오.',
      emergency_response:
        '점화원을 제거하고 관계자 외 접근을 제한하십시오. 보호구를 착용하고 누출물이 배수구로 유입되지 않도록 하십시오.',
      pdf_path: 'preview/msds-1.pdf',
      pdf_name: '에폭시프라이머_MSDS.pdf',
      submission_no_valid: 'N',
      version: 1,
      history: [],
    },
    {
      id: 'msds-2',
      product_name: '실리콘 실란트',
      contractor: '새길설비',
      receipt_status: 'pending',
      supplier: '한국실란트',
      signal_word: '경고',
      pictograms: 'GHS07',
      h_codes: 'H315 H319',
      p_codes: 'P264 P280 P302+P352 P305+P351+P338',
      legal_special: 'N',
    },
  ];
  Object.assign(msdsRecords[0], {
    cas_no: '108-88-3, 67-64-1',
    components: '톨루엔 20~30%, 아세톤 10~15%',
    issue_date: '2026-08-01',
    legal_measurement: 'Y',
    legal_exam: 'Y',
    legal_manage: 'Y',
    legal_permit: 'N',
    legal_dangerous: 'Y',
    analysis_provider: 'gemini',
    analysis_model: 'gemini-2.5-flash',
    component_details: [
      {
        casNo: '108-88-3',
        substanceName: '톨루엔',
        minContent: '20',
        maxContent: '30',
        unit: '%',
        basis: '3항 구성성분',
      },
      {
        casNo: '67-64-1',
        substanceName: '아세톤',
        minContent: '10',
        maxContent: '15',
        unit: '%',
        basis: '3항 구성성분',
      },
    ],
    dangerous_goods_details: {
      status: '해당',
      classNo: '제4류',
      flammableLiquid: {
        status: '해당',
        detail: '인화성액체',
        basis: '9항 및 15항',
      },
      category: '제1석유류',
      waterSolubility: '비수용성액체',
      designatedQuantity: '200 L',
      detail: '제4류 제1석유류',
      basis: '15항 위험물안전관리법',
    },
    occupational_safety_details: {
      managementTarget: {
        status: '해당',
        detail: '톨루엔 함유',
        basis: '15항',
      },
      specialManagement: {
        status: '내용없음',
        detail: '문서에서 특별관리물질 표기를 확인하지 못함',
        basis: '',
      },
      workEnvironmentMeasurement: {
        status: '해당',
        detail: '작업환경측정 대상',
        basis: '15항',
      },
      exposureLimit: {
        status: '해당',
        detail: '톨루엔 TWA 50 ppm',
        basis: '8항',
      },
      permissibleLimit: { status: '내용없음', detail: '', basis: '' },
      localExhaustInspection: {
        status: '조건부',
        detail: '밀폐설비·국소배기 설치 및 점검 여부는 실제 공정 확인 필요',
        basis: '현장 조건 필요',
      },
      specialHealthExam: {
        status: '해당',
        detail: '특수건강진단 대상, 기본주기 12개월',
        basis: '15항',
      },
      permitTarget: { status: '해당없음', detail: '', basis: '15항' },
      prohibitedTarget: { status: '해당없음', detail: '', basis: '15항' },
      psm: {
        status: '조건부',
        detail: '공정 및 규정수량 이상 취급 여부 확인 필요',
        basis: '취급량·공정 조건 필요',
      },
    },
    chemical_regulation_details: {
      toxic: { status: '해당', detail: '유독물질 함유', basis: '15항' },
      restricted: { status: '해당없음', detail: '', basis: '15항' },
      prohibited: { status: '해당없음', detail: '', basis: '15항' },
      accidentPreparedness: {
        status: '조건부',
        detail: '혼합물 함유량 기준 확인 필요',
        basis: '15항',
      },
    },
  });
  businessLicenses = [
    {
      id: 'license-1',
      contractor_id: 'con-1',
      file_name: '대한건설_사업자등록증.pdf',
      uploaded_by: 'manager',
      uploaded_at: new Date().toISOString(),
      contractor: { name: '대한건설' },
    },
  ];
  aiSettingsState = {
    preferredProvider: 'claude',
    privacy: {
      allowSensitiveDocuments: false,
      geminiPaidDataProtectionConfirmed: false,
      monthlyRequestLimit: 0,
      monthlyUsed: 4,
    },
    providers: {
      claude: { configured: true, status: 'active', keyHint: 'sk-a••••1234' },
      openai: { configured: false },
      gemini: { configured: false },
    },
  };
  isSystemAdmin = true;
  if (page === 'admin') {
    const now = new Date().toISOString();
    adminConsoleState = {
      me: { id: 'preview-user', email: user.email, name: '시스템 관리자' },
      metrics: {
        users: 3,
        workspaces: 2,
        activeWorkspaces: 1,
        systemAdmins: 1,
        openFeedback: 2,
        aiIssues: 1,
      },
      health: {
        database: true,
        auth: true,
        storage: true,
        edgeFunction: true,
        checkedAt: now,
      },
      workspaces: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '성동 안전현장',
          code: 'A7K9D2',
          owner_id: 'preview-user',
          ownerName: '구다희',
          ownerEmail: 'manager@example.com',
          address: '서울특별시 성동구 천호대로 416',
          status: 'active',
          memberCount: 2,
          msdsCount: 375,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: '마포 신규현장',
          code: 'M3P8Q1',
          owner_id: 'preview-user-2',
          ownerName: '김보건',
          ownerEmail: 'health@example.com',
          address: '서울특별시 마포구',
          status: 'suspended',
          memberCount: 1,
          msdsCount: 12,
        },
      ],
      users: [
        {
          id: 'preview-user',
          name: '구다희',
          email: 'manager@example.com',
          createdAt: now,
          lastSignInAt: now,
          isSystemAdmin: true,
          memberships: [
            {
              workspaceId: '11111111-1111-4111-8111-111111111111',
              role: 'admin',
            },
          ],
        },
        {
          id: 'preview-user-2',
          name: '김보건',
          email: 'health@example.com',
          createdAt: now,
          lastSignInAt: now,
          isSystemAdmin: false,
          memberships: [
            {
              workspaceId: '22222222-2222-4222-8222-222222222222',
              role: 'admin',
            },
          ],
        },
        {
          id: 'preview-user-3',
          name: '이초보',
          email: 'beginner@example.com',
          createdAt: now,
          lastSignInAt: null,
          isSystemAdmin: false,
          memberships: [],
        },
      ],
      feedback: [
        {
          id: 'preview-feedback',
          author_name: '이초보',
          category: 'bug',
          feature_area: 'MSDS 대장',
          urgency: 'urgent',
          title: 'PDF 분석 후 화면이 멈춥니다',
          status: 'received',
          created_at: now,
        },
      ],
      aiIssues: [
        {
          user_id: 'preview-user-3',
          provider: 'openai',
          key_hint: 'sk-p••••1234',
          status: 'error',
          last_error: 'API 사용 한도를 확인해주세요.',
          last_validated_at: now,
        },
      ],
      auditLogs: [
        {
          id: 'preview-audit',
          actor_id: 'preview-user',
          action: 'membership.set',
          target_type: 'user',
          created_at: now,
        },
      ],
    };
  }
  if (page === 'measure') {
    currentMeasureData = {
      round: '2026년 1차 (상반기)',
      period: '2026-05-21 ~ 2026-05-22',
      receivedDate: '2026-06-19',
      siteName: currentWS.name,
      createdDate: '2026-06-26',
      defaultAssignee: '보건관리자',
      dust: [
        {
          no: 1,
          process: '내장목공사',
          agent: '목재분진',
          measured: '1.21 mg/m³',
          limit: '1 mg/m³',
          reason: '개인시료 측정',
        },
      ],
      noise: [
        {
          no: 1,
          process: '철골공사',
          agent: '소음',
          measured: '86.2 dB(A)',
          limit: '90 dB(A)',
          reason: '8시간 TWA',
        },
      ],
      workTypes: ['내장목공사', '철골공사'],
      dustExceeded: true,
      noiseExceeded: false,
      mixedExceeded: false,
      aftercare: {
        overview: {
          siteName: currentWS.name,
          measurementPeriod: '2026-05-21 ~ 2026-05-22',
          receivedDate: '2026-06-19',
        },
        resultRows: [
          {
            no: 1,
            workType: '내장목공사',
            singleStatus: '초과',
            mixedStatus: '해당없음',
            noiseStatus: '해당없음',
            exceededMeasurements: [
              {
                agent: '목재분진',
                measured: { value: '1.21', unit: 'mg/m³' },
                limit: { value: '1', unit: 'mg/m³' },
              },
            ],
          },
          {
            no: 2,
            workType: '철골공사',
            singleStatus: '해당없음',
            mixedStatus: '해당없음',
            noiseStatus: '미만',
            exceededMeasurements: [],
          },
        ],
        improvements: [
          {
            no: 1,
            target: '내장목공사(목재분진)',
            method:
              '이동식 집진장치 설치, 방진마스크 착용 및 작업 후 습식 청소를 실시한다.',
            assignee: '보건관리자',
            source: '보고서 기재',
          },
          {
            no: 2,
            target: '철골공사',
            method:
              '귀마개 착용 상태를 점검하고 소음 발생 장비의 정비 상태를 주기적으로 확인한다.',
            assignee: '공사담당자',
            source: 'AI 제안',
          },
        ],
      },
    };
  }
  announcementsLoaded = true;
  announcements = [
    {
      id: 'announcement-1',
      workspace_id: 'preview-workspace',
      title: 'MSDS 분석 결과는 원문과 함께 확인해주세요',
      content:
        'AI 분석 결과는 업무를 돕는 초안입니다. 법적 분류와 조치사항은 반드시 최신 법령 및 원문을 확인한 뒤 확정해주세요.',
      is_important: true,
      starts_at: new Date(Date.now() - 86400000).toISOString(),
      ends_at: null,
      created_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date(Date.now() - 86400000).toISOString(),
    },
  ];
  feedbackLoaded = true;
  feedbackPosts = [
    {
      id: 'feedback-1',
      author_id: 'preview-user',
      author_name: '구다희',
      category: 'bug',
      feature_area: 'MSDS 대장',
      urgency: 'urgent',
      title: 'MSDS 재분석 후 비교 화면이 열리지 않습니다',
      content:
        'PDF를 선택하고 다시 분석하기를 눌렀는데 로딩 후 화면이 그대로입니다.',
      reproduction_steps:
        '1. MSDS 대장 이동\n2. 제품 상세 열기\n3. 다시 분석하기 클릭',
      expected_result: '기존 결과와 새 결과의 비교 화면이 보여야 합니다.',
      status: 'reviewing',
      created_at: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: 'feedback-2',
      author_id: 'preview-user',
      author_name: '구다희',
      category: 'improvement',
      feature_area: '건강진단',
      urgency: 'normal',
      title: '검진 결과 엑셀 내보내기를 추가해주세요',
      content:
        '특수검진 대상자 목록을 엑셀로 내려받아 협력사에 전달하고 싶습니다.',
      status: 'received',
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
  ];
  feedbackComments = [
    {
      id: 'comment-1',
      post_id: 'feedback-1',
      admin_name: '시스템 관리자',
      content:
        '확인 중입니다. 재현 환경을 점검한 뒤 처리 일정을 안내하겠습니다.',
      created_at: new Date().toISOString(),
    },
  ];
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('workspaceScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('sidebarWSName').textContent = currentWS.name;
  document.getElementById('sidebarName').textContent = profile.name;
  document.getElementById('sidebarEmail').textContent = user.email;
  document.getElementById('wsNameEdit').value = currentWS.name;
  hydrateWorkspaceLocationInputs();
  populateContractorSelects();
  const target = PAGES.includes(page) ? page : 'home';
  if (target === 'warning') {
    warnSelected = new Set(['msds-1']);
    warnPreviewSingle = 'msds-1';
  }
  // 모듈 하단에 정의된 날씨 렌더러까지 초기화된 뒤 미리보기 화면을 연다.
  setTimeout(() => {
    updateStats();
    renderMsdsTable();
    renderHomeDashboard();
    renderAiSettings();
    if (target === 'announcements') window.renderAnnouncements();
    if (target === 'feedback') renderFeedbackBoard();
    if (target === 'measure') showMeasureResult(currentMeasureData);
    window.showPage(target);
  }, 0);
}

function mountAiSettingsCard() {
  const card = document.getElementById('aiSettingsCard');
  const settingsContent = document.querySelector(
    '#page-settings > .content-scroll',
  );
  if (card && settingsContent && card.parentElement !== settingsContent)
    settingsContent.prepend(card);
}

async function init() {
  mountAiSettingsCard();
  mountGsWorkspace();
  const previewPage = getDevPreviewPage();
  if (previewPage) {
    previewPage === 'ai-settings'
      ? showDevAiPreview()
      : showDevFeaturePreview(previewPage);
    document.getElementById('loadingScreen').style.display = 'none';
    return;
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (isPasswordRecoveryUrl()) {
    passwordRecoveryMode = true;
    showAuth();
    switchTab('reset');
  } else if (session?.user) {
    user = session.user;
    await showWorkspaces(true);
  } else {
    showAuth();
  }
  document.getElementById('loadingScreen').style.display = 'none';
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    passwordRecoveryMode = true;
    showAuth();
    switchTab('reset');
    return;
  }
  if (event === 'SIGNED_IN' && session?.user) {
    user = session.user;
  }
});

// ═══════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════
function showAuth() {
  document.getElementById('authScreen').style.display = 'block';
  document.getElementById('workspaceScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'none';
  const autoLogin = document.getElementById('autoLoginChk');
  if (autoLogin) autoLogin.checked = isAutoLoginEnabled();
  renderTeamInviteNotice();
}

window.switchTab = function (tab) {
  ['login', 'signup', 'forgot', 'reset'].forEach((t) => {
    document.getElementById(t + 'Form').style.display =
      t === tab ? 'flex' : 'none';
  });
  const tabs = document.querySelectorAll('.auth-tab');
  tabs[0].classList.toggle('active', tab === 'login');
  tabs[1].classList.toggle('active', tab === 'signup');
  if (tab === 'forgot' || tab === 'reset') {
    tabs[0].classList.remove('active');
    tabs[1].classList.remove('active');
  }
};

window.handleLogin = async function () {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const msg = document.getElementById('loginMsg');
  const btn = document.getElementById('loginBtn');
  if (!email || !password) {
    msg.className = 'auth-msg error';
    msg.textContent = '이메일과 비밀번호를 입력하세요';
    return;
  }
  setAutoLoginEnabled(
    document.getElementById('autoLoginChk')?.checked !== false,
  );
  btn.disabled = true;
  btn.textContent = '로그인 중...';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.textContent = '로그인';
  if (error) {
    msg.className = 'auth-msg error';
    msg.textContent = translateAuthError(error.message);
    return;
  }
  user = (await supabase.auth.getUser()).data.user;
  await showWorkspaces(true);
};

window.handleSignup = async function () {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const msg = document.getElementById('signupMsg');
  const btn = document.getElementById('signupBtn');
  if (!name || !email || !password) {
    msg.className = 'auth-msg error';
    msg.textContent = '모든 항목을 입력하세요';
    return;
  }
  btn.disabled = true;
  btn.textContent = '가입 중...';
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  btn.disabled = false;
  btn.textContent = '회원가입';
  if (error) {
    msg.className = 'auth-msg error';
    msg.textContent = translateAuthError(error.message);
    return;
  }
  msg.className = 'auth-msg success';
  msg.textContent = '가입 완료! 로그인하세요.';
  setTimeout(() => switchTab('login'), 2000);
};

window.handleForgot = async function () {
  const msg = document.getElementById('forgotMsg');
  msg.className = 'auth-msg error';
  msg.textContent = '비밀번호 재설정 이메일 기능은 현재 중지되어 있습니다.';
};

window.handlePasswordUpdate = async function () {
  const password = document.getElementById('resetPassword').value;
  const confirmPassword = document.getElementById('resetPasswordConfirm').value;
  const msg = document.getElementById('resetMsg');
  const btn = document.getElementById('resetBtn');
  if (!passwordRecoveryMode) {
    msg.className = 'auth-msg error';
    msg.textContent = '유효한 비밀번호 재설정 링크로 다시 접속하세요';
    return;
  }
  if (password.length < 6) {
    msg.className = 'auth-msg error';
    msg.textContent = '비밀번호는 6자 이상이어야 합니다';
    return;
  }
  if (password !== confirmPassword) {
    msg.className = 'auth-msg error';
    msg.textContent = '비밀번호 확인이 일치하지 않습니다';
    return;
  }
  btn.disabled = true;
  btn.textContent = '변경 중...';
  const { error } = await supabase.auth.updateUser({ password });
  btn.disabled = false;
  btn.textContent = '비밀번호 변경';
  if (error) {
    msg.className = 'auth-msg error';
    msg.textContent = translateAuthError(error.message);
    return;
  }
  passwordRecoveryMode = false;
  history.replaceState({}, document.title, window.location.pathname);
  msg.className = 'auth-msg success';
  msg.textContent = '비밀번호가 변경됐습니다. 새 비밀번호로 로그인하세요.';
  await supabase.auth.signOut();
  setTimeout(() => switchTab('login'), 1200);
};

window.handleLogout = async function () {
  await supabase.auth.signOut();
  user = null;
  profile = null;
  workspaces = [];
  currentWS = null;
  resetWorkspaceScopedState();
  feedbackPosts = [];
  feedbackComments = [];
  feedbackLoaded = false;
  isSystemAdmin = false;
  feedbackCurrentId = null;
  adminConsoleState = null;
  adminStandalone = false;
  document.body.classList.remove('admin-standalone');
  showAuth();
};

function translateAuthError(m) {
  if (m.includes('Invalid login')) return '이메일 또는 비밀번호가 틀렸습니다';
  if (m.includes('already registered')) return '이미 가입된 이메일입니다';
  if (m.includes('Password should')) return '비밀번호는 6자 이상이어야 합니다';
  if (m.includes('Email not confirmed'))
    return '이메일 인증이 필요합니다 (메일함 확인)';
  return m;
}

// ═══════════════════════════════════════════════
// Workspace
// ═══════════════════════════════════════════════
function resetWorkspaceScopedState() {
  createdTeamInvite = null;
  const inviteUrl = document.getElementById('teamInviteUrl');
  if (inviteUrl) inviteUrl.value = '';
  const inviteResult = document.getElementById('teamInviteResult');
  if (inviteResult) inviteResult.hidden = true;
  contractors = [];
  workTypes = [];
  msdsRecords = [];
  tokens = [];
  members = [];
  businessLicenses = [];
  pendingInvites = [];
  msdsFileQueue = [];
  healthFileQueue = [];
  editingMsdsId = null;
  currentDetailId = null;
  receiptEditId = null;
  pendingMsdsReanalysis = null;

  measureFileData = null;
  measureFileName_val = null;
  measureFileB64 = null;
  currentMeasureData = null;
  measureResults = [];
  measureRounds = [];

  healthConfirmData = [];
  healthExcelData = null;
  healthExcelName_val = null;
  healthCurrentRound = null;
  healthRecordsList = [];

  placementRawRows = [];
  placementCodeSet = [];
  placementFiltered = [];
  placementSnapshots = [];
  activeSnapshotId = null;

  publicLink = null;
  siteDirectoryLink = null;
  sortingRows = [];
  mpMonth = '';
  mpRecords = [];
  mpSelected = new Set();
  mpFilter = '전체';
  vulGroups = null;
  bpList = null;
  bpBaseDate = null;

  announcements = [];
  announcementsLoaded = false;
  announcementCurrentId = null;
  announcementsLoadedAt = 0;
  announcementsWorkspaceId = null;

  warnSelected = new Set();
  warnPreviewSingle = null;
  window.selectedContractor = '';

  photoFolders = [];
  photos = [];
  activeFolderId = null;
  openFolderIds = new Set();
  photoThumbUrlCache = {};
  pendingUploadFiles = [];
  draggedPhotoId = null;
  addFolderParentId = null;
  viewingPhotoId = null;

  wxForecast = null;
  wxPosterCache = {};
  wxPosterSvg = '';
  if (wxPosterObjectUrl) URL.revokeObjectURL(wxPosterObjectUrl);
  wxPosterObjectUrl = '';

  kgCatalog = null;
  window.clauseSearchStore = [];
  window.koshaGuideSearchStore = [];
  clauseSearchQuery = '';

  if (notifChannel) {
    supabase.removeChannel(notifChannel);
    notifChannel = null;
  }
  notifs = [];
}

async function showWorkspaces(autoEnter = false) {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('workspaceScreen').style.display = 'block';
  document.getElementById('appScreen').style.display = 'none';
  const name = user.user_metadata?.name || user.email.split('@')[0];
  document.getElementById('wsGreeting').textContent =
    `안녕하세요, ${name}님 👋`;
  document.getElementById('topbarUser').textContent = user.email;
  await refreshSystemAdminRole();
  await loadWorkspaces();
  setSystemAdminVisibility();
  renderTeamInviteNotice();
  if (pendingTeamInvite) {
    await window.reviewTeamInvite();
    return;
  }
  if (autoEnter && isSystemAdmin) {
    await window.enterAdminConsole();
    return;
  }
  if (autoEnter && workspaces.length > 0) {
    const lastId = localStorage.getItem('fms_last_ws');
    const target =
      workspaces.find((w) => w.id === lastId) ||
      (workspaces.length === 1 ? workspaces[0] : null);
    if (target) await enterWorkspace(target.id);
  }
}

async function loadWorkspaces() {
  const { data: memberRows } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user.id);
  if (!memberRows || memberRows.length === 0) {
    workspaces = [];
    renderWorkspaceList();
    return;
  }
  const wsIds = memberRows.map((m) => m.workspace_id);
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .in('id', wsIds)
    .order('created_at', { ascending: true });
  if (error) {
    toast('현장 목록 로드 실패', 'error');
    workspaces = [];
    renderWorkspaceList();
    return;
  }
  workspaces = (data || []).map((ws) => ({
    ...ws,
    workspace_members: [
      {
        role:
          memberRows.find((m) => m.workspace_id === ws.id)?.role || 'member',
      },
    ],
  }));
  renderWorkspaceList();
}

function renderWorkspaceList() {
  const el = document.getElementById('wsList');
  if (workspaces.length === 0) {
    el.innerHTML = `<div class="ws-empty"><div class="ws-empty-icon">🏗️</div><div class="ws-empty-text">아직 등록된 현장이 없습니다</div><div>아래 버튼으로 첫 번째 현장을 추가하세요</div></div>`;
    return;
  }
  el.innerHTML = workspaces
    .map((ws) => {
      const role = ws.workspace_members?.[0]?.role || 'member';
      const isOwner = ws.owner_id === user.id;
      const unavailable =
        !isSystemAdmin && ['suspended', 'archived'].includes(ws.status);
      return `<button type="button" class="ws-card ${unavailable ? 'is-unavailable' : ''}" onclick="enterWorkspace('${ws.id}')" ${unavailable ? 'disabled' : ''}>
      <div class="ws-card-icon">🏗️</div>
      <div class="ws-card-info">
        <div class="ws-card-name">${escapeHtml(ws.name)}</div>
        <div class="ws-card-meta">코드: ${escapeHtml(ws.code)} · ${isOwner ? '관리자' : role === 'admin' ? '관리자' : '멤버'}${unavailable ? ` · ${ADMIN_STATUS_LABEL[ws.status]}` : ''}</div>
      </div>
      <div class="ws-card-badge">${unavailable ? '접근 중지' : '입장 →'}</div>
    </button>`;
    })
    .join('');
}

window.createWorkspace = async function () {
  const name = document.getElementById('wsNameInput').value.trim();
  if (!name) {
    toast('현장명을 입력하세요', 'error');
    return;
  }
  const code = generateCode();
  const { data: ws, error } = await supabase
    .from('workspaces')
    .insert({ name, code, owner_id: user.id })
    .select()
    .single();
  if (error) {
    toast('생성 실패: ' + error.message, 'error');
    return;
  }
  await supabase
    .from('workspace_members')
    .insert({ workspace_id: ws.id, user_id: user.id, role: 'admin' });
  closeModal('createWSModal');
  document.getElementById('wsNameInput').value = '';
  await loadWorkspaces();
  toast(name + ' 현장이 추가됐습니다', 'success');
};

window.enterWorkspace = async function (wsId) {
  const nextWorkspace = workspaces.find((w) => w.id === wsId);
  if (!nextWorkspace) return;
  if (
    !isSystemAdmin &&
    ['suspended', 'archived'].includes(nextWorkspace.status)
  ) {
    toast(
      '현재 접근할 수 없는 현장입니다. 시스템 관리자에게 문의해주세요.',
      'error',
    );
    return;
  }
  resetWorkspaceScopedState();
  adminStandalone = false;
  document.body.classList.remove('admin-standalone');
  currentWS = nextWorkspace;
  localStorage.setItem('fms_last_ws', wsId);
  document.getElementById('workspaceScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('sidebarWSName').textContent = currentWS.name;
  document.getElementById('homeTitle').textContent = currentWS.name;
  document.getElementById('homeDate').textContent =
    new Date().toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
  document.getElementById('wsNameEdit').value = currentWS.name;
  hydrateWorkspaceLocationInputs();
  document.getElementById('warningSite').value = currentWS.name;
  const name = user.user_metadata?.name || user.email.split('@')[0];
  document.getElementById('sidebarName').textContent = name;
  document.getElementById('sidebarEmail').textContent = user.email;
  document.getElementById('sidebarAvatar').textContent = name
    .charAt(0)
    .toUpperCase();
  document.getElementById('accountInfo').innerHTML =
    `이메일: ${escapeHtml(user.email)}<br>이름: ${escapeHtml(name)}<br>가입일: ${new Date(user.created_at).toLocaleDateString('ko-KR')}`;
  await Promise.all([
    loadContractors(),
    loadWorkTypes(),
    loadMembers(),
    loadTokens(),
    loadPublicLink(),
  ]);
  await Promise.all([
    loadMsdsRecords(),
    loadPlacementSnapshots(),
    loadBusinessLicenses(),
    loadMeasureRounds(),
    loadMeasureResults(),
    loadNotifications(),
    loadHealthRecords(),
  ]);
  subscribeNotifications();
  renderHomeDashboard(); // 알림(재업로드 도착) 로드 후 대시보드 갱신
  loadDashWeather();
  showPage('home');
  loadPhotoFolders().then(loadPhotos); // 사진은 홈 화면 진입을 막지 않고 백그라운드로 로드
};

window.enterAdminConsole = async function () {
  if (!isSystemAdmin) {
    toast('시스템 관리자 권한이 필요합니다.', 'error');
    return;
  }
  resetWorkspaceScopedState();
  adminStandalone = true;
  document.body.classList.add('admin-standalone');
  currentWS = null;
  document.getElementById('workspaceScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('sidebarWSName').textContent = '전체 시스템';
  const name = user.user_metadata?.name || user.email.split('@')[0];
  document.getElementById('sidebarName').textContent = name;
  document.getElementById('sidebarEmail').textContent = user.email;
  document.getElementById('sidebarAvatar').textContent = name
    .charAt(0)
    .toUpperCase();
  setSystemAdminVisibility();
  showPage('admin');
};

window.goWorkspaces = function () {
  adminStandalone = false;
  document.body.classList.remove('admin-standalone');
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('workspaceScreen').style.display = 'block';
  loadWorkspaces();
};

function hydrateWorkspaceLocationInputs() {
  const address = document.getElementById('wsAddressEdit');
  const lat = document.getElementById('wsLatitudeEdit');
  const lng = document.getElementById('wsLongitudeEdit');
  if (address) address.value = currentWS?.address || '';
  if (lat) lat.value = currentWS?.latitude ?? '';
  if (lng) lng.value = currentWS?.longitude ?? '';
  renderSiteCoordinateResult();
}

let siteCoordinateRequest = 0;

function renderSiteCoordinateResult() {
  const box = document.getElementById('siteCoordinateResult');
  const text = document.getElementById('siteCoordinateText');
  if (!box || !text) return;
  const lat = Number(document.getElementById('wsLatitudeEdit')?.value);
  const lng = Number(document.getElementById('wsLongitudeEdit')?.value);
  const ready =
    Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  box.classList.toggle('found', ready);
  box.classList.remove('error');
  const retry = document.getElementById('siteCoordinateRetry'); if (retry) retry.hidden = true;
  text.textContent = ready
    ? `좌표 확인됨 · 위도 ${lat.toFixed(5)}, 경도 ${lng.toFixed(5)}`
    : '주소를 입력하고 좌표를 확인해주세요.';
}

window.clearSiteCoordinateResult = function () {
  const address = document.getElementById('wsAddressEdit')?.value.trim() || '';
  if (address === (currentWS?.address || '')) return;
  document.getElementById('wsLatitudeEdit').value = '';
  document.getElementById('wsLongitudeEdit').value = '';
  renderSiteCoordinateResult();
};

window.openSiteAddressSearch = function () {
  const applyAddress = async (address, zonecode = '') => {
    const input = document.getElementById('wsAddressEdit');
    if (!input) return;
    input.value = address;
    document.getElementById('wsLatitudeEdit').value = '';
    document.getElementById('wsLongitudeEdit').value = '';
    renderSiteCoordinateResult();
    try {
      const found = await findSiteCoordinates({ silent: true, throwOnError: true });
      if (found) toast(`${zonecode ? `[${zonecode}] ` : ''}주소와 좌표를 확인했습니다. 현장 정보를 저장해주세요`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  if (getDevPreviewPage()) {
    applyAddress('서울특별시 성동구 천호대로 416', '04808');
    return;
  }
  if (!window.kakao?.Postcode) {
    toast(
      '주소 검색 서비스를 불러오지 못했습니다. 인터넷 연결 후 다시 시도해주세요',
      'error',
    );
    return;
  }
  new window.kakao.Postcode({
    oncomplete(data) {
      const address =
        data.userSelectedType === 'R'
          ? data.roadAddress || data.address
          : data.jibunAddress || data.address;
      applyAddress(address, data.zonecode || '');
    },
  }).open();
};

window.findSiteCoordinates = async function (options = {}) {
  const address = document.getElementById('wsAddressEdit')?.value.trim();
  if (!address) {
    if (!options.silent) toast('현장 주소를 입력하세요', 'error');
    return null;
  }
  const request = ++siteCoordinateRequest;
  const btn = document.getElementById('siteGeocodeBtn');
  const text = document.getElementById('siteCoordinateText');
  const box = document.getElementById('siteCoordinateResult');
  if (btn) { btn.disabled = true; btn.textContent = '좌표 확인 중...'; }
  box?.classList.remove('found', 'error');
  if (text) text.textContent = '선택한 주소의 좌표를 확인하고 있습니다…';
  const retry = document.getElementById('siteCoordinateRetry'); if (retry) retry.hidden = true;
  try {
    const result = getDevPreviewPage()
      ? { address, latitude: 37.5663, longitude: 127.0541 }
      : (await invokeEdgeJson('site-weather', { action: 'geocode', address })).result;
    if (request !== siteCoordinateRequest || document.getElementById('wsAddressEdit').value.trim() !== address) return null;
    const latitude = Number(result?.latitude), longitude = Number(result?.longitude);
    if (!result || result.latitude === null || result.longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude <= 0 || latitude > 90 || longitude <= 0 || longitude > 180) throw new Error('좌표 서비스가 유효한 좌표를 반환하지 않았습니다. 다시 시도해주세요.');
    document.getElementById('wsLatitudeEdit').value = latitude;
    document.getElementById('wsLongitudeEdit').value = longitude;
    renderSiteCoordinateResult();
    if (!options.silent) toast('현장 좌표를 찾았습니다. 저장 버튼을 눌러주세요', 'success');
    return { ...result, address, latitude, longitude };
  } catch (error) {
    if (request !== siteCoordinateRequest) return null;
    document.getElementById('wsLatitudeEdit').value = '';
    document.getElementById('wsLongitudeEdit').value = '';
    box?.classList.remove('found'); box?.classList.add('error');
    if (text) text.textContent = error.message;
    if (retry) retry.hidden = false;
    if (options.throwOnError) throw error;
    if (!options.silent) toast(error.message, 'error');
    return null;
  } finally {
    if (btn && request === siteCoordinateRequest) { btn.disabled = false; btn.textContent = '주소 검색'; }
  }
};

window.updateWorkspaceInfo = async function () {
  const name = document.getElementById('wsNameEdit').value.trim();
  if (!name) {
    toast('현장명을 입력하세요', 'error');
    return;
  }
  const address = document.getElementById('wsAddressEdit')?.value.trim() || '';
  let latitude = Number(document.getElementById('wsLatitudeEdit')?.value);
  let longitude = Number(document.getElementById('wsLongitudeEdit')?.value);
  if (
    address &&
    (!Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !latitude ||
      !longitude)
  ) {
    const found = await findSiteCoordinates();
    if (!found) return;
    latitude = Number(found.latitude);
    longitude = Number(found.longitude);
  }
  const payload = {
    name,
    address: address || null,
    latitude: address ? latitude : null,
    longitude: address ? longitude : null,
  };
  if (getDevPreviewPage()) {
    Object.assign(currentWS, payload);
    hydrateWorkspaceLocationInputs();
    toast('미리보기에서 현장 정보가 저장됐습니다', 'success');
    return;
  }
  const { error } = await supabase
    .from('workspaces')
    .update(payload)
    .eq('id', currentWS.id);
  if (error) {
    toast('저장 실패', 'error');
    return;
  }
  Object.assign(currentWS, payload);
  document.getElementById('sidebarWSName').textContent = name;
  document.getElementById('homeTitle').textContent = name;
  document.getElementById('warningSite').value = name;
  wxForecast = null;
  gsHomeForecast = null;
  gsHomeForecastKey = '';
  toast('현장 정보와 위치가 저장됐습니다', 'success');
};

window.updateWSName = window.updateWorkspaceInfo;

window.openSiteLocationSettings = function () {
  showPage('settings');
  setTimeout(
    () =>
      document
        .getElementById('siteLocationSettingsCard')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    100,
  );
};

// ═══════════════════════════════════════════════
// 사용자별 AI API 설정
// ═══════════════════════════════════════════════
const AI_PROVIDER_LABEL = { claude: 'Claude', openai: 'GPT', gemini: 'Gemini' };
const AI_SETUP_CODES = new Set([
  'AI_KEY_REQUIRED',
  'AI_KEY_INVALID',
  'AI_BILLING_REQUIRED',
  'AI_QUOTA_EXCEEDED',
  'AI_MONTHLY_LIMIT',
  'AI_PRIVACY_CONSENT_REQUIRED',
  'AI_PROVIDER_PRIVACY_REQUIRED',
]);

async function invokeEdgeJson(functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });
  if (error) {
    let payload = null;
    try {
      payload = error.context ? await error.context.json() : null;
    } catch {}
    const err = new Error(
      payload?.error || error.message || '서버 요청에 실패했습니다.',
    );
    err.code = payload?.code || 'EDGE_FUNCTION_ERROR';
    throw err;
  }
  if (data?.error) {
    const err = new Error(data.error);
    err.code = data.code || 'EDGE_FUNCTION_ERROR';
    throw err;
  }
  return data;
}

function showAiRequiredWarning(message, code = 'AI_KEY_REQUIRED') {
  const el = document.getElementById('aiRequiredMessage');
  if (el)
    el.textContent =
      message || 'AI 분석을 사용하려면 개인 API 키를 먼저 등록해야 합니다.';
  openModal('aiRequiredModal');
  if (AI_SETUP_CODES.has(code)) aiSettingsState = null;
}

window.goToAiSettings = function () {
  closeModal('aiRequiredModal');
  showPage('settings');
  setTimeout(
    () =>
      document
        .getElementById('aiSettingsCard')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    80,
  );
};

function handleAiError(error, prefix = '분석 실패') {
  if (AI_SETUP_CODES.has(error?.code)) {
    showAiRequiredWarning(error.message, error.code);
  } else {
    toast(`${prefix}: ${error?.message || '알 수 없는 오류'}`, 'error');
  }
}

window.loadAiSettings = async function () {
  if (!user) return;
  const warning = document.getElementById('aiSettingsWarning');
  if (warning) {
    warning.style.display = '';
    warning.textContent = 'API 설정을 확인하는 중입니다...';
  }
  try {
    aiSettingsState = await invokeEdgeJson('ai-settings', { action: 'status' });
    renderAiSettings();
  } catch (error) {
    if (warning) {
      warning.style.display = '';
      warning.textContent = 'API 설정을 불러오지 못했습니다: ' + error.message;
    }
  }
};

function renderAiSettings() {
  if (!aiSettingsState) return;
  const configured = Object.values(aiSettingsState.providers || {}).filter(
    (item) => item.configured,
  );
  const usable = configured.filter((item) => item.status !== 'error');
  const privacy = aiSettingsState.privacy || {};
  const sensitiveInput = document.getElementById('aiAllowSensitiveDocuments');
  const geminiInput = document.getElementById('aiGeminiPaidProtection');
  const limitInput = document.getElementById('aiMonthlyLimit');
  const limitEnabledInput = document.getElementById('aiEnableMonthlyLimit');
  const usageEl = document.getElementById('aiMonthlyUsage');
  if (sensitiveInput)
    sensitiveInput.checked = privacy.allowSensitiveDocuments === true;
  if (geminiInput)
    geminiInput.checked = privacy.geminiPaidDataProtectionConfirmed === true;
  const hasLimit = Number(privacy.monthlyRequestLimit || 0) > 0;
  if (limitEnabledInput) limitEnabledInput.checked = hasLimit;
  if (limitInput) {
    limitInput.value = hasLimit ? privacy.monthlyRequestLimit : 30;
    limitInput.disabled = !hasLimit;
  }
  if (usageEl)
    usageEl.textContent = hasLimit
      ? `이번 달 유료 분석 ${privacy.monthlyUsed || 0} / ${privacy.monthlyRequestLimit}회`
      : `이번 달 유료 분석 ${privacy.monthlyUsed || 0}회 · 제한 없음`;
  const routingEl = document.getElementById('aiRoutingSummary');
  if (routingEl) {
    routingEl.innerHTML =
      configured.length === 0
        ? '<b>API 등록 필요</b><span>Claude, GPT, Gemini 중 하나 이상의 키를 등록해주세요.</span>'
        : configured.length === 1
          ? '<b>단일 API 모드</b><span>등록된 API가 1개이므로 모든 분석에 그 API만 사용합니다.</span>'
          : '<b>자동 맞춤 선택</b><span>MSDS·작업환경측정은 Gemini → GPT → Claude, 건강진단은 GPT → Claude → 보호조건을 확인한 Gemini 순으로 한 곳만 호출합니다.</span>';
  }

  const providerRoles = {
    claude: '복잡한 문서의 예비 순위',
    openai: '건강진단 구조화 우선',
    gemini: 'MSDS·측정 PDF/OCR 우선',
  };

  ['claude', 'openai', 'gemini'].forEach((provider) => {
    const status = aiSettingsState.providers?.[provider] || {
      configured: false,
    };
    const el = document.getElementById(`aiStatus-${provider}`);
    if (!el) return;
    el.className =
      'ai-provider-status' +
      (status.status === 'error' ? ' error' : status.configured ? ' ok' : '');
    if (!status.configured) el.textContent = '미설정 — API 키를 입력해주세요.';
    else if (status.status === 'error')
      el.textContent = status.lastError || `오류 — ${status.keyHint}`;
    else
      el.textContent = `연결됨 · ${status.keyHint}${configured.length > 1 ? ` · ${providerRoles[provider]}` : ' · 단독 사용'}`;
  });

  const warning = document.getElementById('aiSettingsWarning');
  if (!warning) return;
  if (!configured.length) {
    warning.style.display = '';
    warning.textContent =
      '⚠️ 등록된 API가 없어 AI 분석을 사용할 수 없습니다. 아래 제공자 중 하나의 키를 등록해주세요.';
  } else if (!usable.length) {
    warning.style.display = '';
    warning.textContent =
      '⚠️ 등록된 모든 API에 오류가 있습니다. 키·결제 잔액·사용 한도를 확인해주세요.';
  } else if (usable.length < configured.length) {
    warning.style.display = '';
    warning.textContent =
      'ℹ️ 오류가 있는 API는 자동 선택에서 제외됩니다. 연결을 확인하면 다시 자동 경로에 포함됩니다.';
  } else {
    warning.style.display = 'none';
  }
}

async function refreshSystemAdminRole() {
  if (!user || getDevPreviewPage()) return isSystemAdmin;
  const { data, error } = await supabase
    .from('system_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  isSystemAdmin = !error && Boolean(data);
  return isSystemAdmin;
}

function setSystemAdminVisibility() {
  const display = isSystemAdmin ? '' : 'none';
  ['nav-admin', 'openAdminConsoleBtn', 'moreAdminItem'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.style.display = display;
  });
}

window.saveAiPrivacySettings = async function () {
  const monthlyRequestLimit = document.getElementById('aiEnableMonthlyLimit')
    ?.checked
    ? Math.max(
        1,
        Math.min(
          Number(document.getElementById('aiMonthlyLimit')?.value || 30),
          200,
        ),
      )
    : 0;
  try {
    const result = await invokeEdgeJson('ai-settings', {
      action: 'privacy',
      allowSensitiveDocuments:
        document.getElementById('aiAllowSensitiveDocuments')?.checked === true,
      geminiPaidDataProtectionConfirmed:
        document.getElementById('aiGeminiPaidProtection')?.checked === true,
      monthlyRequestLimit,
    });
    toast(result.message || 'AI 보호 설정을 저장했습니다', 'success');
    await loadAiSettings();
  } catch (error) {
    toast(error.message, 'error');
  }
};

window.toggleAiMonthlyLimit = function () {
  const input = document.getElementById('aiMonthlyLimit');
  if (input)
    input.disabled =
      document.getElementById('aiEnableMonthlyLimit')?.checked !== true;
};

window.saveAiKey = async function (provider) {
  const input = document.getElementById(`aiKey-${provider}`);
  const apiKey = input?.value.trim();
  if (!apiKey) {
    toast('API 키를 붙여넣어 주세요', 'error');
    input?.focus();
    return;
  }
  const button = input?.nextElementSibling;
  if (button) {
    button.disabled = true;
    button.textContent = '확인 중...';
  }
  try {
    const result = await invokeEdgeJson('ai-settings', {
      action: 'save',
      provider,
      apiKey,
    });
    input.value = '';
    toast(result.message || 'API 키가 저장됐습니다', 'success');
    await loadAiSettings();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '저장';
    }
  }
};

window.testAiKey = async function (provider) {
  try {
    const result = await invokeEdgeJson('ai-settings', {
      action: 'test',
      provider,
    });
    toast(result.message || 'API 연결이 정상입니다', 'success');
    await loadAiSettings();
  } catch (error) {
    toast(error.message, 'error');
    await loadAiSettings();
  }
};

window.selectAiProvider = async function (provider) {
  if (!aiSettingsState?.providers?.[provider]?.configured) {
    toast(`${AI_PROVIDER_LABEL[provider]} API 키를 먼저 저장해주세요`, 'error');
    renderAiSettings();
    document.getElementById(`aiKey-${provider}`)?.focus();
    return;
  }
  try {
    await invokeEdgeJson('ai-settings', { action: 'select', provider });
    aiSettingsState.preferredProvider = provider;
    renderAiSettings();
    toast(
      `${AI_PROVIDER_LABEL[provider]}를 기타 문서의 기본 제공자로 저장했습니다. 자동 맞춤 선택은 유지됩니다.`,
      'success',
    );
  } catch (error) {
    toast(error.message, 'error');
    renderAiSettings();
  }
};

window.deleteAiKey = async function (provider) {
  if (!aiSettingsState?.providers?.[provider]?.configured) {
    toast('저장된 API 키가 없습니다');
    return;
  }
  if (!confirm(`${AI_PROVIDER_LABEL[provider]} API 키를 삭제하시겠습니까?`))
    return;
  try {
    await invokeEdgeJson('ai-settings', { action: 'delete', provider });
    toast('API 키를 삭제했습니다', 'success');
    await loadAiSettings();
  } catch (error) {
    toast(error.message, 'error');
  }
};

// ═══════════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════════
// (PAGES, MOBILE_TABS → src/data/constants.js 로 이동)

window.showPage = function (id) {
  const linksRequested = id === 'upload-link';
  if (id === 'calendar') id = 'home';
  if (linksRequested) id = 'contractors';
  if (!PAGES.includes(id)) id = 'home';
  if (id === 'admin' && !isSystemAdmin) {
    toast('시스템 관리자 권한이 필요합니다.', 'error');
    return;
  }
  PAGES.forEach((p) => {
    document.getElementById('page-' + p)?.classList.toggle('active', p === id);
    document.getElementById('nav-' + p)?.classList.toggle('active', p === id);
  });
  MOBILE_TABS.forEach((t) => {
    document.getElementById('mtab-' + t)?.classList.toggle('active', t === id);
  });
  if (id === 'home') {
    renderGsHome();
  }
  if (id === 'msds') { renderContractorSidebar(); renderMsdsTable(); }
  if (id === 'requests') renderMsdsRequests();
  if (id === 'contractors')
    switchContractorTab(linksRequested ? 'links' : contractorTab);
  if (id === 'warning') {
    renderWarnPickList();
    updateWarningPreview();
  }
  if (id === 'upload-link') {
    renderTokenList();
    renderPublicLinkUI();
  }
  if (id === 'health') switchHealthSub(activeHealthSub);
  if (id === 'photos') {
    renderPhotoFolderTree();
    renderPhotoMain();
  }
  if (id === 'measure') {
    renderMeasureRoundsChecklist();
    renderMeasureList();
  }
  if (id === 'manpower') {
    initManpowerPage();
  }
  if (id === 'weather') {
    loadWeatherPage();
  }
  if (id === 'bp') {
    initBpPage();
  }
  if (id === 'library') {
    initLibraryPage();
  }
  if (id === 'contractors') {
    renderContractorTags();
    renderBusinessLicenseStatus();
  }
  if (id === 'announcements') {
    window.loadAnnouncements();
  }
  if (id === 'feedback') {
    loadFeedbackBoard();
  }
  if (id === 'admin') {
    loadAdminConsole();
  }
  document.getElementById('mainContent')?.scrollTo(0, 0);
  if (id === 'settings') {
    if (!getDevPreviewPage()) {
      loadMembers();
      loadAiSettings();
    }
    // 재판정 버튼 건수 업데이트
    const btn = document.getElementById('reanalyzeLegalBtn');
    if (btn)
      btn.textContent = `⚖️ 법정물질 일괄 재판정 (${msdsRecords.length}건)`;
  }
};

// ═══════════════════════════════════════════════
// 시스템 관리자 콘솔
// ═══════════════════════════════════════════════
const ADMIN_STATUS_LABEL = {
  active: '운영 중',
  suspended: '일시중지',
  archived: '보관',
};
const ADMIN_ACTION_LABEL = {
  'workspace.update': '현장 정보 변경',
  'membership.set': '현장 권한 변경',
  'membership.remove': '현장 배정 해제',
  'system_admin.grant': '시스템 관리자 지정',
  'system_admin.revoke': '시스템 관리자 해제',
  'user.suspend': '계정 정지',
  'user.restore': '계정 복구',
};

window.loadAdminConsole = async function (force = false) {
  if (!isSystemAdmin || adminConsoleLoading || (adminConsoleState && !force)) {
    if (adminConsoleState) renderAdminConsole();
    return;
  }
  adminConsoleLoading = true;
  document.getElementById('adminLoading')?.classList.add('show');
  const button = document.getElementById('adminRefreshBtn');
  if (button) button.disabled = true;
  try {
    adminConsoleState = await invokeEdgeJson('system-admin', {
      action: 'dashboard',
    });
    renderAdminConsole();
    if (force) toast('관리 정보를 새로 불러왔습니다.', 'success');
  } catch (error) {
    document.getElementById('adminOverview').innerHTML =
      `<div class="admin-error-state"><span>⚠️</span><b>관리 정보를 불러오지 못했습니다.</b><p>${escapeHtml(error.message)}</p><button class="btn btn-primary" onclick="loadAdminConsole(true)">다시 시도</button></div>`;
    toast(error.message, 'error');
  } finally {
    adminConsoleLoading = false;
    document.getElementById('adminLoading')?.classList.remove('show');
    if (button) button.disabled = false;
  }
};

window.switchAdminTab = function (tab) {
  adminConsoleTab = tab;
  document
    .querySelectorAll('.admin-tab')
    .forEach((button) =>
      button.classList.toggle('active', button.dataset.adminTab === tab),
    );
  document
    .querySelectorAll('.admin-panel')
    .forEach((panel) =>
      panel.classList.toggle('active', panel.id === `admin-panel-${tab}`),
    );
};

function adminDate(value, withTime = false) {
  if (!value) return '기록 없음';
  return new Date(value).toLocaleString(
    'ko-KR',
    withTime
      ? {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }
      : { year: 'numeric', month: '2-digit', day: '2-digit' },
  );
}

function renderAdminConsole() {
  if (!adminConsoleState) return;
  const m = adminConsoleState.metrics;
  document.getElementById('adminMetrics').innerHTML = [
    ['👥', '전체 계정', m.users, '가입 계정'],
    ['🏗️', '전체 현장', m.workspaces, `${m.activeWorkspaces}곳 운영 중`],
    ['💬', '미처리 신고', m.openFeedback, '확인 필요'],
    ['🤖', 'AI 설정 이상', m.aiIssues, '사용자 확인 필요'],
    ['🛡️', '시스템 관리자', m.systemAdmins, '최고 권한'],
  ]
    .map(
      ([icon, label, value, note]) =>
        `<div class="admin-metric-card"><span>${icon}</span><div><small>${label}</small><strong>${value}</strong><em>${note}</em></div></div>`,
    )
    .join('');
  renderAdminOverview();
  renderAdminWorkspaces();
  renderAdminUsers();
  renderAdminIssues();
  renderAdminAudit();
  switchAdminTab(adminConsoleTab);
}

function renderAdminOverview() {
  const state = adminConsoleState;
  const healthItems = [
    ['데이터베이스', state.health.database],
    ['로그인·인증', state.health.auth],
    ['파일 저장소', state.health.storage],
    ['관리자 서버 함수', state.health.edgeFunction],
  ];
  const recentIssues = [
    ...state.feedback
      .filter((item) =>
        ['received', 'reviewing', 'planned'].includes(item.status),
      )
      .slice(0, 4)
      .map((item) => ({
        icon: item.category === 'bug' ? '🐞' : '💬',
        title: item.title,
        meta: `${item.author_name} · ${adminDate(item.created_at)}`,
        bad: item.urgency === 'urgent',
      })),
    ...state.aiIssues
      .slice(0, 3)
      .map((item) => ({
        icon: '🤖',
        title: `${item.provider.toUpperCase()} API 설정 이상`,
        meta: item.last_error || 'API 키 상태를 확인해주세요.',
        bad: true,
      })),
  ];
  document.getElementById('adminOverview').innerHTML = `
    <div class="admin-overview-grid">
      <div class="admin-section-card"><div class="admin-section-heading"><div><b>시스템 상태</b><small>마지막 점검 ${adminDate(state.health.checkedAt, true)}</small></div><span class="admin-health-summary">${healthItems.every(([, ok]) => ok) ? '● 정상' : '● 점검 필요'}</span></div>
        <div class="admin-health-grid">${healthItems.map(([label, ok]) => `<div class="admin-health-item ${ok ? 'ok' : 'bad'}"><span>${ok ? '✓' : '!'}</span><div><b>${label}</b><small>${ok ? '정상 연결' : '연결 점검 필요'}</small></div></div>`).join('')}</div></div>
      <div class="admin-section-card"><div class="admin-section-heading"><div><b>최근 확인 필요 항목</b><small>신고와 API 오류를 모아 보여줍니다.</small></div><button class="btn btn-outline btn-sm" onclick="switchAdminTab('issues')">전체 보기</button></div>
        <div class="admin-alert-list">${recentIssues.length ? recentIssues.map((item) => `<div class="admin-alert-item ${item.bad ? 'bad' : ''}"><span>${item.icon}</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.meta)}</small></div></div>`).join('') : '<div class="admin-empty-compact">현재 확인할 이상이 없습니다.</div>'}</div></div>
    </div>`;
}

window.renderAdminWorkspaces = function () {
  if (!adminConsoleState) return;
  const query = (document.getElementById('adminWorkspaceSearch')?.value || '')
    .trim()
    .toLowerCase();
  const rows = adminConsoleState.workspaces.filter((item) =>
    [item.name, item.code, item.address, item.ownerEmail].some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(query),
    ),
  );
  document.getElementById('adminWorkspaceList').innerHTML = rows.length
    ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>현장</th><th>소유자</th><th>사용 현황</th><th>운영 상태</th></tr></thead><tbody>${rows
        .map(
          (item) =>
            `<tr><td><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.code)}${item.address ? ` · ${escapeHtml(item.address)}` : ''}</small></td><td>${escapeHtml(item.ownerName)}<small>${escapeHtml(item.ownerEmail)}</small></td><td><b>${item.memberCount}명</b><small>MSDS ${item.msdsCount}건</small></td><td><select class="admin-status-select ${item.status}" aria-label="${escapeHtml(item.name)} 운영 상태" onchange="updateAdminWorkspaceStatus('${item.id}',this.value)">${Object.entries(
              ADMIN_STATUS_LABEL,
            )
              .map(
                ([value, label]) =>
                  `<option value="${value}" ${item.status === value ? 'selected' : ''}>${label}</option>`,
              )
              .join('')}</select></td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<div class="admin-empty">검색 조건에 맞는 현장이 없습니다.</div>';
};

window.renderAdminUsers = function () {
  if (!adminConsoleState) return;
  const query = (document.getElementById('adminUserSearch')?.value || '')
    .trim()
    .toLowerCase();
  const workspaceMap = new Map(
    adminConsoleState.workspaces.map((item) => [item.id, item]),
  );
  const rows = adminConsoleState.users.filter((item) =>
    [item.name, item.email].some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(query),
    ),
  );
  document.getElementById('adminUserList').innerHTML = rows.length
    ? `<div class="admin-user-list">${rows
        .map((item) => {
          const suspended = Boolean(
            item.bannedUntil && new Date(item.bannedUntil) > new Date(),
          );
          return `<article class="admin-user-card ${suspended ? 'suspended' : ''}"><div class="admin-user-main"><div class="admin-user-avatar">${escapeHtml(item.name.charAt(0).toUpperCase())}</div><div><div class="admin-user-name">${escapeHtml(item.name)} ${item.isSystemAdmin ? '<span class="admin-role-badge system">시스템 관리자</span>' : ''} ${suspended ? '<span class="admin-role-badge stopped">정지</span>' : ''}</div><small>${escapeHtml(item.email)} · 최근 로그인 ${adminDate(item.lastSignInAt)}</small></div></div>
      <div class="admin-memberships">${item.memberships.length ? item.memberships.map((member) => `<span class="admin-membership-chip"><b>${escapeHtml(workspaceMap.get(member.workspaceId)?.name || '삭제된 현장')}</b><select aria-label="현장 권한" onchange="setAdminMembershipRole('${item.id}','${member.workspaceId}',this.value)"><option value="member" ${member.role === 'member' ? 'selected' : ''}>멤버</option><option value="admin" ${member.role === 'admin' ? 'selected' : ''}>관리자</option></select><button onclick="removeAdminMembership('${item.id}','${member.workspaceId}')" aria-label="현장 배정 해제">×</button></span>`).join('') : '<span class="admin-no-site">배정된 현장 없음</span>'}</div>
      <div class="admin-user-actions"><button class="btn btn-outline btn-sm" onclick="openAdminMembership('${item.id}')">+ 현장 배정</button><button class="btn btn-outline btn-sm" onclick="toggleSystemAdmin('${item.id}',${!item.isSystemAdmin})">${item.isSystemAdmin ? '관리자 해제' : '시스템 관리자 지정'}</button><button class="btn ${suspended ? 'btn-secondary' : 'btn-danger'} btn-sm" onclick="toggleAdminUserAccess('${item.id}',${!suspended})">${suspended ? '계정 복구' : '계정 정지'}</button></div></article>`;
        })
        .join('')}</div>`
    : '<div class="admin-empty">검색 조건에 맞는 계정이 없습니다.</div>';
};

function renderAdminIssues() {
  const feedback = adminConsoleState.feedback.filter((item) =>
    ['received', 'reviewing', 'planned'].includes(item.status),
  );
  const ai = adminConsoleState.aiIssues;
  document.getElementById('adminIssueList').innerHTML =
    `<div class="admin-overview-grid"><div class="admin-section-card"><div class="admin-section-heading"><div><b>미처리 건의 · 오류 신고</b><small>${feedback.length}건을 확인해야 합니다.</small></div></div><div class="admin-alert-list">${feedback.length ? feedback.map((item) => `<div class="admin-alert-item ${item.urgency === 'urgent' ? 'bad' : ''}"><span>${item.category === 'bug' ? '🐞' : '💬'}</span><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.feature_area || '기타')} · ${escapeHtml(item.author_name)} · ${adminDate(item.created_at)}</small></div></div>`).join('') : '<div class="admin-empty-compact">미처리 신고가 없습니다.</div>'}</div></div>
  <div class="admin-section-card"><div class="admin-section-heading"><div><b>사용자 AI 설정 이상</b><small>API 키 값은 표시하지 않습니다.</small></div></div><div class="admin-alert-list">${ai.length ? ai.map((item) => `<div class="admin-alert-item bad"><span>🤖</span><div><b>${escapeHtml(item.provider.toUpperCase())} · ${escapeHtml(item.key_hint || '키 정보 없음')}</b><small>${escapeHtml(item.last_error || 'API 상태 확인 필요')} · ${adminDate(item.last_validated_at, true)}</small></div></div>`).join('') : '<div class="admin-empty-compact">AI 설정 이상이 없습니다.</div>'}</div></div></div>`;
}

function renderAdminAudit() {
  const userMap = new Map(
    adminConsoleState.users.map((item) => [item.id, item]),
  );
  document.getElementById('adminAuditList').innerHTML = adminConsoleState
    .auditLogs.length
    ? `<div class="admin-audit-list">${adminConsoleState.auditLogs.map((item) => `<div class="admin-audit-row"><span class="admin-audit-icon">↺</span><div><b>${escapeHtml(ADMIN_ACTION_LABEL[item.action] || item.action)}</b><small>${escapeHtml(userMap.get(item.actor_id)?.name || '관리자')} · ${adminDate(item.created_at, true)}</small></div><code>${escapeHtml(item.target_type)}</code></div>`).join('')}</div>`
    : '<div class="admin-empty">아직 관리자 변경 기록이 없습니다.</div>';
}

async function runAdminAction(body, successMessage) {
  try {
    await invokeEdgeJson('system-admin', body);
    toast(successMessage, 'success');
    adminConsoleState = null;
    await loadAdminConsole(true);
  } catch (error) {
    toast(error.message, 'error');
  }
}

window.updateAdminWorkspaceStatus = async function (workspaceId, status) {
  const workspace = adminConsoleState.workspaces.find(
    (item) => item.id === workspaceId,
  );
  if (
    !confirm(
      `${workspace?.name || '현장'} 상태를 '${ADMIN_STATUS_LABEL[status]}'(으)로 변경하시겠습니까?`,
    )
  ) {
    renderAdminWorkspaces();
    return;
  }
  await runAdminAction(
    { action: 'update-workspace', workspaceId, status },
    '현장 운영 상태를 변경했습니다.',
  );
};

window.openAdminMembership = function (userId) {
  const target = adminConsoleState.users.find((item) => item.id === userId);
  document.getElementById('adminMembershipUserId').value = userId;
  document.getElementById('adminMembershipUserLabel').value =
    `${target.name} (${target.email})`;
  document.getElementById('adminMembershipWorkspace').innerHTML =
    adminConsoleState.workspaces
      .map(
        (item) =>
          `<option value="${item.id}">${escapeHtml(item.name)} · ${escapeHtml(item.code)}</option>`,
      )
      .join('');
  document.getElementById('adminMembershipRole').value = 'member';
  openModal('adminMembershipModal');
};

window.saveAdminMembership = async function () {
  const userId = document.getElementById('adminMembershipUserId').value;
  const workspaceId = document.getElementById('adminMembershipWorkspace').value;
  const role = document.getElementById('adminMembershipRole').value;
  closeModal('adminMembershipModal');
  await runAdminAction(
    { action: 'set-membership', userId, workspaceId, role },
    '현장 권한을 저장했습니다.',
  );
};

window.setAdminMembershipRole = async function (userId, workspaceId, role) {
  if (
    !confirm(
      `현장 권한을 ${role === 'admin' ? '관리자' : '멤버'}로 변경하시겠습니까?`,
    )
  ) {
    renderAdminUsers();
    return;
  }
  await runAdminAction(
    { action: 'set-membership', userId, workspaceId, role },
    '현장 권한을 변경했습니다.',
  );
};

window.removeAdminMembership = async function (userId, workspaceId) {
  if (!confirm('이 사용자의 현장 접근 권한을 해제하시겠습니까?')) return;
  await runAdminAction(
    { action: 'remove-membership', userId, workspaceId },
    '현장 배정을 해제했습니다.',
  );
};

window.toggleSystemAdmin = async function (userId, enabled) {
  if (
    !confirm(
      enabled
        ? '이 계정에 전체 시스템 관리자 권한을 부여하시겠습니까?'
        : '이 계정의 시스템 관리자 권한을 해제하시겠습니까?',
    )
  )
    return;
  await runAdminAction(
    { action: 'set-system-admin', userId, enabled },
    enabled
      ? '시스템 관리자로 지정했습니다.'
      : '시스템 관리자 권한을 해제했습니다.',
  );
};

window.toggleAdminUserAccess = async function (userId, suspended) {
  if (
    !confirm(
      suspended
        ? '이 계정을 정지하시겠습니까? 정지 중에는 로그인할 수 없습니다.'
        : '이 계정을 다시 사용할 수 있게 복구하시겠습니까?',
    )
  )
    return;
  await runAdminAction(
    { action: 'set-user-access', userId, suspended },
    suspended ? '계정을 정지했습니다.' : '계정을 복구했습니다.',
  );
};

window.searchLawFromHome = function () {
  const query = document.getElementById('homeLawQuery')?.value.trim();
  if (!query) {
    toast('검색어를 입력하세요', 'error');
    return;
  }
  showPage('library');
  setTimeout(() => {
    const target = document.getElementById('clauseQuery');
    if (target) target.value = query;
    window.runClauseSearch?.();
  }, 50);
};

// ═══════════════════════════════════════════════
// 공지사항
// ═══════════════════════════════════════════════
function canManageAnnouncements() {
  if (!user || !currentWS) return false;
  const currentRole = currentWS.workspace_members?.[0]?.role;
  return (
    isSystemAdmin ||
    currentWS.owner_id === user.id ||
    currentRole === 'admin' ||
    members.some(
      (member) => member.user_id === user.id && member.role === 'admin',
    )
  );
}

function announcementStatus(item, now = Date.now()) {
  const startsAt = new Date(item.starts_at).getTime();
  const endsAt = item.ends_at ? new Date(item.ends_at).getTime() : null;
  if (Number.isFinite(startsAt) && startsAt > now) return 'scheduled';
  if (Number.isFinite(endsAt) && endsAt < now) return 'expired';
  return 'active';
}

function announcementPeriod(item) {
  const format = (value) =>
    new Date(value).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  return `${format(item.starts_at)}부터 · ${item.ends_at ? `${format(item.ends_at)}까지` : '종료일 없음'}`;
}

function toLocalDateTimeInput(value) {
  const date = value ? new Date(value) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

window.loadAnnouncements = async function (force = false) {
  if (getDevPreviewPage()) {
    window.renderAnnouncements();
    return;
  }
  if (!user || !currentWS) return;
  const workspaceId = currentWS.id;
  const userId = user.id;
  const cacheIsFresh =
    announcementsLoaded &&
    announcementsWorkspaceId === workspaceId &&
    Date.now() - announcementsLoadedAt < ANNOUNCEMENT_CACHE_TTL_MS;
  if (cacheIsFresh && !force) {
    window.renderAnnouncements();
    return;
  }

  const list = document.getElementById('announcementList');
  if (list)
    list.innerHTML =
      '<div class="announcement-empty">공지사항을 불러오는 중입니다.</div>';

  const [{ data: adminRole, error: adminError }, { data, error }] =
    await Promise.all([
      supabase
        .from('system_admins')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('announcements')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('is_important', { ascending: false })
        .order('starts_at', { ascending: false }),
    ]);

  if (currentWS?.id !== workspaceId || user?.id !== userId) return;

  if (adminError)
    console.warn('시스템 관리자 권한 확인 실패:', adminError.message);
  isSystemAdmin = Boolean(adminRole) || isSystemAdmin;
  if (error) {
    announcementsLoaded = false;
    if (list)
      list.innerHTML = `<div class="announcement-empty error">공지사항을 불러오지 못했습니다.<br><small>${escapeHtml(error.message || '')}</small></div>`;
    return;
  }

  announcements = data || [];
  announcementsLoaded = true;
  announcementsLoadedAt = Date.now();
  announcementsWorkspaceId = workspaceId;
  window.renderAnnouncements();
};

window.renderAnnouncements = function () {
  const list = document.getElementById('announcementList');
  if (!list) return;

  const canManage = canManageAnnouncements();
  const adminActions = document.getElementById('announcementAdminActions');
  const showAllWrap = document.getElementById('announcementShowAllWrap');
  const scopeHint = document.getElementById('announcementScopeHint');
  if (adminActions) adminActions.style.display = canManage ? 'flex' : 'none';
  if (showAllWrap)
    showAllWrap.style.display = canManage ? 'inline-flex' : 'none';
  if (scopeHint)
    scopeHint.textContent = canManage
      ? '관리자는 예약·종료된 공지도 함께 확인하고 수정할 수 있습니다.'
      : '현재 게시 중인 현장 공지만 표시됩니다.';

  const showAll =
    canManage && document.getElementById('announcementShowAllChk')?.checked;
  const visible = announcements.filter(
    (item) => showAll || announcementStatus(item) === 'active',
  );
  if (!visible.length) {
    list.innerHTML = `<div class="announcement-empty"><div>📢</div><b>${announcements.length ? '현재 게시 중인 공지가 없습니다.' : '등록된 공지사항이 없습니다.'}</b><span>${canManage ? '새 공지를 작성해 현장 구성원에게 안내할 수 있습니다.' : '새 공지가 등록되면 이곳에 표시됩니다.'}</span></div>`;
    return;
  }

  const statusLabels = {
    active: '게시 중',
    scheduled: '게시 예정',
    expired: '게시 종료',
  };
  list.innerHTML = visible
    .map((item) => {
      const status = announcementStatus(item);
      return `<article class="announcement-card ${item.is_important ? 'important' : ''} ${status}">
      <div class="announcement-card-head">
        <div class="announcement-card-tags">
          ${item.is_important ? '<span class="announcement-important">중요</span>' : ''}
          <span class="announcement-status ${status}">${statusLabels[status]}</span>
        </div>
        ${canManage ? `<button type="button" class="btn btn-outline btn-sm" onclick="openAnnouncementEditor('${item.id}')">수정</button>` : ''}
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <div class="announcement-content">${escapeHtml(item.content).replace(/\n/g, '<br>')}</div>
      <div class="announcement-period">${escapeHtml(announcementPeriod(item))}</div>
    </article>`;
    })
    .join('');
};

window.toggleAnnouncementEnd = function () {
  const noEnd = document.getElementById('announcementNoEnd')?.checked;
  const input = document.getElementById('announcementEndsAt');
  if (!input) return;
  input.disabled = Boolean(noEnd);
  if (noEnd) input.value = '';
};

window.openAnnouncementEditor = function (id = null) {
  if (!canManageAnnouncements()) {
    toast('공지사항을 관리할 권한이 없습니다.', 'error');
    return;
  }

  const item = id ? announcements.find((row) => row.id === id) : null;
  announcementCurrentId = item?.id || null;
  document.getElementById('announcementModalTitle').textContent = item
    ? '공지사항 수정'
    : '새 공지 작성';
  document.getElementById('announcementId').value = item?.id || '';
  document.getElementById('announcementTitle').value = item?.title || '';
  document.getElementById('announcementContent').value = item?.content || '';
  document.getElementById('announcementImportant').checked = Boolean(
    item?.is_important,
  );
  document.getElementById('announcementStartsAt').value = toLocalDateTimeInput(
    item?.starts_at,
  );
  document.getElementById('announcementNoEnd').checked = !item?.ends_at;
  document.getElementById('announcementEndsAt').value = item?.ends_at
    ? toLocalDateTimeInput(item.ends_at)
    : '';
  document.getElementById('announcementDeleteBtn').style.display = item
    ? ''
    : 'none';
  window.toggleAnnouncementEnd();
  openModal('announcementModal');
  setTimeout(() => document.getElementById('announcementTitle')?.focus(), 80);
};

window.saveAnnouncement = async function () {
  if (!canManageAnnouncements()) return;
  const title = document.getElementById('announcementTitle').value.trim();
  const content = document.getElementById('announcementContent').value.trim();
  const startsValue = document.getElementById('announcementStartsAt').value;
  const noEnd = document.getElementById('announcementNoEnd').checked;
  const endsValue = document.getElementById('announcementEndsAt').value;
  if (!title || !content || !startsValue) {
    toast('제목, 내용, 게시 시작일을 입력하세요.', 'error');
    return;
  }
  if (title.length < 2 || title.length > 120) {
    toast('공지 제목은 2자 이상 120자 이하로 입력하세요.', 'error');
    return;
  }
  if (content.length > 5000) {
    toast('공지 내용은 5,000자 이하로 입력하세요.', 'error');
    return;
  }

  const startsAt = new Date(startsValue);
  const endsAt = noEnd || !endsValue ? null : new Date(endsValue);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    (endsAt && !Number.isFinite(endsAt.getTime()))
  ) {
    toast('게시 기간을 다시 확인해주세요.', 'error');
    return;
  }
  if (endsAt && endsAt <= startsAt) {
    toast('종료일은 시작일보다 뒤여야 합니다.', 'error');
    return;
  }

  const payload = {
    workspace_id: currentWS.id,
    title,
    content,
    is_important: document.getElementById('announcementImportant').checked,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt?.toISOString() || null,
  };
  const button = document.getElementById('announcementSaveBtn');
  button.disabled = true;
  button.textContent = '저장 중...';
  try {
    if (getDevPreviewPage()) {
      if (announcementCurrentId) {
        const index = announcements.findIndex(
          (row) => row.id === announcementCurrentId,
        );
        announcements[index] = {
          ...announcements[index],
          ...payload,
          updated_at: new Date().toISOString(),
        };
      } else {
        announcements.unshift({
          ...payload,
          id: `preview-announcement-${Date.now()}`,
          created_by: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } else if (announcementCurrentId) {
      const { error } = await supabase
        .from('announcements')
        .update(payload)
        .eq('id', announcementCurrentId)
        .eq('workspace_id', currentWS.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('announcements')
        .insert({ ...payload, created_by: user.id });
      if (error) throw error;
    }
    closeModal('announcementModal');
    announcementCurrentId = null;
    if (!getDevPreviewPage()) await window.loadAnnouncements(true);
    else window.renderAnnouncements();
    toast('공지사항이 저장됐습니다.', 'success');
  } catch (error) {
    toast('공지 저장 실패: ' + error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '저장';
  }
};

window.deleteAnnouncement = async function () {
  if (!canManageAnnouncements() || !announcementCurrentId) return;
  if (!confirm('이 공지사항을 삭제하시겠습니까?')) return;
  try {
    if (getDevPreviewPage()) {
      announcements = announcements.filter(
        (row) => row.id !== announcementCurrentId,
      );
    } else {
      const { error } = await supabase
        .from('announcements')
        .delete()
        .eq('id', announcementCurrentId)
        .eq('workspace_id', currentWS.id);
      if (error) throw error;
    }
    closeModal('announcementModal');
    announcementCurrentId = null;
    if (!getDevPreviewPage()) await window.loadAnnouncements(true);
    else window.renderAnnouncements();
    toast('공지사항이 삭제됐습니다.');
  } catch (error) {
    toast('공지 삭제 실패: ' + error.message, 'error');
  }
};

// ═══════════════════════════════════════════════
// 건의 · 오류 신고
// ═══════════════════════════════════════════════
const FEEDBACK_CATEGORY = {
  bug: '오류 신고',
  improvement: '기능 개선',
  question: '사용 문의',
  other: '기타',
};
const FEEDBACK_STATUS = {
  received: '접수',
  reviewing: '검토 중',
  planned: '반영 예정',
  resolved: '처리 완료',
  closed: '종료',
};

function feedbackDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

window.loadFeedbackBoard = async function (force = false) {
  if (getDevPreviewPage()) {
    renderFeedbackBoard();
    return;
  }
  if (!user || (feedbackLoaded && !force)) {
    renderFeedbackBoard();
    return;
  }

  const list = document.getElementById('feedbackList');
  if (list)
    list.innerHTML =
      '<div class="feedback-empty">건의사항을 불러오는 중입니다.</div>';
  const [
    { data: adminRole, error: adminError },
    { data: posts, error: postsError },
  ] = await Promise.all([
    supabase
      .from('system_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('feedback_posts')
      .select('*')
      .order('created_at', { ascending: false }),
  ]);
  if (adminError || postsError) {
    if (list)
      list.innerHTML = `<div class="feedback-empty error">불러오지 못했습니다. 잠시 후 다시 시도해주세요.<br><small>${escapeHtml(postsError?.message || adminError?.message || '')}</small></div>`;
    return;
  }
  isSystemAdmin = Boolean(adminRole);
  feedbackPosts = posts || [];
  feedbackLoaded = true;
  renderFeedbackBoard();
};

window.renderFeedbackBoard = function () {
  const list = document.getElementById('feedbackList');
  if (!list) return;
  const query =
    document.getElementById('feedbackSearch')?.value.trim().toLowerCase() || '';
  const category =
    document.getElementById('feedbackCategoryFilter')?.value || '';
  const status = document.getElementById('feedbackStatusFilter')?.value || '';
  const filtered = feedbackPosts.filter((post) => {
    const haystack =
      `${post.title || ''} ${post.content || ''} ${post.feature_area || ''} ${post.author_name || ''}`.toLowerCase();
    return (
      (!query || haystack.includes(query)) &&
      (!category || post.category === category) &&
      (!status || post.status === status)
    );
  });

  const adminChip = document.getElementById('feedbackAdminChip');
  if (adminChip)
    adminChip.style.display = isSystemAdmin ? 'inline-flex' : 'none';
  const received = feedbackPosts.filter(
    (post) => post.status === 'received',
  ).length;
  const active = feedbackPosts.filter((post) =>
    ['reviewing', 'planned'].includes(post.status),
  ).length;
  const done = feedbackPosts.filter((post) =>
    ['resolved', 'closed'].includes(post.status),
  ).length;
  const stats = document.getElementById('feedbackStats');
  if (stats)
    stats.innerHTML = `
    <div class="feedback-stat"><span>전체</span><b>${feedbackPosts.length}</b></div>
    <div class="feedback-stat"><span>접수</span><b>${received}</b></div>
    <div class="feedback-stat"><span>처리 중</span><b>${active}</b></div>
    <div class="feedback-stat"><span>완료</span><b>${done}</b></div>`;

  const badge = document.getElementById('navBadgeFeedback');
  if (badge) {
    badge.style.display = isSystemAdmin && received ? 'inline' : 'none';
    badge.textContent = String(received);
  }

  if (!filtered.length) {
    list.innerHTML = `<div class="feedback-empty"><div>💬</div><b>${feedbackPosts.length ? '조건에 맞는 글이 없습니다.' : '아직 작성한 건의사항이 없습니다.'}</b><span>불편한 점이나 필요한 기능을 실명으로 알려주세요.</span><button class="btn btn-primary" onclick="openFeedbackCreate()">첫 건의 작성하기</button></div>`;
    return;
  }

  list.innerHTML = filtered
    .map(
      (post) => `
    <button class="feedback-card" onclick="openFeedbackDetail('${post.id}')">
      <div class="feedback-card-top">
        <div class="feedback-card-tags">
          <span class="feedback-type ${post.category}">${FEEDBACK_CATEGORY[post.category] || '기타'}</span>
          <span class="feedback-area">${escapeHtml(post.feature_area)}</span>
          ${post.urgency === 'urgent' ? '<span class="feedback-urgent">긴급</span>' : ''}
        </div>
        <span class="feedback-status ${post.status}">${FEEDBACK_STATUS[post.status] || post.status}</span>
      </div>
      <div class="feedback-card-title">${escapeHtml(post.title)}</div>
      <div class="feedback-card-summary">${escapeHtml(post.content)}</div>
      <div class="feedback-card-meta"><span>${escapeHtml(post.author_name)}</span><span>${feedbackDate(post.created_at)}</span></div>
    </button>`,
    )
    .join('');
};

window.openFeedbackCreate = function () {
  const author =
    user?.user_metadata?.name ||
    profile?.name ||
    user?.email?.split('@')[0] ||
    '로그인 사용자';
  document.getElementById('feedbackAuthorName').textContent = author;
  [
    'feedbackTitle',
    'feedbackContent',
    'feedbackReproduction',
    'feedbackExpected',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('feedbackCategory').value = 'bug';
  document.getElementById('feedbackUrgency').value = 'normal';
  toggleFeedbackBugFields();
  openModal('feedbackCreateModal');
  setTimeout(() => document.getElementById('feedbackTitle')?.focus(), 80);
};

window.toggleFeedbackBugFields = function () {
  const isBug = document.getElementById('feedbackCategory')?.value === 'bug';
  const fields = document.getElementById('feedbackBugFields');
  if (fields) fields.style.display = isBug ? '' : 'none';
};

window.submitFeedback = async function () {
  const category = document.getElementById('feedbackCategory').value;
  const payload = {
    author_id: user?.id,
    author_name: user?.user_metadata?.name || profile?.name || '로그인 사용자',
    category,
    feature_area: document.getElementById('feedbackFeatureArea').value,
    urgency: document.getElementById('feedbackUrgency').value,
    title: document.getElementById('feedbackTitle').value.trim(),
    content: document.getElementById('feedbackContent').value.trim(),
    reproduction_steps:
      category === 'bug'
        ? document.getElementById('feedbackReproduction').value.trim() || null
        : null,
    expected_result:
      category === 'bug'
        ? document.getElementById('feedbackExpected').value.trim() || null
        : null,
  };
  if (payload.title.length < 2) {
    toast('제목을 2자 이상 입력해주세요', 'error');
    return;
  }
  if (payload.content.length < 5) {
    toast('내용을 5자 이상 입력해주세요', 'error');
    return;
  }

  const button = document.getElementById('feedbackSubmitBtn');
  button.disabled = true;
  button.textContent = '접수 중...';
  try {
    if (getDevPreviewPage()) {
      feedbackPosts.unshift({
        ...payload,
        id: `preview-${Date.now()}`,
        status: 'received',
        created_at: new Date().toISOString(),
      });
    } else {
      const { data, error } = await supabase
        .from('feedback_posts')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      feedbackPosts.unshift(data);
    }
    closeModal('feedbackCreateModal');
    renderFeedbackBoard();
    toast('건의사항이 실명으로 접수됐습니다', 'success');
  } catch (error) {
    toast(`접수 실패: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '실명으로 접수하기';
  }
};

function renderFeedbackDetail(post, comments) {
  document.getElementById('feedbackDetailTitle').textContent = post.title;
  document.getElementById('feedbackDetailMeta').textContent =
    `${post.author_name} · ${feedbackDate(post.created_at)}`;
  document.getElementById('feedbackDetailBody').innerHTML = `
    <div class="feedback-detail-tags">
      <span class="feedback-type ${post.category}">${FEEDBACK_CATEGORY[post.category] || '기타'}</span>
      <span class="feedback-area">${escapeHtml(post.feature_area)}</span>
      ${post.urgency === 'urgent' ? '<span class="feedback-urgent">긴급</span>' : ''}
      <span class="feedback-status ${post.status}">${FEEDBACK_STATUS[post.status] || post.status}</span>
    </div>
    <div class="feedback-detail-section"><b>내용</b><div>${escapeHtml(post.content).replace(/\n/g, '<br>')}</div></div>
    ${post.reproduction_steps ? `<div class="feedback-detail-section"><b>재현 방법</b><div>${escapeHtml(post.reproduction_steps).replace(/\n/g, '<br>')}</div></div>` : ''}
    ${post.expected_result ? `<div class="feedback-detail-section"><b>기대 결과</b><div>${escapeHtml(post.expected_result).replace(/\n/g, '<br>')}</div></div>` : ''}
    <div class="feedback-comments">
      <div class="feedback-comments-title">관리자 답변 <span>${comments.length}</span></div>
      ${comments.length ? comments.map((comment) => `<div class="feedback-comment"><div><b>시스템 관리자 · ${escapeHtml(comment.admin_name)}</b><span>${feedbackDate(comment.created_at)}</span></div><p>${escapeHtml(comment.content).replace(/\n/g, '<br>')}</p></div>`).join('') : '<div class="feedback-no-comment">아직 관리자 답변이 없습니다. 확인 후 이곳에 안내됩니다.</div>'}
    </div>`;
  const panel = document.getElementById('feedbackAdminPanel');
  panel.style.display = isSystemAdmin ? 'block' : 'none';
  document.getElementById('feedbackAdminStatus').value = post.status;
}

window.openFeedbackDetail = async function (postId) {
  const post = feedbackPosts.find((item) => item.id === postId);
  if (!post) return;
  feedbackCurrentId = postId;
  const localComments = feedbackComments.filter(
    (item) => item.post_id === postId,
  );
  renderFeedbackDetail(post, localComments);
  openModal('feedbackDetailModal');
  if (getDevPreviewPage()) return;

  const { data, error } = await supabase
    .from('feedback_comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at');
  if (error) {
    toast('관리자 답변을 불러오지 못했습니다', 'error');
    return;
  }
  feedbackComments = feedbackComments
    .filter((item) => item.post_id !== postId)
    .concat(data || []);
  if (feedbackCurrentId === postId) renderFeedbackDetail(post, data || []);
};

window.updateFeedbackStatus = async function () {
  if (!isSystemAdmin || !feedbackCurrentId) return;
  const status = document.getElementById('feedbackAdminStatus').value;
  try {
    if (!getDevPreviewPage()) {
      const { error } = await supabase
        .from('feedback_posts')
        .update({ status })
        .eq('id', feedbackCurrentId);
      if (error) throw error;
    }
    const post = feedbackPosts.find((item) => item.id === feedbackCurrentId);
    if (post) post.status = status;
    renderFeedbackBoard();
    renderFeedbackDetail(
      post,
      feedbackComments.filter((item) => item.post_id === feedbackCurrentId),
    );
    toast('처리 상태를 저장했습니다', 'success');
  } catch (error) {
    toast(`상태 저장 실패: ${error.message}`, 'error');
  }
};

window.addFeedbackComment = async function () {
  if (!isSystemAdmin || !feedbackCurrentId) return;
  const input = document.getElementById('feedbackAdminComment');
  const content = input.value.trim();
  if (!content) {
    toast('관리자 답변을 입력해주세요', 'error');
    return;
  }
  const payload = {
    post_id: feedbackCurrentId,
    admin_id: user.id,
    admin_name: user.user_metadata?.name || '시스템 관리자',
    content,
  };
  try {
    let comment;
    if (getDevPreviewPage())
      comment = {
        ...payload,
        id: `comment-${Date.now()}`,
        created_at: new Date().toISOString(),
      };
    else {
      const { data, error } = await supabase
        .from('feedback_comments')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      comment = data;
    }
    feedbackComments.push(comment);
    input.value = '';
    const post = feedbackPosts.find((item) => item.id === feedbackCurrentId);
    renderFeedbackDetail(
      post,
      feedbackComments.filter((item) => item.post_id === feedbackCurrentId),
    );
    toast('관리자 답변을 등록했습니다', 'success');
  } catch (error) {
    toast(`답변 등록 실패: ${error.message}`, 'error');
  }
};

// ═══════════════════════════════════════════════
// Contractors & Work Types
// ═══════════════════════════════════════════════
async function loadContractors() {
  const { data } = await supabase
    .from('contractors')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .order('created_at');
  contractors = data || [];
  renderContractorTags();
  populateContractorSelects();
  renderSiteDirectoryLink();
}

async function loadWorkTypes() {
  const { data } = await supabase
    .from('work_types')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .order('created_at');
  workTypes = data || [];
}

function populateContractorSelects() {
  [
    'batchContractor',
    'f_contractor',
    'linkContractor',
    'workTypeContractor',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const q = (document.getElementById(id + 'Search')?.value || '')
      .trim()
      .toLowerCase();
    const list = !q
      ? contractors
      : contractors.filter((c) => c.name.toLowerCase().includes(q));
    const cur = el.value;
    el.innerHTML =
      '<option value="">' +
      (q ? `검색결과 ${list.length}건` : '선택하세요') +
      '</option>' +
      list.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    el.value = list.some((c) => c.id === cur) ? cur : '';
  });
}

window.searchContractorSelect = function (id) {
  const isNameBased = id === 'warnFilterContractor'; // 경고표지 필터는 값이 이름 기반
  isNameBased ? populateWarnContractorFilter() : populateContractorSelects();
  // 검색 결과가 정확히 1곳이면 자동 선택 + 연동 로직(공종 목록·목록 필터 등)까지 발동
  const q = (document.getElementById(id + 'Search')?.value || '')
    .trim()
    .toLowerCase();
  updateInlineContractorAdd(id);
  if (!q) return;
  const matches = contractors.filter((c) => c.name.toLowerCase().includes(q));
  const el = document.getElementById(id);
  const val = isNameBased ? matches[0]?.name : matches[0]?.id;
  if (matches.length === 1 && el && el.value !== val) {
    el.value = val;
    el.dispatchEvent(new Event('change'));
  }
};

function normalizeContractorName(name) {
  return (name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch],
  );
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : '';
  } catch {
    return '';
  }
}

window.updateInlineContractorAdd = function (id) {
  const btn = document.getElementById(id + 'AddBtn');
  const input = document.getElementById(id + 'Search');
  if (!btn || !input) return;
  const name = input.value.trim().replace(/\s+/g, ' ');
  const exact = contractors.some(
    (c) => normalizeContractorName(c.name) === normalizeContractorName(name),
  );
  btn.style.display = name && !exact ? 'flex' : 'none';
  btn.textContent = name && !exact ? `+ “${name}” 신규 협력사로 등록` : '';
};

async function insertContractor(name, contact = {}) {
  const cleanName = name.trim().replace(/\s+/g, ' ');
  const existing = contractors.find(
    (c) =>
      normalizeContractorName(c.name) === normalizeContractorName(cleanName),
  );
  if (existing) return { contractor: existing, created: false };
  if (getDevPreviewPage()) {
    const contractor = { id: `preview-con-${Date.now()}`, name: cleanName };
    contractors.push(contractor);
    return { contractor, created: true };
  }
  const { data, error } = await supabase
    .from('contractors')
    .insert({ workspace_id: currentWS.id, name: cleanName, ...contact })
    .select()
    .single();
  if (error) throw error;
  contractors.push(data);
  return { contractor: data, created: true };
}

window.quickAddContractorFromSearch = async function (id) {
  const input = document.getElementById(id + 'Search');
  const select = document.getElementById(id);
  const name = input?.value.trim();
  if (!name || !select) return;
  const btn = document.getElementById(id + 'AddBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '등록 중...';
  }
  try {
    const { contractor, created } = await insertContractor(name);
    populateContractorSelects();
    select.value = contractor.id;
    select.dispatchEvent(new Event('change'));
    updateInlineContractorAdd(id);
    renderContractorTags();
    toast(
      created
        ? `${contractor.name} 등록 완료 — 계속 업로드하세요`
        : `${contractor.name} 협력사를 선택했습니다`,
      'success',
    );
  } catch (error) {
    toast('협력사 등록 실패: ' + error.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

function getWorkTypesForContractor(contractorId) {
  return workTypes.filter((w) => w.contractor_id === contractorId);
}

window.updateBatchWorkTypes = function () {
  const searchInput = document.getElementById('batchWorkTypeSearch'); if (searchInput) searchInput.value = '';
  const workInput = document.getElementById('batchWorkTypeSearch');
  if (workInput) workInput.value = '';
  const conId = document.getElementById('batchContractor').value;
  const wts = getWorkTypesForContractor(conId);
  document.getElementById('batchWorkType').innerHTML =
    '<option value="">공종 선택 (선택사항)</option>' +
    wts.map((w) => `<option value="${w.name}">${w.name}</option>`).join('');
};

window.updateManualWorkTypes = function () {
  const conId = document.getElementById('f_contractor').value;
  const wts = getWorkTypesForContractor(conId);
  document.getElementById('f_workType').innerHTML =
    '<option value="">공종 선택</option>' +
    wts.map((w) => `<option value="${w.name}">${w.name}</option>`).join('');
};

window.renderContractorTags = function () {
  const el = document.getElementById('conMgrList');
  if (!el) return;
  const q = (document.getElementById('conMgrSearch')?.value || '')
    .trim()
    .toLowerCase();
  const submittedIds = new Set(businessLicenses.map((l) => l.contractor_id));
  const hasReceivedMsds = (c) =>
    msdsRecords.some((r) => r.contractor === c.name && msdsReceived(r));
  const missingLicense = contractors.filter((c) => !submittedIds.has(c.id));
  const missingMsds = contractors.filter((c) => !hasReceivedMsds(c));
  const list = contractors.filter((c) => {
    const matchesQuery = !q || c.name.toLowerCase().includes(q);
    const matchesFilter =
      contractorFilter === 'missing-license'
        ? !submittedIds.has(c.id)
        : contractorFilter === 'missing-msds'
          ? !hasReceivedMsds(c)
          : true;
    return matchesQuery && matchesFilter;
  });
  const cnt = document.getElementById('conMgrCount');
  if (cnt) cnt.textContent = `(${list.length}/${contractors.length}개사)`;
  const totalEl = document.getElementById('conStatTotal');
  const licenseEl = document.getElementById('conStatMissingLicense');
  const msdsEl = document.getElementById('conStatMissingMsds');
  if (totalEl) totalEl.textContent = contractors.length;
  if (licenseEl) licenseEl.textContent = missingLicense.length;
  if (msdsEl) msdsEl.textContent = missingMsds.length;
  if (!list.length) {
    el.innerHTML = `<div class="contractor-empty">
      <div>${q ? '검색 조건에 맞는 협력사가 없습니다' : contractorFilter === 'all' ? '등록된 협력사가 없습니다' : '해당 상태의 협력사가 없습니다'}</div>
      ${q && contractorFilter === 'all' ? `<button class="btn btn-primary btn-sm" onclick="prefillNewContractor()">+ “${escapeHtml(document.getElementById('conMgrSearch')?.value.trim())}” 신규 등록</button>` : ''}
    </div>`;
    return;
  }
  el.innerHTML = list
    .map((c) => {
      const wts = getWorkTypesForContractor(c.id);
      const msdsCnt = msdsRecords.filter((r) => r.contractor === c.name).length;
      const hasLic = businessLicenses.some((l) => l.contractor_id === c.id);
      const wtChips =
        wts
          .map(
            (w) =>
              `<span class="tag contractor-work-tag">${escapeHtml(w.name)}<button class="tag-remove" onclick="conMgrDelWt('${w.id}')" aria-label="${escapeHtml(w.name)} 공종 삭제">✕</button></span>`,
          )
          .join('') +
        `<button class="btn btn-outline btn-sm contractor-add-work" onclick="conMgrAddWt('${c.id}')">+ 공종</button>`;
      return `<div class="contractor-row">
      <div class="contractor-main">
        <div class="contractor-name">
          ${escapeHtml(c.name)}
          <button class="btn btn-secondary btn-sm" onclick="renameContractor('${c.id}')">이름 수정</button>
        </div>
        <div class="contractor-contact-line"><span>관리자 ${escapeHtml(c.manager_name || '미등록')}</span><span>${escapeHtml(c.manager_phone || '전화번호 미등록')}</span><button class="btn btn-secondary btn-sm" onclick="editContractorContact('${c.id}')">연락처 수정</button></div><div class="contractor-work-types">${wtChips}</div>
      </div>
      <div class="contractor-statuses">
        <button class="contractor-badge neutral" onclick="openContractorMsds('${c.id}')">🧪 MSDS ${msdsCnt}건</button>
        <button class="contractor-badge ${hasLic ? 'ok' : 'danger'}" onclick="${hasLic ? `scrollToBusinessLicenses()` : `uploadLicenseForContractor('${c.id}')`}">📑 ${hasLic ? '등록증 제출' : '등록증 미제출'}</button>
        <button class="btn btn-outline btn-sm" onclick="openContractorUploadLink('${c.id}')">링크 관리</button>
        <button class="btn btn-danger btn-sm" onclick="removeContractor('${c.id}')">삭제</button>
      </div>
    </div>`;
    })
    .join('');
};

window.setContractorFilter = function (filter) {
  contractorFilter = filter || 'all';
  const select = document.getElementById('conMgrFilter');
  if (select && select.value !== contractorFilter)
    select.value = contractorFilter;
  document
    .querySelectorAll('.contractor-stat-card')
    .forEach((el) => el.classList.remove('active'));
  const activeId =
    contractorFilter === 'missing-license'
      ? 'conStatLicense'
      : contractorFilter === 'missing-msds'
        ? 'conStatMsds'
        : 'conStatAll';
  document.getElementById(activeId)?.classList.add('active');
  renderContractorTags();
};

window.openContractorPage = function (filter = 'all') {
  showPage('contractors');
  switchContractorTab(filter === 'missing-license' ? 'licenses' : 'companies');
  setContractorFilter(filter);
};

window.focusNewContractor = function () {
  toggleNewContractorForm(true);
  document
    .getElementById('newContractorCard')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => document.getElementById('newContractor')?.focus(), 250);
};

window.toggleNewContractorForm = function (force) {
  const panel = document.getElementById('newContractorCard');
  const btn = document.getElementById('contractorAddToggleBtn');
  if (!panel) return;
  const open = typeof force === 'boolean' ? force : panel.hidden;
  panel.hidden = !open;
  if (btn) {
    btn.textContent = open ? '등록 취소' : '+ 협력사 등록';
    btn.classList.toggle('btn-secondary', open);
    btn.classList.toggle('btn-primary', !open);
  }
  if (open)
    setTimeout(() => document.getElementById('newContractor')?.focus(), 50);
};

window.prefillNewContractor = function () {
  const search = document.getElementById('conMgrSearch');
  const input = document.getElementById('newContractor');
  if (input && search) input.value = search.value.trim();
  focusNewContractor();
};

window.openContractorMsds = function (id) {
  const name = contractors.find((c) => c.id === id)?.name;
  if (!name) return;
  showPage('msds');
  window.selectedContractor = name;
  renderMsdsTable();
  renderContractorSidebar?.();
};

window.openContractorUploadLink = function (id) {
  showPage('contractors');
  switchContractorTab('links');
  const select = document.getElementById('linkContractor');
  if (select) select.value = id;
  setTimeout(
    () =>
      document
        .getElementById('linkContractor')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    100,
  );
};

window.scrollToBusinessLicenses = function () {
  switchContractorTab('licenses');
  document
    .getElementById('businessLicenseCard')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.uploadLicenseForContractor = function (id) {
  let target = document.getElementById('manualLicenseContractor');
  if (!target) {
    target = document.createElement('input');
    target.type = 'hidden';
    target.id = 'manualLicenseContractor';
    document.getElementById('businessLicenseList')?.appendChild(target);
  }
  target.value = id;
  document.getElementById('manualLicenseInput')?.click();
};

window.renameContractor = async function (id) {
  const c = contractors.find((x) => x.id === id);
  if (!c) return;
  const name = prompt(
    `'${c.name}'의 새 이름을 입력하세요.\n(MSDS 대장의 협력사명도 함께 변경됩니다)`,
    c.name,
  );
  if (!name || name.trim() === '' || name.trim() === c.name) return;
  const newName = name.trim();
  if (contractors.some((x) => x.name === newName)) {
    toast('이미 같은 이름의 협력사가 있습니다', 'error');
    return;
  }
  const { error } = await supabase
    .from('contractors')
    .update({ name: newName })
    .eq('id', id);
  if (error) {
    toast('변경 실패: ' + error.message, 'error');
    return;
  }
  // MSDS 대장의 협력사명 문자열도 연쇄 변경
  const { error: e2 } = await supabase
    .from('msds_records')
    .update({ contractor: newName })
    .eq('workspace_id', currentWS.id)
    .eq('contractor', c.name);
  if (e2)
    toast('협력사명은 바뀌었지만 MSDS 대장 반영 실패: ' + e2.message, 'error');
  if (window.selectedContractor === c.name) window.selectedContractor = newName;
  c.name = newName;
  await loadMsdsRecords();
  populateContractorSelects();
  renderContractorTags();
  toast(`'${newName}'(으)로 변경됐습니다`, 'success');
};

window.conMgrAddWt = async function (conId) {
  const v = prompt('추가할 공종명을 입력하세요');
  if (!v || !v.trim()) return;
  const name = v.trim();
  if (getWorkTypesForContractor(conId).some((w) => w.name === name)) {
    toast('이미 있는 공종입니다', 'error');
    return;
  }
  const { data, error } = await supabase
    .from('work_types')
    .insert({ workspace_id: currentWS.id, contractor_id: conId, name })
    .select()
    .single();
  if (error) {
    toast('추가 실패', 'error');
    return;
  }
  workTypes.push(data);
  renderContractorTags();
  toast(name + ' 추가됨', 'success');
};

window.conMgrDelWt = async function (id) {
  await supabase.from('work_types').delete().eq('id', id);
  workTypes = workTypes.filter((w) => w.id !== id);
  renderContractorTags();
};

window.addContractor = async function () {
  const v = document.getElementById('newContractor').value.trim();
  if (!v) return;
  try {
    const manager_name = document.getElementById('newContractorManager').value.trim();
    const manager_phone = document.getElementById('newContractorPhone').value.trim();
    if (manager_phone && !/^[0-9+() .-]{7,30}$/.test(manager_phone)) throw new Error('전화번호 형식을 확인해주세요');
    const { contractor, created } = await insertContractor(v, {manager_name, manager_phone});
    if (!created) {
      toast('이미 등록된 협력사입니다', 'error');
      return;
    }
    document.getElementById('newContractor').value = '';
    document.getElementById('newContractorManager').value = '';
    document.getElementById('newContractorPhone').value = '';
    document.getElementById('conMgrSearch').value = '';
    setContractorFilter('all');
    populateContractorSelects();
    toggleNewContractorForm(false);
    toast(
      `${contractor.name} 등록 완료 — 목록에서 공종·등록증·링크를 관리하세요`,
      'success',
    );
  } catch (error) {
    toast('협력사 등록 실패: ' + error.message, 'error');
  }
};

window.removeContractor = async function (id) {
  const c = contractors.find((x) => x.id === id);
  const linked = c
    ? msdsRecords.filter((r) => r.contractor === c.name).length
    : 0;
  const warn =
    linked > 0
      ? `이 협력사에 연결된 MSDS가 ${linked}건 있습니다.\nMSDS 기록은 삭제되지 않고 남지만, 협력사와 공종 정보는 삭제됩니다.\n계속하시겠습니까?`
      : '협력사를 삭제하면 관련 공종도 삭제됩니다. 계속하시겠습니까?';
  if (!confirm(warn)) return;
  const { error } = await supabase.from('contractors').delete().eq('id', id);
  if (error) {
    toast('협력사 삭제 실패: ' + error.message, 'error');
    return;
  }
  contractors = contractors.filter((c) => c.id !== id);
  workTypes = workTypes.filter((w) => w.contractor_id !== id);
  renderContractorTags();
  populateContractorSelects();
  toast('삭제됐습니다');
};

window.renderWorkTypeTags = function () {
  const sel = document.getElementById('workTypeContractor');
  if (!sel) {
    renderContractorTags();
    return;
  } // 통합 협력사 관리 UI로 대체됨
  const conId = sel.value;
  const tagEl = document.getElementById('workTypeTags');
  const addRow = document.getElementById('workTypeAddRow');
  if (!conId) {
    tagEl.innerHTML =
      '<div style="color:var(--text3);font-size:13px;">협력사를 먼저 선택하세요</div>';
    if (addRow) addRow.style.display = 'none';
    return;
  }
  if (addRow) addRow.style.display = 'flex';
  const wts = getWorkTypesForContractor(conId);
  tagEl.innerHTML =
    wts.length === 0
      ? '<div style="color:var(--text3);font-size:13px;">등록된 공종이 없습니다</div>'
      : wts
          .map(
            (w) =>
              `<span class="tag">${escapeHtml(w.name)}<button type="button" class="tag-remove" aria-label="${escapeHtml(w.name)} 공종 삭제" onclick="removeWorkType('${w.id}')">✕</button></span>`,
          )
          .join('');
};

window.addWorkType = async function () {
  const conId = document.getElementById('workTypeContractor').value;
  const v = document.getElementById('newWorkType').value.trim();
  if (!conId) {
    toast('협력사를 먼저 선택하세요', 'error');
    return;
  }
  if (!v) return;
  const { data, error } = await supabase
    .from('work_types')
    .insert({ workspace_id: currentWS.id, contractor_id: conId, name: v })
    .select()
    .single();
  if (error) {
    toast('추가 실패', 'error');
    return;
  }
  workTypes.push(data);
  document.getElementById('newWorkType').value = '';
  renderWorkTypeTags();
  toast(v + ' 추가됨', 'success');
};

window.removeWorkType = async function (id) {
  await supabase.from('work_types').delete().eq('id', id);
  workTypes = workTypes.filter((w) => w.id !== id);
  renderWorkTypeTags();
};

// ═══════════════════════════════════════════════
// Members
// ═══════════════════════════════════════════════
async function teamRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || '초대 정보를 처리하지 못했습니다.');
  return data;
}

function canManageTeam() {
  return currentWS?.owner_id === user?.id ||
    members.some((m) => m.user_id === user?.id && m.role === 'admin');
}

async function loadMembers() {
  const workspaceId = currentWS.id;
  try {
    const [team, links] = await Promise.all([
      teamRpc('list_workspace_team', { p_workspace: workspaceId }),
      teamRpc('list_workspace_invite_links', { p_workspace: workspaceId }),
    ]);
    if (currentWS?.id !== workspaceId) return;
    members = team || [];
    pendingInvites = links || [];
    renderMemberList();
  } catch (error) {
    if (currentWS?.id !== workspaceId) return;
    document.getElementById('memberList').textContent = '팀원 정보를 불러오지 못했습니다. ' + error.message;
    document.getElementById('createTeamInviteBtn').hidden = true;
  }
}

function renderMemberList() {
  const el = document.getElementById('memberList');
  if (!el) return;
  const canManage = canManageTeam();
  document.getElementById('createTeamInviteBtn').hidden = !canManage;
  const memberHtml = members.map((m) => {
    const email = m.user?.email || '이메일 없음';
    const name = m.user?.raw_user_meta_data?.name || email.split('@')[0];
    const isMe = m.user_id === user.id, isOwner = currentWS.owner_id === m.user_id;
    return `<div class="member-item"><div class="member-avatar">${escapeHtml(name.charAt(0).toUpperCase())}</div>
      <div class="member-info"><div class="member-name">${escapeHtml(name)}${isMe ? ' (나)' : ''}</div><div class="member-email">${escapeHtml(email)}</div></div>
      <span class="member-role ${m.role === 'admin' ? 'admin' : 'member'}">${isOwner ? '소유자' : m.role === 'admin' ? '관리자' : '멤버'}</span>
      ${!isMe && !isOwner && canManage ? `<button class="btn btn-danger btn-sm" onclick="removeMember('${m.id}')">제거</button>` : ''}</div>`;
  }).join('');
  const inviteHtml = pendingInvites.map((inv) => {
    const active = !inv.revoked_at && !inv.accepted_at && new Date(inv.expires_at) > new Date();
    const status = inv.revoked_at ? '취소됨' : inv.accepted_at ? '사용 완료' : active ? '참여 대기' : '만료됨';
    const expiry = new Date(inv.expires_at).toLocaleDateString('ko-KR');
    return `<div class="member-item"><div class="member-avatar">↗</div><div class="member-info">
      <div class="member-name">${inv.role === 'admin' ? '관리자' : '멤버'} 초대 링크 · ${status}</div>
      <div class="member-email">${expiry}까지 · 1명 참여 가능</div></div>
      ${canManage && active ? `<button class="btn btn-danger btn-sm" onclick="cancelInvite('${inv.id}')">링크 취소</button>` : ''}</div>`;
  }).join('');
  el.innerHTML = memberHtml + (canManage ? `<div class="team-invite-heading">발급한 초대 링크</div>${inviteHtml || '<div class="form-note">발급한 초대 링크가 없습니다.</div>'}` : '');
}

window.openTeamInvite = function () {
  if (!canManageTeam()) return toast('현장 관리자만 초대 링크를 만들 수 있습니다.', 'error');
  createdTeamInvite = null;
  document.getElementById('teamInviteResult').hidden = true;
  document.getElementById('teamInviteUrl').value = '';
  document.getElementById('inviteMsg').textContent = '';
  document.getElementById('inviteRole').value = 'member';
  openModal('inviteModal');
};

window.handleInvite = async function () {
  if (!canManageTeam()) return toast('현장 관리자만 초대 링크를 만들 수 있습니다.', 'error');
  const btn = document.getElementById('inviteBtn'), msg = document.getElementById('inviteMsg');
  const workspaceId = currentWS.id;
  btn.disabled = true; msg.textContent = ''; btn.textContent = '생성 중...';
  createdTeamInvite = null;
  document.getElementById('teamInviteResult').hidden = true;
  try {
    const result = await teamRpc('create_workspace_invite_link', { p_workspace: workspaceId, p_role: document.getElementById('inviteRole').value });
    if (currentWS?.id !== workspaceId) return;
    const url = new URL(import.meta.env.DEV ? location.origin : 'https://gshealthk.vercel.app');
    url.hash = 'team-invite=' + result.token;
    createdTeamInvite = { workspaceId, id: result.id, url: url.href };
    document.getElementById('teamInviteUrl').value = url.href;
    document.getElementById('teamInviteResult').hidden = false;
    msg.className = 'auth-msg success';
    msg.textContent = '링크를 만들었습니다. 복사해 초대할 팀원에게 전달하세요.';
    await loadMembers();
  } catch (error) {
    msg.className = 'auth-msg error'; msg.textContent = error.message;
  } finally { btn.disabled = false; btn.textContent = '새 링크 만들기'; }
};

window.copyTeamInvite = async function () {
  if (createdTeamInvite?.workspaceId !== currentWS?.id) return;
  const input = document.getElementById('teamInviteUrl');
  try { await navigator.clipboard.writeText(createdTeamInvite.url); toast('초대 링크를 복사했습니다.', 'success'); }
  catch { input.focus(); input.select(); toast('링크를 선택했습니다. 복사해서 전달해주세요.'); }
};

window.cancelInvite = async function (id) {
  if (!confirm('이 초대 링크를 취소하시겠습니까? 취소하면 사용할 수 없습니다.')) return;
  try {
    await teamRpc('revoke_workspace_invite_link', { p_id: id });
    if (createdTeamInvite?.id === id) {
      createdTeamInvite = null;
      document.getElementById('teamInviteResult').hidden = true;
      document.getElementById('teamInviteUrl').value = '';
    }
    await loadMembers(); toast('초대 링크를 취소했습니다.', 'success');
  } catch (error) { toast(error.message, 'error'); }
};

function renderTeamInviteNotice() {
  for (const [id, anchor] of [['teamInviteAuthNotice', document.getElementById('authTabs')], ['teamInviteWorkspaceNotice', document.getElementById('wsList')]]) {
    let note = document.getElementById(id);
    if (!note && anchor) {
      note = document.createElement('div'); note.id = id; note.className = 'team-invite-notice'; anchor.before(note);
    }
    if (!note) continue;
    note.hidden = !pendingTeamInvite;
    note.innerHTML = id === 'teamInviteAuthNotice'
      ? '<b>현장 초대 링크로 접속했습니다.</b><p>로그인 또는 회원가입 후 초대받은 현장과 권한을 확인할 수 있습니다.</p><button type="button" class="btn btn-outline btn-sm" onclick="dismissTeamInvite()">초대 닫기</button>'
      : '<b>받은 현장 초대가 있습니다.</b><button type="button" class="btn btn-primary btn-sm" onclick="reviewTeamInvite()">초대 확인</button><button type="button" class="btn btn-outline btn-sm" onclick="dismissTeamInvite()">닫기</button>';
  }
}

function ensureTeamInviteModal() {
  if (document.getElementById('acceptTeamInviteModal')) return;
  const modal = document.createElement('div'); modal.id = 'acceptTeamInviteModal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="acceptTeamInviteTitle" style="max-width:440px"><div class="modal-header"><div class="modal-title" id="acceptTeamInviteTitle">현장 초대 확인</div><button class="modal-close" onclick="closeModal('acceptTeamInviteModal')" aria-label="닫기">✕</button></div><div class="modal-body"><div id="teamInviteDetails"></div><div class="auth-msg" id="teamInviteAcceptMsg" role="status"></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="dismissTeamInvite()">참여하지 않기</button><button class="btn btn-primary" id="acceptTeamInviteBtn" onclick="acceptTeamInvite()" disabled>이 현장에 참여</button></div></div>`;
  document.body.append(modal);
}

window.reviewTeamInvite = async function () {
  if (!pendingTeamInvite || !user) return;
  ensureTeamInviteModal();
  const requestedToken = pendingTeamInvite;
  const details = document.getElementById('teamInviteDetails'), btn = document.getElementById('acceptTeamInviteBtn');
  document.getElementById('teamInviteAcceptMsg').textContent = '';
  details.textContent = '초대 정보를 확인하고 있습니다...'; btn.disabled = true; openModal('acceptTeamInviteModal');
  try {
    const preview = await teamRpc('preview_workspace_invite_link', { p_token: requestedToken });
    if (pendingTeamInvite !== requestedToken) return;
    details.innerHTML = `<h3>${escapeHtml(preview.workspaceName)}</h3><p>참여 권한: <b>${preview.role === 'admin' ? '현장 관리자' : '멤버'}</b></p><p class="form-note">${escapeHtml(user.email)} 계정으로 참여합니다. 현장과 권한을 확인한 뒤 참여해주세요.</p>`;
    btn.disabled = false;
  } catch (error) { if (pendingTeamInvite === requestedToken) details.textContent = error.message; }
};

window.dismissTeamInvite = function () {
  pendingTeamInvite = '';
  try { sessionStorage.removeItem(TEAM_INVITE_STORAGE); } catch {}
  closeModal('acceptTeamInviteModal'); renderTeamInviteNotice();
};

window.acceptTeamInvite = async function () {
  if (!pendingTeamInvite || !user) return;
  const btn = document.getElementById('acceptTeamInviteBtn'), msg = document.getElementById('teamInviteAcceptMsg');
  btn.disabled = true; btn.textContent = '참여 중...';
  try {
    const result = await teamRpc('accept_workspace_invite_link', { p_token: pendingTeamInvite });
    window.dismissTeamInvite();
    await loadWorkspaces();
    toast(result.alreadyMember ? '이미 참여 중인 현장입니다.' : '현장에 참여했습니다.', 'success');
    await enterWorkspace(result.workspaceId);
  } catch (error) { msg.className = 'auth-msg error'; msg.textContent = error.message; }
  finally { btn.disabled = false; btn.textContent = '이 현장에 참여'; }
};

window.removeMember = async function (memberId) {
  if (!confirm('팀원을 제거하시겠습니까?')) return;
  await supabase.from('workspace_members').delete().eq('id', memberId);
  await loadMembers();
  toast('제거됐습니다');
};

// ═══════════════════════════════════════════════
// Upload Tokens
// ═══════════════════════════════════════════════
async function loadTokens() {
  const { data } = await supabase
    .from('upload_tokens')
    .select('*, contractor:contractor_id(name)')
    .eq('workspace_id', currentWS.id)
    .order('created_at');
  tokens = data || [];
}

window.generateUploadLink = async function () {
  const conId = document.getElementById('linkContractor').value;
  if (!conId) {
    toast('협력사를 선택하세요', 'error');
    return;
  }
  const existing = tokens.find((t) => t.contractor_id === conId);
  if (existing) {
    toast('이미 발급된 링크가 있습니다', 'warn');
    renderTokenList();
    return;
  }
  const token = generateToken();
  const { data, error } = await supabase
    .from('upload_tokens')
    .insert({ workspace_id: currentWS.id, contractor_id: conId, token })
    .select('*, contractor:contractor_id(name)')
    .single();
  if (error) {
    toast('발급 실패: ' + error.message, 'error');
    return;
  }
  tokens.push(data);
  renderTokenList();
  toast('링크가 발급됐습니다', 'success');
};

function renderTokenList() {
  const el = document.getElementById('tokenList');
  if (!el) return;
  const wsTokens = tokens;
  if (wsTokens.length === 0) {
    el.innerHTML =
      '<div style="font-size:13px;color:var(--text3);text-align:center;padding:20px;">발급된 링크가 없습니다</div>';
    return;
  }
  const base = window.location.origin + '/upload.html';
  el.innerHTML = wsTokens
    .map((t) => {
      const url = `${base}?token=${t.token}`;
      return `<div class="token-card">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">👷 ${t.contractor?.name || '알 수 없음'}</div>
        <div class="token-url">${url}</div>
        <div class="token-meta">발급일: ${new Date(t.created_at).toLocaleDateString('ko-KR')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
        <button class="btn btn-primary btn-sm" onclick="copyLink('${url}')">복사</button>
        <button class="btn btn-secondary btn-sm" onclick="shareLink('${url}','${t.contractor?.name || ''}')">공유</button>
        <button class="btn btn-danger btn-sm" onclick="revokeToken('${t.id}')">삭제</button>
      </div>
    </div>`;
    })
    .join('');
}

window.copyLink = function (url) {
  navigator.clipboard
    .writeText(url)
    .then(() => toast('링크가 복사됐습니다', 'success'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('링크가 복사됐습니다', 'success');
    });
};

window.shareLink = function (url, name) {
  if (navigator.share) {
    navigator.share({
      title: `${currentWS?.name || ""} ${name} 관리페이지`,
      text: `MSDS 조회·업로드, 경고표지 인쇄 및 사업자등록증 등록`,
      url,
    });
  } else {
    copyLink(url);
  }
};

window.revokeToken = async function (id) {
  if (
    !confirm(
      '링크를 삭제하면 협력사에서 더 이상 업로드할 수 없습니다. 계속하시겠습니까?',
    )
  )
    return;
  await supabase.from('upload_tokens').delete().eq('id', id);
  tokens = tokens.filter((t) => t.id !== id);
  renderTokenList();
  toast('링크가 삭제됐습니다');
};

// ═══════════════════════════════════════════════
// MSDS Records
// ═══════════════════════════════════════════════
async function loadMsdsRecords() {
  const { data } = await supabase
    .from('msds_records')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .order('created_at', { ascending: false });
  msdsRecords = data || [];
  updateStats();
  renderMsdsTable();
  renderHomeDashboard();
  renderWarnPickList();
  renderContractorTags();
  renderContractorSidebar(); // 추가
}

function updateStats() {
  const total = msdsRecords.length;
  const pending = msdsRecords.filter((r) => !msdsReceived(r)).length;
  const special = msdsRecords.filter((r) => r.legal_special === 'Y').length;
  const active = msdsRecords.filter(
    (r) => (r.status || 'active') === 'active',
  ).length;
  document.getElementById('msdsSubtitle').textContent = `총 ${total}건`;
  const nb = document.getElementById('navBadgeMsds');
  const mb = document.getElementById('mBadgeMsds');
  if (total > 0) {
    nb.style.display = 'inline';
    nb.textContent = total;
    mb.style.display = 'inline';
    mb.textContent = total;
  } else {
    nb.style.display = 'none';
    mb.style.display = 'none';
  }
}

function renderHomeDashboard() {
  renderGsHome();
}

let dashAlertsOpen = false;
window.toggleDashAlerts = function () {
  dashAlertsOpen = !dashAlertsOpen;
  document.getElementById('dashAlertDetail').style.display = dashAlertsOpen
    ? 'block'
    : 'none';
  document.getElementById('dashAlertToggleIcon').textContent = dashAlertsOpen
    ? '▴ 접기'
    : '▾ 펼치기';
  document
    .getElementById('dashAlertBar')
    ?.setAttribute('aria-expanded', String(dashAlertsOpen));
};

// ═══════════════════════════════════════════════
// MSDS Table
// ═══════════════════════════════════════════════
function getFilteredMsds() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const fCon = window.selectedContractor || '';
  const fWork = document.getElementById('filterWorkType')?.value || '';
  const fSt = document.getElementById('filterStatus')?.value || '';
  const fRc = ''; // receipt state lives on the request page
  const fSpc = document.getElementById('filterSpecial')?.value || '';
  return msdsRecords
    .filter((r) => {
      const mq =
        !q ||
        [r.product_name, r.supplier, r.cas_no, r.contractor, r.work_type]
          .join(' ')
          .toLowerCase()
          .includes(q);
      const mc = !fCon || r.contractor === fCon;
      const mw = !fWork || r.work_type === fWork;
      const ms = !fSt || (r.status || 'active') === fSt;
      const mr = !fRc || (r.receipt_status || 'received') === fRc;
      const msp = !fSpc || r.legal_special === 'Y';
      return mq && mc && mw && ms && mr && msp;
    })
    .sort((a, b) => {
      const conSort = a.contractor.localeCompare(b.contractor, 'ko');
      if (conSort !== 0) return conSort;
      return a.product_name.localeCompare(b.product_name, 'ko');
    });
}

window.renderMsdsTable = function () {
  const filtered = getFilteredMsds();
  const tbody = document.getElementById('msdsTableBody');
  const summary = document.getElementById('msdsResultSummary');
  if (summary) summary.innerHTML = `<strong>${escapeHtml(window.selectedContractor || '전체 협력사')}</strong><span>조회 ${filtered.length}건</span>${window.selectedContractor ? '<button type="button" class="msds-reset" onclick="selectContractorSidebar(&quot;&quot;)">전체 보기</button>' : ''}`;
  const checkAll = document.getElementById('checkAll');
  if (checkAll) { checkAll.checked = false; checkAll.indeterminate = false; }
  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="10">등록된 MSDS가 없습니다</td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map((r) => {
      const sp =
        r.legal_special === 'Y'
          ? '<span class="badge badge-danger">특별</span>'
          : '<span class="badge badge-gray">일반</span>';
      const st =
        (r.status || 'active') === 'active'
          ? `<button type="button" class="badge badge-ok status-toggle" onclick="toggleMsdsStatus('${r.id}')">사용중</button>`
          : `<button type="button" class="badge badge-gray status-toggle" onclick="toggleMsdsStatus('${r.id}')">종료</button>`;
      const rc =
        (r.receipt_status || 'received') === 'received'
          ? `<button type="button" class="badge badge-ok status-toggle" onclick="openReceipt('${r.id}')">✓ 수령</button>`
          : `<button type="button" class="badge badge-danger status-toggle" onclick="openReceipt('${r.id}')">! 미수령</button>`;
      const file = r.has_pdf
        ? `<button type="button" class="pdf-link" aria-label="${escapeHtml(r.product_name)} 원본 PDF 보기" onclick="viewFile('${r.id}')">📄</button>`
        : '-';
      return `<tr>
      <td><input type="checkbox" class="row-check" value="${r.id}" onchange="updateCheckAll()"></td>
      <td><button type="button" class="msds-product-link" data-msds-id="${r.id}" onclick="openMsdsWarning('${r.id}', this)" aria-label="${escapeHtml(r.product_name)} 경고표지 보기">${escapeHtml(r.product_name)}</button><div class="td-sub">v${escapeHtml(r.version || 1)}${r.submission_no_valid === 'N' ? ' · <span style="color:var(--danger);font-weight:700;">⚠ 제출번호 확인필요</span>' : ''}${r.reupload_requested ? ' · <span style="color:var(--warn);font-weight:700;">🔁 재업로드 요청중</span>' : ''}</div></td>
      <td>${escapeHtml(r.contractor)}</td>
      <td>${escapeHtml(r.work_type || '-')}</td>
      <td>${escapeHtml(r.supplier || '-')}</td>
      <td style="font-size:12px;">${escapeHtml(r.cas_no || '-')}</td>
      <td>${sp}</td>
      <td>${st}</td>

      <td>${file}</td>
      <td>
        <div class="msds-row-actions">
          <button type="button" class="btn btn-secondary btn-sm" onclick="showMsdsDetail('${r.id}')">상세보기</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="startMsdsEdit('${r.id}')">수정</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="reanalyzeMsds('${r.id}')">AI 재분석</button>
          <button type="button" class="btn ${r.reupload_requested ? 'btn-warn' : 'btn-secondary'} btn-sm" onclick="${r.reupload_requested ? `cancelReupload('${r.id}')` : `requestReupload('${r.id}')`}">${r.reupload_requested ? '요청 취소' : '재업로드 요청'}</button>
          <button type="button" class="btn btn-danger btn-sm" onclick="deleteMsdsRecord('${r.id}')">삭제</button>
        </div>
      </td>
    </tr>`;
    })
    .join('');
};

window.toggleAll = function (cb) {
  document
    .querySelectorAll('.row-check')
    .forEach((c) => (c.checked = cb.checked));
};
window.updateCheckAll = function () {
  const all = document.querySelectorAll('.row-check');
  const ch = document.querySelectorAll('.row-check:checked');
  const ca = document.getElementById('checkAll');
  if (ca) ca.checked = all.length > 0 && all.length === ch.length;
};

// ═══════════════════════════════════════════════
// MSDS Register Modal
// ═══════════════════════════════════════════════
window.openMsdsRegister = function () {
  editingMsdsId = null;
  document.getElementById('msdsRegisterTitle').textContent = 'MSDS 등록';
  document.getElementById('msdsManualFooter').style.display = 'none';
  switchMsdsTab('upload');
  populateContractorSelects();
  openModal('msdsRegisterModal');
};

window.switchMsdsTab = function (tab) {
  if (tab === 'manual' && !editingMsdsId) tab = 'upload';
  document.getElementById('msdsUploadTab').style.display =
    tab === 'upload' ? 'block' : 'none';
  document.getElementById('msdsManualTab').style.display =
    tab === 'manual' ? 'block' : 'none';
  document.getElementById('msdsManualFooter').style.display =
    tab === 'manual' ? 'flex' : 'none';
  if (tab === 'manual') {
    populateContractorSelects();
  }
};

// ═══════════════════════════════════════════════
// File Queue (MSDS)
// ═══════════════════════════════════════════════
window.dragOver = function (e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId)?.classList.add('drag');
};
window.dragLeave = function (e, zoneId) {
  document.getElementById(zoneId)?.classList.remove('drag');
};

window.dropMsdsFiles = function (e) {
  e.preventDefault();
  document.getElementById('msdsUploadZone').classList.remove('drag');
  const items = [...e.dataTransfer.items];
  const ok = ['application/pdf', 'image/jpeg', 'image/png'];
  const files = [...e.dataTransfer.files].filter((f) => ok.includes(f.type));
  const non = e.dataTransfer.files.length - files.length;
  if (non > 0) toast(`PDF/JPG/PNG만 가능합니다 (${non}개 제외)`, 'warn');
  if (files.length) addMsdsFilesToQueue(files, e.dataTransfer);
};

window.handleMsdsFileSelect = function (e) {
  const ok = ['application/pdf', 'image/jpeg', 'image/png'];
  const files = [...e.target.files].filter((f) => ok.includes(f.type));
  addMsdsFilesToQueue(files, null);
  e.target.value = '';
};

window.handleFolderSelect = function (e) {
  const ok = ['application/pdf', 'image/jpeg', 'image/png'];
  const files = [...e.target.files].filter((f) => ok.includes(f.type));
  if (files.length === 0) {
    toast('폴더에 PDF/JPG/PNG가 없습니다', 'error');
    e.target.value = '';
    return;
  }
  addMsdsFilesToQueue(files, null, true);
  e.target.value = '';
  toast(
    `${files.length}개 파일 추가됨 (폴더에서 협력사·공종 자동 인식)`,
    'success',
  );
};

function addMsdsFilesToQueue(files, dt, fromFolder = false) {
  files.forEach((file) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const rel = file.webkitRelativePath || file.name;
    let guessCon = '',
      guessWork = '';
    if (fromFolder) {
      const g = guessFromPath(rel, contractors, workTypes);
      guessCon = g.guessCon;
      guessWork = g.guessWork;
    }
    const item = {
      id,
      file,
      name: file.name,
      path: rel,
      data: null,
      mediaType: file.type,
      status: 'reading',
      error: null,
      guessCon,
      guessWork,
    };
    msdsFileQueue.push(item);
    readMsdsQueueItem(item);
  });
  renderMsdsFileQueue();
  updateMsdsBatchBar();
}

function readMsdsQueueItem(item) {
  item.status = 'reading';
  item.error = null;
  item.data = null;
  renderMsdsFileQueue();
  updateMsdsBatchBar();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = String(ev.target?.result || '');
      const separator = result.indexOf(',');
      if (separator < 0 || !result.slice(separator + 1)) {
        item.status = 'error';
        item.error = '파일 내용을 읽지 못했습니다';
      } else {
        item.data = result.slice(separator + 1);
        item.status = 'waiting';
      }
      renderMsdsFileQueue();
      updateMsdsBatchBar();
      resolve(item.status === 'waiting');
    };
    reader.onerror = () => {
      item.status = 'error';
      item.error = '파일 읽기에 실패했습니다. 파일을 다시 선택해 주세요';
      renderMsdsFileQueue();
      updateMsdsBatchBar();
      resolve(false);
    };
    reader.readAsDataURL(item.file);
  });
}

function renderMsdsFileQueue() {
  const el = document.getElementById('msdsFileQueue');
  if (!el) return;
  if (msdsFileQueue.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  const icons = {
    reading: '📥',
    waiting: '📄',
    parsing: '⏳',
    done: '✅',
    error: '❌',
  };
  const st = {
    reading: '파일 읽는 중...',
    waiting: '분석 대기',
    parsing: 'AI 분석 중...',
    done: '완료 — 저장됨',
    error: '',
  };
  el.innerHTML = msdsFileQueue
    .map((item) => {
      const guess =
        item.guessCon || item.guessWork
          ? ` · ${[item.guessCon, item.guessWork].filter(Boolean).join(' / ')}`
          : '';
      const statusText =
        item.status === 'error'
          ? '오류: ' + (item.error || '알수없음')
          : st[item.status] + (item.status === 'waiting' ? guess : '');
      return `<div class="file-item ${item.status}">
      <span class="fi-icon">${icons[item.status]}</span>
      <div class="fi-info">
        <div class="fi-name">${escapeHtml(item.name)}</div>
        <div class="fi-status">${escapeHtml(statusText)}</div>
        ${item.status === 'parsing' ? '<div class="file-progress"><div class="file-progress-bar"></div></div>' : ''}
      </div>
      ${item.status !== 'parsing' && item.status !== 'reading' ? `<button type="button" class="fi-remove" aria-label="${escapeHtml(item.name)} 제거" onclick="removeMsdsFile('${item.id}')">✕</button>` : ''}
    </div>`;
    })
    .join('');
}

window.removeMsdsFile = function (id) {
  msdsFileQueue = msdsFileQueue.filter((f) => f.id !== id);
  renderMsdsFileQueue();
  updateMsdsBatchBar();
};
window.clearMsdsFiles = function () {
  msdsFileQueue = [];
  renderMsdsFileQueue();
  updateMsdsBatchBar();
};

function updateMsdsBatchBar() {
  const bar = document.getElementById('msdsBatchBar');
  if (!bar) return;
  if (msdsFileQueue.length === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  const done = msdsFileQueue.filter((f) => f.status === 'done').length;
  const err = msdsFileQueue.filter((f) => f.status === 'error').length;
  const wait = msdsFileQueue.filter((f) => f.status === 'waiting').length;
  const reading = msdsFileQueue.filter((f) => f.status === 'reading').length;
  document.getElementById('msdsBatchInfo').innerHTML =
    `<strong>${msdsFileQueue.length}개</strong> 파일${reading ? ` · 읽는 중 ${reading}` : ''} · 대기 ${wait} · 완료 ${done}${err ? ` · <span style="color:var(--danger)">오류 ${err}</span>` : ''}`;
  document.getElementById('parseAllBtn').disabled = wait === 0 || reading > 0;
  const retryBtn = document.getElementById('retryMsdsBtn');
  if (retryBtn) retryBtn.style.display = err ? '' : 'none';
}

window.retryMsdsErrors = async function () {
  const errors = msdsFileQueue.filter((item) => item.status === 'error');
  await Promise.all(
    errors.map((item) =>
      item.data
        ? Promise.resolve(
            Object.assign(item, { status: 'waiting', error: null }),
          )
        : readMsdsQueueItem(item),
    ),
  );
  renderMsdsFileQueue();
  updateMsdsBatchBar();
  if (msdsFileQueue.some((item) => item.status === 'waiting')) parseAllFiles();
};

// ═══════════════════════════════════════════════
// Parse & Save MSDS
// ═══════════════════════════════════════════════
window.parseAllFiles = async function () {
  if (msdsFileQueue.some((f) => f.status === 'reading')) {
    toast('파일을 읽는 중입니다. 잠시 후 다시 눌러주세요', 'warn');
    return;
  }
  const batchConId = document.getElementById('batchContractor').value;
  const batchWork = document.getElementById('batchWorkType').value;
  const waiting = msdsFileQueue.filter((f) => f.status === 'waiting');
  if (waiting.length === 0) {
    toast('대기 중인 파일이 없습니다', 'error');
    return;
  }
  const hasContractor = waiting.every((f) => f.guessCon || batchConId);
  if (!hasContractor) {
    toast('협력사를 선택하거나 폴더 구조에 협력사명을 포함해주세요', 'error');
    return;
  }
  document.getElementById('parseAllBtn').disabled = true;
  let saved = 0;
  for (const item of waiting) {
    item.status = 'parsing';
    renderMsdsFileQueue();
    let recId = null;
    try {
      const parsed = await callParseFunction(item.data, item.mediaType);
      const conName =
        item.guessCon ||
        contractors.find((c) => c.id === batchConId)?.name ||
        '';
      const workTypeName = item.guessWork || batchWork || '';
      recId = await saveMsdsRecord({
        product_name:
          parsed.productName || item.name.replace(/\.(pdf|jpg|jpeg|png)$/i, ''),
        supplier: parsed.supplier || '',
        supplier_contact: parsed.supplierContact || '',
        contractor: conName,
        work_type: workTypeName,
        cas_no: parsed.casNo || '',
        components: parsed.components || '',
        signal_word: parsed.signalWord || '',
        h_codes: parsed.hCodes || '',
        p_codes: parsed.pCodes || '',
        pictograms: parsed.pictograms || '',
        issue_date: parsed.issueDate || '',
        protective_equipment: parsed.protectiveEquipment || '',
        handling_precautions: parsed.handlingPrecautions || '',
        first_aid: parsed.firstAid || '',
        emergency_response: parsed.emergencyResponse || '',
        legal_measurement: parsed.legalMeasurement || 'N',
        legal_exam: parsed.legalExam || 'N',
        legal_exam_cycle: parsed.legalExamCycle || '',
        legal_manage: parsed.legalManage || 'N',
        legal_permit: parsed.legalPermit || 'N',
        legal_special: parsed.legalSpecial || 'N',
        legal_dangerous: parsed.legalDangerous || 'N',
        special: parsed.legalSpecial === 'Y' ? 'Y_special' : 'N',
        submission_no: parsed.submissionNo || '',
        submission_no_valid: parsed.submissionNoValid || 'N',
        ...structuredMsdsFields(parsed),
        receipt_status: 'received',
        receipt_date: today(),
      });
      await uploadMsdsFile(recId, item.name, item.data, item.mediaType);
      saved++;
      item.status = 'done';
    } catch (err) {
      if (recId) {
        const { error: rollbackError } = await supabase
          .from('msds_records')
          .delete()
          .eq('id', recId);
        if (rollbackError)
          console.error(
            '파일 업로드 실패 후 레코드 정리 실패:',
            rollbackError.message,
          );
      }
      item.status = 'error';
      item.error = err.message;
      if (AI_SETUP_CODES.has(err.code)) {
        renderMsdsFileQueue();
        updateMsdsBatchBar();
        handleAiError(err);
        break;
      }
    }
    renderMsdsFileQueue();
    updateMsdsBatchBar();
    await new Promise((r) => setTimeout(r, 300));
  }
  await loadMsdsRecords();
  const hasErrors = msdsFileQueue.some((f) => f.status === 'error');
  toast(
    `${saved}개 저장 완료${hasErrors ? ', 실패 파일은 다시 시도할 수 있습니다' : ''}`,
    saved > 0 ? (hasErrors ? 'warn' : 'success') : 'error',
  );
  document.getElementById('parseAllBtn').disabled = !msdsFileQueue.some(
    (f) => f.status === 'waiting',
  );
  if (saved > 0 && !hasErrors)
    setTimeout(() => {
      closeModal('msdsRegisterModal');
      msdsFileQueue = [];
      renderMsdsFileQueue();
      updateMsdsBatchBar();
    }, 800);
};

async function callParseFunction(base64Data, mediaType, options = {}) {
  const mb = ((base64Data.length * 0.75) / 1024 / 1024).toFixed(1);
  if (mb > 20) throw new Error(`파일이 너무 큽니다 (${mb}MB)`);
  const data = await invokeEdgeJson('parse-msds', {
    fileBase64: base64Data,
    mediaType,
    ...options,
  });
  return {
    ...data.result,
    analysisProvider: data.provider || '',
    analysisModel: data.model || '',
    analysisRouting: data.routing || null,
  };
}

function structuredMsdsFields(parsed = {}) {
  return {
    component_details: Array.isArray(parsed.componentDetails)
      ? parsed.componentDetails
      : [],
    dangerous_goods_details:
      parsed.dangerousGoods && typeof parsed.dangerousGoods === 'object'
        ? parsed.dangerousGoods
        : {},
    occupational_safety_details:
      parsed.occupationalSafety && typeof parsed.occupationalSafety === 'object'
        ? parsed.occupationalSafety
        : {},
    chemical_regulation_details:
      parsed.chemicalRegulation && typeof parsed.chemicalRegulation === 'object'
        ? parsed.chemicalRegulation
        : {},
    analysis_provider: parsed.analysisProvider || null,
    analysis_model: parsed.analysisModel || null,
  };
}

async function saveMsdsRecord(fields) {
  const { data, error } = await supabase
    .from('msds_records')
    .insert({
      workspace_id: currentWS.id,
      uploaded_by: user.id,
      status: 'active',
      version: 1,
      history: [],
      has_pdf: false,
      ...fields,
    })
    .select()
    .single();
  if (error) throw new Error('DB 저장 실패: ' + error.message);
  return data.id;
}

async function uploadMsdsFile(recId, fileName, base64Data, mediaType) {
  const ext =
    mediaType === 'application/pdf' ? 'pdf' : mediaType.split('/')[1] || 'jpg';
  const path = `${currentWS.id}/${recId}.${ext}`;
  const blob = base64ToBlob(base64Data, mediaType);
  const { error } = await supabase.storage
    .from('msds-pdfs')
    .upload(path, blob, { contentType: mediaType, upsert: true });
  if (error) throw new Error('원본 파일 업로드 실패: ' + error.message);
  const { error: updateError } = await supabase
    .from('msds_records')
    .update({ has_pdf: true, pdf_name: fileName, pdf_path: path })
    .eq('id', recId);
  if (updateError) {
    await supabase.storage.from('msds-pdfs').remove([path]);
    throw new Error('파일 정보 저장 실패: ' + updateError.message);
  }
}

// ═══════════════════════════════════════════════
// MSDS Manual Save
// ═══════════════════════════════════════════════
window.saveMsdsManual = async function () {
  if (!editingMsdsId) {
    toast('MSDS 원본 파일을 먼저 등록해주세요', 'error');
    return;
  }
  const productName = document.getElementById('f_productName').value.trim();
  const supplier = document.getElementById('f_supplier').value.trim();
  const conId = document.getElementById('f_contractor').value;
  const conName = contractors.find((c) => c.id === conId)?.name || '';
  if (!productName || !supplier || !conName) {
    toast('제품명·공급업체·협력사는 필수입니다', 'error');
    return;
  }
  const lsp = document.getElementById('f_legal_special').checked ? 'Y' : 'N';
  const fields = {
    product_name: productName,
    supplier,
    contractor: conName,
    work_type: document.getElementById('f_workType').value,
    supplier_contact: document.getElementById('f_supplierContact').value,
    cas_no: document.getElementById('f_casNo').value,
    components: document.getElementById('f_components').value,
    signal_word: document.getElementById('f_signalWord').value,
    h_codes: document.getElementById('f_hCodes').value,
    p_codes: document.getElementById('f_pCodes').value,
    pictograms: document.getElementById('f_pictograms').value,
    issue_date: document.getElementById('f_issueDate').value,
    protective_equipment: document.getElementById('f_protectiveEquipment')
      .value,
    handling_precautions: document.getElementById('f_handlingPrecautions')
      .value,
    first_aid: document.getElementById('f_firstAid').value,
    emergency_response: document.getElementById('f_emergencyResponse').value,
    legal_measurement: document.getElementById('f_legal_measurement').checked
      ? 'Y'
      : 'N',
    legal_exam: document.getElementById('f_legal_exam').checked ? 'Y' : 'N',
    legal_exam_cycle: document.getElementById('f_legalExamCycle').value,
    legal_manage: document.getElementById('f_legal_manage').checked ? 'Y' : 'N',
    legal_permit: document.getElementById('f_legal_permit').checked ? 'Y' : 'N',
    legal_special: lsp,
    legal_dangerous: document.getElementById('f_legal_dangerous').checked
      ? 'Y'
      : 'N',
    special: lsp === 'Y' ? 'Y_special' : 'N',
  };
  try {
    if (editingMsdsId) {
      const old = msdsRecords.find((r) => r.id === editingMsdsId);
      const nv = (old.version || 1) + 1;
      const history = [
        ...(old.history || []),
        {
          version: old.version || 1,
          date: (old.updated_at || old.created_at || '').split('T')[0],
          note: '수정됨',
        },
      ];
      const { error } = await supabase
        .from('msds_records')
        .update({
          ...fields,
          version: nv,
          history,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingMsdsId);
      if (error) throw error;
      toast(`수정됐습니다 (v${nv})`, 'success');
    } else {
      await saveMsdsRecord({ ...fields, receipt_status: 'pending' });
      toast('등록됐습니다', 'success');
    }
    closeModal('msdsRegisterModal');
    resetMsdsForm();
    await loadMsdsRecords();
  } catch (err) {
    toast('저장 실패: ' + err.message, 'error');
  }
};

window.resetMsdsForm = function () {
  [
    'f_productName',
    'f_supplier',
    'f_supplierContact',
    'f_casNo',
    'f_components',
    'f_hCodes',
    'f_pCodes',
    'f_pictograms',
    'f_issueDate',
    'f_protectiveEquipment',
    'f_legalExamCycle',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['f_signalWord', 'f_workType'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  [
    'f_legal_measurement',
    'f_legal_exam',
    'f_legal_manage',
    'f_legal_permit',
    'f_legal_special',
    'f_legal_dangerous',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  editingMsdsId = null;
};

// ═══════════════════════════════════════════════
// MSDS Detail / Edit / Delete
// ═══════════════════════════════════════════════
function safeJsonValue(value, fallback) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizedAssessment(value, legacyValue = '') {
  const valid = new Set(['해당', '해당없음', '내용없음', '조건부']);
  if (value && typeof value === 'object') {
    return {
      status: valid.has(value.status) ? value.status : '내용없음',
      detail: String(value.detail || ''),
      basis: String(value.basis || ''),
    };
  }
  if (typeof value === 'string' && valid.has(value))
    return { status: value, detail: '', basis: '' };
  if (legacyValue === 'Y')
    return {
      status: '해당',
      detail: '기존 CAS 보조 판정',
      basis: '기존 분석 결과',
    };
  return { status: '내용없음', detail: '', basis: '' };
}

function statusBadge(status) {
  const css =
    {
      해당: 'applicable',
      해당없음: 'not-applicable',
      내용없음: 'missing',
      조건부: 'conditional',
    }[status] || 'missing';
  return `<span class="legal-status ${css}">${escapeHtml(status || '내용없음')}</span>`;
}

function renderAssessmentItem(label, value, legacyValue = '') {
  const item = normalizedAssessment(value, legacyValue);
  return `<div class="regulatory-item">
    <div class="regulatory-item-head"><b>${escapeHtml(label)}</b>${statusBadge(item.status)}</div>
    ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : '<p class="regulatory-empty">추가 설명 없음</p>'}
    ${item.basis ? `<small>근거: ${escapeHtml(item.basis)}</small>` : ''}
  </div>`;
}

function detailRow(label, value) {
  return `<div class="detail-row"><div class="detail-key">${escapeHtml(label)}</div><div class="detail-val">${value}</div></div>`;
}

window.showMsdsDetail = function (id) {
  const r = msdsRecords.find((x) => x.id === id);
  if (!r) return;
  currentDetailId = id;
  document.getElementById('detailTitle').textContent = r.product_name;
  const safe = (value) => escapeHtml(value || '-');
  const contentWithUnit = (value, unit) => {
    if (!value || value === '내용없음') return safe(value || '내용없음');
    const text = String(value);
    const suffix = String(unit || '%');
    return `${escapeHtml(text)}${text.includes(suffix) ? '' : escapeHtml(suffix)}`;
  };
  const firstCas = String(r.cas_no || '')
    .split(/[,;\s]/)[0]
    .replace(/[^0-9-]/g, '');
  const componentDetails = safeJsonValue(r.component_details, []);
  const dangerous = safeJsonValue(r.dangerous_goods_details, {});
  const occupational = safeJsonValue(r.occupational_safety_details, {});
  const chemical = safeJsonValue(r.chemical_regulation_details, {});
  const dangerousStatus = ['해당', '해당없음', '내용없음', '조건부'].includes(
    dangerous.status,
  )
    ? dangerous.status
    : r.legal_dangerous === 'Y'
      ? '해당'
      : '내용없음';
  const providerLabel =
    { claude: 'Claude', openai: 'GPT', gemini: 'Gemini' }[
      r.analysis_provider
    ] || '';
  const componentHtml =
    Array.isArray(componentDetails) && componentDetails.length
      ? `
    <div class="component-table-wrap"><table class="component-detail-table">
      <thead><tr><th>CAS No.</th><th>물질명</th><th>최소 함유량</th><th>최대 함유량</th><th>근거</th></tr></thead>
      <tbody>${componentDetails
        .map(
          (item) => `<tr>
        <td>${safe(item.casNo)}</td><td>${safe(item.substanceName)}</td>
        <td>${contentWithUnit(item.minContent, item.unit)}</td>
        <td>${contentWithUnit(item.maxContent, item.unit)}</td>
        <td>${safe(item.basis)}</td>
      </tr>`,
        )
        .join('')}</tbody>
    </table></div>`
      : '<div class="regulatory-no-data">내용 없음 · 원본 다시 분석을 실행하면 CAS별 함유량을 추출합니다.</div>';
  const flammable = normalizedAssessment(
    dangerous.flammableLiquid,
    r.legal_dangerous,
  );
  const dangerousHtml = `<div class="dangerous-summary">
    <div class="dangerous-summary-head"><b>위험물 분류</b>${statusBadge(dangerousStatus)}</div>
    <div class="dangerous-facts">
      <span><small>류별 분류</small><b>${safe(dangerous.classNo || (dangerousStatus === '해당없음' ? '해당없음' : '내용없음'))}</b></span>
      <span><small>인화성액체</small><b>${statusBadge(flammable.status)}</b></span>
      <span><small>위험물 종류</small><b>${safe(dangerous.category || '내용없음')}</b></span>
      <span><small>수용성 구분</small><b>${safe(dangerous.waterSolubility || '내용없음')}</b></span>
      <span><small>지정수량</small><b>${safe(dangerous.designatedQuantity || '내용없음')}</b></span>
    </div>
    ${dangerous.detail || flammable.detail ? `<p>${safe(dangerous.detail || flammable.detail)}</p>` : ''}
    ${dangerous.basis || flammable.basis ? `<small>근거: ${safe(dangerous.basis || flammable.basis)}</small>` : ''}
  </div>`;
  const occupationalHtml = [
    ['관리대상', 'managementTarget', r.legal_manage],
    ['특별관리', 'specialManagement', r.legal_special],
    ['작업환경측정 대상', 'workEnvironmentMeasurement', r.legal_measurement],
    ['노출기준', 'exposureLimit', ''],
    ['허용기준', 'permissibleLimit', ''],
    ['국소배기 점검대상', 'localExhaustInspection', ''],
    ['특수건강진단 대상', 'specialHealthExam', r.legal_exam],
    ['허가대상', 'permitTarget', r.legal_permit],
    ['금지대상', 'prohibitedTarget', ''],
    ['PSM 보고서', 'psm', ''],
  ]
    .map(([label, key, legacy]) =>
      renderAssessmentItem(label, occupational[key], legacy),
    )
    .join('');
  const chemicalHtml = [
    ['유독물질', 'toxic'],
    ['제한물질', 'restricted'],
    ['금지물질', 'prohibited'],
    ['사고대비물질', 'accidentPreparedness'],
  ]
    .map(([label, key]) => renderAssessmentItem(label, chemical[key]))
    .join('');
  const hist =
    r.history?.length > 0
      ? r.history
          .map(
            (h) =>
              `<div class="detail-history-row">v${escapeHtml(h.version)} · ${escapeHtml(h.date)} · ${escapeHtml(h.note)}</div>`,
          )
          .join('')
      : '<div class="regulatory-no-data">개정 이력 없음</div>';
  document.getElementById('detailBody').innerHTML = `
    ${detailRow('제품명', `<strong>${safe(r.product_name)}</strong> <span class="badge badge-gray detail-version">v${escapeHtml(r.version || 1)}</span>`)}
    ${detailRow('협력사', safe(r.contractor))}
    ${detailRow('취급 공종', safe(r.work_type))}
    ${detailRow('공급업체', `${safe(r.supplier)}${r.supplier_contact ? ` (${safe(r.supplier_contact)})` : ''}`)}
    ${detailRow('MSDS 개정일', safe(r.issue_date))}
    ${detailRow('제출번호', `${r.submission_no ? safe(r.submission_no) : '<span class="detail-alert">없음</span>'}${r.submission_no_valid === 'N' ? '<span class="badge badge-danger detail-version">⚠ 확인 필요</span>' : ''}`)}
    ${detailRow('CAS No.', `${safe(r.cas_no)}${firstCas ? `<button class="btn btn-outline btn-sm kosha-inline-btn" onclick="openKosha('${firstCas}')">🔍 KOSHA 조회</button>` : ''}`)}
    ${detailRow('구성성분', `<span class="detail-pre">${safe(r.components)}</span>`)}
    ${detailRow('신호어', safe(r.signal_word))}
    ${detailRow('H코드', safe(r.h_codes))}
    ${detailRow('P코드', safe(r.p_codes))}
    ${detailRow('적절한 보호구', safe(r.protective_equipment))}
    ${detailRow('취급상의 주의사항', safe(r.handling_precautions || '원본 MSDS 7항을 확인하세요'))}
    ${detailRow('응급조치 요령', safe(r.first_aid || '원본 MSDS 4항을 확인하세요'))}
    ${detailRow('사고 시 대처방법', safe(r.emergency_response || '원본 MSDS 5·6항을 확인하세요'))}
    ${providerLabel ? detailRow('최근 분석 AI', `${escapeHtml(providerLabel)} · ${safe(r.analysis_model)}`) : ''}
    <section class="regulatory-section"><div class="regulatory-section-title"><span>CAS별 물질명·함유량</span><small>MSDS 3항 기준</small></div>${componentHtml}</section>
    <section class="regulatory-section"><div class="regulatory-section-title"><span>위험물안전관리법</span><small>제n류·인화성·세부 종류</small></div>${dangerousHtml}</section>
    <section class="regulatory-section"><div class="regulatory-section-title"><span>산업안전보건법</span><small>문서 근거와 현장조건 구분</small></div><div class="regulatory-grid">${occupationalHtml}</div></section>
    <section class="regulatory-section"><div class="regulatory-section-title"><span>화평법·화관법</span><small>유독·제한·금지·사고대비</small></div><div class="regulatory-grid">${chemicalHtml}</div></section>
    <div class="regulatory-caution">AI 분석은 MSDS 문서의 업무 보조 결과입니다. <b>조건부</b> 항목은 취급량·공정·용도 등 현장 조건과 최신 법령을 함께 확인하세요.</div>
    <section class="regulatory-section"><div class="regulatory-section-title"><span>개정 이력</span></div>${hist}</section>`;
  const fb = document.getElementById('detailViewFileBtn');
  fb.style.display = r.has_pdf ? 'inline-flex' : 'none';
  fb.onclick = () => {
    closeModal('msdsDetailModal');
    viewFile(r.id);
  };
  document.getElementById('detailDeleteBtn').onclick = () => {
    closeModal('msdsDetailModal');
    deleteMsdsRecord(id);
  };
  openModal('msdsDetailModal');
};

window.editMsdsRecord = function () {
  closeModal('msdsDetailModal');
  startMsdsEdit(currentDetailId);
};

const REANALYSIS_FIELDS = [
  ['product_name', '제품명', 'productName'],
  ['supplier', '공급업체', 'supplier'],
  ['supplier_contact', '공급업체 연락처', 'supplierContact'],
  ['cas_no', 'CAS No.', 'casNo'],
  ['components', '구성성분', 'components'],
  ['signal_word', '신호어', 'signalWord'],
  ['h_codes', 'H코드', 'hCodes'],
  ['p_codes', 'P코드', 'pCodes'],
  ['pictograms', 'GHS 그림문자', 'pictograms'],
  ['issue_date', 'MSDS 개정일', 'issueDate'],
  ['protective_equipment', '적절한 보호구', 'protectiveEquipment'],
  ['handling_precautions', '취급상의 주의사항', 'handlingPrecautions'],
  ['first_aid', '응급조치 요령', 'firstAid'],
  ['emergency_response', '사고 시 대처방법', 'emergencyResponse'],
  ['submission_no', 'MSDS 제출번호', 'submissionNo'],
  ['legal_measurement', '작업환경측정 대상', 'legalMeasurement'],
  ['legal_exam', '특수건강진단 대상', 'legalExam'],
  ['legal_exam_cycle', '특수검진 주기', 'legalExamCycle'],
  ['legal_manage', '관리대상 유해물질', 'legalManage'],
  ['legal_permit', '허가대상 유해물질', 'legalPermit'],
  ['legal_special', '특별관리물질', 'legalSpecial'],
  ['legal_dangerous', '위험물 규제', 'legalDangerous'],
];

const REANALYSIS_DETAIL_FIELDS = [
  ['component_details', 'CAS별 물질·함유량'],
  ['dangerous_goods_details', '위험물 상세 분류'],
  ['occupational_safety_details', '산업안전보건법 상세 판정'],
  ['chemical_regulation_details', '화평법·화관법 상세 판정'],
];

function summarizeStructuredAnalysis(dbKey, value) {
  if (dbKey === 'component_details') {
    const items = Array.isArray(value) ? value : [];
    return items.length
      ? items
          .map(
            (item) =>
              `${item.substanceName || '물질명 없음'} (${item.casNo || 'CAS 없음'}): ${item.minContent || '내용없음'}~${item.maxContent || '내용없음'}${item.unit || ''}`,
          )
          .join('\n')
      : '내용없음';
  }
  const entries =
    value && typeof value === 'object' ? Object.entries(value) : [];
  if (!entries.length) return '내용없음';
  return entries
    .map(([key, item]) => {
      if (item && typeof item === 'object' && !Array.isArray(item))
        return `${key}: ${item.status || item.detail || '내용없음'}`;
      return `${key}: ${item || '내용없음'}`;
    })
    .join('\n');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

window.reanalyzeCurrentMsds = function () {
  if (currentDetailId) reanalyzeMsds(currentDetailId);
};

window.reanalyzeMsds = async function (id) {
  const record = msdsRecords.find((item) => item.id === id);
  if (!record?.has_pdf || !record.pdf_path) {
    toast('재분석할 원본 파일이 없습니다. 먼저 파일을 등록해주세요.', 'error');
    return;
  }
  const detailBtn = document.getElementById('msdsReanalyzeBtn');
  if (detailBtn) {
    detailBtn.disabled = true;
    detailBtn.textContent = '⏳ 원본 분석 중...';
  }
  toast('원본 MSDS를 다시 분석하고 있습니다.', 'info');
  try {
    let parsed;
    if (getDevPreviewPage()) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      parsed = {
        productName: record.product_name,
        supplier: record.supplier,
        supplierContact: record.supplier_contact,
        casNo: record.cas_no || '108-88-3',
        components: record.components || '톨루엔(108-88-3) 25%',
        signalWord: record.signal_word,
        hCodes: record.h_codes,
        pCodes: record.p_codes,
        pictograms: record.pictograms,
        issueDate: record.issue_date || '2026-08-01',
        protectiveEquipment: record.protective_equipment,
        submissionNo: 'AA-2026-123456',
        submissionNoValid: 'Y',
        legalMeasurement: 'Y',
        legalExam: 'Y',
        legalExamCycle: '배치후 1차: 6개월, 이후: 12개월',
        legalManage: 'Y',
        legalPermit: 'N',
        legalSpecial: record.legal_special || 'N',
        legalDangerous: 'N',
        componentDetails: [
          {
            casNo: '108-88-3',
            substanceName: '톨루엔',
            minContent: '20',
            maxContent: '30',
            unit: '%',
            basis: '3항 구성성분',
          },
        ],
        dangerousGoods: {
          status: '해당',
          classNo: '제4류',
          flammableLiquid: {
            status: '해당',
            detail: '인화성액체',
            basis: '9항 및 15항',
          },
          category: '제1석유류',
          waterSolubility: '비수용성액체',
          designatedQuantity: '200 L',
          detail: '제4류 제1석유류',
          basis: '15항',
        },
        occupationalSafety: {
          managementTarget: {
            status: '해당',
            detail: '관리대상 유해물질',
            basis: '15항',
          },
          specialManagement: { status: '내용없음', detail: '', basis: '' },
          workEnvironmentMeasurement: {
            status: '해당',
            detail: '작업환경측정 대상',
            basis: '15항',
          },
          exposureLimit: { status: '해당', detail: 'TWA 50 ppm', basis: '8항' },
          permissibleLimit: { status: '내용없음', detail: '', basis: '' },
          localExhaustInspection: {
            status: '조건부',
            detail: '밀폐설비·국소배기 설치 및 점검 여부는 공정 확인 필요',
            basis: '현장 조건 필요',
          },
          specialHealthExam: {
            status: '해당',
            detail: '특수건강진단 대상, 12개월',
            basis: '15항',
          },
          permitTarget: { status: '해당없음', detail: '', basis: '15항' },
          prohibitedTarget: { status: '해당없음', detail: '', basis: '15항' },
          psm: {
            status: '조건부',
            detail: '취급량과 공정 확인 필요',
            basis: '현장 조건 필요',
          },
        },
        chemicalRegulation: {
          toxic: { status: '해당', detail: '유독물질', basis: '15항' },
          restricted: { status: '해당없음', detail: '', basis: '15항' },
          prohibited: { status: '해당없음', detail: '', basis: '15항' },
          accidentPreparedness: {
            status: '조건부',
            detail: '함유량 기준 확인 필요',
            basis: '15항',
          },
        },
        analysisProvider: 'gemini',
        analysisModel: 'gemini-2.5-flash',
      };
    } else {
      const { data: blob, error: downloadError } = await supabase.storage
        .from('msds-pdfs')
        .download(record.pdf_path);
      if (downloadError || !blob)
        throw new Error(
          downloadError?.message || '원본 파일을 내려받지 못했습니다.',
        );
      parsed = await callParseFunction(
        await blobToBase64(blob),
        blob.type ||
          (record.pdf_name?.toLowerCase().endsWith('.pdf')
            ? 'application/pdf'
            : 'image/jpeg'),
        { forceReanalysis: true },
      );
    }
    const updates = {};
    const changes = [];
    for (const [dbKey, label, parsedKey] of REANALYSIS_FIELDS) {
      let next = parsed[parsedKey] ?? '';
      if (dbKey === 'submission_no') next = String(next).trim();
      const before = record[dbKey] ?? '';
      updates[dbKey] = next;
      if (String(before).trim() !== String(next).trim())
        changes.push({ dbKey, label, before, next });
    }
    const structured = structuredMsdsFields(parsed);
    for (const [dbKey, label] of REANALYSIS_DETAIL_FIELDS) {
      const before = record[dbKey] ?? (dbKey === 'component_details' ? [] : {});
      const next = structured[dbKey];
      updates[dbKey] = next;
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        changes.push({
          dbKey,
          label,
          before: summarizeStructuredAnalysis(dbKey, before),
          next: summarizeStructuredAnalysis(dbKey, next),
        });
      }
    }
    updates.analysis_provider = structured.analysis_provider;
    updates.analysis_model = structured.analysis_model;
    updates.submission_no_valid = parsed.submissionNoValid || 'N';
    updates.special = parsed.legalSpecial === 'Y' ? 'Y_special' : 'N';
    pendingMsdsReanalysis = { id, record, updates, changes };
    document.getElementById('msdsReanalysisSummary').innerHTML = changes.length
      ? `<b>${escapeHtml(record.product_name)}</b>에서 <strong>${changes.length}개 항목</strong>의 차이를 찾았습니다. 확인 후 반영하세요.`
      : `<b>${escapeHtml(record.product_name)}</b>의 기존 정보와 새 분석 결과가 같습니다.`;
    document.getElementById('msdsReanalysisCompare').innerHTML = changes.length
      ? changes
          .map(
            (change) => `
      <div class="reanalyze-row">
        <div class="reanalyze-label">${escapeHtml(change.label)}</div>
        <div class="reanalyze-values">
          <div><span>기존</span><p>${escapeHtml(change.before || '없음')}</p></div>
          <div class="reanalyze-next"><span>새 분석</span><p>${escapeHtml(change.next || '없음')}</p></div>
        </div>
      </div>`,
          )
          .join('')
      : '<div class="mp-empty">변경할 항목이 없습니다.</div>';
    document.getElementById('applyMsdsReanalysisBtn').disabled =
      changes.length === 0;
    closeModal('msdsDetailModal');
    openModal('msdsReanalysisModal');
  } catch (error) {
    handleAiError(error);
  } finally {
    if (detailBtn) {
      detailBtn.disabled = false;
      detailBtn.textContent = '✨ 원본 다시 분석';
    }
  }
};

window.cancelMsdsReanalysis = function () {
  pendingMsdsReanalysis = null;
  closeModal('msdsReanalysisModal');
};

window.applyMsdsReanalysis = async function () {
  if (!pendingMsdsReanalysis) return;
  const { id, record, updates, changes } = pendingMsdsReanalysis;
  const button = document.getElementById('applyMsdsReanalysisBtn');
  button.disabled = true;
  button.textContent = '반영 중...';
  try {
    const nextVersion = (record.version || 1) + 1;
    const history = [
      ...(record.history || []),
      {
        version: record.version || 1,
        date: new Date().toISOString().slice(0, 10),
        note: `원본 AI 재분석 (${changes.length}개 항목 변경)`,
      },
    ];
    const { error } = await supabase
      .from('msds_records')
      .update({
        ...updates,
        version: nextVersion,
        history,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
    cancelMsdsReanalysis();
    await loadMsdsRecords();
    showMsdsDetail(id);
    toast(`재분석 결과를 반영했습니다 (v${nextVersion})`, 'success');
  } catch (error) {
    toast('재분석 결과 반영 실패: ' + error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '변경사항 반영';
  }
};

// ─── MSDS 대장 상세 → 경고표지 탭으로 이동, 해당 물질 선택 상태로 진입 ───
let msdsWarningTrigger = null;

window.openMsdsWarning = function(id, trigger) {
  const record = msdsRecords.find(r => r.id === id);
  if (!record) return;
  msdsWarningTrigger = trigger || null;
  document.getElementById('msdsWarningTitle').textContent = `${record.product_name} · 경고표지`;
  document.getElementById('msdsWarningPreview').innerHTML = buildWarnLabel(record, currentWS?.name || '현장명', 'a4');
  document.getElementById('msdsWarningPrintBtn').onclick = () => {
    const previousSize = warnLabelSize;
    try {
      warnLabelSize = 'a4';
      printSingleWarning(id);
    } finally {
      warnLabelSize = previousSize;
    }
  };
  document.getElementById('msdsWarningPageBtn').onclick = () => {
    closeModal('msdsWarningModal');
    warnPreviewSingle = id;
    showPage('warning');
  };
  document.getElementById('msdsWarningModal').onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMsdsWarning();
    }
    if (event.key === 'Tab') {
      const buttons = event.currentTarget.querySelectorAll('button:not([disabled])');
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  };
  openModal('msdsWarningModal');
  document.getElementById('msdsWarningCloseBtn').focus();
};

window.closeMsdsWarning = function() {
  closeModal('msdsWarningModal');
  msdsWarningTrigger?.focus();
};

window.printWarningFromDetail = function () {
  if (!currentDetailId) return;
  warnSelected.add(currentDetailId);
  warnPreviewSingle = null;
  closeModal('msdsDetailModal');
  showPage('warning');
};

// ─── 새 MSDS 파일로 갱신 (기존 레코드를 AI 재분석 결과로 버전업) ───
window.openMsdsRenewPicker = function () {
  if (!currentDetailId) return;
  document.getElementById('msdsRenewFileInput').value = '';
  document.getElementById('msdsRenewFileInput').click();
};

window.handleMsdsRenewFile = async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const recId = currentDetailId;
  const old = msdsRecords.find((r) => r.id === recId);
  if (!old) {
    toast('대상 MSDS를 찾을 수 없습니다', 'error');
    return;
  }

  const btn = document.getElementById('msdsRenewBtn');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ 분석 중...';
  }

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const parsed = await callParseFunction(base64, file.type);

    const nv = (old.version || 1) + 1;
    const history = [
      ...(old.history || []),
      {
        version: old.version || 1,
        date: (old.updated_at || old.created_at || '').split('T')[0],
        note: '새 MSDS 파일로 갱신',
      },
    ];

    const updateFields = {
      product_name: parsed.productName || old.product_name,
      supplier: parsed.supplier || old.supplier,
      supplier_contact: parsed.supplierContact || old.supplier_contact,
      cas_no: parsed.casNo || '',
      components: parsed.components || '',
      signal_word: parsed.signalWord || '',
      h_codes: parsed.hCodes || '',
      p_codes: parsed.pCodes || '',
      pictograms: parsed.pictograms || '',
      issue_date: parsed.issueDate || '',
      protective_equipment: parsed.protectiveEquipment || '',
      handling_precautions: parsed.handlingPrecautions || '',
      first_aid: parsed.firstAid || '',
      emergency_response: parsed.emergencyResponse || '',
      legal_measurement: parsed.legalMeasurement || 'N',
      legal_exam: parsed.legalExam || 'N',
      legal_exam_cycle: parsed.legalExamCycle || '',
      legal_manage: parsed.legalManage || 'N',
      legal_permit: parsed.legalPermit || 'N',
      legal_special: parsed.legalSpecial || 'N',
      legal_dangerous: parsed.legalDangerous || 'N',
      special: parsed.legalSpecial === 'Y' ? 'Y_special' : 'N',
      submission_no: parsed.submissionNo || '',
      submission_no_valid: parsed.submissionNoValid || 'N',
      ...structuredMsdsFields(parsed),
      version: nv,
      history,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('msds_records')
      .update(updateFields)
      .eq('id', recId);
    if (error) throw error;

    await uploadMsdsFile(recId, file.name, base64, file.type);
    await loadMsdsRecords();

    const updated = msdsRecords.find((r) => r.id === recId);
    if (updated) showMsdsDetail(recId); // 상세 화면 새로고침
    toast(
      `새 MSDS로 갱신됐습니다 (v${nv})${parsed.submissionNoValid === 'N' ? ' — 제출번호 확인 필요' : ''}`,
      parsed.submissionNoValid === 'N' ? 'warn' : 'success',
    );
  } catch (err) {
    console.error(err);
    toast('갱신 실패: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
    e.target.value = '';
  }
};

// ─── 파일만 교체 (AI 재분석·필드 변경 없이 첨부 PDF만 바꿔치기) ───
window.openMsdsFileReplacePicker = function () {
  if (!currentDetailId) return;
  document.getElementById('msdsFileReplaceInput').value = '';
  document.getElementById('msdsFileReplaceInput').click();
};

window.handleMsdsFileReplace = async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const recId = currentDetailId;
  const old = msdsRecords.find((r) => r.id === recId);
  if (!old) {
    toast('대상 MSDS를 찾을 수 없습니다', 'error');
    return;
  }
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const nv = (old.version || 1) + 1;
    const history = [
      ...(old.history || []),
      {
        version: old.version || 1,
        date: (old.updated_at || old.created_at || '').split('T')[0],
        note: '파일만 교체 (필드 변경 없음)',
      },
    ];
    const { error } = await supabase
      .from('msds_records')
      .update({ version: nv, history, updated_at: new Date().toISOString() })
      .eq('id', recId);
    if (error) throw error;
    await uploadMsdsFile(recId, file.name, base64, file.type);
    await loadMsdsRecords();
    showMsdsDetail(recId);
    toast(`파일이 교체됐습니다 (v${nv}, 나머지 필드는 유지)`, 'success');
  } catch (err) {
    console.error(err);
    toast('파일 교체 실패: ' + err.message, 'error');
  } finally {
    e.target.value = '';
  }
};

window.startMsdsEdit = function (id) {
  const r = msdsRecords.find((x) => x.id === id);
  if (!r) return;
  editingMsdsId = id;
  document.getElementById('msdsRegisterTitle').textContent =
    `MSDS 수정 (v${r.version} → v${(r.version || 1) + 1})`;
  switchMsdsTab('manual');
  populateContractorSelects();
  setTimeout(() => {
    const setV = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v || '';
    };
    const setC = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.checked = v === 'Y';
    };
    setV('f_productName', r.product_name);
    setV('f_supplier', r.supplier);
    setV('f_supplierContact', r.supplier_contact);
    const con = contractors.find((c) => c.name === r.contractor);
    setV('f_contractor', con?.id || '');
    setTimeout(() => {
      updateManualWorkTypes();
      setTimeout(() => setV('f_workType', r.work_type), 50);
    }, 50);
    setV('f_casNo', r.cas_no);
    setV('f_components', r.components);
    setV('f_signalWord', r.signal_word);
    setV('f_hCodes', r.h_codes);
    setV('f_pCodes', r.p_codes);
    setV('f_pictograms', r.pictograms);
    setV('f_handlingPrecautions', r.handling_precautions);
    setV('f_firstAid', r.first_aid);
    setV('f_emergencyResponse', r.emergency_response);
    setV('f_issueDate', r.issue_date);
    setV('f_protectiveEquipment', r.protective_equipment);
    setV('f_legalExamCycle', r.legal_exam_cycle);
    setC('f_legal_measurement', r.legal_measurement);
    setC('f_legal_exam', r.legal_exam);
    setC('f_legal_manage', r.legal_manage);
    setC('f_legal_permit', r.legal_permit);
    setC('f_legal_special', r.legal_special);
    setC('f_legal_dangerous', r.legal_dangerous);
  }, 100);
  openModal('msdsRegisterModal');
};

window.deleteMsdsRecord = async function (id) {
  const r = msdsRecords.find((x) => x.id === id);
  if (!confirm(`"${r?.product_name || '이 항목'}"을 삭제하시겠습니까?`)) return;
  if (r?.has_pdf && r?.pdf_path)
    await supabase.storage.from('msds-pdfs').remove([r.pdf_path]);
  await supabase.from('msds_records').delete().eq('id', id);
  await loadMsdsRecords();
  toast('삭제됐습니다');
};

// ═══════════════════════════════════════════════
// Status / Receipt
// ═══════════════════════════════════════════════
window.toggleMsdsStatus = async function (id) {
  const r = msdsRecords.find((x) => x.id === id);
  if (!r) return;
  const newSt = (r.status || 'active') === 'active' ? 'ended' : 'active';
  await supabase.from('msds_records').update({ status: newSt }).eq('id', id);
  r.status = newSt;
  renderMsdsTable();
  updateStats();
  toast(
    newSt === 'active' ? '사용중으로 변경됐습니다' : '사용종료로 변경됐습니다',
  );
};

window.openReceipt = function (id) {
  const r = msdsRecords.find((x) => x.id === id);
  if (!r) return;
  receiptEditId = id;
  const recv = msdsReceived(r);
  document.getElementById('receiptBody').innerHTML = `
    <div style="font-size:13px;color:var(--text2);margin-bottom:16px;"><strong>${r.product_name}</strong> · ${r.contractor}</div>
    <div class="form-field" style="margin-bottom:12px;"><label class="form-label">수령 상태</label>
      <select class="form-input" id="rc_status"><option value="received" ${recv ? 'selected' : ''}>✓ 수령 완료</option><option value="pending" ${!recv ? 'selected' : ''}>! 미수령</option></select></div>
    <div class="form-field" style="margin-bottom:12px;"><label class="form-label">수령일</label><input class="form-input" type="date" id="rc_date" value="${r.receipt_date || ''}"></div>
    <div class="form-field" style="margin-bottom:12px;"><label class="form-label">담당자</label><input class="form-input" id="rc_manager" value="${r.receipt_manager || ''}" placeholder="예) 김OO 과장"></div>
    <div class="form-field"><label class="form-label">비고</label><input class="form-input" id="rc_note" value="${r.receipt_note || ''}"></div>`;
  openModal('receiptModal');
};

window.saveReceipt = async function () {
  const upd = {
    receipt_status: document.getElementById('rc_status').value,
    receipt_date: document.getElementById('rc_date').value,
    receipt_manager: document.getElementById('rc_manager').value,
    receipt_note: document.getElementById('rc_note').value,
  };
  await supabase.from('msds_records').update(upd).eq('id', receiptEditId);
  Object.assign(msdsRecords.find((r) => r.id === receiptEditId) || {}, upd);
  closeModal('receiptModal');
  renderMsdsTable();
  updateStats();
  renderHomeDashboard();
  toast('수령 정보가 저장됐습니다', 'success');
};

// ═══════════════════════════════════════════════
// File Viewer
// ═══════════════════════════════════════════════
window.viewFile = async function (id) {
  const r = msdsRecords.find((x) => x.id === id);
  if (!r?.pdf_path) {
    toast('원본 파일이 없습니다', 'error');
    return;
  }
  const { data, error } = await supabase.storage
    .from('msds-pdfs')
    .createSignedUrl(r.pdf_path, 3600);
  if (error) {
    toast('파일 로드 실패', 'error');
    return;
  }
  const url = data.signedUrl;
  const isImg = /\.(jpg|jpeg|png|webp)$/i.test(r.pdf_path);
  const frame = document.getElementById('fileViewerFrame');
  const img = document.getElementById('fileViewerImg');
  if (isImg) {
    frame.style.display = 'none';
    img.style.display = 'block';
    img.src = url;
  } else {
    img.style.display = 'none';
    frame.style.display = 'block';
    frame.src = url;
  }
  document.getElementById('fileViewerTitle').textContent = r.product_name;
  document.getElementById('fileDownloadBtn').onclick = () =>
    window.open(url, '_blank');
  openModal('fileViewerModal');
};

window.closeFileViewer = function () {
  closeModal('fileViewerModal');
  document.getElementById('fileViewerFrame').src = '';
  document.getElementById('fileViewerImg').src = '';
};

// ═══════════════════════════════════════════════
// Warning Labels
// ═══════════════════════════════════════════════
function populateWarnContractorFilter() {
  const sel = document.getElementById('warnFilterContractor');
  if (!sel) return;
  const cur = sel.value;
  const q = (document.getElementById('warnFilterContractorSearch')?.value || '')
    .trim()
    .toLowerCase();
  const sorted = [...contractors]
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  sel.innerHTML =
    `<option value="">${q ? `검색결과 ${sorted.length}건 (전체 보기)` : '전체 협력사'}</option>` +
    sorted.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
  sel.value = sorted.some((c) => c.name === cur) ? cur : '';
}

function getFilteredWarnRecords() {
  const q = (document.getElementById('warnSearchInput')?.value || '')
    .trim()
    .toLowerCase();
  const fCon = document.getElementById('warnFilterContractor')?.value || '';
  return msdsRecords.filter((r) => {
    const mq =
      !q ||
      [r.product_name, r.cas_no, r.supplier, r.contractor, r.work_type]
        .join(' ')
        .toLowerCase()
        .includes(q);
    const mc = !fCon || r.contractor === fCon;
    return mq && mc;
  });
}

let warnPickView = 'all';
let warnPreviewZoom = 'read';

window.setWarnPickView = function(view) {
  warnPickView = view === 'selected' ? 'selected' : 'all';
  renderWarnPickList();
};

function visibleWarnRecords() {
  return getFilteredWarnRecords().filter(r => warnPickView !== 'selected' || warnSelected.has(r.id));
}

function updateWarnWorkbench() {
  const count = warnSelected.size;
  const cfg = WARN_SIZES[warnLabelSize];
  const sheets = Math.ceil(count * warnCopies / cfg.perPage);
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('warnAllCount', msdsRecords.length);
  setText('warnSelectedCount', count);
  setText('warnPrintSummary', count ? `${count}개 물질 · 표지 ${count * warnCopies}매 · A4 ${sheets}장` : '인쇄할 물질을 선택하세요');
  setText('warnPrintScope', count ? '검색 조건과 관계없이 인쇄 선택한 물질을 모두 출력합니다.' : '체크박스로 선택한 물질만 인쇄됩니다.');
  setText('warnPrintButtonLabel', count ? `선택한 ${count}개 물질 인쇄` : '선택한 물질 인쇄');
  const printBtn = document.getElementById('warnPrintSelectedBtn');
  if (printBtn) printBtn.disabled = !count;
  ['all','selected'].forEach(view => {
    const tab = document.getElementById(view === 'all' ? 'warnTabAll' : 'warnTabSelected');
    if (tab) { tab.classList.toggle('active', warnPickView === view); tab.setAttribute('aria-pressed', String(warnPickView === view)); }
  });
  const records = visibleWarnRecords();
  const checked = records.filter(r => warnSelected.has(r.id)).length;
  const master = document.getElementById('warnCheckVisible');
  if (master) {
    master.checked = records.length > 0 && checked === records.length;
    master.indeterminate = checked > 0 && checked < records.length;
    master.disabled = !records.length;
  }
}

function renderWarnPickList() {
  const el = document.getElementById('warnPickList');
  if (!el) return;
  populateWarnContractorFilter();
  const records = visibleWarnRecords();
  const scroll = el.scrollTop;
  const count = document.getElementById('warnPickCountLabel');
  if (count) count.textContent = `${records.length}개 물질${warnPickView === 'selected' ? ' · 인쇄 선택 목록' : ' · 검색 결과'}`;
  el.innerHTML = records.map(r => {
    const selected = warnSelected.has(r.id);
    const previewing = warnPreviewSingle === r.id;
    return `<div class="warn-pick-item ${selected ? 'selected' : ''} ${previewing ? 'previewing' : ''}">
      <input type="checkbox" class="warn-check" value="${r.id}" onchange="onWarnCheck('${r.id}',this.checked)" ${selected ? 'checked' : ''} aria-label="${escapeHtml(r.product_name)} 인쇄 선택">
      <button type="button" class="warn-pick-preview" onclick="warnPreviewOne('${r.id}')" aria-label="${escapeHtml(r.product_name)} 미리보기" ${previewing ? 'aria-current="true"' : ''}>
        <span class="wb-row-top"><span class="wp-name">${escapeHtml(r.product_name)}</span>${previewing ? '<span class="wb-viewing-badge">미리보기</span>' : selected ? '<span class="wb-selected-dot" aria-label="선택됨">✓</span>' : ''}</span>
        <span class="wp-sub">${escapeHtml(r.contractor)}${r.supplier ? ' · '+escapeHtml(r.supplier) : ''}</span>
        <span class="wp-cas" title="${escapeHtml(r.cas_no || '')}">${r.cas_no ? 'CAS '+escapeHtml(r.cas_no) : 'CAS 번호 미등록'}</span>
      </button>
    </div>`;
  }).join('') || `<div class="wb-list-empty">${warnPickView === 'selected' && !warnSelected.size ? '아직 선택한 물질이 없습니다.<br>전체 물질에서 체크박스를 눌러주세요.' : '검색 결과가 없습니다.<br>물질명이나 협력사를 다시 확인해주세요.'}</div>`;
  el.scrollTop = scroll;
  updateWarnWorkbench();
}
window.renderWarnPickList = renderWarnPickList;

window.onWarnCheck = function(id, checked) {
  if (checked) { warnSelected.add(id); warnPreviewSingle = id; }
  else warnSelected.delete(id);
  renderWarnPickList();
  updateWarningPreview();
};

window.selectAllWarn = function(selected) {
  const records = visibleWarnRecords();
  records.forEach(r => selected ? warnSelected.add(r.id) : warnSelected.delete(r.id));
  if (selected && !warnPreviewSingle && records.length) warnPreviewSingle = records[0].id;
  renderWarnPickList();
  updateWarningPreview();
};

let warnPreviewSingle = null; // 단일 미리보기 중인 레코드 id (선택과 무관)

window.setWarnPreviewZoom = function(mode) {
  warnPreviewZoom = mode === 'read' ? 'read' : 'fit';
  layoutWarnPreview();
};

function layoutWarnPreview() {
  const viewport = document.getElementById('warningPreview');
  const sheet = viewport?.querySelector('.wb-canvas-sheet');
  const stage = viewport?.querySelector('.wb-sheet-stage');
  ['fit','read'].forEach(mode => {
    const button = document.getElementById(mode === 'fit' ? 'warnZoomFit' : 'warnZoomRead');
    if (button) { button.classList.toggle('active', warnPreviewZoom === mode); button.setAttribute('aria-pressed', String(warnPreviewZoom === mode)); }
  });
  if (!sheet || !stage) return;
  const width = sheet.offsetWidth;
  const height = sheet.offsetHeight;
  const availableWidth = Math.max(180, viewport.clientWidth - 48);
  const availableHeight = Math.max(200, viewport.clientHeight - 48);
  const scale = Math.min(1, availableWidth / width, warnPreviewZoom === 'fit' ? availableHeight / height : 1);
  stage.style.width = `${width * scale}px`;
  stage.style.height = `${height * scale}px`;
  sheet.style.transform = `scale(${scale})`;
  viewport.scrollTo(0, 0);
}
window.addEventListener('resize', () => {
  if (document.getElementById('page-warning')?.classList.contains('active')) layoutWarnPreview();
});

window.updateWarningPreview = function() {
  const prev = document.getElementById('warningPreview');
  if (!prev) return;
  updateWarnWorkbench();
  const record = msdsRecords.find(r => r.id === warnPreviewSingle) || msdsRecords.find(r => warnSelected.has(r.id));
  const header = document.getElementById('warnPreviewHeader');
  const state = document.getElementById('warnPreviewState');
  if (!record) {
    if (header) header.textContent = '물질을 선택하세요';
    if (state) state.textContent = '';
    prev.innerHTML = '<div class="warn-empty"><div class="wb-empty-paper">▤</div><strong>어떤 경고표지를 만들까요?</strong><p>왼쪽에서 물질 이름을 누르면 표지를 확인할 수 있습니다.<br>인쇄할 물질은 체크박스로 선택해주세요.</p></div>';
    return;
  }
  warnPreviewSingle = record.id;
  const safetyInfo = labelSafetySections(record, decodePCodes(record.p_codes));
  const dataNote = document.getElementById('warnPreviewDataNote');
  if (dataNote) {
    dataNote.textContent = safetyInfo.missing.length ? `미등록 정보: ${safetyInfo.missing.join(' · ')}` : '등록된 MSDS의 취급·응급조치·보호구 정보를 표시합니다.';
    dataNote.classList.toggle('has-missing', Boolean(safetyInfo.missing.length));
  }
  if (header) header.textContent = record.product_name;
  if (state) {
    state.textContent = warnSelected.has(record.id) ? '✓ 인쇄 선택됨' : '미선택 · 인쇄에 포함되지 않음';
    state.className = warnSelected.has(record.id) ? 'is-selected' : '';
  }
  const site = document.getElementById('warningSite')?.value || currentWS?.name || '현장명';
  prev.innerHTML = `<div class="wb-sheet-stage"><div class="wb-canvas-sheet" style="width:${warnLabelSize === 'a6' || warnLabelSize === 'mini' ? 350 : 714}px">${buildWarnLabel(record, site)}</div></div>`;
  requestAnimationFrame(() => { fitWarningLabels(prev); layoutWarnPreview(); });
};

window.warnPreviewOne = function (id) {
  warnPreviewSingle = id;
  renderWarnPickList(); // 현재 보는 행 하이라이트
  updateWarningPreview();
};

window.warnShowAllPreview = function () {
  warnPreviewSingle = null;
  renderWarnPickList();
  updateWarningPreview();
};

window.printSingleWarning = function (id) {
  const keep = new Set(warnSelected);
  warnSelected = new Set([id]);
  printWarnings();
  warnSelected = keep;
};

// ── 선택된 물질 패널 (필터와 무관하게 전체 선택 상태 표시) ──
let warnSelPanelOpen = true;

function renderWarnSelPanel() { updateWarnWorkbench(); }

window.toggleWarnSelPanel = function () {
  warnSelPanelOpen = !warnSelPanelOpen;
  renderWarnSelPanel();
};

window.warnRemoveSel = function (id) {
  warnSelected.delete(id);
  renderWarnPickList();
  renderWarnSelPanel();
  updateWarningPreview();
};

window.clearAllWarnSelected = function () {
  if (
    warnSelected.size &&
    !confirm(`선택된 ${warnSelected.size}건을 모두 해제할까요?`)
  )
    return;
  warnSelected.clear();
  renderWarnPickList();
  renderWarnSelPanel();
  updateWarningPreview();
};

// (WARN_SIZES → src/data/constants.js 로 이동)

// QR코드 SVG — 스캔 시 msds-view Edge Function이 원본 PDF로 리다이렉트
function warningRenderer() { return createWarningRenderer({ size: warnLabelSize, qrEnabled: warnQrEnabled, preview: Boolean(getDevPreviewPage()) }); }
function buildWarnLabel(...args) { return warningRenderer().buildWarnLabel(...args); }
function warnLabelCss() { return warningRenderer().warnLabelCss(); }
function fitWarningLabels(...args) { return warningRenderer().fitWarningLabels(...args); }
function warningAutoFitPrintScript() { return warningRenderer().warningAutoFitPrintScript(); }
function warnSheets(...args) { return warningRenderer().warnSheets(...args); }

window.setWarnLabelSize = function (v) {
  warnLabelSize = WARN_SIZES[v] ? v : 'a4';
  updateWarningPreview();
};
window.setWarnCopies = function (v) {
  warnCopies = Math.min(20, Math.max(1, parseInt(v, 10) || 1));
  const inp = document.getElementById('warnCopiesInput');
  if (inp) inp.value = warnCopies;
  updateWarningPreview();
};
// 현재 분할 수에 맞춰 매수를 설정 → 물질 1개로도 A4 한 장이 꽉 참
window.warnFillPage = function () {
  const per = (WARN_SIZES[warnLabelSize] || WARN_SIZES.a4).perPage;
  setWarnCopies(per);
  toast(
    `매수를 ${per}매로 설정 — ${WARN_SIZES[warnLabelSize].name} 한 장이 같은 표지로 채워집니다`,
    'success',
  );
};
window.toggleWarnQr = function (v) {
  warnQrEnabled = !!v;
  updateWarningPreview();
};

// (openPrintWindow, buildPrintHtml → src/lib/ui.js 로 이동)

window.printWarnings = function () {
  const ids = [...warnSelected];
  if (ids.length === 0) {
    toast('인쇄할 물질을 선택하세요', 'error');
    return;
  }
  const site =
    document.getElementById('warningSite')?.value ||
    currentWS?.name ||
    '현장명';
  const records = ids
    .map((id) => msdsRecords.find((r) => r.id === id))
    .filter(Boolean);
  const labels = records.flatMap((r) => {
    const html = buildWarnLabel(r, site);
    return Array.from({ length: warnCopies }, () => html);
  });
  const sheets = warnSheets(labels);
  openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>경고표지</title><style>
    @page{size:A4;margin:0;}
    *{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;}
    ${warnLabelCss()}
  </style></head><body>${sheets.join('')}${warningAutoFitPrintScript()}</body></html>`);
  const cfg = WARN_SIZES[warnLabelSize];
  const copyTxt = warnCopies > 1 ? ` × ${warnCopies}매` : '';
  toast(
    `${records.length}건${copyTxt} · ${cfg.name} · A4 ${sheets.length}장 인쇄 준비 완료`,
    'success',
  );
};

// ═══════════════════════════════════════════════
// 저장된 전체 물질 인쇄 (협력사별 표지 포함, 양면인쇄 대응)
// ═══════════════════════════════════════════════
window.printAllWarningsByContractor = function () {
  if (msdsRecords.length === 0) {
    toast('인쇄할 물질이 없습니다', 'error');
    return;
  }
  const site =
    document.getElementById('warningSite')?.value ||
    currentWS?.name ||
    '현장명';

  const sorted = [...msdsRecords].sort((a, b) => {
    const c = (a.contractor || '').localeCompare(b.contractor || '', 'ko');
    if (c !== 0) return c;
    return (a.product_name || '').localeCompare(b.product_name || '', 'ko');
  });

  // 협력사별로 그룹핑
  const groups = [];
  sorted.forEach((r) => {
    const last = groups[groups.length - 1];
    if (last && last.contractor === r.contractor) last.items.push(r);
    else groups.push({ contractor: r.contractor, items: [r] });
  });

  // 표지가 항상 앞면(홀수 페이지)에 오도록 페이지를 구성.
  // 양면인쇄 시 앞면=홀수 페이지, 뒷면=짝수 페이지이므로,
  // 필요하면 빈 페이지를 하나 끼워서 표지를 홀수 페이지로 맞춘다.
  let pageCount = 0;
  const htmlPages = [];
  groups.forEach((g) => {
    if (pageCount % 2 === 1) {
      // 다음 페이지가 짝수(뒷면)가 되는 상황 → 빈 페이지 하나 삽입해 홀수로 맞춤
      htmlPages.push(`<div class="page-a4 blank-page"></div>`);
      pageCount++;
    }
    htmlPages.push(`<div class="page-a4 cover-page"><div class="cover-inner">
      <div class="cover-label">협력사</div>
      <div class="cover-name">${g.contractor}</div>
      <div class="cover-sub">${site}</div>
    </div></div>`);
    pageCount++;
    const groupLabels = g.items.flatMap((r) => {
      const html = buildWarnLabel(r, site);
      return Array.from({ length: warnCopies }, () => html);
    });
    const sheets = warnSheets(groupLabels);
    sheets.forEach((s) => {
      htmlPages.push(s);
      pageCount++;
    });
  });

  openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>경고표지 전체 인쇄</title><style>
    @page{size:A4;margin:0;}
    *{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;}
    .page-a4{width:210mm;height:297mm;page-break-after:always;display:flex;align-items:flex-start;justify-content:center;}
    .page-a4:last-child{page-break-after:auto;}
    .blank-page{min-height:297mm;}
    .cover-page{align-items:center;justify-content:center;min-height:297mm;}
    .cover-inner{text-align:center;}
    .cover-label{font-size:16px;letter-spacing:6px;color:#888;font-weight:700;margin-bottom:18px;}
    .cover-name{font-size:48px;font-weight:900;color:#111;border:4px solid #111;border-radius:10px;padding:30px 50px;letter-spacing:2px;}
    .cover-sub{font-size:15px;color:#555;margin-top:20px;font-weight:600;}
    ${warnLabelCss()}
  </style></head><body>${htmlPages.join('')}${warningAutoFitPrintScript()}</body></html>`);
  toast(
    `협력사 ${groups.length}곳 · 물질 ${sorted.length}건 · ${WARN_SIZES[warnLabelSize].name} 인쇄 준비 완료 (양면인쇄 설정을 켜주세요)`,
    'success',
  );
};

// ═══════════════════════════════════════════════
// Excel Export
// ═══════════════════════════════════════════════
function splitComponents(r) {
  const comp = r.components || '';
  let parts = comp
    .split(/,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    const cass = (r.cas_no || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return cass.length
      ? cass.map((c) => ({ name: '', cas: c }))
      : [{ name: '', cas: '' }];
  }
  return parts.map((p) => {
    const m = p.match(/\(([\d-]+)\)/);
    return { name: p.replace(/\([\d-]+\)/, '').trim(), cas: m ? m[1] : '' };
  });
}

window.exportMsdsExcel = function () {
  const filtered = getFilteredMsds().sort((a, b) => {
    const conSort = a.contractor.localeCompare(b.contractor, 'ko');
    if (conSort !== 0) return conSort;
    return a.product_name.localeCompare(b.product_name, 'ko');
  });
  if (filtered.length === 0) {
    toast('내보낼 데이터가 없습니다', 'error');
    return;
  }
  const YN = (v) => (v === 'Y' ? 'O' : '');
  const rows = [];
  let no = 0;
  filtered.forEach((r) => {
    no++;
    const comps = splitComponents(r);
    comps.forEach((comp, idx) => {
      rows.push({
        'No.': idx === 0 ? no : '',
        '사용 협력사': idx === 0 ? r.contractor : '',
        '취급 공종': idx === 0 ? r.work_type || '' : '',
        제품명: idx === 0 ? r.product_name : '',
        공급업체: idx === 0 ? r.supplier || '' : '',
        '공급업체 연락처': idx === 0 ? r.supplier_contact || '' : '',
        'MSDS 개정일자': idx === 0 ? r.issue_date || '' : '',
        'CAS No.': comp.cas || '',
        구성성분명: comp.name || '',
        작업환경측정: idx === 0 ? YN(r.legal_measurement) : '',
        '특수검진 주기':
          idx === 0
            ? r.legal_exam === 'Y'
              ? r.legal_exam_cycle || '대상'
              : ''
            : '',
        관리대상유해물질: idx === 0 ? YN(r.legal_manage) : '',
        허가대상유해물질: idx === 0 ? YN(r.legal_permit) : '',
        특별관리물질: idx === 0 ? YN(r.legal_special) : '',
        '위험물 규제': idx === 0 ? YN(r.legal_dangerous) : '',
        '적절한 보호구': idx === 0 ? r.protective_equipment || '' : '',
      });
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 5 },
    { wch: 14 },
    { wch: 10 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 20 },
    { wch: 10 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 9 },
    { wch: 30 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MSDS 관리대장');
  XLSX.writeFile(wb, `MSDS_관리대장_${currentWS.name}_${today()}.xlsx`);
  toast('엑셀 다운로드 완료', 'success');
};

// ═══════════════════════════════════════════════
// Print List
// ═══════════════════════════════════════════════
window.printMsdsList = function () {
  const filtered = getFilteredMsds().sort((a, b) => {
    const conSort = a.contractor.localeCompare(b.contractor, 'ko');
    if (conSort !== 0) return conSort;
    return a.product_name.localeCompare(b.product_name, 'ko'); // 같은 협력사면 제품명순
  });
  if (filtered.length === 0) {
    toast('인쇄할 데이터가 없습니다', 'error');
    return;
  }
  const YN = (v) => (v === 'Y' ? '●' : '');
  const title = `MSDS 관리대장 — ${currentWS.name}`;
  const rows = [];
  let no = 0;
  filtered.forEach((r) => {
    no++;
    const comps = splitComponents(r);
    comps.forEach((comp, idx) => {
      rows.push(`<tr>
        <td class="ctr">${idx === 0 ? no : ''}</td>
        <td>${idx === 0 ? r.contractor : ''}</td>
        <td>${idx === 0 ? r.work_type || '-' : ''}</td>
        <td class="pname">${idx === 0 ? r.product_name : ''}</td>
        <td>${idx === 0 ? r.supplier || '-' : ''}</td>
        <td>${idx === 0 ? r.supplier_contact || '-' : ''}</td>
        <td class="ctr">${idx === 0 ? r.issue_date || '-' : ''}</td>
        <td>${comp.cas || '-'}</td>
        <td style="font-size:8px;">${comp.name || '-'}</td>
        <td class="ctr">${idx === 0 ? YN(r.legal_measurement) : ''}</td>
        <td class="ctr">${idx === 0 ? (r.legal_exam === 'Y' ? r.legal_exam_cycle || '●' : '') : ''}</td>
        <td class="ctr">${idx === 0 ? YN(r.legal_manage) : ''}</td>
        <td class="ctr">${idx === 0 ? YN(r.legal_permit) : ''}</td>
        <td class="ctr">${idx === 0 ? YN(r.legal_special) : ''}</td>
        <td class="ctr">${idx === 0 ? YN(r.legal_dangerous) : ''}</td>
        <td style="font-size:8px;">${idx === 0 ? r.protective_equipment || '-' : ''}</td>
      </tr>`);
    });
  });
  openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
    @page{size:A4 landscape;margin:8mm;}*{box-sizing:border-box;}
    body{margin:0;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#111;}
    .doc-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:6px;border-bottom:3px solid #111;padding-bottom:6px;}
    .legend{font-size:9px;color:#444;margin-bottom:6px;line-height:1.4;}
    table{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed;}
    th{background:#333;color:#fff;padding:4px 3px;text-align:center;border:1px solid #333;}
    td{padding:3px;border:1px solid #ccc;vertical-align:top;word-break:break-all;}
    tr:nth-child(even) td{background:#f7f7f7;}.pname{font-weight:700;}.ctr{text-align:center;}
    thead{display:table-header-group;}
  </style></head><body>
  <div class="doc-head"><div style="font-size:16px;font-weight:800;">${title}</div><div style="font-size:10px;color:#555;">총 ${filtered.length}건 · ${today()}</div></div>
  <div class="legend"><b>범례</b> ● = 해당 · 측정=작업환경측정 · 특수검진=특수건강진단(주기) · 관리=관리대상 · 허가=허가대상 · 특별=특별관리물질(CMR) · 위험=위험물</div>
  <table>
    <thead><tr><th>No</th><th>협력사</th><th>공종</th><th>제품명</th><th>공급업체</th><th>연락처</th><th>개정일</th><th>CAS No.</th><th>구성성분명</th><th>측정</th><th>특수검진</th><th>관리</th><th>허가</th><th>특별</th><th>위험</th><th>보호구</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </body></html>`);
};

// ═══════════════════════════════════════════════
// Package
// ═══════════════════════════════════════════════
let packageSelectedContractors = new Set();

window.openPackageModal = function (selectAll = false) {
  document.getElementById('pkgContractorSearch').value = '';
  const fc = window.selectedContractor || '';
  packageSelectedContractors = selectAll
    ? new Set(packageContractorNames())
    : new Set(fc ? [fc] : []);
  renderPackageContractors();
  openModal('packageModal');
};

function packageContractorNames() {
  return [
    ...new Set(
      msdsRecords.map((r) => (r.contractor || '').trim()).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ko'));
}

function selectedPackageContractors() {
  return [...packageSelectedContractors];
}

window.renderPackageContractors = function () {
  const listEl = document.getElementById('pkgContractorList');
  const query = document
    .getElementById('pkgContractorSearch')
    .value.trim()
    .toLowerCase();
  const names = packageContractorNames().filter(
    (name) => !query || name.toLowerCase().includes(query),
  );
  listEl.innerHTML =
    names
      .map((name) => {
        const items = msdsRecords.filter((r) => r.contractor === name);
        const withPdf = items.filter((r) => r.has_pdf && r.pdf_path).length;
        return `<label style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:6px;cursor:pointer;">
      <input type="checkbox" class="pkg-contractor-check" value="${escapeHtml(name)}" ${packageSelectedContractors.has(name) ? 'checked' : ''} onchange="setPackageContractorSelected(this.value,this.checked)">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${escapeHtml(name)}</div>
        <div style="font-size:11px;color:var(--text3);">물질 ${items.length}건 · 원본 파일 ${withPdf}건</div>
      </div>
    </label>`;
      })
      .join('') ||
    '<div style="padding:14px;text-align:center;color:var(--text3);font-size:13px;">검색 결과가 없습니다</div>';
  updatePkgCount();
};

window.setPackageContractorSelected = function (name, checked) {
  if (checked) packageSelectedContractors.add(name);
  else packageSelectedContractors.delete(name);
  updatePkgCount();
};

window.toggleAllPackageContractors = function (checked) {
  packageSelectedContractors = checked
    ? new Set(packageContractorNames())
    : new Set();
  renderPackageContractors();
};

function pkgTargets() {
  const selected = selectedPackageContractors();
  const st = document.getElementById('pkgStatus').value;
  if (!selected.length) return [];
  return msdsRecords.filter(
    (r) =>
      selected.includes(r.contractor) && (!st || (r.status || 'active') === st),
  );
}

window.updatePkgCount = function () {
  const t = pkgTargets();
  const el = document.getElementById('pkgCount');
  const selected = selectedPackageContractors();
  const allNames = packageContractorNames();
  const selectAll = document.getElementById('pkgSelectAll');
  selectAll.checked =
    allNames.length > 0 &&
    allNames.every((name) => packageSelectedContractors.has(name));
  selectAll.indeterminate = selected.length > 0 && !selectAll.checked;
  if (!selected.length) {
    el.textContent = '';
    return;
  }
  el.textContent = `협력사 ${selected.length}곳 · 물질 ${t.length}건 (원본 파일 ${t.filter((r) => r.has_pdf && r.pdf_path).length}건)`;
};

window.exportPackage = async function () {
  const selected = selectedPackageContractors();
  if (!selected.length) {
    toast('협력사를 선택하세요', 'error');
    return;
  }
  const targets = pkgTargets();
  if (targets.length === 0) {
    toast('선택한 조건에 해당하는 물질이 없습니다', 'error');
    return;
  }
  const wantList = document.getElementById('pkgList').checked;
  const wantPdf = document.getElementById('pkgPdf').checked;
  const wantWarn = document.getElementById('pkgWarn').checked;
  if (!wantList && !wantPdf && !wantWarn) {
    toast('출력 항목을 선택하세요', 'error');
    return;
  }
  toast(`협력사 ${selected.length}곳 패키지 생성 중...`);
  const zip = new JSZip();
  const safeZipName = (value) =>
    String(value || '미지정')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim() || '미지정';
  const safeSheetName = (value) =>
    String(value || 'MSDS')
      .replace(/[\\/?*\[\]:]/g, '_')
      .slice(0, 31) || 'MSDS';
  const usedFolderNames = new Set();
  const groups = selected
    .map((contractor) => ({
      contractor,
      targets: targets.filter((r) => r.contractor === contractor),
    }))
    .filter((group) => group.targets.length > 0);
  for (const group of groups) {
    const con = group.contractor;
    const contractorTargets = group.targets;
    const folderBase = safeZipName(con);
    let folderName = folderBase,
      folderNo = 2;
    while (usedFolderNames.has(folderName))
      folderName = `${folderBase}_${folderNo++}`;
    usedFolderNames.add(folderName);
    const root = zip.folder(folderName);
    if (wantList) {
      const YN = (v) => (v === 'Y' ? 'O' : '');
      const rows = [];
      let no = 0;
      contractorTargets.forEach((r) => {
        no++;
        const comps = splitComponents(r);
        comps.forEach((comp, idx) => {
          rows.push({
            'No.': idx === 0 ? no : '',
            '사용 협력사': idx === 0 ? r.contractor : '',
            '취급 공종': idx === 0 ? r.work_type || '' : '',
            제품명: idx === 0 ? r.product_name : '',
            공급업체: idx === 0 ? r.supplier || '' : '',
            '공급업체 연락처': idx === 0 ? r.supplier_contact || '' : '',
            'MSDS 개정일자': idx === 0 ? r.issue_date || '' : '',
            'CAS No.': comp.cas || '',
            구성성분명: comp.name || '',
            작업환경측정: idx === 0 ? YN(r.legal_measurement) : '',
            '특수검진 주기':
              idx === 0
                ? r.legal_exam === 'Y'
                  ? r.legal_exam_cycle || '대상'
                  : ''
                : '',
            관리대상유해물질: idx === 0 ? YN(r.legal_manage) : '',
            허가대상유해물질: idx === 0 ? YN(r.legal_permit) : '',
            특별관리물질: idx === 0 ? YN(r.legal_special) : '',
            '위험물 규제': idx === 0 ? YN(r.legal_dangerous) : '',
            '추천 보호구': idx === 0 ? r.protective_equipment || '' : '',
          });
        });
      });
      const ws2 = XLSX.utils.json_to_sheet(rows);
      const wb2 = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb2, ws2, safeSheetName(con));
      root.file(
        `${safeZipName(con)}_MSDS목록.xlsx`,
        XLSX.write(wb2, { bookType: 'xlsx', type: 'array' }),
      );
    }
    if (wantPdf) {
      const pf = root.folder('원본파일');
      for (const r of contractorTargets) {
        if (!r.has_pdf || !r.pdf_path) continue;
        const { data, error } = await supabase.storage
          .from('msds-pdfs')
          .download(r.pdf_path);
        if (error || !data) continue;
        const originalName = safeZipName(r.pdf_name || r.product_name + '.pdf');
        let n = originalName,
          c = 1;
        while (pf.file(n)) {
          const dot = originalName.lastIndexOf('.');
          n =
            dot > 0
              ? `${originalName.slice(0, dot)}_${c}${originalName.slice(dot)}`
              : `${originalName}_${c}`;
          c++;
        }
        pf.file(n, data);
      }
    }
  }
  const content = await zip.generateAsync({ type: 'blob' });
  const filePrefix =
    groups.length === 1
      ? safeZipName(groups[0].contractor)
      : `전체_${groups.length}개협력사`;
  downloadBlob(content, `${filePrefix}_MSDS패키지_${today()}.zip`);
  if (wantWarn)
    setTimeout(() => {
      warnSelected = new Set(targets.map((r) => r.id));
      printWarnings();
    }, 600);
  toast(
    `협력사 ${groups.length}곳 · 물질 ${targets.length}건 패키지 완료`,
    'success',
  );
  closeModal('packageModal');
};
// ═══════════════════════════════════════════════
// MSDS 전문 인쇄 (협력사별 표지 포함, 양면인쇄 대응)
// ═══════════════════════════════════════════════
window.openMsdsFullPrintModal = function () {
  const el = document.getElementById('fullPrintContractorList');
  document.getElementById('fullPrintSearch').value = '';
  const sorted = [...contractors].sort((a, b) =>
    a.name.localeCompare(b.name, 'ko'),
  );
  el.innerHTML =
    sorted
      .map((c) => {
        const items = msdsRecords.filter((r) => r.contractor === c.name);
        const withPdf = items.filter((r) => r.has_pdf && r.pdf_path).length;
        return `<label style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:6px;cursor:pointer;">
      <input type="checkbox" class="fpc-check" value="${c.name}" onchange="updateFullPrintCount()">
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:600;">${c.name}</div>
        <div style="font-size:11px;color:var(--text3);">물질 ${items.length}건 · 원본 파일 ${withPdf}건</div>
      </div>
    </label>`;
      })
      .join('') ||
    '<div style="padding:14px;text-align:center;color:var(--text3);font-size:13px;">등록된 협력사가 없습니다</div>';
  document.getElementById('fullPrintSelectAll').checked = false;
  updateFullPrintCount();
  openModal('msdsFullPrintModal');
};

window.toggleAllFullPrintContractors = function (checked) {
  document
    .querySelectorAll('.fpc-check')
    .forEach((cb) => (cb.checked = checked));
  updateFullPrintCount();
};

window.updateFullPrintCount = function () {
  const selected = [...document.querySelectorAll('.fpc-check:checked')].map(
    (cb) => cb.value,
  );
  const targets = msdsRecords.filter((r) => selected.includes(r.contractor));
  const withPdf = targets.filter((r) => r.has_pdf && r.pdf_path);
  const el = document.getElementById('fullPrintCount');
  el.textContent =
    selected.length === 0
      ? ''
      : `협력사 ${selected.length}곳 · 물질 ${targets.length}건 (원본 파일 ${withPdf.length}건 인쇄됨)`;
};

function renderContractorCoverImage(contractorName, siteName) {
  const W = 1240,
    H = 1754; // A4 @ ~150dpi
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#888888';
  ctx.font = '700 38px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  ctx.fillText('협      력      사', W / 2, H / 2 - 170);
  ctx.font = '900 96px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  const boxW = Math.min(
    W - 140,
    Math.max(600, ctx.measureText(contractorName).width + 140),
  );
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 6;
  ctx.strokeRect(W / 2 - boxW / 2, H / 2 - 110, boxW, 210);
  ctx.fillStyle = '#111111';
  ctx.fillText(contractorName, W / 2, H / 2 - 2);
  ctx.fillStyle = '#555555';
  ctx.font = '600 34px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  ctx.fillText(siteName || '', W / 2, H / 2 + 170);
  return canvas.toDataURL('image/png');
}

function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function drawItemFitted(page, item, box, marginPt) {
  const m = marginPt || 0;
  const availW = box.w - m * 2,
    availH = box.h - m * 2;
  const scale = Math.min(availW / item.width, availH / item.height);
  const w = item.width * scale,
    h = item.height * scale;
  const x = box.x + (box.w - w) / 2,
    y = box.y + (box.h - h) / 2;
  if (item.kind === 'pdf')
    page.drawPage(item.obj, { x, y, width: w, height: h });
  else page.drawImage(item.obj, { x, y, width: w, height: h });
}

window.printMsdsFullDocs = async function () {
  const selected = [...document.querySelectorAll('.fpc-check:checked')].map(
    (cb) => cb.value,
  );
  if (selected.length === 0) {
    toast('협력사를 선택하세요', 'error');
    return;
  }
  const targets = msdsRecords.filter(
    (r) => selected.includes(r.contractor) && r.has_pdf && r.pdf_path,
  );
  if (targets.length === 0) {
    toast('선택한 협력사에 원본 파일이 없습니다', 'error');
    return;
  }
  const layout =
    document.querySelector('input[name="fullPrintLayout"]:checked')?.value ||
    '1';

  const sorted = [...targets].sort((a, b) => {
    const c = a.contractor.localeCompare(b.contractor, 'ko');
    return c !== 0 ? c : a.product_name.localeCompare(b.product_name, 'ko');
  });
  const groups = [];
  sorted.forEach((r) => {
    const last = groups[groups.length - 1];
    if (last && last.contractor === r.contractor) last.items.push(r);
    else groups.push({ contractor: r.contractor, items: [r] });
  });

  const btn = document.getElementById('fullPrintGoBtn');
  btn.disabled = true;
  const site = currentWS?.name || '현장명';
  const A4W = 595.28,
    A4H = 841.89;
  const failed = [];
  let processed = 0;
  let printedGroups = 0;

  try {
    const { PDFDocument, rgb } = PDFLib;
    const merged = await PDFDocument.create();
    let pageCount = 0;

    for (const g of groups) {
      // 1) 협력사의 원본 파일들을 먼저 전부 불러와서 페이지 항목으로 변환
      const renderItems = [];
      for (const r of g.items) {
        processed++;
        btn.textContent = `불러오는 중... (${processed}/${targets.length})`;
        try {
          const { data, error } = await supabase.storage
            .from('msds-pdfs')
            .download(r.pdf_path);
          if (error || !data) {
            failed.push(r.product_name);
            continue;
          }
          const bytes = new Uint8Array(await data.arrayBuffer());
          const ext = (r.pdf_path.split('.').pop() || '').toLowerCase();
          if (ext === 'pdf') {
            const srcDoc = await PDFDocument.load(bytes, {
              ignoreEncryption: true,
            });
            for (const srcPage of srcDoc.getPages()) {
              if (!srcPage.node.Contents()) continue; // 내용 없는 빈 페이지는 embed 시 저장 단계에서 에러가 나므로 건너뜀
              try {
                const embedded = await merged.embedPage(srcPage);
                renderItems.push({
                  kind: 'pdf',
                  obj: embedded,
                  width: embedded.width,
                  height: embedded.height,
                });
              } catch (pageErr) {
                /* 이 페이지만 건너뜀 */
              }
            }
          } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
            const img =
              ext === 'png'
                ? await merged.embedPng(bytes)
                : await merged.embedJpg(bytes);
            renderItems.push({
              kind: 'image',
              obj: img,
              width: img.width,
              height: img.height,
            });
          } else {
            failed.push(r.product_name);
          }
        } catch (e) {
          failed.push(r.product_name);
        }
      }
      if (renderItems.length === 0) continue; // 실제로 실을 내용이 없으면 표지도 생략

      // 2) 표지가 항상 홀수(앞면) 페이지가 되도록 필요하면 빈 페이지로 보정
      if (pageCount % 2 === 1) {
        merged.addPage([A4W, A4H]);
        pageCount++;
      }
      const coverPage = merged.addPage([A4W, A4H]);
      const pngBytes = dataUrlToBytes(
        renderContractorCoverImage(g.contractor, site),
      );
      const pngImage = await merged.embedPng(pngBytes);
      coverPage.drawImage(pngImage, { x: 0, y: 0, width: A4W, height: A4H });
      pageCount++;
      printedGroups++;

      // 3) 내용 페이지 배치 (1페이지씩 / 2페이지씩)
      if (layout === '2') {
        for (let i = 0; i < renderItems.length; i += 2) {
          const page = merged.addPage([A4H, A4W]); // 가로(landscape)로 눕혀서 좌/우로 배치
          drawItemFitted(
            page,
            renderItems[i],
            { x: 0, y: 0, w: A4H / 2, h: A4W },
            12,
          );
          if (renderItems[i + 1]) {
            drawItemFitted(
              page,
              renderItems[i + 1],
              { x: A4H / 2, y: 0, w: A4H / 2, h: A4W },
              12,
            );
            page.drawLine({
              start: { x: A4H / 2, y: 20 },
              end: { x: A4H / 2, y: A4W - 20 },
              thickness: 0.5,
              dashArray: [3, 3],
              color: rgb(0.7, 0.7, 0.7),
            });
          }
          pageCount++;
        }
      } else {
        for (const item of renderItems) {
          const page = merged.addPage([A4W, A4H]);
          drawItemFitted(page, item, { x: 0, y: 0, w: A4W, h: A4H }, 0);
          pageCount++;
        }
      }
    }

    if (pageCount === 0) {
      toast('인쇄할 원본 파일을 하나도 열지 못했습니다', 'error');
      return;
    }

    const pdfBytes = await merged.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    closeModal('msdsFullPrintModal');
    toast(
      `협력사 ${printedGroups}곳 · 총 ${pageCount}페이지 준비 완료${failed.length ? ` (원본 열기 실패 ${failed.length}건)` : ''}`,
      failed.length ? 'error' : 'success',
    );
  } catch (e) {
    toast('인쇄 파일 생성 실패: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📄 인쇄';
  }
};

window.selectContractorSidebar = function (name) {
  window.selectedContractor = name;
  // 사이드바 활성화 표시
  document.querySelectorAll('.sidebar-con-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.name === name);
    el.setAttribute('aria-pressed', String(el.dataset.name === name));
  });
  // 공종 필터 업데이트
  const con = contractors.find((c) => c.name === name);
  const wts = con ? getWorkTypesForContractor(con.id) : [];
  const wtSel = document.getElementById('filterWorkType');
  if (wtSel) {
    wtSel.innerHTML =
      '<option value="">전체 공종</option>' +
      wts.map((w) => `<option value="${w.name}">${w.name}</option>`).join('');
  }
  // 서브타이틀 업데이트
  const filtered = getFilteredMsds();
  document.getElementById('msdsSubtitle').textContent = name
    ? `${name} · ${filtered.length}건`
    : `총 ${msdsRecords.length}건`;
  renderMsdsTable();
};

window.renderContractorSidebar = function() {
  const el = document.getElementById('contractorSidebar');
  if (!el) return;
  const counts = new Map();
  msdsRecords.forEach(r => counts.set(r.contractor, (counts.get(r.contractor) || 0) + 1));
  const query = normalizeContractorName(document.getElementById('msdsContractorSearch')?.value);
  // Keep record-linked companies visible even if their contractor entry was removed.
  const names = [...new Set([...contractors.map(c => c.name), ...counts.keys()])].filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const matches = names.filter(name => normalizeContractorName(name).includes(query));
  document.getElementById('msdsContractorCount').textContent = query
    ? `검색 결과 ${matches.length}개사 / 전체 ${names.length}개사` : `전체 ${names.length}개사 · 숫자는 등록 MSDS 수`;
  el.replaceChildren();
  const addItem = (name, label, count) => {
    const button = document.createElement('button');
    const active = (window.selectedContractor || '') === name;
    button.type = 'button';
    button.className = `sidebar-con-item${active ? ' active' : ''}`;
    button.dataset.name = name;
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', `${label}, MSDS ${count}건`);
    button.innerHTML = `<span class="sidebar-con-name">${escapeHtml(label)}</span><span class="sidebar-con-count">${count}</span>`;
    button.onclick = () => selectContractorSidebar(name);
    el.append(button);
  };
  addItem('', '전체 보기', msdsRecords.length);
  matches.forEach(name => addItem(name, name, counts.get(name) || 0));
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'msds-con-empty';
    empty.textContent = query ? '검색된 협력사가 없습니다.' : '등록된 협력사가 없습니다.';
    if (query) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'msds-reset';
      reset.textContent = '검색 초기화';
      reset.onclick = () => {
        const input = document.getElementById('msdsContractorSearch');
        input.value = '';
        renderContractorSidebar();
        input.focus();
      };
      empty.append(reset);
    }
    el.append(empty);
  }
};
// ═══════════════════════════════════════════════
// 작업환경측정
// ═══════════════════════════════════════════════
let measureFileB64 = null;
let measurePreparation = null;

function prepareMeasureReport(base64) {
  if (measurePreparation?.base64 === base64) return measurePreparation.promise;
  const promise = extractMeasurePages(base64, ({ completed, total }) => {
    if (measureFileB64 === base64) document.getElementById('measureFileStatus').textContent = `문서 읽는 중 ${completed}/${total}쪽`;
  }).then(pages => parseLocalMeasureReport(pages));
  measurePreparation = { base64, promise };
  // Preprocessing begins on selection, before the user starts analysis.
  promise.then(() => {
    if (measureFileB64 === base64) document.getElementById('measureFileStatus').textContent = '빠른 분석 준비 완료';
  }, () => {
    if (measureFileB64 === base64) document.getElementById('measureFileStatus').textContent = '빠른 분석으로 확인되지 않는 양식입니다. AI 정밀 분석을 선택해주세요.';
  });
  return promise;
}

window.openMeasureUpload = function () {
  measureFileB64 = null;
  measurePreparation = null;
  measureFileName_val = null;
  document.getElementById('measureFileInfo').style.display = 'none';
  document.getElementById('measureUploadZone').style.display = 'block';
  document.getElementById('measureYear').value = new Date()
    .getFullYear()
    .toString();
  document.getElementById('measureHalf').value = '';
  document.getElementById('measureDateFrom').value = '';
  document.getElementById('measureDateTo').value = '';
  document.getElementById('measureReceivedDate').value = '';
  document.getElementById('measureAssignee').value = '';
  openModal('measureUploadModal');
};

window.dropMeasureFile = function (e) {
  e.preventDefault();
  document.getElementById('measureUploadZone').classList.remove('drag');
  const file = [...e.dataTransfer.files].find(
    (f) => f.type === 'application/pdf',
  );
  if (!file) {
    toast('PDF 파일만 가능합니다', 'error');
    return;
  }
  loadMeasureFile(file);
};

window.handleMeasureFile = function (e) {
  const file = e.target.files[0];
  if (!file) return;
  loadMeasureFile(file);
  e.target.value = '';
};

function loadMeasureFile(file) {
  if (file.type !== 'application/pdf') { toast('PDF 파일만 가능합니다', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { toast('파일은 20MB 이하여야 합니다', 'error'); return; }
  const reader = new FileReader();
  reader.onerror = () => toast('파일을 읽지 못했습니다. 다시 선택해주세요.', 'error');
  reader.onload = (ev) => {
    measureFileB64 = ev.target.result.split(',')[1];
    measureFileName_val = file.name;
    document.getElementById('measureUploadZone').style.display = 'none';
    const info = document.getElementById('measureFileInfo');
    info.style.display = 'flex';
    info.querySelector('.fi-name').textContent = file.name;
    document.getElementById('measureFileStatus').textContent = '빠른 분석 준비 중...';
    prepareMeasureReport(measureFileB64);
  };
  reader.readAsDataURL(file);
}

window.clearMeasureFile = function () {
  measureFileB64 = null;
  measurePreparation = null;
  measureFileName_val = null;
  document.getElementById('measureFileInfo').style.display = 'none';
  document.getElementById('measureUploadZone').style.display = 'block';
};

window.analyzeMeasure = async function ({ useAi = false } = {}) {
  const year = document.getElementById('measureYear').value;
  const half = document.getElementById('measureHalf').value;
  const dateFrom = document.getElementById('measureDateFrom').value;
  const dateTo = document.getElementById('measureDateTo').value;
  const receivedDate = document.getElementById('measureReceivedDate').value;
  const defaultAssignee = document
    .getElementById('measureAssignee')
    .value.trim();
  if (!year || !half) {
    toast('연도와 상/하반기를 선택하세요', 'error');
    return;
  }
  if (!dateFrom || !dateTo) {
    toast('측정 기간을 선택하세요', 'error');
    return;
  }
  const round = `${year}년 ${half}`;
  const period = `${dateFrom} ~ ${dateTo}`;
  if (!measureFileB64) {
    toast('파일을 먼저 업로드하세요', 'error');
    return;
  }
  const quickBtn = document.getElementById('measureAnalyzeBtn');
  const aiBtn = document.getElementById('measureAiAnalyzeBtn');
  const btn = useAi ? aiBtn : quickBtn;
  if (quickBtn.disabled || aiBtn.disabled) return;
  const sourceBase64 = measureFileB64;
  const sourceFileName = measureFileName_val;
  quickBtn.disabled = aiBtn.disabled = true;
  btn.textContent = useAi ? '🤖 AI 분석 중...' : '📄 보고서 확인 중...';
  try {
    const result = useAi ? await analyzeMeasurePdf(sourceBase64, invokeEdgeJson, ({ phase, completed, total }) => {
      btn.textContent = phase === 'extract' ? `📄 문서 읽는 중 ${completed}/${total}쪽` : phase === 'complete' ? '🤖 분석 완료' : `🤖 AI 분석 중 ${completed}/${total}쪽 완료`;
    }) : await prepareMeasureReport(sourceBase64);
    currentMeasureData = {
      round,
      period,
      receivedDate,
      defaultAssignee,
      siteName: currentWS.name,
      createdDate: today(),
      ...result,
    };
    closeModal('measureUploadModal');
    showMeasureResult(currentMeasureData);

    // DB 저장 + 원본 PDF 보관 (백그라운드, 실패해도 결과 화면은 그대로 유지)
    btn.textContent = '💾 저장 중...';
    try {
      const recId = await saveMeasureResult(
        currentMeasureData,
        sourceFileName,
      );
      await uploadMeasurePdf(recId, sourceFileName, sourceBase64);
      currentMeasureData.id = recId;
      currentMeasureData.file_name = sourceFileName;
      await loadMeasureResults();
      const saveStatus = document.getElementById('measureSaveStatus');
      if (saveStatus) saveStatus.textContent = '결과와 원본 PDF 저장 완료';
    } catch (saveErr) {
      console.error('측정결과 저장 실패:', saveErr);
      const saveStatus = document.getElementById('measureSaveStatus');
      if (saveStatus) saveStatus.textContent = '저장 실패 · 다운로드로 결과를 보관해주세요.';
      toast(
        '분석은 완료됐지만 저장에 실패했습니다. 다운로드로 결과를 보관해주세요.',
        'warn',
      );
    }
  } catch (err) {
    handleAiError(err);
  } finally {
    quickBtn.disabled = aiBtn.disabled = false;
    quickBtn.textContent = '📄 빠른 분석';
    aiBtn.textContent = '🤖 AI 정밀 분석';
  }
};

async function saveMeasureResult(d, fileName) {
  const { data, error } = await supabase
    .from('measure_results')
    .insert({
      workspace_id: currentWS.id,
      uploaded_by: user.id,
      round: d.round,
      period: d.period,
      dust: d.dust || [],
      noise: d.noise || [],
      work_types: d.workTypes || [],
      dust_exceeded: !!d.dustExceeded,
      noise_exceeded: !!d.noiseExceeded,
      mixed_exceeded: !!d.mixedExceeded,
      aftercare: {
        ...(d.aftercare || {}),
        overview: {
          ...(d.aftercare?.overview || {}),
          receivedDate:
            d.receivedDate || d.aftercare?.overview?.receivedDate || '',
        },
        defaultAssignee:
          d.defaultAssignee || d.aftercare?.defaultAssignee || '',
      },
      file_name: fileName || null,
    })
    .select()
    .single();
  if (error) throw new Error('DB 저장 실패: ' + error.message);
  return data.id;
}

async function uploadMeasurePdf(recId, fileName, base64Data) {
  if (!base64Data) return;
  const path = `${currentWS.id}/${recId}.pdf`;
  const blob = base64ToBlob(base64Data, 'application/pdf');
  const { error } = await supabase.storage
    .from('measure-pdfs')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error('원본 PDF 업로드 실패: ' + error.message);
  const { error: updateError } = await supabase
    .from('measure_results')
    .update({ file_path: path })
    .eq('id', recId);
  if (updateError) {
    await supabase.storage.from('measure-pdfs').remove([path]);
    throw new Error('원본 PDF 연결 실패: ' + updateError.message);
  }
}

function showMeasureResult(d) {
  document.getElementById('measureResultTitle').textContent =
    `측정 결과 — ${d.round}`;
  const body = document.getElementById('measureResultBody');
  const dust = Array.isArray(d.dust)
    ? d.dust.filter((row) => row && typeof row === 'object')
    : [];
  const noise = Array.isArray(d.noise)
    ? d.noise.filter((row) => row && typeof row === 'object')
    : [];
  const aftercareSummary = buildMeasureAftercare({ ...d, aftercare: { ...d.aftercare, resultRows: getMeasureResultRows(d) } });
  const resultRows = aftercareSummary.resultRows;
  const improvements = aftercareSummary.improvements;
  const dustRows = dust
    .map(
      (row) =>
        `<tr><td class="ctr">${escapeHtml(row.no ?? '')}</td><td>${escapeHtml(row.process ?? '')}</td><td>${escapeHtml(row.agent ?? '')}</td><td class="ctr">${escapeHtml(row.measured ?? '')}</td><td class="ctr">${escapeHtml(row.limit ?? '')}</td><td>${escapeHtml(row.reason ?? '')}</td></tr>`,
    )
    .join('');
  const noiseRows = noise
    .map(
      (row) =>
        `<tr><td class="ctr">${escapeHtml(row.no ?? '')}</td><td>${escapeHtml(row.process ?? '')}</td><td class="ctr">소음</td><td class="ctr">${escapeHtml(row.measured ?? '')}</td><td class="ctr">${escapeHtml(row.limit || '90dB(A)')}</td><td>${escapeHtml(row.reason ?? '')}</td></tr>`,
    )
    .join('');
  const workTypeRows = resultRows
    .map((row, i) => {
      const exceeded = Array.isArray(row.exceededMeasurements)
        ? row.exceededMeasurements
        : [];
      const agents = exceeded
        .map((item) => escapeHtml(item.agent || ''))
        .filter(Boolean)
        .join('<br>');
      const values = exceeded
        .map(
          (item) =>
            `${escapeHtml(formatMeasurePart(item.measured))} / ${escapeHtml(formatMeasurePart(item.limit))}`,
        )
        .filter((value) => value !== ' / ')
        .join('<br>');
      return `<tr>
      <td class="ctr">${row.no || i + 1}</td><td>${escapeHtml(row.workType || '')}</td>
      <td class="ctr">${measureStatusMarkup(row.singleStatus)}</td>
      <td class="ctr">${measureStatusMarkup(row.mixedStatus)}</td>
      <td class="ctr">${measureStatusMarkup(row.noiseStatus)}</td>
      <td>${agents || '-'}</td><td>${values || '-'}</td>
    </tr>`;
    })
    .join('');
  const improvementRows = improvements
    .map(
      (item, index) =>
        `<tr><td class="ctr">${item.no || index + 1}</td><td>${escapeHtml(item.target || '')}</td><td>${escapeHtml(item.method || '')}${item.source === 'AI 제안' || item.source === '사후관리 작성안' ? '<div class="td-sub" style="color:var(--warn)">관리대책 작성안 · 현장 여건 확인</div>' : ''}</td><td>${escapeHtml(item.assignee || d.defaultAssignee || '')}</td></tr>`,
    )
    .join('');

  body.innerHTML = `
    <div class="form-note" id="measureSaveStatus" role="status" style="margin-bottom:8px;">${d.id ? '저장된 결과' : '결과와 원본 PDF 저장 중...'}</div>
    <div style="background:var(--ok-light);border:1.5px solid #86EFAC;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:13px;color:var(--ok);">
      ${d.aftercare?.analysisMethod === 'local' ? '✅ 빠른 분석 완료 — 보고서의 측정값·판정을 추출하고 공사 단위로 사후관리 내용을 정리했습니다. 개선대책과 담당자를 현장 여건에 맞게 확인한 뒤 원본 양식으로 내려받으세요.' : '✅ AI 분석 완료 — 단위와 초과 판정, 개선대책을 원본 보고서와 대조한 뒤 Word 파일을 내려받으세요.'}
    </div>
    <h4 style="margin-bottom:8px;font-size:14px;">📋 분진·화학물질 측정결과 (${dust.length}건)</h4>
    <div style="overflow-x:auto;margin-bottom:20px;">
      <table class="result-table">
        <thead><tr><th>No.</th><th>공정명</th><th>유해인자</th><th>측정치</th><th>노출기준</th><th>적용사유</th></tr></thead>
        <tbody>${dustRows || '<tr><td colspan="6" style="text-align:center;color:#999;">분진 측정결과 없음</td></tr>'}</tbody>
      </table>
    </div>
    <h4 style="margin-bottom:8px;font-size:14px;">🔊 소음 측정결과 (${noise.length}건)</h4>
    <div style="overflow-x:auto;margin-bottom:20px;">
      <table class="result-table">
        <thead><tr><th>No.</th><th>공종명</th><th>유해인자</th><th>측정치</th><th>노출기준</th><th>적용사유</th></tr></thead>
        <tbody>${noiseRows || '<tr><td colspan="6" style="text-align:center;color:#999;">소음 측정결과 없음</td></tr>'}</tbody>
      </table>
    </div>
    <h4 style="margin-bottom:8px;font-size:14px;">📊 사후관리 측정결과 요약</h4>
    <div style="overflow-x:auto;">
      <table class="result-table">
        <thead><tr><th>No.</th><th>대상 공종</th><th>단일물질</th><th>혼합유기화합물</th><th>소음</th><th>초과 유해물질</th><th>측정치/기준치</th></tr></thead>
        <tbody>${workTypeRows || '<tr><td colspan="7" style="text-align:center;color:#999;">공종 정보 없음</td></tr>'}</tbody>
      </table>
    </div>
    <h4 style="margin:20px 0 8px;font-size:14px;">🛠️ 개선대책</h4>
    <div style="overflow-x:auto;"><table class="result-table"><thead><tr><th>No.</th><th>개선대상</th><th>개선방법</th><th>담당자</th></tr></thead><tbody>${improvementRows || '<tr><td colspan="4" style="text-align:center;color:#999;">추출된 개선대책 없음 · 원본 보고서 확인 필요</td></tr>'}</tbody></table></div>`;

  document.getElementById('measureResultFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal('measureResultModal')">닫기</button>
    ${d.file_path ? `<button class="btn btn-outline btn-sm" onclick="viewMeasureOriginalPdf()">📄 원본 PDF 보기</button>` : ''}
    <button class="btn btn-primary btn-sm" onclick="downloadMeasureDust()">📥 분진 결과표</button>
    <button class="btn btn-primary btn-sm" onclick="downloadMeasureNoise()">📥 소음 결과표</button>
    <button class="btn btn-primary btn-sm" id="measureWordBtn" onclick="downloadMeasureAfter()">📄 사후관리 Word</button>`;
  openModal('measureResultModal');
}

function formatMeasurePart(part) {
  if (!part) return '';
  if (part.display) return String(part.display);
  return [part.value, part.unit]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function measureStatusMarkup(status) {
  const safe = ['미만', '초과', '해당없음'].includes(status)
    ? status
    : '해당없음';
  return safe === '초과'
    ? '<span style="color:red;font-weight:700">초과</span>'
    : safe;
}

function getMeasureResultRows(d) {
  if (Array.isArray(d.aftercare?.resultRows) && d.aftercare.resultRows.length)
    return d.aftercare.resultRows;
  const workTypes = Array.isArray(d.workTypes)
    ? d.workTypes.map((value) => String(value || '')).filter(Boolean)
    : [];
  return workTypes.map((workType, index) => {
    const dust = (d.dust || []).filter((row) =>
      String(row.process || '').includes(workType),
    );
    const noise = (d.noise || []).filter((row) =>
      String(row.process || '').includes(workType),
    );
    const exceededMeasurements = [
      ...(d.dustExceeded ? dust : []),
      ...(d.noiseExceeded ? noise : []),
    ].map((row) => ({
      agent: row.agent || (noise.includes(row) ? '소음' : ''),
      measured: parseMeasureDisplay(row.measured),
      limit: parseMeasureDisplay(row.limit),
    }));
    return {
      no: index + 1,
      workType,
      singleStatus: dust.length
        ? d.dustExceeded
          ? '초과'
          : '미만'
        : '해당없음',
      mixedStatus: d.mixedExceeded && dust.length ? '초과' : '해당없음',
      noiseStatus: noise.length
        ? d.noiseExceeded
          ? '초과'
          : '미만'
        : '해당없음',
      exceededMeasurements,
    };
  });
}

function parseMeasureDisplay(value) {
  const text = String(value || '').trim();
  const match = text.match(/^([<>≤≥]?[\d.,]+)\s*(.+)$/);
  return match
    ? { value: match[1], unit: match[2], display: text }
    : { value: text, unit: '', display: text };
}

// ─── 작업환경측정 결과 영구 저장 목록 (DB 기반) ───
let measureResults = [];

async function loadMeasureResults() {
  const { data, error } = await supabase
    .from('measure_results')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    measureResults = [];
    return;
  }
  measureResults = data || [];
  renderMeasureList();
}

function renderMeasureList() {
  const list = document.getElementById('measureList');
  if (!list) return;
  if (!measureResults.length) {
    list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text3);">
      <div style="font-size:40px;margin-bottom:12px;">📊</div>
      <div style="font-size:15px;font-weight:600;color:var(--text2);margin-bottom:6px;">등록된 측정 결과가 없습니다</div>
      <div style="font-size:13px;margin-bottom:20px;">측정 결과 PDF를 업로드하면 자동으로 분석됩니다</div>
      <button class="btn btn-primary btn-lg" onclick="openMeasureUpload()">+ 측정결과 업로드</button>
    </div>`;
    return;
  }
  list.innerHTML = measureResults
    .map(
      (r) => `
    <div class="measure-card">
      <button type="button" class="complex-card-open" aria-label="${escapeHtml(r.round || '측정 결과')} 열기" onclick="openSavedMeasureResult('${r.id}')">
        <span class="measure-round">${escapeHtml(r.round)}</span>
        <span class="measure-date">측정 기간: ${escapeHtml(r.period)}${r.file_name ? ' · ' + escapeHtml(r.file_name) : ''}</span>
        <span class="measure-badges">
          <span class="badge badge-primary">분진 ${r.dust?.length || 0}건</span>
          <span class="badge badge-primary">소음 ${r.noise?.length || 0}건</span>
          ${r.dust_exceeded || r.noise_exceeded ? '<span class="badge badge-danger">기준 초과 있음</span>' : '<span class="badge badge-ok">전체 기준 이하</span>'}
          ${r.file_path ? '<span class="badge badge-gray">📄 원본 보관됨</span>' : ''}
        </span>
      </button>
      <button class="btn btn-danger btn-sm" style="position:absolute;top:14px;right:14px;" onclick="event.stopPropagation();deleteMeasureResult('${r.id}')">🗑</button>
    </div>
  `,
    )
    .join('');
}

window.openSavedMeasureResult = function (id) {
  const r = measureResults.find((x) => x.id === id);
  if (!r) return;
  currentMeasureData = {
    id: r.id,
    round: r.round,
    period: r.period,
    dust: r.dust || [],
    noise: r.noise || [],
    workTypes: r.work_types || [],
    dustExceeded: r.dust_exceeded,
    noiseExceeded: r.noise_exceeded,
    mixedExceeded: r.mixed_exceeded,
    aftercare: r.aftercare || {},
    siteName: currentWS.name,
    receivedDate: r.aftercare?.overview?.receivedDate || '',
    defaultAssignee: r.aftercare?.defaultAssignee || '',
    createdDate: String(r.created_at || today()).substring(0, 10),
    file_name: r.file_name,
    file_path: r.file_path,
  };
  showMeasureResult(currentMeasureData);
};

window.viewMeasureOriginalPdf = async function () {
  if (!currentMeasureData?.file_path) {
    toast('보관된 원본 파일이 없습니다', 'error');
    return;
  }
  const { data, error } = await supabase.storage
    .from('measure-pdfs')
    .createSignedUrl(currentMeasureData.file_path, 3600);
  if (error) {
    toast('파일을 열 수 없습니다: ' + error.message, 'error');
    return;
  }
  window.open(data.signedUrl, '_blank');
};

window.deleteMeasureResult = async function (id) {
  const r = measureResults.find((x) => x.id === id);
  if (!r) return;
  if (
    !confirm(
      `"${r.round}" 측정 결과를 삭제하시겠습니까? (원본 PDF도 함께 삭제됩니다)`,
    )
  )
    return;
  if (r.file_path)
    await supabase.storage.from('measure-pdfs').remove([r.file_path]);
  await supabase.from('measure_results').delete().eq('id', id);
  await loadMeasureResults();
  toast('삭제됐습니다');
};

window.downloadMeasureDust = function () {
  if (!currentMeasureData) return;
  const d = currentMeasureData;
  const rows = (d.dust || []).map((r) => ({
    'No.': r.no || '',
    공정명: r.process || '',
    유해인자: r.agent || '',
    측정치: r.measured || '',
    노출기준: r.limit || '',
    적용사유: r.reason || '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  const sheetName = `(${d.round}) 분진측정결과`.slice(0, 30);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `작업환경측정_분진_${d.round}_${today()}.xlsx`);
  toast('분진 결과표 다운로드 완료', 'success');
};

window.downloadMeasureNoise = function () {
  if (!currentMeasureData) return;
  const d = currentMeasureData;
  const rows = (d.noise || []).map((r) => ({
    'No.': r.no || '',
    공종명: r.process || '',
    '유해인자(소음)': '소음',
    '측정치dB(A)': r.measured || '',
    '노출기준 90dB(A)': '90dB(A)',
    적용사유: r.reason || '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `소음측정결과`.slice(0, 30));
  XLSX.writeFile(wb, `작업환경측정_소음_${d.round}_${today()}.xlsx`);
  toast('소음 결과표 다운로드 완료', 'success');
};

window.downloadMeasureAfter = async function () {
  if (!currentMeasureData) return;
  const d = currentMeasureData;
  const btn = document.getElementById('measureWordBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Word 생성 중...';
  }
  try {
    const payload = {
      ...d,
      aftercare: {
        ...(d.aftercare || {}),
        resultRows: getMeasureResultRows(d),
      },
      siteName: d.siteName || currentWS.name,
      createdDate: d.createdDate || today(),
    };
    const blob = await createMeasureAftercareDocx(payload);
    downloadBlob(
      blob,
      `작업환경측정_사후관리_${String(d.round || '').replace(/[\\/:*?"<>|]/g, '_')}_${today()}.docx`,
    );
    toast('사후관리 Word 파일을 생성했습니다.', 'success');
  } catch (error) {
    toast(error.message || 'Word 생성에 실패했습니다.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📄 사후관리 Word';
    }
  }
};

// ═══════════════════════════════════════════════
// 건강진단
// ═══════════════════════════════════════════════
window.openHealthUpload = function () {
  healthFileQueue = [];
  healthConfirmData = [];
  healthExcelData = null;
  healthExcelName_val = null;
  document.getElementById('healthFileQueue').style.display = 'none';
  document.getElementById('healthUploadZone').style.display = 'block';
  openModal('healthUploadModal');
};

window.dropHealthFiles = function (e) {
  e.preventDefault();
  document.getElementById('healthUploadZone').classList.remove('drag');
  const ok = ['application/pdf', 'image/jpeg', 'image/png'];
  const files = [...e.dataTransfer.files].filter((f) => ok.includes(f.type));
  if (files.length) addHealthFiles(files);
};

window.handleHealthFiles = function (e) {
  const ok = ['application/pdf', 'image/jpeg', 'image/png'];
  const files = [...e.target.files].filter((f) => ok.includes(f.type));
  addHealthFiles(files);
  e.target.value = '';
};

function addHealthFiles(files) {
  files.forEach((file) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const item = {
      id,
      file,
      name: file.name,
      data: null,
      mediaType: file.type,
      status: 'reading',
      error: null,
    };
    healthFileQueue.push(item);
    readHealthQueueItem(item);
  });
  renderHealthFileQueue();
}

function readHealthQueueItem(item) {
  item.status = 'reading';
  item.error = null;
  item.data = null;
  renderHealthFileQueue();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = String(ev.target?.result || '');
      const separator = result.indexOf(',');
      if (separator < 0 || !result.slice(separator + 1)) {
        item.status = 'error';
        item.error = '파일 내용을 읽지 못했습니다';
      } else {
        item.data = result.slice(separator + 1);
        item.status = 'waiting';
      }
      renderHealthFileQueue();
      resolve(item.status === 'waiting');
    };
    reader.onerror = () => {
      item.status = 'error';
      item.error = '파일 읽기에 실패했습니다. 파일을 다시 선택해 주세요';
      renderHealthFileQueue();
      resolve(false);
    };
    reader.readAsDataURL(item.file);
  });
}

function renderHealthFileQueue() {
  const el = document.getElementById('healthFileQueue');
  if (healthFileQueue.length === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';
  const icons = {
    reading: '📥',
    waiting: '📄',
    parsing: '⏳',
    done: '✅',
    error: '❌',
  };
  const labels = {
    reading: '파일 읽는 중...',
    waiting: '분석 대기',
    parsing: 'AI 분석 중...',
    done: '분석 완료',
    error: '분석 오류',
  };
  el.innerHTML = healthFileQueue
    .map((item) => {
      const statusText =
        item.status === 'error'
          ? `${labels.error}: ${item.error || '알 수 없는 오류'}`
          : labels[item.status];
      return `<div class="file-item ${item.status}">
      <span class="fi-icon">${icons[item.status]}</span>
      <div class="fi-info">
        <div class="fi-name">${escapeHtml(item.name)}</div>
        <div class="fi-status">${escapeHtml(statusText)}</div>
      </div>
      ${item.status === 'error' ? `<button type="button" class="btn btn-outline btn-sm" onclick="retryHealthFile('${item.id}')">다시 시도</button>` : ''}
      ${item.status !== 'parsing' && item.status !== 'reading' ? `<button type="button" class="fi-remove" aria-label="${escapeHtml(item.name)} 제거" onclick="removeHealthFile('${item.id}')">✕</button>` : ''}
    </div>`;
    })
    .join('');
  const analyzeBtn = document.getElementById('healthAnalyzeBtn');
  if (analyzeBtn && analyzeBtn.textContent !== '🤖 AI 분석 중...') {
    const ready = healthFileQueue.some((item) => item.status === 'waiting');
    const reading = healthFileQueue.some((item) => item.status === 'reading');
    analyzeBtn.disabled = !ready || reading;
  }
}

window.removeHealthFile = function (id) {
  healthFileQueue = healthFileQueue.filter((f) => f.id !== id);
  renderHealthFileQueue();
};

window.retryHealthFile = async function (id) {
  const item = healthFileQueue.find((file) => file.id === id);
  if (!item) return;
  if (item.data) {
    item.status = 'waiting';
    item.error = null;
    renderHealthFileQueue();
  } else {
    await readHealthQueueItem(item);
  }
};

window.analyzeHealth = async function () {
  if (healthFileQueue.length === 0) {
    toast('파일을 먼저 업로드하세요', 'error');
    return;
  }
  if (healthFileQueue.some((item) => item.status === 'reading')) {
    toast('파일을 읽는 중입니다. 잠시 후 다시 눌러주세요', 'warn');
    return;
  }
  const pending = healthFileQueue.filter((item) => item.status === 'waiting');
  if (pending.length === 0) {
    if (healthConfirmData.length) {
      closeModal('healthUploadModal');
      showHealthConfirm();
    } else {
      toast('분석 대기 중인 파일이 없습니다', 'error');
    }
    return;
  }
  const btn = document.getElementById('healthAnalyzeBtn');
  btn.disabled = true;
  btn.textContent = '🤖 AI 분석 중...';
  healthCurrentRound = new Date().toLocaleDateString('ko-KR');
  if (!healthFileQueue.some((item) => item.status === 'done'))
    healthConfirmData = [];
  const allowedCodes = new Set([
    'A',
    'B',
    'C1',
    'C2',
    'CN',
    'D1',
    'D2',
    'DN',
    'R',
    'U',
    'V',
  ]);
  const allowedExamTypes = new Set(['1', '2', '3']);
  for (const item of pending) {
    item.status = 'parsing';
    renderHealthFileQueue();
    try {
      const data = await invokeEdgeJson('parse-msds', {
        fileBase64: item.data,
        mediaType: item.mediaType,
        mode: 'health',
        prompt: `이 건강진단 결과 문서에서 근로자별 정보를 추출하세요. 여러 명이면 모두 추출. JSON 배열만 응답:
[{
  "name":"이름",
  "contractor":"협력사명",
  "jobType":"직무구분(예:소음작업,분진작업,일반)",
  "examDate":"검진일자 YYYY.MM.DD",
  "examType":"1(일반)/2(특수)/3(배치전)",
  "resultCode":"A|B|C1|C2|CN|D1|D2|DN|R|U|V",
  "hazardResult":"유해인자별 판정이 A가 아닌 것만. 예: 소음(우) D1, 소음(좌) C1"
}]`,
      });
      const parsed = Array.isArray(data.result) ? data.result : [data.result];
      const normalized = parsed
        .filter(
          (entry) =>
            entry && typeof entry === 'object' && !Array.isArray(entry),
        )
        .map((entry) => {
          const examType = String(entry.examType || '1');
          const resultCode = String(entry.resultCode || 'A').toUpperCase();
          return {
            name: String(entry.name || '')
              .trim()
              .slice(0, 100),
            contractor: String(entry.contractor || '')
              .trim()
              .slice(0, 200),
            jobType: String(entry.jobType || '')
              .trim()
              .slice(0, 200),
            examDate: String(entry.examDate || '')
              .trim()
              .slice(0, 30),
            examType: allowedExamTypes.has(examType) ? examType : '1',
            resultCode: allowedCodes.has(resultCode) ? resultCode : 'A',
            hazardResult: String(entry.hazardResult || '')
              .trim()
              .slice(0, 500),
          };
        })
        .filter((entry) => entry.name || entry.contractor || entry.examDate);
      if (!normalized.length)
        throw new Error('문서에서 확인 가능한 근로자 결과가 없습니다');
      healthConfirmData.push(...normalized);
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
      console.error(err);
      if (AI_SETUP_CODES.has(err.code)) {
        handleAiError(err);
        break;
      }
    }
    renderHealthFileQueue();
    await new Promise((r) => setTimeout(r, 200));
  }
  btn.disabled = false;
  btn.textContent = '🤖 AI 분석 시작';
  if (healthConfirmData.length === 0) {
    toast('분석 결과가 없습니다. 파일을 확인하세요', 'error');
    return;
  }
  const failedCount = healthFileQueue.filter(
    (item) => item.status === 'error',
  ).length;
  if (failedCount) {
    toast(
      `성공 ${healthConfirmData.length}명 · 오류 ${failedCount}개. 오류 파일을 다시 시도하거나 제거한 뒤 검토하세요`,
      'warn',
    );
    renderHealthFileQueue();
    return;
  }
  closeModal('healthUploadModal');
  showHealthConfirm();
};

function showHealthConfirm() {
  const tbody = document.getElementById('healthConfirmBody');
  const contractorOpts = contractors
    .map(
      (c) =>
        `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`,
    )
    .join('');
  tbody.innerHTML = healthConfirmData
    .map(
      (item, i) => `
    <tr>
      <td class="ctr" style="color:var(--text3);">${i + 1}</td>
      <td><input value="${escapeHtml(item.name || '')}" onchange="healthConfirmData[${i}].name=this.value"></td>
      <td><select onchange="healthConfirmData[${i}].contractor=this.value"><option value="">선택</option>${contractorOpts}</select></td>
      <td><input value="${escapeHtml(item.jobType || '')}" onchange="healthConfirmData[${i}].jobType=this.value" placeholder="소음작업"></td>
      <td><input value="${escapeHtml(item.examDate || '')}" onchange="healthConfirmData[${i}].examDate=this.value" placeholder="2026.01.01"></td>
      <td>
        <select onchange="healthConfirmData[${i}].examType=this.value">
          <option value="1" ${String(item.examType) === '1' ? 'selected' : ''}>1 일반</option>
          <option value="2" ${String(item.examType) === '2' ? 'selected' : ''}>2 특수</option>
          <option value="3" ${String(item.examType) === '3' ? 'selected' : ''}>3 배치전</option>
        </select>
      </td>
      <td>
        <select onchange="healthConfirmData[${i}].resultCode=this.value">
          ${['A', 'B', 'C1', 'C2', 'CN', 'D1', 'D2', 'DN', 'R', 'U', 'V'].map((c) => `<option value="${c}" ${item.resultCode === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </td>
      <td><input value="${escapeHtml(item.hazardResult || '')}" onchange="healthConfirmData[${i}].hazardResult=this.value" placeholder="소음(우) D1" style="min-width:140px;"></td>
    </tr>`,
    )
    .join('');

  // 협력사 select 기본값 설정
  const rows = tbody.querySelectorAll('tr');
  healthConfirmData.forEach((item, i) => {
    const sel = rows[i]?.querySelector('select');
    if (sel && item.contractor) sel.value = item.contractor;
  });

  document.getElementById('healthExcelName').textContent = '';
  document.getElementById('healthDownloadBtn').disabled = true;
  document.getElementById('healthAnalyzeBtn').disabled = false;
  openModal('healthConfirmModal');
}

window.handleHealthExcel = function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    healthExcelData = ev.target.result;
    healthExcelName_val = file.name;
    document.getElementById('healthExcelName').textContent = '✅ ' + file.name;
    document.getElementById('healthDownloadBtn').disabled = false;
    toast('엑셀 양식이 로드됐습니다', 'success');
  };
  reader.readAsBinaryString(file);
  e.target.value = '';
};

window.downloadHealthExcel = function () {
  if (!healthExcelData) {
    toast('엑셀 양식을 먼저 업로드하세요', 'error');
    return;
  }
  try {
    const wb = XLSX.read(healthExcelData, { type: 'binary' });
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const allData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // L=11, M=12, N=13, O=14 (0-indexed) — 셀 단위로만 기입해 병합·컬럼폭 등 시트 구조 보존
    const nameCol = findNameColumn(allData);

    let written = 0;
    healthConfirmData.forEach((item) => {
      if (!item.name) return;
      const rowIdx = allData.findIndex(
        (row, ri) =>
          ri > 0 && String(row[nameCol] || '').trim() === item.name.trim(),
      );
      if (rowIdx < 0) return;
      [
        [11, item.examDate],
        [12, item.examType],
        [13, item.resultCode],
        [14, item.hazardResult],
      ].forEach(([col, val]) => {
        const addr = XLSX.utils.encode_cell({ r: rowIdx, c: col });
        ws[addr] = { t: 's', v: String(val || '') };
      });
      written++;
    });
    // 기입 범위가 기존 !ref 밖이면 확장
    const ref = XLSX.utils.decode_range(ws['!ref']);
    if (ref.e.c < 14) {
      ref.e.c = 14;
      ws['!ref'] = XLSX.utils.encode_range(ref);
    }

    XLSX.writeFile(wb, `건강진단_${healthCurrentRound}_${today()}.xlsx`);
    toast(
      `엑셀 다운로드 완료 (${written}명 기입${written < healthConfirmData.length ? `, ${healthConfirmData.length - written}명은 이름 불일치로 미기입` : ''})`,
      written < healthConfirmData.length ? 'warn' : 'success',
    );
  } catch (err) {
    toast('엑셀 처리 실패: ' + err.message, 'error');
  }
};

function findNameColumn(data) {
  // 헤더 행에서 '이름' 또는 '성명' 컬럼 찾기
  for (let ri = 0; ri < Math.min(5, data.length); ri++) {
    for (let ci = 0; ci < data[ri].length; ci++) {
      const cell = String(data[ri][ci] || '');
      if (cell.includes('이름') || cell.includes('성명')) return ci;
    }
  }
  return 0; // 기본값: 첫 번째 열
}

let healthRecordsList = [];

async function loadHealthRecords() {
  const { data } = await supabase
    .from('health_records')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .order('created_at', { ascending: false });
  healthRecordsList = data || [];
  renderHealthRecordsList();
}

function renderHealthRecordsList() {
  const list = document.getElementById('healthList');
  if (!list) return;
  if (!healthRecordsList.length) {
    list.innerHTML =
      '<div style="color:var(--text3);font-size:13px;text-align:center;padding:20px;">저장된 분석 결과가 없습니다</div>';
    return;
  }
  list.innerHTML = healthRecordsList
    .map(
      (rec) => `
    <div class="health-card">
      <button type="button" class="complex-card-open" aria-label="${escapeHtml(rec.round || '건강진단 결과')} 열기" onclick="openHealthRecord('${rec.id}')">
        <span class="measure-round">${escapeHtml(rec.round)}</span>
        <span class="measure-date">${escapeHtml((rec.created_at || '').split('T')[0])}</span>
        <span class="measure-badges"><span class="badge badge-primary">총 ${(rec.entries || []).length}명</span></span>
      </button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="deleteHealthRecord('${rec.id}')" title="삭제">🗑</button>
    </div>`,
    )
    .join('');
}

window.openHealthRecord = function (id) {
  const rec = healthRecordsList.find((r) => r.id === id);
  if (!rec) return;
  healthConfirmData = rec.entries || [];
  healthCurrentRound = rec.round;
  showHealthConfirm();
};

window.deleteHealthRecord = async function (id) {
  if (!confirm('이 분석 결과를 삭제할까요?')) return;
  await supabase.from('health_records').delete().eq('id', id);
  healthRecordsList = healthRecordsList.filter((r) => r.id !== id);
  renderHealthRecordsList();
  toast('삭제됐습니다');
};

window.saveHealthRecord = async function () {
  const btn = document.getElementById('healthSaveBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '저장 중...';
  }
  const { error } = await supabase.from('health_records').insert({
    workspace_id: currentWS.id,
    uploaded_by: user.id,
    round: healthCurrentRound,
    entries: healthConfirmData,
  });
  if (error) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 대장에 저장';
    }
    toast(
      '저장 실패: ' + error.message + ' — 입력 내용은 그대로 유지됩니다',
      'error',
    );
    return;
  }
  await loadHealthRecords();
  closeModal('healthConfirmModal');
  if (btn) {
    btn.disabled = false;
    btn.textContent = '💾 대장에 저장';
  }
  toast(`건강진단 결과 ${healthConfirmData.length}명 저장 완료`, 'success');
};

// ═══════════════════════════════════════════════
// Modal / Toast
// ═══════════════════════════════════════════════
// (openModal, closeModal, toast → src/lib/ui.js 로 이동, 아래에서 window에 재부착)
window.openModal = openModal;
window.closeModal = closeModal;
window.toast = toast;

// ESC로 모달 닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document
      .querySelectorAll('.modal-backdrop.open')
      .forEach((m) => m.classList.remove('open'));
  }
});

// ═══════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// CAS 기반 법정물질 일괄 재판정
// ═══════════════════════════════════════════════

function checkCasList(casStr) {
  const casList = (casStr || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    measurement: casList.some((c) => CAS_MEASUREMENT.has(c)) ? 'Y' : 'N',
    healthExam: casList.some((c) => CAS_HEALTH_EXAM.has(c)) ? 'Y' : 'N',
    manage: casList.some((c) => CAS_MANAGE.has(c)) ? 'Y' : 'N',
    permit: casList.some((c) => CAS_PERMIT.has(c)) ? 'Y' : 'N',
    special: casList.some((c) => CAS_SPECIAL.has(c)) ? 'Y' : 'N',
    examCycle: casList.map((c) => CAS_EXAM_CYCLE[c]).filter(Boolean)[0] || '',
  };
}

window.reanalyzeLegal = async function () {
  if (
    !confirm(
      `등록된 ${msdsRecords.length}건의 법정물질 판정을 CAS 번호 기준으로 일괄 업데이트합니다.\n비용 없이 빠르게 처리됩니다. 계속하시겠습니까?`,
    )
  )
    return;
  const btn = document.getElementById('reanalyzeLegalBtn');
  btn.disabled = true;
  btn.textContent = '업데이트 중...';
  let updated = 0,
    skipped = 0;
  for (const r of msdsRecords) {
    if (!r.cas_no) {
      skipped++;
      continue;
    }
    const check = checkCasList(r.cas_no);
    const { error } = await supabase
      .from('msds_records')
      .update({
        legal_measurement: check.measurement,
        legal_exam: check.healthExam,
        legal_exam_cycle: check.examCycle,
        legal_manage: check.manage,
        legal_permit: check.permit,
        legal_special: check.special,
        special: check.special === 'Y' ? 'Y_special' : 'N',
      })
      .eq('id', r.id);
    if (!error) updated++;
    // 진행상황 표시
    btn.textContent = `업데이트 중... (${updated}/${msdsRecords.length})`;
    await new Promise((res) => setTimeout(res, 50));
  }
  await loadMsdsRecords();
  btn.disabled = false;
  btn.textContent = '✅ 법정물질 일괄 재판정';
  toast(`${updated}건 업데이트 완료 (CAS 없음 ${skipped}건 제외)`, 'success');
};

// ═══════════════════════════════════════════════
// 건강진단 — 배치전 확인서 추적
// ═══════════════════════════════════════════════
let placementRawRows = []; // 재직자만, 원본 파싱 결과
let placementCodeSet = []; // 발견된 판정코드 목록
let placementFiltered = []; // 추출 결과

window.switchHealthSub = function (which) {
  activeHealthSub = which;
  document
    .getElementById('hsub-result')
    .classList.toggle('active', which === 'result');
  document
    .getElementById('hsub-placement')
    .classList.toggle('active', which === 'placement');
  document
    .getElementById('hsub-sorting')
    .classList.toggle('active', which === 'sorting');
  document.getElementById('healthSubResult').style.display =
    which === 'result' ? '' : 'none';
  document.getElementById('healthSubPlacement').style.display =
    which === 'placement' ? '' : 'none';
  document.getElementById('healthSubSorting').style.display =
    which === 'sorting' ? '' : 'none';
  const headerActions = document.getElementById('healthHeaderActions');
  if (headerActions)
    headerActions.style.display = which === 'result' ? '' : 'none';
};

// 배치전 셀 값에서 판정코드 추출. 예: "2026.06.25 (V)" -> "V" / "" -> null(누락)
function extractPlacementCode(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/\(([^)]+)\)\s*$/);
  if (m) return m[1].trim();
  // 괄호 없이 코드만 있는 경우 대비
  if (/^[A-Za-z0-9]+$/.test(s)) return s;
  return null;
}

window.handlePlacementExcel = function (e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('placementFileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) {
        toast('데이터가 없습니다', 'error');
        return;
      }

      // 헤더 유연 매칭
      const headerKeys = Object.keys(rows[0]);
      const findKey = (cands) =>
        headerKeys.find((h) => cands.some((c) => h.includes(c)));
      const kCon = findKey(['협력회사', '협력사']);
      const kJob = findKey(['직종']);
      const kName = findKey(['성명']);
      const kStatus = findKey(['재직상태']);
      const kPlacement =
        findKey(['배치전']) && !findKey(['배치전']).includes('판정코드')
          ? headerKeys.find((h) => h === '배치전') || findKey(['배치전'])
          : findKey(['배치전']);
      const kPhone = findKey(['휴대전화', '연락처', '전화']);

      if (!kCon || !kName || !kStatus || !kPlacement) {
        toast(
          '필수 열(협력회사/성명/재직상태/배치전)을 찾을 수 없습니다. 양식을 확인하세요.',
          'error',
        );
        return;
      }

      // 재직자만 필터
      const active = rows.filter(
        (r) => String(r[kStatus] || '').trim() === '재직',
      );

      placementRawRows = active.map((r) => ({
        contractor: String(r[kCon] || '').trim(),
        job: kJob ? String(r[kJob] || '').trim() : '',
        name: String(r[kName] || '').trim(),
        phone: kPhone ? String(r[kPhone] || '').trim() : '',
        placementRaw: r[kPlacement],
        code: extractPlacementCode(r[kPlacement]),
      }));

      // 발견된 코드 집계
      const codeCount = {};
      placementRawRows.forEach((r) => {
        if (r.code) codeCount[r.code] = (codeCount[r.code] || 0) + 1;
      });
      placementCodeSet = Object.keys(codeCount).sort();

      const missingCount = placementRawRows.filter((r) => !r.code).length;

      // 체크박스 렌더링
      const wrap = document.getElementById('placementCodeChecks');
      wrap.innerHTML = placementCodeSet
        .map(
          (code) => `
        <label class="placement-code-chip">
          <input type="checkbox" class="placement-code-cb" value="${code}" ${code === 'V' ? 'checked' : ''}>
          <span>${code} (${codeCount[code]}명)</span>
        </label>
      `,
        )
        .join('');
      document.getElementById('placementMissingCheck').nextSibling && null;
      const missingLabel = document
        .getElementById('placementMissingCheck')
        .closest('.legal-check');
      if (missingLabel)
        missingLabel.lastChild.textContent = ` 배치전 누락(공백)자 포함 (${missingCount}명)`;

      document.getElementById('placementFilterCard').style.display = '';
      document.getElementById('placementResultArea').style.display = 'none';
      toast(
        `재직자 ${active.length}명 불러옴 (전체 ${rows.length}명 중)`,
        'success',
      );
    } catch (err) {
      console.error(err);
      toast('엑셀 파싱 실패: ' + err.message, 'error');
    }
  };
  reader.readAsBinaryString(file);
};

window.runPlacementFilter = function () {
  activeSnapshotId = null;
  const checkedCodes = Array.from(
    document.querySelectorAll('.placement-code-cb:checked'),
  ).map((cb) => cb.value);
  const includeMissing = document.getElementById(
    'placementMissingCheck',
  ).checked;

  if (!checkedCodes.length && !includeMissing) {
    toast('판정코드를 1개 이상 선택하거나 누락자 포함을 체크하세요', 'error');
    return;
  }

  placementFiltered = placementRawRows.filter((r) => {
    if (r.code && checkedCodes.includes(r.code)) return true;
    if (!r.code && includeMissing) return true;
    return false;
  });

  // 협력사별, 가나다순 정렬
  placementFiltered.sort((a, b) => {
    if (a.contractor !== b.contractor)
      return a.contractor.localeCompare(b.contractor, 'ko');
    return a.name.localeCompare(b.name, 'ko');
  });

  const body = document.getElementById('placementResultBody');
  if (!placementFiltered.length) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:30px;">선택한 조건에 해당하는 재직자가 없습니다</td></tr>`;
  } else {
    body.innerHTML = placementFiltered
      .map(
        (r) => `
      <tr>
        <td>${r.contractor}</td>
        <td>${r.job || '-'}</td>
        <td>${r.name}</td>
        <td>${r.code ? r.code : '<span style="color:#DC2626;font-weight:700;">누락</span>'}</td>
        <td>${r.phone || '-'}</td>
      </tr>
    `,
      )
      .join('');
  }

  const contractorCount = new Set(placementFiltered.map((r) => r.contractor))
    .size;
  document.getElementById('placementResultSummary').textContent =
    `결과지 미수령 대상: 총 ${placementFiltered.length}명 (${contractorCount}개 협력사)`;
  document.getElementById('placementResultArea').style.display = '';
  document
    .querySelector('#placementResultArea .btn-ok')
    ?.style.setProperty('display', '');
};

window.downloadPlacementExcel = function () {
  if (!placementFiltered.length) {
    toast('추출된 명단이 없습니다', 'error');
    return;
  }
  const wb = XLSX.utils.book_new();

  // 전체 통합 시트
  const allRows = placementFiltered.map((r) => ({
    협력회사: r.contractor,
    직종: r.job,
    성명: r.name,
    '배치전 상태': r.code || '누락',
    연락처: r.phone,
  }));
  const wsAll = XLSX.utils.json_to_sheet(allRows);
  XLSX.utils.book_append_sheet(wb, wsAll, '전체');

  // 협력사별 시트
  const byContractor = {};
  placementFiltered.forEach((r) => {
    if (!byContractor[r.contractor]) byContractor[r.contractor] = [];
    byContractor[r.contractor].push(r);
  });
  Object.entries(byContractor).forEach(([con, list]) => {
    const rows = list.map((r) => ({
      직종: r.job,
      성명: r.name,
      '배치전 상태': r.code || '누락',
      연락처: r.phone,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, con.slice(0, 30));
  });

  XLSX.writeFile(wb, `배치전_확인서_미수령_${today()}.xlsx`);
};

// Canvas로 명단 이미지 생성 (제목, 협력사명 옵션, 데이터 배열)
function renderPlacementImageCanvas(title, list, subtitle) {
  const rowH = 40,
    headerH = 56,
    titleH = subtitle ? 96 : 70,
    padX = 28,
    footerH = 24;
  const colW = [70, 200, 130, 100, 140]; // No, 협력회사, 직종, 성명, 상태
  const width = colW.reduce((a, b) => a + b, 0) + padX * 2;
  const height = titleH + headerH + rowH * list.length + footerH + 20;

  const canvas = document.createElement('canvas');
  const scale = 2; // 고해상도
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // 배경
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // 타이틀
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(title, padX, 38);
  if (subtitle) {
    ctx.fillStyle = '#475569';
    ctx.font = '14px sans-serif';
    ctx.fillText(subtitle, padX, 62);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '12px sans-serif';
    ctx.fillText(`생성일: ${today()}`, padX, 82);
  } else {
    ctx.fillStyle = '#94A3B8';
    ctx.font = '12px sans-serif';
    ctx.fillText(`생성일: ${today()}`, padX, 58);
  }

  let y = titleH;
  // 헤더 행
  ctx.fillStyle = '#EFF6FF';
  ctx.fillRect(padX, y, width - padX * 2, headerH);
  ctx.fillStyle = '#2563EB';
  ctx.font = 'bold 14px sans-serif';
  const headers = ['No', '협력회사', '직종', '성명', '배치전 상태'];
  let x = padX;
  headers.forEach((h, i) => {
    ctx.fillText(h, x + 12, y + headerH / 2 + 5);
    x += colW[i];
  });
  y += headerH;

  // 데이터 행
  list.forEach((r, idx) => {
    if (idx % 2 === 1) {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(padX, y, width - padX * 2, rowH);
    }
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, y + rowH);
    ctx.lineTo(width - padX, y + rowH);
    ctx.stroke();

    let cx = padX;
    const vals = [
      String(idx + 1),
      r.contractor,
      r.job || '-',
      r.name,
      r.code || '누락',
    ];
    vals.forEach((v, i) => {
      if (i === 4 && !r.code) {
        ctx.fillStyle = '#DC2626';
        ctx.font = 'bold 14px sans-serif';
      } else {
        ctx.fillStyle = '#0F172A';
        ctx.font = i === 3 ? 'bold 14px sans-serif' : '14px sans-serif';
      }
      const text = colW[i] && v.length > 14 ? v.slice(0, 13) + '…' : v;
      ctx.fillText(text, cx + 12, y + rowH / 2 + 5);
      cx += colW[i];
    });
    y += rowH;
  });

  // 테두리
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(padX, titleH, width - padX * 2, headerH + rowH * list.length);

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

window.downloadPlacementImageAll = async function () {
  if (!placementFiltered.length) {
    toast('추출된 명단이 없습니다', 'error');
    return;
  }
  const contractorCount = new Set(placementFiltered.map((r) => r.contractor))
    .size;
  const canvas = renderPlacementImageCanvas(
    '🏥 배치전 건강진단 결과지 미수령 명단',
    placementFiltered,
    `전체 ${placementFiltered.length}명 · ${contractorCount}개 협력사`,
  );
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, `배치전_확인서_미수령_전체_${today()}.png`);
};

window.downloadPlacementImagesByContractor = async function () {
  if (!placementFiltered.length) {
    toast('추출된 명단이 없습니다', 'error');
    return;
  }
  const byContractor = {};
  placementFiltered.forEach((r) => {
    if (!byContractor[r.contractor]) byContractor[r.contractor] = [];
    byContractor[r.contractor].push(r);
  });

  const zip = new JSZip();
  const folder = zip.folder(`배치전_확인서_미수령_협력사별_${today()}`);

  for (const [con, list] of Object.entries(byContractor)) {
    const canvas = renderPlacementImageCanvas(
      `🏥 배치전 건강진단 결과지 미수령 명단`,
      list,
      `${con} · ${list.length}명`,
    );
    const blob = await canvasToBlob(canvas);
    folder.file(`${con}.png`, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipBlob, `배치전_확인서_미수령_협력사별_${today()}.zip`);
};

// ─── 스냅샷 저장/불러오기 ───
let placementSnapshots = [];
let activeSnapshotId = null; // null이면 현재 작업 중인(미저장) 데이터

window.savePlacementSnapshot = async function () {
  if (!placementFiltered.length) {
    toast('저장할 명단이 없습니다', 'error');
    return;
  }
  const checkedCodes = Array.from(
    document.querySelectorAll('.placement-code-cb:checked'),
  ).map((cb) => cb.value);
  const includeMissing = document.getElementById(
    'placementMissingCheck',
  ).checked;
  const label = new Date().toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const { error } = await supabase.from('placement_snapshots').insert({
    workspace_id: currentWS.id,
    created_by: user.id,
    snapshot_label: label,
    filter_codes: checkedCodes,
    include_missing: includeMissing,
    total_active: placementRawRows.length,
    matched_count: placementFiltered.length,
    data: placementFiltered,
  });
  if (error) {
    toast('저장 실패: ' + error.message, 'error');
    return;
  }
  toast('스냅샷이 저장됐습니다', 'success');
  await loadPlacementSnapshots();
};

async function loadPlacementSnapshots() {
  const { data, error } = await supabase
    .from('placement_snapshots')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  placementSnapshots = data || [];
  renderPlacementSnapshotList();
}

function renderPlacementSnapshotList() {
  const el = document.getElementById('placementSnapshotList');
  if (!el) return;
  if (!placementSnapshots.length) {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">저장된 스냅샷이 없습니다</div>`;
    return;
  }
  el.innerHTML = placementSnapshots
    .map(
      (s) => `
    <div class="snapshot-item">
      <button type="button" class="complex-card-open" aria-label="${escapeHtml(s.snapshot_label || '스냅샷')} 열기" onclick="openSnapshot('${s.id}')">
        <span style="font-weight:700;font-size:13.5px;">${escapeHtml(s.snapshot_label)}</span>
        <span style="font-size:12px;color:var(--text3);margin-top:2px;">
          미수령 ${Number(s.matched_count) || 0}명 · 코드 ${escapeHtml(Array.isArray(s.filter_codes) ? s.filter_codes.join(', ') : '-')} ${s.include_missing ? ' + 누락' : ''}
        </span>
      </button>
      <button class="btn btn-danger btn-sm" onclick="deleteSnapshot('${s.id}')">삭제</button>
    </div>
  `,
    )
    .join('');
}

window.openSnapshot = function (id) {
  const snap = placementSnapshots.find((s) => s.id === id);
  if (!snap) return;
  placementFiltered = snap.data;
  activeSnapshotId = id;

  const body = document.getElementById('placementResultBody');
  body.innerHTML = placementFiltered
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.contractor)}</td>
      <td>${escapeHtml(r.job || '-')}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${r.code ? escapeHtml(r.code) : '<span style="color:#DC2626;font-weight:700;">누락</span>'}</td>
      <td>${escapeHtml(r.phone || '-')}</td>
    </tr>
  `,
    )
    .join('');

  const contractorCount = new Set(placementFiltered.map((r) => r.contractor))
    .size;
  document.getElementById('placementResultSummary').textContent =
    `[${snap.snapshot_label} 스냅샷] 미수령 ${placementFiltered.length}명 (${contractorCount}개 협력사)`;
  document.getElementById('placementResultArea').style.display = '';
  // 저장된 스냅샷을 다시 저장할 필요는 없으니 저장 버튼 숨김
  document
    .querySelector('#placementResultArea .btn-ok')
    ?.style.setProperty('display', 'none');
  document
    .getElementById('placementResultArea')
    .scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.deleteSnapshot = async function (id) {
  if (!confirm('이 스냅샷을 삭제하시겠습니까?')) return;
  await supabase.from('placement_snapshots').delete().eq('id', id);
  await loadPlacementSnapshots();
  toast('삭제됐습니다');
};

// ═══════════════════════════════════════════════
// 사업자등록증 관리
// ═══════════════════════════════════════════════
async function loadBusinessLicenses() {
  const { data, error } = await supabase
    .from('business_licenses')
    .select('*, contractor:contractor_id(name)')
    .eq('workspace_id', currentWS.id);
  if (error) {
    console.error(error);
    businessLicenses = [];
    return;
  }
  businessLicenses = data || [];
  renderBusinessLicenseStatus();
  renderLicenseAlert();
  renderContractorTags();
}

function renderBusinessLicenseStatus() {
  const statusEl = document.getElementById('businessLicenseStatus');
  const listEl = document.getElementById('businessLicenseList');
  if (!statusEl || !listEl) return;

  const submittedIds = new Set(businessLicenses.map((l) => l.contractor_id));
  const missing = contractors.filter((c) => !submittedIds.has(c.id));

  statusEl.innerHTML = `<span style="color:var(--ok);">제출 ${businessLicenses.length}개</span> / 전체 ${contractors.length}개 협력사
    ${missing.length ? `<span style="color:var(--danger);margin-left:8px;">미제출 ${missing.length}개</span>` : ''}`;

  let html = '';
  if (missing.length) {
    html += `<div style="margin-bottom:14px;">
      <div style="font-size:12.5px;font-weight:700;color:var(--danger);margin-bottom:6px;">⚠️ 미제출 협력사</div>
      <div class="license-missing-list">${missing
        .map(
          (c) => `<div class="license-missing-item">
        <span>${c.name}</span>
        <div>
          <button class="btn btn-outline btn-sm" onclick="openContractorUploadLink('${c.id}')">링크 관리</button>
          <button class="btn btn-primary btn-sm" onclick="uploadLicenseForContractor('${c.id}')">등록증 업로드</button>
        </div>
      </div>`,
        )
        .join('')}</div>
    </div>`;
  }
  if (businessLicenses.length) {
    html += `<div style="font-size:12.5px;font-weight:700;color:var(--text2);margin-bottom:6px;">✅ 제출 완료</div>`;
    html += businessLicenses
      .map(
        (l) => `
      <div class="snapshot-item" style="cursor:default;">
        <div>
          <div style="font-weight:700;font-size:13.5px;">${l.contractor?.name || '알 수 없음'}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">${l.file_name} · ${l.uploaded_by === 'contractor' ? '협력사 제출' : '관리자 업로드'} · ${new Date(l.uploaded_at).toLocaleDateString('ko-KR')}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-outline btn-sm" onclick="viewLicense('${l.id}')">보기</button>
          <button class="btn btn-danger btn-sm" onclick="deleteLicense('${l.id}')">삭제</button>
        </div>
      </div>
    `,
      )
      .join('');
  }
  listEl.innerHTML =
    html ||
    `<div style="color:var(--text3);font-size:13px;padding:8px 0;">데이터가 없습니다</div>`;

  // hidden input for manual upload contractor targeting
  if (!document.getElementById('manualLicenseContractor')) {
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = 'manualLicenseContractor';
    listEl.appendChild(hidden);
  }
}

function renderLicenseAlert() {
  const wrap = document.getElementById('licenseAlertWrap');
  const list = document.getElementById('licenseAlertList');
  if (!wrap || !list) return;
  const submittedIds = new Set(businessLicenses.map((l) => l.contractor_id));
  const missing = contractors.filter((c) => !submittedIds.has(c.id));
  if (!missing.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  list.innerHTML = `<div style="font-size:13px;color:var(--text2);">
    ${missing.map((c) => c.name).join(', ')} — 사업자등록증 미제출
    <button class="btn btn-outline btn-sm" style="margin-left:8px;" onclick="openContractorPage('missing-license')">미제출 관리</button>
  </div>`;
}

window.handleManualLicenseUpload = async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const conId = document.getElementById('manualLicenseContractor')?.value;
  if (!conId) {
    toast('업로드할 협력사를 먼저 선택하세요', 'error');
    e.target.value = '';
    return;
  }

  const ext = file.name.split('.').pop();
  const path = `${currentWS.id}/${conId}_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('business-licenses')
    .upload(path, file, { contentType: file.type, upsert: true });
  if (upErr) {
    toast('업로드 실패: ' + upErr.message, 'error');
    e.target.value = '';
    return;
  }

  const { error } = await supabase.from('business_licenses').upsert(
    {
      workspace_id: currentWS.id,
      contractor_id: conId,
      file_name: file.name,
      file_path: path,
      uploaded_by: 'manager',
    },
    { onConflict: 'contractor_id' },
  );
  if (error) {
    await supabase.storage.from('business-licenses').remove([path]);
    toast('저장 실패: ' + error.message, 'error');
    e.target.value = '';
    return;
  }

  e.target.value = '';
  await loadBusinessLicenses();
  toast('사업자등록증이 업로드됐습니다', 'success');
};

window.viewLicense = async function (id) {
  const lic = businessLicenses.find((l) => l.id === id);
  if (!lic) return;
  const { data, error } = await supabase.storage
    .from('business-licenses')
    .createSignedUrl(lic.file_path, 3600);
  if (error) {
    toast('파일을 열 수 없습니다: ' + error.message, 'error');
    return;
  }
  window.open(data.signedUrl, '_blank');
};

window.deleteLicense = async function (id) {
  const lic = businessLicenses.find((l) => l.id === id);
  if (!lic) return;
  if (!confirm(`${lic.contractor?.name} 사업자등록증을 삭제하시겠습니까?`))
    return;
  const { error: storageError } = await supabase.storage
    .from('business-licenses')
    .remove([lic.file_path]);
  if (storageError) {
    toast('파일 삭제 실패: ' + storageError.message, 'error');
    return;
  }
  const { error } = await supabase
    .from('business_licenses')
    .delete()
    .eq('id', id);
  if (error) {
    toast('등록증 정보 삭제 실패: ' + error.message, 'error');
    return;
  }
  await loadBusinessLicenses();
  toast('삭제됐습니다');
};

window.downloadAllLicenses = async function () {
  if (!businessLicenses.length) {
    toast('다운로드할 사업자등록증이 없습니다', 'error');
    return;
  }
  const zip = new JSZip();
  const folder = zip.folder(`사업자등록증_${currentWS.name}_${today()}`);
  for (const lic of businessLicenses) {
    const { data, error } = await supabase.storage
      .from('business-licenses')
      .download(lic.file_path);
    if (error) continue;
    const ext = lic.file_name.split('.').pop();
    folder.file(`${lic.contractor?.name || '알수없음'}.${ext}`, data);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `사업자등록증_전체_${today()}.zip`);
};

// ═══════════════════════════════════════════════
// 사진 클라우드 (폴더 트리 + 무한 뎁스)
// ═══════════════════════════════════════════════
// (PHOTO_FOLDER_PRESETS → src/data/constants.js 로 이동)

let photoFolders = []; // 전체 폴더 목록 (flat)
let photos = []; // 전체 사진 목록
let activeFolderId = null; // 현재 선택된 폴더
let openFolderIds = new Set(); // 펼쳐진 폴더 집합
let photoThumbUrlCache = {};
let pendingUploadFiles = [];
let draggedPhotoId = null;
let addFolderParentId = null; // 폴더 추가 시 부모 폴더

async function loadPhotoFolders() {
  const { data, error } = await supabase
    .from('photo_folders')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .order('sort_order');
  if (error) {
    console.error(error);
    photoFolders = [];
    return;
  }
  photoFolders = data || [];
}

async function loadPhotos() {
  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .order('shot_date', { ascending: false });
  if (error) {
    console.error(error);
    photos = [];
    return;
  }
  photos = data || [];
}

// ─── 폴더 트리 렌더링 ───
function renderPhotoFolderTree() {
  const el = document.getElementById('photoFolderTree');
  if (!el) return;
  const roots = photoFolders.filter((f) => !f.parent_id);
  if (!roots.length) {
    el.innerHTML = `<div style="padding:20px 14px;font-size:12.5px;color:var(--text3);text-align:center;">폴더가 없습니다<br>위 + 버튼으로 만들어보세요</div>`;
    document.getElementById('photoMainEmpty').style.display = '';
    document.getElementById('photoMainContent').style.display = 'none';
    document.getElementById('photoUploadBtn').disabled = true;
    return;
  }
  document.getElementById('photoUploadBtn').disabled = !activeFolderId;
  el.innerHTML = `<div class="photo-folder-tree">${renderFolderItems(roots, 0)}</div>`;
}

function renderFolderItems(items, depth) {
  return items
    .map((f) => {
      const children = photoFolders.filter((c) => c.parent_id === f.id);
      const hasChildren = children.length > 0;
      const isOpen = openFolderIds.has(f.id);
      const isActive = f.id === activeFolderId;
      const photoCount = getDescendantPhotoCount(f.id);
      const indent = depth * 14;
      return `<div>
      <div class="tree-item ${isActive ? 'active' : ''}" style="padding-left:${12 + indent}px;"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="handleDropOnFolder(event,'${f.id}')">
        <button type="button" class="tree-toggle" aria-label="${hasChildren ? (isOpen ? '하위 폴더 접기' : '하위 폴더 펼치기') : '하위 폴더 없음'}" ${hasChildren ? '' : 'disabled'} onclick="toggleFolderOpen('${f.id}')">
          ${hasChildren ? (isOpen ? '▾' : '▸') : ''}
        </button>
        <button type="button" class="tree-folder-select" onclick="selectPhotoFolder('${f.id}')">
          <span style="margin-right:4px;">📁</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.name)}</span>
          <span style="font-size:11px;color:var(--text3);margin-left:4px;">${photoCount || ''}</span>
        </button>
      </div>
      <div class="tree-children ${isOpen ? 'open' : ''}">
        ${hasChildren ? renderFolderItems(children, depth + 1) : ''}
      </div>
    </div>`;
    })
    .join('');
}

function getDescendantPhotoCount(folderId) {
  const childIds = getAllDescendantIds(folderId);
  childIds.push(folderId);
  return photos.filter((p) => childIds.includes(p.folder_id)).length;
}

function getAllDescendantIds(folderId) {
  const children = photoFolders.filter((f) => f.parent_id === folderId);
  let ids = children.map((f) => f.id);
  children.forEach((c) => {
    ids = ids.concat(getAllDescendantIds(c.id));
  });
  return ids;
}

window.toggleFolderOpen = function (id) {
  if (openFolderIds.has(id)) openFolderIds.delete(id);
  else openFolderIds.add(id);
  renderPhotoFolderTree();
};

window.selectPhotoFolder = function (id) {
  activeFolderId = id;
  openFolderIds.add(id);
  document.getElementById('photoUploadBtn').disabled = false;
  renderPhotoFolderTree();
  renderPhotoMain();
};

function renderPhotoMain() {
  const emptyEl = document.getElementById('photoMainEmpty');
  const contentEl = document.getElementById('photoMainContent');
  if (!activeFolderId) {
    emptyEl.style.display = '';
    contentEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  contentEl.style.display = '';

  const folder = photoFolders.find((f) => f.id === activeFolderId);
  const breadcrumb = getFolderBreadcrumb(activeFolderId).join(' / ');
  document.getElementById('photoMainTitle').textContent = breadcrumb;

  // 날짜별 그룹
  const folderPhotos = photos.filter((p) => p.folder_id === activeFolderId);
  const dateGroups = document.getElementById('photoDateGroups');
  if (!folderPhotos.length) {
    dateGroups.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text3);">
      <div style="font-size:32px;margin-bottom:8px;">🖼️</div>
      <div style="font-size:14px;">이 폴더에 사진이 없습니다</div>
    </div>`;
    return;
  }
  const byDate = {};
  folderPhotos.forEach((p) => {
    (byDate[p.shot_date] ||= []).push(p);
  });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  dateGroups.innerHTML = dates
    .map((d) => {
      const dLabel = new Date(d + 'T00:00:00').toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      });
      return `<div class="photo-date-group">
      <div class="photo-date-label">${dLabel} <span style="font-weight:500;color:var(--text3);">(${byDate[d].length}장)</span></div>
      <div class="photo-grid">${byDate[d]
        .map(
          (p) => `
        <button type="button" class="photo-thumb" draggable="true" id="photo_${p.id}"
            onclick="openPhotoViewer('${p.id}')"
            ondragstart="handlePhotoDragStart(event,'${p.id}')"
            ondragend="handlePhotoDragEnd(event)">
          <img src="${photoThumbUrlCache[p.id] || ''}" data-photo-id="${p.id}" loading="lazy" alt="사진 크게 보기">
        </button>`,
        )
        .join('')}
      </div>
    </div>`;
    })
    .join('');
  loadPhotoThumbnails(folderPhotos);
}

function getFolderBreadcrumb(folderId) {
  const f = photoFolders.find((x) => x.id === folderId);
  if (!f) return [];
  if (!f.parent_id) return [f.name];
  return [...getFolderBreadcrumb(f.parent_id), f.name];
}

async function loadPhotoThumbnails(list) {
  for (const p of list) {
    if (photoThumbUrlCache[p.id]) {
      const img = document.querySelector(`img[data-photo-id="${p.id}"]`);
      if (img) img.src = photoThumbUrlCache[p.id];
      continue;
    }
    const { data } = await supabase.storage
      .from('site-photos')
      .createSignedUrl(p.file_path, 3600);
    if (data) {
      photoThumbUrlCache[p.id] = data.signedUrl;
      const img = document.querySelector(`img[data-photo-id="${p.id}"]`);
      if (img) img.src = data.signedUrl;
    }
  }
}

// ─── 드래그앤드롭 ───
window.handlePhotoDragStart = function (e, photoId) {
  draggedPhotoId = photoId;
  e.dataTransfer.effectAllowed = 'move';
  document.getElementById(`photo_${photoId}`)?.classList.add('dragging');
};
window.handlePhotoDragEnd = function () {
  document
    .getElementById(`photo_${draggedPhotoId}`)
    ?.classList.remove('dragging');
  draggedPhotoId = null;
};

window.handleDropOnFolder = async function (e, targetFolderId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!draggedPhotoId) return;
  const p = photos.find((x) => x.id === draggedPhotoId);
  if (!p || p.folder_id === targetFolderId) return;
  await supabase
    .from('photos')
    .update({ folder_id: targetFolderId })
    .eq('id', draggedPhotoId);
  await loadPhotos();
  renderPhotoFolderTree();
  renderPhotoMain();
  toast('사진을 이동했습니다', 'success');
};

// ─── 폴더 추가/삭제 ───
window.openAddFolderModal = function (parentId) {
  addFolderParentId = parentId;
  const parent = parentId ? photoFolders.find((f) => f.id === parentId) : null;
  document.getElementById('addFolderModalTitle').textContent = parent
    ? `"${parent.name}" 안에 새 폴더`
    : '새 폴더';
  document.getElementById('newFolderName').value = '';

  // 사전 정의 폴더 칩 (이미 있는 것 제외)
  const existing = new Set(
    photoFolders.filter((f) => f.parent_id === parentId).map((f) => f.name),
  );
  const chips = PHOTO_FOLDER_PRESETS.filter((n) => !existing.has(n));
  document.getElementById('folderPresetChips').innerHTML = chips
    .map(
      (n) =>
        `<button type="button" class="tag tag-button" onclick="document.getElementById('newFolderName').value=decodeURIComponent('${encodeURIComponent(n)}')">${escapeHtml(n)}</button>`,
    )
    .join('');
  openModal('addFolderModal');
};

window.confirmAddFolder = async function () {
  const name = document.getElementById('newFolderName').value.trim();
  if (!name) {
    toast('폴더 이름을 입력하세요', 'error');
    return;
  }
  const { error } = await supabase.from('photo_folders').insert({
    workspace_id: currentWS.id,
    name,
    parent_id: addFolderParentId || null,
    sort_order: photoFolders.filter(
      (f) => f.parent_id === (addFolderParentId || null),
    ).length,
  });
  if (error) {
    toast('추가 실패: ' + error.message, 'error');
    return;
  }
  if (addFolderParentId) openFolderIds.add(addFolderParentId);
  await loadPhotoFolders();
  renderPhotoFolderTree();
  closeModal('addFolderModal');
  toast(`"${name}" 폴더가 추가됐습니다`, 'success');
};

window.deleteCurrentFolder = async function () {
  if (!activeFolderId) return;
  const f = photoFolders.find((x) => x.id === activeFolderId);
  if (!f) return;
  const descIds = getAllDescendantIds(activeFolderId);
  descIds.push(activeFolderId);
  const totalPhotos = photos.filter((p) =>
    descIds.includes(p.folder_id),
  ).length;
  if (
    !confirm(
      `"${f.name}" 폴더${descIds.length > 1 ? ` (하위 폴더 ${descIds.length - 1}개 포함)` : ''}를 삭제하시겠습니까?${totalPhotos ? ` 사진 ${totalPhotos}장도 함께 삭제됩니다.` : ''}`,
    )
  )
    return;

  // 사진 스토리지 삭제
  const toDelete = photos.filter((p) => descIds.includes(p.folder_id));
  if (toDelete.length)
    await supabase.storage
      .from('site-photos')
      .remove(toDelete.map((p) => p.file_path));
  // 폴더 삭제 (cascade로 하위 폴더+사진 DB 레코드도 삭제됨)
  await supabase.from('photo_folders').delete().eq('id', activeFolderId);
  activeFolderId = null;
  await loadPhotoFolders();
  await loadPhotos();
  renderPhotoFolderTree();
  renderPhotoMain();
  toast('폴더가 삭제됐습니다');
};

// ─── 사진 업로드 (날짜 지정) ───
window.openPhotoUploadModal = function () {
  if (!activeFolderId) {
    toast('먼저 폴더를 선택하세요', 'error');
    return;
  }
  pendingUploadFiles = [];
  document.getElementById('photoUploadDate').value = today();
  document.getElementById('photoUploadFileList').innerHTML = '';
  document.getElementById('photoUploadConfirmBtn').disabled = true;
  document.getElementById('photoUploadFileInput').value = '';
  openModal('photoUploadModal');
  setTimeout(() => document.getElementById('photoUploadDropZone')?.focus(), 50);
};

function renderPendingUploadList() {
  const listEl = document.getElementById('photoUploadFileList');
  if (!pendingUploadFiles.length) {
    listEl.innerHTML = '';
    document.getElementById('photoUploadConfirmBtn').disabled = true;
    return;
  }
  listEl.innerHTML =
    `선택됨 ${pendingUploadFiles.length}개: ` +
    pendingUploadFiles.map((f) => f.name).join(', ') +
    ` <button onclick="clearPendingUploads()" style="margin-left:6px;background:none;border:none;color:var(--danger);cursor:pointer;font-weight:700;">전체 삭제</button>`;
  document.getElementById('photoUploadConfirmBtn').disabled = false;
}

window.clearPendingUploads = function () {
  pendingUploadFiles = [];
  document.getElementById('photoUploadFileInput').value = '';
  renderPendingUploadList();
};

window.handlePhotoFilesSelected = function (e) {
  const newFiles = Array.from(e.target.files || []);
  pendingUploadFiles = pendingUploadFiles.concat(newFiles);
  renderPendingUploadList();
};

window.handlePhotoPaste = function (e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  let added = 0;
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        const ext = file.type.split('/')[1] || 'png';
        const named = new File(
          [file],
          `붙여넣기_${Date.now()}_${added}.${ext}`,
          { type: file.type },
        );
        pendingUploadFiles.push(named);
        added++;
      }
    }
  }
  if (added > 0) {
    e.preventDefault();
    renderPendingUploadList();
    toast(`이미지 ${added}장이 추가됐습니다`, 'success');
  }
};

window.confirmPhotoUpload = async function () {
  const shotDate = document.getElementById('photoUploadDate').value;
  if (!shotDate) {
    toast('날짜를 선택하세요', 'error');
    return;
  }
  if (!pendingUploadFiles.length) {
    toast('파일을 선택하거나 붙여넣으세요', 'error');
    return;
  }
  if (!activeFolderId) {
    toast('폴더를 먼저 선택하세요', 'error');
    return;
  }

  const btn = document.getElementById('photoUploadConfirmBtn');
  btn.disabled = true;
  btn.textContent = '업로드 중...';

  let success = 0;
  for (const file of pendingUploadFiles) {
    try {
      const ext = file.name.split('.').pop();
      const path = `${currentWS.id}/${activeFolderId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('site-photos')
        .upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from('photos').insert({
        workspace_id: currentWS.id,
        folder_id: activeFolderId,
        uploaded_by: user.id,
        file_path: path,
        file_name: file.name,
        shot_date: shotDate,
      });
      if (dbErr) throw dbErr;
      success++;
    } catch (err) {
      console.error(err);
    }
  }

  btn.disabled = false;
  btn.textContent = '업로드';
  closeModal('photoUploadModal');
  await loadPhotos();
  renderPhotoFolderTree();
  renderPhotoMain();
  toast(
    `${success}장 업로드 완료`,
    success === pendingUploadFiles.length ? 'success' : 'warn',
  );
};

// ─── 사진 뷰어 ───
let viewingPhotoId = null;
window.openPhotoViewer = async function (photoId) {
  const p = photos.find((x) => x.id === photoId);
  if (!p) return;
  viewingPhotoId = photoId;
  const folder = photoFolders.find((f) => f.id === p.folder_id);
  document.getElementById('photoViewTitle').textContent =
    `${folder?.name || ''} · ${p.shot_date}`;
  document.getElementById('photoViewImg').src = photoThumbUrlCache[p.id] || '';
  document.getElementById('photoViewMeta').textContent =
    `촬영일: ${p.shot_date} · 업로드: ${new Date(p.created_at).toLocaleString('ko-KR')} · ${p.file_name}`;
  if (!photoThumbUrlCache[p.id]) {
    const { data } = await supabase.storage
      .from('site-photos')
      .createSignedUrl(p.file_path, 3600);
    if (data) {
      photoThumbUrlCache[p.id] = data.signedUrl;
      document.getElementById('photoViewImg').src = data.signedUrl;
    }
  }
  openModal('photoViewModal');
};

window.deletePhotoFromViewer = async function () {
  if (!viewingPhotoId) return;
  const p = photos.find((x) => x.id === viewingPhotoId);
  if (!p) return;
  if (!confirm('이 사진을 삭제하시겠습니까?')) return;
  await supabase.storage.from('site-photos').remove([p.file_path]);
  await supabase.from('photos').delete().eq('id', p.id);
  closeModal('photoViewModal');
  await loadPhotos();
  renderPhotoFolderTree();
  renderPhotoMain();
  toast('삭제됐습니다');
};

// ─── 사진대지 인쇄 ───
window.openPhotoPrintModal = function () {
  if (!photoFolders.length) {
    toast('먼저 폴더를 추가하세요', 'error');
    return;
  }
  const sel = document.getElementById('printAlbumSelect');
  sel.innerHTML = photoFolders
    .map((f) => {
      const breadcrumb = getFolderBreadcrumb(f.id).join(' / ');
      return `<option value="${f.id}">${breadcrumb}</option>`;
    })
    .join('');
  if (activeFolderId) sel.value = activeFolderId;

  const fPhotos = photos.filter((p) => p.folder_id === sel.value);
  if (fPhotos.length) {
    const dates = fPhotos.map((p) => p.shot_date).sort();
    document.getElementById('printDateFrom').value = dates[0];
    document.getElementById('printDateTo').value = dates[dates.length - 1];
  } else {
    document.getElementById('printDateFrom').value = today();
    document.getElementById('printDateTo').value = today();
  }
  updatePrintPreviewCount();
  sel.onchange = updatePrintPreviewCount;
  document.getElementById('printDateFrom').onchange = updatePrintPreviewCount;
  document.getElementById('printDateTo').onchange = updatePrintPreviewCount;
  openModal('photoPrintModal');
};

function getPrintTargetPhotos() {
  const folderId = document.getElementById('printAlbumSelect').value;
  const from = document.getElementById('printDateFrom').value;
  const to = document.getElementById('printDateTo').value;
  if (!folderId || !from || !to) return [];
  return photos.filter(
    (p) => p.folder_id === folderId && p.shot_date >= from && p.shot_date <= to,
  );
}

function updatePrintPreviewCount() {
  const list = getPrintTargetPhotos();
  const dateCount = new Set(list.map((p) => p.shot_date)).size;
  document.getElementById('printPreviewCount').textContent = list.length
    ? `대상: 사진 ${list.length}장 · ${dateCount}일치`
    : '선택한 기간에 사진이 없습니다';
}

async function resizeImageForDocx(blob, maxDim = 900) {
  const bitmap = await createImageBitmap(blob);
  let { width, height } = bitmap;
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  const outBlob = await new Promise((res) =>
    canvas.toBlob(res, 'image/jpeg', 0.82),
  );
  const buf = await outBlob.arrayBuffer();
  return { buffer: new Uint8Array(buf), width, height };
}

window.generatePhotoLedgerDocx = async function () {
  const list = getPrintTargetPhotos();
  if (!list.length) {
    toast('선택한 기간에 사진이 없습니다', 'error');
    return;
  }
  const layout = document.querySelector(
    'input[name="printLayout"]:checked',
  ).value;
  const cols = 2,
    rows = layout === '2x4' ? 4 : 3,
    perPage = cols * rows;
  const folderId = document.getElementById('printAlbumSelect').value;
  const folderName = getFolderBreadcrumb(folderId).join(' / ');
  const btn = document.getElementById('photoPrintConfirmBtn');
  btn.disabled = true;
  btn.textContent = '생성 중... (0%)';
  try {
    const docx = await import('https://esm.sh/docx@9');
    const {
      Document,
      Packer,
      Paragraph,
      TextRun,
      Table,
      TableRow,
      TableCell,
      ImageRun,
      AlignmentType,
      WidthType,
      HeadingLevel,
      BorderStyle,
      ShadingType,
      PageBreak,
    } = docx;
    const byDate = {};
    list.forEach((p) => {
      (byDate[p.shot_date] ||= []).push(p);
    });
    const dates = Object.keys(byDate).sort();
    const imageCache = {};
    let done = 0;
    for (const p of list) {
      const { data, error } = await supabase.storage
        .from('site-photos')
        .download(p.file_path);
      if (!error && data) {
        try {
          imageCache[p.id] = await resizeImageForDocx(data);
        } catch (e) {
          console.error(e);
        }
      }
      done++;
      btn.textContent = `생성 중... (${Math.round((done / list.length) * 90)}%)`;
    }
    const contentWidthDxa = 9360,
      cellWidthDxa = Math.floor(contentWidthDxa / cols);
    const imgMaxWidthPx = layout === '2x4' ? 220 : 260;
    const children = [];
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(`${currentWS.name} — ${folderName} 사진대지`)],
      }),
    );
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `기간: ${document.getElementById('printDateFrom').value} ~ ${document.getElementById('printDateTo').value}  ·  생성일: ${today()}`,
            size: 20,
            color: '64748B',
          }),
        ],
        spacing: { after: 300 },
      }),
    );
    dates.forEach((d, dIdx) => {
      if (dIdx > 0)
        children.push(new Paragraph({ children: [new PageBreak()] }));
      const dLabel = new Date(d + 'T00:00:00').toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      });
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(dLabel)],
          spacing: { before: dIdx > 0 ? 0 : 100, after: 200 },
        }),
      );
      const dayPhotos = byDate[d];
      for (
        let pageStart = 0;
        pageStart < dayPhotos.length;
        pageStart += perPage
      ) {
        if (pageStart > 0)
          children.push(new Paragraph({ children: [new PageBreak()] }));
        const pagePhotos = dayPhotos.slice(pageStart, pageStart + perPage);
        const tableRows = [];
        for (let r = 0; r < rows; r++) {
          const rowCells = [];
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const p = pagePhotos[idx];
            const img = p ? imageCache[p.id] : null;
            const cellChildren = [];
            if (img) {
              const dispW = imgMaxWidthPx,
                dispH = Math.round(img.height * (dispW / img.width));
              cellChildren.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new ImageRun({
                      data: img.buffer,
                      transformation: { width: dispW, height: dispH },
                      type: 'jpg',
                    }),
                  ],
                }),
              );
              cellChildren.push(
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: p.file_name,
                      size: 14,
                      color: '94A3B8',
                    }),
                  ],
                }),
              );
            } else {
              cellChildren.push(new Paragraph({ children: [new TextRun('')] }));
            }
            rowCells.push(
              new TableCell({
                width: { size: cellWidthDxa, type: WidthType.DXA },
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                  bottom: {
                    style: BorderStyle.SINGLE,
                    size: 4,
                    color: 'E2E8F0',
                  },
                  left: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
                  right: {
                    style: BorderStyle.SINGLE,
                    size: 4,
                    color: 'E2E8F0',
                  },
                },
                margins: { top: 120, bottom: 120, left: 100, right: 100 },
                shading: { fill: 'FFFFFF', type: ShadingType.CLEAR },
                children: cellChildren,
              }),
            );
          }
          tableRows.push(new TableRow({ children: rowCells }));
        }
        children.push(
          new Table({
            width: { size: contentWidthDxa, type: WidthType.DXA },
            columnWidths: Array(cols).fill(cellWidthDxa),
            rows: tableRows,
          }),
        );
      }
    });
    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 24 } } },
        paragraphStyles: [
          {
            id: 'Heading1',
            name: 'Heading 1',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: { size: 32, bold: true, font: 'Arial' },
            paragraph: { spacing: { before: 0, after: 120 }, outlineLevel: 0 },
          },
          {
            id: 'Heading2',
            name: 'Heading 2',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: { size: 26, bold: true, font: 'Arial', color: '1D4ED8' },
            paragraph: {
              spacing: { before: 200, after: 160 },
              outlineLevel: 1,
            },
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
            },
          },
          children,
        },
      ],
    });
    btn.textContent = '생성 중... (95%)';
    const blob = await Packer.toBlob(doc);
    downloadBlob(
      blob,
      `사진대지_${folderName.replace(/\//g, '_')}_${document.getElementById('printDateFrom').value}~${document.getElementById('printDateTo').value}.docx`,
    );
    closeModal('photoPrintModal');
    toast('Word 파일이 생성됐습니다', 'success');
  } catch (err) {
    console.error(err);
    toast('생성 실패: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📄 Word 생성';
  }
};

// ═══════════════════════════════════════════════
// 작업환경측정 연간 체크리스트 (상/하반기)
// ═══════════════════════════════════════════════
let measureRounds = [];

async function loadMeasureRounds() {
  const year = new Date().getFullYear();
  const { data, error } = await supabase
    .from('measure_rounds')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .eq('year', year);
  if (error) {
    console.error(error);
    measureRounds = [];
    return;
  }
  measureRounds = data || [];
  renderMeasureRoundsChecklist();
}

function renderMeasureRoundsChecklist() {
  const el = document.getElementById('measureRoundsChecklist');
  if (!el) return;
  const year = new Date().getFullYear();
  const h1 = measureRounds.find((r) => r.half === 'H1');
  const h2 = measureRounds.find((r) => r.half === 'H2');

  const row = (half, label, rec) => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid var(--border);">
      <input type="checkbox" ${rec?.done ? 'checked' : ''} onchange="toggleMeasureRound('${half}', this.checked)" style="width:18px;height:18px;cursor:pointer;flex-shrink:0;">
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:700;${rec?.done ? 'color:var(--ok);' : ''}">${year}년 ${label} 작업환경측정</div>
        ${rec?.done && rec.done_date ? `<div style="font-size:12px;color:var(--text3);margin-top:2px;">완료일: ${rec.done_date}</div>` : `<div style="font-size:12px;color:var(--text3);margin-top:2px;">미완료</div>`}
      </div>
    </div>`;

  el.innerHTML = row('H1', '상반기', h1) + row('H2', '하반기', h2);
}

window.toggleMeasureRound = async function (half, done) {
  const year = new Date().getFullYear();
  const payload = {
    workspace_id: currentWS.id,
    year,
    half,
    done,
    done_date: done ? today() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('measure_rounds')
    .upsert(payload, { onConflict: 'workspace_id,year,half' });
  if (error) {
    toast('저장 실패: ' + error.message, 'error');
    return;
  }
  await loadMeasureRounds();
  toast(done ? '완료 처리됐습니다' : '미완료로 변경됐습니다', 'success');
};

// ═══════════════════════════════════════════════
// 전체 협력사용 공용 업로드 링크
// ═══════════════════════════════════════════════
let publicLink = null;
let siteDirectoryLink = null;
async function loadSiteDirectoryLink() {
  const {data,error}=await supabase.from('contractor_directory_links').select('*').eq('workspace_id',currentWS.id).maybeSingle();
  siteDirectoryLink=error?null:data;
}

async function loadPublicLink() {
  await loadSiteDirectoryLink();
  const { data, error } = await supabase
    .from('public_upload_links')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .maybeSingle();
  if (error) {
    console.error(error);
    publicLink = null;
    return;
  }
  publicLink = data || null;
}

function renderPublicLinkUI() {
  renderSiteDirectoryLink();
  const emptyEl = document.getElementById('publicLinkEmptyState');
  const activeEl = document.getElementById('publicLinkActiveState');
  if (!emptyEl || !activeEl) return;

  if (!publicLink) {
    emptyEl.style.display = '';
    activeEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  activeEl.style.display = '';

  const url = `${window.location.origin}/upload.html?ptoken=${publicLink.token}`;
  document.getElementById('publicLinkUrl').textContent = url;
  document.getElementById('publicLinkMeta').textContent =
    `발급일: ${new Date(publicLink.created_at).toLocaleDateString('ko-KR')}`;
  document.getElementById('publicLinkAllowMsdsEdit').checked =
    publicLink.allow_msds;
  document.getElementById('publicLinkAllowLicenseEdit').checked =
    publicLink.allow_license;
}

window.generatePublicUploadLink = async function () {
  const allowMsds = document.getElementById('publicLinkAllowMsds').checked;
  const allowLicense = document.getElementById(
    'publicLinkAllowLicense',
  ).checked;
  if (!allowMsds && !allowLicense) {
    toast('최소 하나는 선택해야 합니다', 'error');
    return;
  }

  const token = generateToken();
  const { data, error } = await supabase
    .from('public_upload_links')
    .insert({
      workspace_id: currentWS.id,
      token,
      allow_msds: allowMsds,
      allow_license: allowLicense,
      created_by: user.id,
    })
    .select()
    .single();
  if (error) {
    toast('발급 실패: ' + error.message, 'error');
    return;
  }
  publicLink = data;
  renderPublicLinkUI();
  toast('공용 링크가 발급됐습니다', 'success');
};

window.copyPublicLink = function () {
  if (!publicLink) return;
  const url = `${window.location.origin}/upload.html?ptoken=${publicLink.token}`;
  copyLink(url);
};

window.revokePublicLink = async function () {
  if (!publicLink) return;
  if (
    !confirm(
      '공용 링크를 삭제하면 더 이상 사용할 수 없습니다. 계속하시겠습니까?',
    )
  )
    return;
  await supabase.from('public_upload_links').delete().eq('id', publicLink.id);
  publicLink = null;
  renderPublicLinkUI();
  toast('공용 링크가 삭제됐습니다');
};

window.updatePublicLinkSettings = async function () {
  if (!publicLink) return;
  const allowMsds = document.getElementById('publicLinkAllowMsdsEdit').checked;
  const allowLicense = document.getElementById(
    'publicLinkAllowLicenseEdit',
  ).checked;
  if (!allowMsds && !allowLicense) {
    toast('최소 하나는 선택해야 합니다', 'error');
    document.getElementById('publicLinkAllowMsdsEdit').checked =
      publicLink.allow_msds;
    document.getElementById('publicLinkAllowLicenseEdit').checked =
      publicLink.allow_license;
    return;
  }
  const { error } = await supabase
    .from('public_upload_links')
    .update({ allow_msds: allowMsds, allow_license: allowLicense })
    .eq('id', publicLink.id);
  if (error) {
    toast('설정 변경 실패: ' + error.message, 'error');
    return;
  }
  publicLink.allow_msds = allowMsds;
  publicLink.allow_license = allowLicense;
  toast('설정이 변경됐습니다', 'success');
};
// Site directory uses the same contractors, business_licenses and msds_records.
function renderSiteDirectoryLink() {
  const host = document.getElementById('siteDirectoryLinkState'); if (!host) return;
  const active = siteDirectoryLink?.token && new Date(siteDirectoryLink.expires_at) > new Date();
  document.getElementById('siteDirectoryRevoke').hidden = !active;
  if (!active) { host.innerHTML = '<p class="form-note">발급된 목록 링크가 없습니다. 연락처 조회·수정이 가능하므로 현장 참여자에게만 공유해주세요.</p>'; return; }
  const url = `${location.origin}/contractors.html?dtoken=${encodeURIComponent(siteDirectoryLink.token)}`;
  host.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(currentWS?.name || '현장')} 전체 협력사 리스트 열기 ↗</a><div class="token-url">${escapeHtml(url)}</div><p class="form-note">만료일: ${new Date(siteDirectoryLink.expires_at).toLocaleDateString('ko-KR')}</p>`;
}
window.generateSiteDirectoryLink = async function () {
  const {data,error} = await supabase.rpc('manage_contractor_directory_link',{p_workspace:currentWS.id,p_revoke:false});
  if(error) return toast('목록 링크 발급 실패: '+error.message,'error');
  await loadPublicLink(); renderSiteDirectoryLink(); renderPublicLinkUI();
  copyLink(`${location.origin}/contractors.html?dtoken=${encodeURIComponent(data.token)}`);
};
window.revokeSiteDirectoryLink = async function () {
  if(!confirm('현장 전체 협력사 목록 링크를 해제할까요? 개별 협력사 링크는 계속 사용할 수 있습니다.')) return;
  const {error}=await supabase.rpc('manage_contractor_directory_link',{p_workspace:currentWS.id,p_revoke:true});
  if(error) return toast('목록 링크 해제 실패: '+error.message,'error');
  await loadPublicLink(); renderSiteDirectoryLink(); toast('목록 링크가 해제됐습니다','success');
};
window.refreshContractorDirectoryData = async function () {
  await Promise.all([loadContractors(),loadMsdsRecords(),loadBusinessLicenses(),loadPublicLink()]);
  renderContractorTags(); renderSiteDirectoryLink(); toast('협력사 정보를 갱신했습니다','success');
};
window.editContractorContact = function (id) {
  const c=contractors.find(c=>c.id===id); if(!c)return;
  document.getElementById('contactContractorId').value=id;
  document.getElementById('contactContractorName').textContent=c.name;
  document.getElementById('contactManagerName').value=c.manager_name || '';
  document.getElementById('contactManagerPhone').value=c.manager_phone || '';
  document.getElementById('contactError').textContent='';
  document.getElementById('contractorContactDialog').showModal();
  document.getElementById('contactManagerName').focus();
};
document.getElementById('contractorContactForm').addEventListener('submit',async event=>{
  event.preventDefault(); const button=document.getElementById('contactSaveButton'); button.disabled=true;
  try {
    const manager_name=document.getElementById('contactManagerName').value.trim();
    const manager_phone=document.getElementById('contactManagerPhone').value.trim();
    if(manager_phone && !/^[0-9+() .-]{7,30}$/.test(manager_phone))throw new Error('전화번호 형식을 확인해주세요');
    const {error}=await supabase.rpc('save_workspace_contractor_contact',{p_workspace:currentWS.id,p_contractor_id:document.getElementById('contactContractorId').value,p_manager_name:manager_name,p_manager_phone:manager_phone});
    if(error)throw error;
    await loadContractors(); document.getElementById('contractorContactDialog').close(); toast('연락처가 저장됐습니다','success');
  }catch(error){document.getElementById('contactError').textContent=error.message;}
  finally{button.disabled=false;}
});

// ═══════════════════════════════════════════════
// 검진 대상자 소팅
// ═══════════════════════════════════════════════
let sortingRows = [];

function parseSortingDate(val) {
  if (!val && val !== 0) return null;
  const s = String(val).trim();
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

function fmtDate(d) {
  if (!d) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function addMonths(d, n) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function diffDays(a, b) {
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

window.handleSortingExcel = function (e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('sortingFileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!raw.length) {
        toast('데이터가 없습니다', 'error');
        return;
      }

      const hKeys = Object.keys(raw[0]);
      const findKey = (...cands) =>
        hKeys.find((h) => cands.some((c) => h.includes(c)));
      const kCon = findKey('협력회사', '협력사', '업체');
      const kJob = findKey('직종');
      const kName = findKey('성명', '이름');
      const kStatus = findKey('재직상태', '재직');
      const kJoin = findKey('최초전입일', '전입일', '입사');
      const kGeneral = findKey('일반');
      const kSpecial = findKey('특수');
      const kPlace = findKey('배치전');

      if (!kCon || !kName || !kStatus) {
        toast('필수 컬럼(협력회사/성명/재직상태)을 찾을 수 없습니다', 'error');
        return;
      }

      const TODAY = new Date();
      TODAY.setHours(0, 0, 0, 0);
      const SPEC_ORDER = {
        '배치전검진 필요': 0,
        '특수검진 기한초과': 1,
        '특수검진 임박': 2,
        '특수검진 주의': 3,
        정상: 4,
      };
      sortingRows = [];

      for (const r of raw) {
        const status = String(r[kStatus] || '').trim();
        if (status !== '재직') continue;
        const name = String(r[kName] || '').trim();
        if (!name) continue;

        const company = String(r[kCon] || '').trim();
        const job = String(r[kJob] || '').trim();
        const joinDate = parseSortingDate(r[kJoin]);
        const generalD = parseSortingDate(r[kGeneral]);
        const specialD = parseSortingDate(r[kSpecial]);
        const placeD = parseSortingDate(r[kPlace]);

        let basisD, nextD, basisLabel, specStatus, specRemain;
        if (specialD) {
          basisD = specialD;
          nextD = addMonths(basisD, 12);
          basisLabel = '특수(정기)';
        } else if (placeD) {
          basisD = placeD;
          nextD = addMonths(basisD, 6);
          basisLabel = '배치전';
        } else {
          basisD = null;
          nextD = null;
          basisLabel = '-';
        }

        if (!basisD) {
          specStatus = '배치전검진 필요';
          specRemain = null;
        } else {
          specRemain = diffDays(nextD, TODAY);
          if (specRemain < 0) specStatus = '특수검진 기한초과';
          else if (specRemain <= 30) specStatus = '특수검진 임박';
          else if (specRemain <= 60) specStatus = '특수검진 주의';
          else specStatus = '정상';
        }

        let genStatus;
        if (generalD) {
          genStatus =
            TODAY.getFullYear() - generalD.getFullYear() <= 1
              ? '정상'
              : '일반검진 필요';
        } else {
          const daysIn = joinDate ? diffDays(TODAY, joinDate) : 0;
          genStatus =
            daysIn > 365 ? '일반검진 필요' : '해당없음(입사 1년 미만)';
        }

        const needs = [];
        if (specStatus !== '정상')
          needs.push(
            specStatus === '배치전검진 필요' ? '배치전검진' : '특수검진',
          );
        if (genStatus === '일반검진 필요') needs.push('일반검진');
        const action = needs.length ? needs.join(' + ') : '없음 (정상)';

        const descs = [];
        if (specStatus === '배치전검진 필요')
          descs.push(
            '배치전검진을 아직 받지 않았습니다. 배치전검진부터 받아야 합니다.',
          );
        else if (specStatus !== '정상' && nextD) {
          const kw =
            specRemain < 0
              ? `기한이 ${Math.abs(specRemain)}일 지났습니다`
              : `예정일이 ${specRemain}일 남았습니다`;
          descs.push(`특수검진 ${kw}. (예정일 ${fmtDate(nextD)})`);
        }
        if (genStatus === '일반검진 필요')
          descs.push(
            '일반건강검진이 필요합니다.' +
              (generalD ? ` (최근: ${fmtDate(generalD)})` : ''),
          );

        sortingRows.push({
          company,
          name,
          job,
          action,
          description: descs.join(' / ') || '정상',
          specStatus,
          basisDate: fmtDate(basisD),
          basisLabel,
          nextDate: fmtDate(nextD) || '-',
          specRemain: specRemain !== null ? specRemain : '',
          generalDate: fmtDate(generalD),
          genStatus,
          _so: SPEC_ORDER[specStatus] ?? 5,
          _sr: specRemain !== null ? specRemain : 9999,
        });
      }

      sortingRows.sort(
        (a, b) =>
          a.company.localeCompare(b.company, 'ko') ||
          a._so - b._so ||
          a._sr - b._sr ||
          a.name.localeCompare(b.name, 'ko'),
      );

      renderSortingResult();
      toast(`${sortingRows.length}명 분석 완료`, 'success');
    } catch (err) {
      console.error(err);
      toast('파싱 실패: ' + err.message, 'error');
    }
  };
  reader.readAsBinaryString(file);
};

function renderSortingResult() {
  const cnt = (s) => sortingRows.filter((r) => r.specStatus === s).length;
  document.getElementById('sortStat0').textContent = cnt('배치전검진 필요');
  document.getElementById('sortStat1').textContent = cnt('특수검진 기한초과');
  document.getElementById('sortStat2').textContent = cnt('특수검진 임박');
  document.getElementById('sortStat3').textContent = cnt('특수검진 주의');
  document.getElementById('sortStat4').textContent = sortingRows.filter(
    (r) => r.genStatus === '일반검진 필요',
  ).length;
  document.getElementById('sortingResultTitle').textContent =
    `재직자 ${sortingRows.length}명 분석 완료 (기준일: ${new Date().toLocaleDateString('ko-KR')})`;

  const SC = {
    '배치전검진 필요': '#FF6B6B',
    '특수검진 기한초과': '#FFC7CE',
    '특수검진 임박': '#FFEB9C',
    '특수검진 주의': '#FFF2CC',
    정상: '#C6EFCE',
  };
  const GC = {
    '일반검진 필요': '#FFC7CE',
    정상: '#C6EFCE',
    '해당없음(입사 1년 미만)': '#F2F2F2',
  };

  document.getElementById('sortingResultBody').innerHTML = sortingRows
    .map(
      (r) => `<tr>
    <td>${r.company}</td><td>${r.name}</td><td>${r.job || '-'}</td>
    <td style="${r.action !== '없음 (정상)' ? 'font-weight:700;color:var(--danger);' : 'color:var(--text3);'}">${r.action}</td>
    <td style="background:${SC[r.specStatus] || ''};">${r.specStatus}</td>
    <td>${r.basisDate || '-'}</td><td>${r.nextDate}</td>
    <td>${r.specRemain !== '' ? r.specRemain + '일' : '-'}</td>
    <td>${r.generalDate || '-'}</td>
    <td style="background:${GC[r.genStatus] || ''};">${r.genStatus}</td>
  </tr>`,
    )
    .join('');

  document.getElementById('sortingSummaryArea').style.display = '';
}

window.downloadSortingExcel = function () {
  if (!sortingRows.length) {
    toast('분석된 데이터가 없습니다', 'error');
    return;
  }
  const headers = [
    '협력회사',
    '성명',
    '직종',
    '지금 수검해야 할 것',
    '설명',
    '특수검진 상태',
    '특수검진 기준일',
    '특수검진 기준구분',
    '특수검진 다음 예정일',
    '특수검진 잔여일',
    '일반검진 최근일',
    '일반검진 상태',
  ];
  const data = sortingRows.map((r) => [
    r.company,
    r.name,
    r.job,
    r.action,
    r.description,
    r.specStatus,
    r.basisDate,
    r.basisLabel,
    r.nextDate,
    r.specRemain !== '' ? r.specRemain : '',
    r.generalDate,
    r.genStatus,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = [18, 10, 18, 26, 52, 18, 13, 12, 16, 10, 13, 18].map((w) => ({
    wch: w,
  }));
  ws['!autofilter'] = { ref: 'A1:L1' };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '검진대상자 소팅');

  const cnt = (s) => sortingRows.filter((r) => r.specStatus === s).length;
  const sumData = [
    ['검진 현황 요약', ''],
    ['', ''],
    ['특수검진', '건수'],
    ['배치전검진 필요', cnt('배치전검진 필요')],
    ['특수검진 기한초과', cnt('특수검진 기한초과')],
    ['특수검진 임박', cnt('특수검진 임박')],
    ['특수검진 주의', cnt('특수검진 주의')],
    ['정상', cnt('정상')],
    ['', ''],
    ['일반건강검진', '건수'],
    [
      '일반검진 필요',
      sortingRows.filter((r) => r.genStatus === '일반검진 필요').length,
    ],
    ['정상', sortingRows.filter((r) => r.genStatus === '정상').length],
    [
      '해당없음(입사 1년 미만)',
      sortingRows.filter((r) => r.genStatus === '해당없음(입사 1년 미만)')
        .length,
    ],
    ['', ''],
    [
      `총 재직자: ${sortingRows.length}명 / 기준일: ${new Date().toLocaleDateString('ko-KR')}`,
      '',
    ],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(sumData);
  ws2['!cols'] = [{ wch: 28 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws2, '요약');

  XLSX.writeFile(wb, `검진대상자_소팅_${today()}.xlsx`);
};
// ═══════════════════════════════════════════════
// 투입인원 (Manpower)
// ═══════════════════════════════════════════════
const MP_TYPE_COLORS = {
  건축: '#2563eb',
  전기: '#d97706',
  설비: '#059669',
  공통: '#7c3aed',
  토목: '#dc2626',
  자재: '#0891b2',
  기술: '#be185d',
  설계: '#78350f',
};
let mpMonth = ''; // 'YYYY-MM'
let mpRecords = []; // 현재 월 DB rows
let mpSelected = new Set();
let mpFilter = '전체';

function mpSelStorageKey() {
  return `fms_mp_sel_${currentWS?.id || ''}`;
}
function mpDaysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function initManpowerPage() {
  if (!mpMonth) {
    const now = new Date();
    mpMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const up = document.getElementById('mpUploadMonth');
  if (up && !up.value) up.value = mpMonth;
  loadManpower();
}

window.mpShiftMonth = function (delta) {
  const [y, m] = mpMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  mpMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  loadManpower();
};

async function loadManpower() {
  document.getElementById('mpMonthLabel').textContent =
    mpMonth.replace('-', '년 ') + '월';
  const start = `${mpMonth}-01`;
  const end = `${mpMonth}-${String(mpDaysInMonth(mpMonth)).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('manpower_records')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .gte('work_date', start)
    .lte('work_date', end);
  if (error) {
    toast('투입인원 로드 실패: ' + error.message, 'error');
    mpRecords = [];
  } else mpRecords = data || [];
  // 선택 복원 (저장분 ∩ 이번 달 실제 협력사), 없으면 전체 선택
  const companies = new Set(mpRecords.map((r) => r.company));
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(mpSelStorageKey()) || '[]');
  } catch {}
  const restored = saved.filter((c) => companies.has(c));
  mpSelected = new Set(restored.length ? restored : companies);
  renderManpower();
}

function mpGrouped() {
  const map = new Map();
  for (const r of mpRecords) {
    if (!map.has(r.company))
      map.set(r.company, {
        company: r.company,
        type: r.work_type || '기타',
        days: {},
      });
    map.get(r.company).days[new Date(r.work_date + 'T00:00:00').getDate()] =
      r.headcount;
  }
  return [...map.values()].sort((a, b) =>
    a.company.localeCompare(b.company, 'ko'),
  );
}

function mpActiveDays(groups) {
  const s = new Set();
  for (const g of groups)
    for (const [d, v] of Object.entries(g.days)) if (v > 0) s.add(Number(d));
  return [...s].sort((a, b) => a - b);
}

function mpSaveSel() {
  localStorage.setItem(mpSelStorageKey(), JSON.stringify([...mpSelected]));
}

function renderManpower() {
  const groups = mpGrouped();
  const activeDays = mpActiveDays(groups);
  const dailySums = {};
  for (const d of activeDays)
    dailySums[d] = groups
      .filter((g) => mpSelected.has(g.company))
      .reduce((s, g) => s + (g.days[d] || 0), 0);
  const totalSum = Object.values(dailySums).reduce((a, b) => a + b, 0);
  const daysWithWork = activeDays.filter((d) => dailySums[d] > 0);
  const maxVal = Math.max(...Object.values(dailySums), 1);

  document.getElementById('mpSumCount').textContent = mpSelected.size;
  document.getElementById('mpSumTotal').textContent = totalSum.toLocaleString();
  document.getElementById('mpSumAvgLabel').textContent =
    `일평균 (${daysWithWork.length}일)`;
  document.getElementById('mpSumAvg').textContent = daysWithWork.length
    ? Math.round(totalSum / daysWithWork.length)
    : 0;
  document.getElementById('mpSelCount').textContent =
    `(${mpSelected.size}/${groups.length})`;

  const chartArea = document.getElementById('mpChartArea');
  if (!groups.length) {
    chartArea.innerHTML =
      '<div class="mp-empty">이 달에 저장된 데이터가 없습니다. 오른쪽 위에서 월을 선택하고 엑셀을 업로드하세요.</div>';
  } else if (!mpSelected.size) {
    chartArea.innerHTML =
      '<div class="mp-empty">왼쪽에서 협력사를 선택하세요</div>';
  } else {
    const bars = activeDays
      .map((d) => {
        const v = dailySums[d] || 0;
        const h = Math.max((v / maxVal) * 130, v > 0 ? 4 : 0);
        const bg =
          v > 0
            ? 'linear-gradient(180deg,#60a5fa,var(--primary))'
            : 'var(--surface2)';
        return `<div class="mp-bar-col"><div class="mp-bar-label" style="${v ? '' : 'visibility:hidden'}">${v}</div><div class="mp-bar-body" style="height:${h}px;background:${bg}"></div></div>`;
      })
      .join('');
    const labels = activeDays
      .map((d) => `<div class="mp-bar-day">${d}</div>`)
      .join('');
    chartArea.innerHTML = `<div class="mp-bar-container">${bars}</div><div class="mp-bar-days">${labels}</div>`;
  }

  const detailCard = document.getElementById('mpDetailCard');
  if (groups.length && mpSelected.size) {
    detailCard.style.display = 'block';
    document.getElementById('mpDetailGrid').innerHTML = activeDays
      .map((d) => {
        const v = dailySums[d] || 0;
        return `<div class="mp-detail-item" style="background:${v ? 'var(--primary-light)' : 'var(--surface2)'};border:1.5px solid ${v ? '#bfdbfe' : 'var(--border)'}">
        <div class="mp-detail-day">${d}일</div><div class="mp-detail-val" style="color:${v ? 'var(--primary)' : 'var(--border2)'}">${v}</div></div>`;
      })
      .join('');
  } else detailCard.style.display = 'none';

  renderMpTypeFilters(groups);
  renderMpCompanyList();
}

function renderMpTypeFilters(groups) {
  groups = groups || mpGrouped();
  const present = new Set(groups.map((g) => g.type));
  const types = [
    '전체',
    ...Object.keys(MP_TYPE_COLORS).filter((t) => present.has(t)),
    ...[...present].filter((t) => !MP_TYPE_COLORS[t]),
  ];
  document.getElementById('mpTypeFilters').innerHTML = types
    .map((t) => {
      const color = MP_TYPE_COLORS[t] || 'var(--primary)';
      const on = mpFilter === t;
      return `<button type="button" class="mp-type-btn" onclick="mpSetFilter(decodeURIComponent('${encodeURIComponent(t)}'))" style="${on ? `background:${color};border-color:${color};color:#fff;font-weight:700` : ''}">${escapeHtml(t)}</button>`;
    })
    .join('');
}

window.mpSetFilter = function (t) {
  mpFilter = t;
  renderMpTypeFilters();
  renderMpCompanyList();
};

window.renderMpCompanyList = function () {
  const q = document.getElementById('mpSearchInput').value.trim();
  const groups = mpGrouped().filter(
    (g) =>
      g.company.includes(q) && (mpFilter === '전체' || g.type === mpFilter),
  );
  const el = document.getElementById('mpCompanyList');
  if (!groups.length) {
    el.innerHTML =
      '<div class="mp-empty" style="padding:16px;">협력사가 없습니다</div>';
    return;
  }
  el.innerHTML = groups
    .map((g) => {
      const on = mpSelected.has(g.company);
      const color = MP_TYPE_COLORS[g.type] || '#64748b';
      return `<button type="button" class="mp-company-item" aria-pressed="${on}" onclick="mpToggleCompany(decodeURIComponent('${encodeURIComponent(g.company)}'))">
      <div class="mp-company-check" style="border-color:${on ? color : 'var(--border2)'};background:${on ? color : 'var(--surface)'}">${on ? '✓' : ''}</div>
      <div class="mp-company-name">${escapeHtml(g.company)}</div>
      <span class="mp-type-badge" style="background:${color}18;color:${color}">${escapeHtml(g.type)}</span>
    </button>`;
    })
    .join('');
};

window.mpToggleCompany = function (c) {
  mpSelected.has(c) ? mpSelected.delete(c) : mpSelected.add(c);
  mpSaveSel();
  renderManpower();
};
window.mpSelectAll = function () {
  const q = document.getElementById('mpSearchInput').value.trim();
  mpGrouped()
    .filter(
      (g) =>
        g.company.includes(q) && (mpFilter === '전체' || g.type === mpFilter),
    )
    .forEach((g) => mpSelected.add(g.company));
  mpSaveSel();
  renderManpower();
};
window.mpClearSel = function () {
  mpSelected.clear();
  mpSaveSel();
  renderManpower();
};

// ── 엑셀 파싱 (협력사[공종] + 직종='전체' 행 + 1~31 일자 컬럼) ──
function parseMpXlsx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        let headerIdx = -1;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].map(String);
          if (
            r.includes('협력사') &&
            r.includes('직종') &&
            r.some((c) => /^1$/.test(c))
          ) {
            headerIdx = i;
            break;
          }
        }
        if (headerIdx === -1)
          throw new Error('헤더 행(협력사·직종·일자)을 찾을 수 없습니다');
        const headers = rows[headerIdx].map(String);
        const companyIdx = headers.indexOf('협력사');
        const jobIdx = headers.indexOf('직종');
        const dayColumns = [];
        for (let c = 0; c < headers.length; c++) {
          const m = headers[c].match(/^(\d+)$/);
          if (m) {
            const d = parseInt(m[1]);
            if (d >= 1 && d <= 31) dayColumns.push({ col: c, day: d });
          }
        }
        const data = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          if (String(row[jobIdx] || '').trim() !== '전체') continue;
          const rawCompany = String(row[companyIdx] || '').trim();
          if (!rawCompany) continue;
          const match = rawCompany.match(/^(.+?)\[(.+?)\]$/);
          const company = match ? match[1] : rawCompany;
          const type = match ? match[2] : '기타';
          const days = {};
          for (const { col, day } of dayColumns) {
            const v = Number(row[col]);
            if (!isNaN(v) && String(row[col]).trim() !== '') days[day] = v;
          }
          data.push({ company, type, days });
        }
        if (!data.length)
          throw new Error("'전체' 직종 행이 있는 협력사를 찾지 못했습니다");
        resolve(data);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

window.handleMpFile = async function (file) {
  if (!file) return;
  if (!file.name.match(/\.xlsx?$/i)) {
    toast('xlsx 파일만 지원됩니다', 'error');
    return;
  }
  const month = document.getElementById('mpUploadMonth').value;
  if (!month) {
    toast('먼저 파일의 해당 월을 선택하세요', 'error');
    return;
  }
  try {
    const parsed = await parseMpXlsx(file);
    const dim = mpDaysInMonth(month);
    // 같은 협력사가 여러 공종으로 나뉘어 여러 행에 등장하는 경우(예: "OO건설[건축]"+"OO건설[전기]")
    // company 기준으로는 동일 키가 되므로, upsert 전에 (협력사, 날짜) 단위로 합산 병합한다.
    // (병합 안 하면 같은 배치 안에 동일 충돌키가 두 번 들어가 Postgres가 'ON CONFLICT DO UPDATE
    //  command cannot affect row a second time' 오류를 낸다.)
    const merged = new Map(); // company -> { types:Set, days:{day:sum} }
    for (const p of parsed) {
      if (!merged.has(p.company))
        merged.set(p.company, { types: new Set(), days: {} });
      const m = merged.get(p.company);
      if (p.type) m.types.add(p.type);
      for (const [d, v] of Object.entries(p.days))
        m.days[d] = (m.days[d] || 0) + v;
    }
    const mergedCount = [...merged.values()].filter(
      (m) => m.types.size > 1,
    ).length;
    const upserts = [];
    for (const [company, m] of merged) {
      const type = [...m.types].slice(0, 3).join('/') || '기타';
      for (const [d, v] of Object.entries(m.days)) {
        const day = Number(d);
        if (day < 1 || day > dim) continue; // 존재하지 않는 날짜(예: 6월 31일)는 건너뜀
        upserts.push({
          workspace_id: currentWS.id,
          work_date: `${month}-${String(day).padStart(2, '0')}`,
          company,
          work_type: type,
          headcount: v,
          updated_at: new Date().toISOString(),
        });
      }
    }
    if (!upserts.length) {
      toast('저장할 인원 데이터가 없습니다', 'error');
      return;
    }
    toast(`저장 중... (${upserts.length}건)`);
    for (let i = 0; i < upserts.length; i += 500) {
      const { error } = await supabase
        .from('manpower_records')
        .upsert(upserts.slice(i, i + 500), {
          onConflict: 'workspace_id,work_date,company',
        });
      if (error) throw error;
    }
    toast(
      `${month} 투입인원 ${upserts.length}건 저장 완료${mergedCount ? ` (여러 공종 협력사 ${mergedCount}곳은 공수 합산 병합)` : ''}`,
      'success',
    );
    mpMonth = month;
    await loadManpower();
  } catch (err) {
    toast('업로드 실패: ' + (err?.message || err), 'error');
  }
};

window.deleteMpMonth = async function () {
  if (!mpRecords.length) {
    toast('삭제할 데이터가 없습니다', 'error');
    return;
  }
  if (
    !confirm(
      `${mpMonth} 투입인원 데이터 ${mpRecords.length}건을 모두 삭제할까요?\n(엑셀을 다시 올리면 복구됩니다)`,
    )
  )
    return;
  const start = `${mpMonth}-01`;
  const end = `${mpMonth}-${String(mpDaysInMonth(mpMonth)).padStart(2, '0')}`;
  const { error } = await supabase
    .from('manpower_records')
    .delete()
    .eq('workspace_id', currentWS.id)
    .gte('work_date', start)
    .lte('work_date', end);
  if (error) {
    toast('삭제 실패: ' + error.message, 'error');
    return;
  }
  toast('삭제됐습니다');
  await loadManpower();
};

// ═══════════════════════════════════════════════
// 알림 (협력사 재업로드 등)
// ═══════════════════════════════════════════════
let notifs = [];
let notifChannel = null;

async function loadNotifications() {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('workspace_id', currentWS.id)
    .order('created_at', { ascending: false })
    .limit(50);
  notifs = data || [];
}

function subscribeNotifications() {
  if (notifChannel) {
    supabase.removeChannel(notifChannel);
    notifChannel = null;
  }
  notifChannel = supabase
    .channel('notif-' + currentWS.id)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `workspace_id=eq.${currentWS.id}`,
      },
      (payload) => {
        notifs.unshift(payload.new);
        toast(
          `🔁 ${payload.new.title} — ${payload.new.body || '재업로드 도착'}`,
          'success',
        );
        renderHomeDashboard();
        loadMsdsRecords(); // 버전업 반영
      },
    )
    .subscribe();
}

window.markNotifRead = async function (id) {
  await supabase.from('notifications').update({ read: true }).eq('id', id);
  const n = notifs.find((x) => x.id === id);
  if (n) n.read = true;
  renderHomeDashboard();
};

window.openNotifRecord = async function (notifId, recordId) {
  await window.markNotifRead(notifId);
  if (msdsRecords.some((r) => r.id === recordId)) {
    showPage('msds');
    showMsdsDetail(recordId);
  }
};

// ═══════════════════════════════════════════════
// MSDS 재업로드 요청
// ═══════════════════════════════════════════════
window.requestReupload = async function (id) {
  const r = msdsRecords.find((x) => x.id === id);
  if (!r) return;
  const reason = prompt(
    `'${r.product_name}' (${r.contractor})\n협력사에 전달할 재업로드 사유를 입력하세요.\n예) 최신 개정본 필요, 제출번호 누락, 스캔 상태 불량`,
    r.reupload_reason || '',
  );
  if (reason === null) return;
  const { error } = await supabase
    .from('msds_records')
    .update({
      reupload_requested: true,
      reupload_reason: reason.trim() || '재업로드 필요',
      reupload_requested_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) {
    toast('요청 실패: ' + error.message, 'error');
    return;
  }
  r.reupload_requested = true;
  r.reupload_reason = reason.trim() || '재업로드 필요';
  renderMsdsTable();
  toast(
    `재업로드 요청됨 — ${r.contractor}가 업로드 링크에 접속하면 표시됩니다`,
    'success',
  );
};

window.cancelReupload = async function (id) {
  const r = msdsRecords.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`'${r.product_name}' 재업로드 요청을 취소할까요?`)) return;
  const { error } = await supabase
    .from('msds_records')
    .update({
      reupload_requested: false,
      reupload_reason: null,
      reupload_requested_at: null,
    })
    .eq('id', id);
  if (error) {
    toast('취소 실패: ' + error.message, 'error');
    return;
  }
  r.reupload_requested = false;
  renderMsdsTable();
  toast('요청이 취소됐습니다');
};

// ═══════════════════════════════════════════════
// 혹서기 날씨 (예보 포스터 + 기상청 A48 예보)
// ═══════════════════════════════════════════════
const WX_REPO = 'dhdh09080/seongdongxi';
let wxSeasonMode = 'auto';
let wxPosterLanguage = 'ko', wxPosterRenderRequest = 0;
let wxWeatherView = 'poster';
let wxViewKey = '';
let wxViewLoaded = new Set();
let wxPageRequest = 0;
let wxForecastPending = null;
let wxForecast = null; // {hours:[{hour,feel}]} — 기상청 예보 (엣지펑션)
let wxTab = 'forecast';
let wxPosterCache = {};
let wxPosterSvg = '';
let wxPosterObjectUrl = '';

async function fetchWxForecast(workspace = {...currentWS}) {
  if (getDevPreviewPage()) {
    return {
      date: kstDate(),
      latitude: workspace.latitude,
      longitude: workspace.longitude,
      address: workspace.address,
      hours: Array.from({length:14}, (_, i) => ({hour:i+6, temp:10+6*Math.sin(i/13*Math.PI), feel:9+7*Math.sin(i/13*Math.PI), humidity:60+i, wind:1.2+(i%5)*0.7})),
      source: 'preview',
    };
  }
  const latitude = Number(workspace?.latitude);
  const longitude = Number(workspace?.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !latitude ||
    !longitude
  ) {
    throw new Error('현장 주소와 좌표를 먼저 설정해주세요');
  }
  const { data, error } = await supabase.functions.invoke('site-weather', {
    body: {
      action: 'forecast',
      address: workspace.address,
      latitude,
      longitude,
    },
  });
  if (error || data?.error) throw new Error(error?.message || data.error);
  return data.result;
}

function renderWxSiteSummary() {
  const name = document.getElementById('wxSiteName');
  const address = document.getElementById('wxSiteAddress');
  const warning = document.getElementById('wxLocationWarning');
  if (!name || !address || !warning) return false;
  const latitude = Number(currentWS?.latitude);
  const longitude = Number(currentWS?.longitude);
  const ready =
    !!currentWS?.address &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0;
  name.textContent = currentWS?.name || '현장명 미설정';
  address.textContent = ready
    ? `${currentWS.address} · ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
    : '저장된 현장 주소·좌표가 없습니다.';
  warning.style.display = ready ? 'none' : 'flex';
  return ready;
}

async function renderWxSitePoster(fc) {
  const request = ++wxPosterRenderRequest;
  const site = {...currentWS}, lang = wxPosterLanguage, mode = wxSeasonMode;
  const font = await loadPosterFont(lang);
  if (request !== wxPosterRenderRequest || fc !== wxForecast) return;
  wxPosterSvg = buildHealthPosterSvg(fc, site, mode, lang, font);
  if (wxPosterObjectUrl) URL.revokeObjectURL(wxPosterObjectUrl);
  wxPosterObjectUrl = URL.createObjectURL(new Blob([wxPosterSvg], {type:'image/svg+xml;charset=utf-8'}));
  const model = posterModel(fc, mode), l = posterLocale(lang);
  document.getElementById('wxLatestPoster').innerHTML =
    `<div class="wx-mobile-health" lang="${lang}" style="font-family:'${l.font}',sans-serif"><h3>${escapeHtml(site.name || l.site)}</h3><p>${escapeHtml(posterDateTitle(model.date,lang))}</p>${model.alerts.map(a=>localizeAlert(a,lang)).map(a=>`<p style="color:${a.color}">${escapeHtml(a.label)} · ${escapeHtml(a.threshold)}</p>`).join('')}<div class="wx-mobile-health-metrics"><div><small>${escapeHtml(l.high)} / ${escapeHtml(l.low)}</small><b>${riskMetric('temp',model.high,'°')} / ${riskMetric('temp',model.low,'°')}</b></div><div><small>${escapeHtml(l.feelHigh)}</small><b>${riskMetric('feel',model.maxFeel,'°C')}</b></div><div><small>${escapeHtml(l.windHigh)}</small><b>${riskMetric('wind',model.maxWind,' m/s')}</b></div></div><h4>${escapeHtml(l.tips)}</h4><ol>${localizeAdvice(model.tips,lang).map(tip=>`<li>${escapeHtml(tip)}</li>`).join('')}</ol></div><a class="wx-poster-original" href="${wxPosterObjectUrl}" target="_blank" rel="noopener" aria-label="포스터 원본 크게 보기"><img class="wx-site-poster" src="${wxPosterObjectUrl}" alt="${escapeHtml(site.name || l.site)} · ${escapeHtml(posterDateTitle(model.date,lang))}" lang="${lang}"></a><p class="wx-detail-note"><a class="wx-poster-open-link" href="${wxPosterObjectUrl}" target="_blank" rel="noopener">포스터 원본 크게 보기 ↗</a> · PNG로 저장해 현장에 게시하거나 공유하세요.</p>`;
  document.getElementById('wxDownloadPosterBtn').style.display = 'inline-flex';
}
window.setWxPosterLanguage = async function(lang) {
  wxPosterLanguage = posterLocale(lang).lang;
  if (wxForecast) {
    document.getElementById('wxDownloadPosterBtn').style.display = 'none';
    wxPosterSvg = '';
    try { await renderWxSitePoster(wxForecast); }
    catch(error) { toast(error.message, 'error'); }
  }
};

window.printWxSitePoster = function () {
  if (!wxPosterSvg) { toast('포스터를 먼저 생성해주세요', 'error'); return; }
  openPrintWindow(`<!doctype html><html lang="${wxPosterLanguage}"><head><meta charset="utf-8"><title>현장 오늘의 날씨 · A4</title><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}body>svg{display:block;width:210mm;height:297mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${wxPosterSvg}</body></html>`);
};

window.downloadWxSitePoster = function () {
  if (!wxPosterSvg) {
    toast('포스터를 먼저 생성해주세요', 'error');
    return;
  }
  const url = URL.createObjectURL(
    new Blob([wxPosterSvg], { type: 'image/svg+xml;charset=utf-8' }),
  );
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = A4_POSTER.exportWidth;
    canvas.height = A4_POSTER.exportHeight;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(
      (blob) =>
        blob &&
        downloadBlob(
          blob,
          `현장_날씨_${currentWS?.name || '현장'}_${kstDate()}_${wxPosterLanguage}.png`,
        ),
      'image/png',
    );
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast('포스터 저장에 실패했습니다', 'error');
  };
  img.src = url;
};

async function fetchWxPosterList(kind) {
  if (!wxPosterCache[kind]) {
    const res = await fetch(
      `https://api.github.com/repos/${WX_REPO}/contents/snapshots/${kind}`,
    );
    if (!res.ok)
      throw new Error(
        res.status === 403
          ? 'GitHub 조회 한도 초과 — 잠시 후 다시 시도하세요'
          : '포스터 목록 조회 실패',
      );
    const files = await res.json();
    wxPosterCache[kind] = (files || [])
      .filter((f) => /\.(png|jpe?g)$/i.test(f.name))
      .sort((a, b) => b.name.localeCompare(a.name));
  }
  return wxPosterCache[kind];
}

function wxHourlyHtml(fc) {
  return hourlyWeatherHtml(fc, wxSeasonMode);
}

async function loadDashWeather() {
  const card = document.getElementById('dashWeatherCard');
  const body = document.getElementById('dashWeatherBody');
  if (!card || !body) return;
  const head = `<div class="dash-section-header" style="margin-bottom:8px;"><div class="dash-section-title">☀️ 오늘 체감온도 예보</div><span style="font-size:12px;color:var(--text3);">혹서기 날씨 →</span></div>`;
  try {
    if (!wxForecast) wxForecast = await fetchWxForecast();
    card.style.display = 'block';
    body.innerHTML = head + wxHourlyHtml(wxForecast);
  } catch {
    card.style.display = 'none';
  }
}

window.setWxSeasonMode = function (mode) {
  wxSeasonMode = ['auto', 'summer', 'transition', 'winter'].includes(mode) ? mode : 'auto';
  if (wxForecast) renderWxSitePoster(wxForecast).catch(error => toast(error.message, 'error'));
};

window.setWeatherView = function (view) {
  const views = ['poster', 'hourly', 'forecast', 'observations', 'archive'];
  if (!views.includes(view)) return;
  wxWeatherView = view;
  views.forEach(key => {
    const active = key === view;
    const button = document.getElementById('wxView-' + key);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    document.getElementById('wxPanel-' + key).hidden = !active;
  });
  loadWeatherPage();
};
window.weatherViewKeydown = function (event) {
  const tabs = [...document.querySelectorAll('.wx-view-tabs [role="tab"]')];
  const index = tabs.indexOf(event.currentTarget);
  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
  if (next === null) return;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
};

window.loadWeatherPage = async function (force) {
  const key = `${JSON.stringify([currentWS?.id,currentWS?.name,currentWS?.address,currentWS?.latitude,currentWS?.longitude])}:${kstDate()}`;
  if (force || key !== wxViewKey) {
    wxViewKey = key;
    ++wxPosterRenderRequest;
    ++wxPageRequest;
    wxViewLoaded.clear();
    wxForecast = null;
    wxForecastPending = null;
    wxPosterCache = {};
    wxPosterSvg = '';
    document.getElementById('wxDownloadPosterBtn').style.display = 'none';
  }
  const ready = renderWxSiteSummary();
  const view = wxWeatherView;
  if (wxViewLoaded.has(view)) return;
  const options = { workspace: currentWS, invoke: invokeEdgeJson, preview: !!getDevPreviewPage(), weatherIcon: gsWeatherIcon, weatherLabel: gsWeatherLabel };
  if (view === 'forecast') { await loadWeatherDetail(options); if (key === wxViewKey) wxViewLoaded.add(view); return; }
  if (view === 'observations') { await loadWeatherObservations(options); if (key === wxViewKey) wxViewLoaded.add(view); return; }
  if (view === 'archive') { await loadWxPosters(); if (key === wxViewKey) wxViewLoaded.add(view); return; }
  const token = ++wxPageRequest;
  const latest = document.getElementById('wxLatestPoster');
  const el = document.getElementById('wxTodayBody');
  if (!ready) {
    latest.innerHTML = '<div class="mp-empty">현장 주소를 설정하면 오늘의 건강관리 포스터가 생성됩니다.</div>';
    el.innerHTML = '<div class="mp-empty">현장 주소를 설정하면 시간별 기온·체감온도·풍속을 볼 수 있습니다.</div>';
    return;
  }
  if (!wxForecast) {
    latest.innerHTML = '<div class="mp-empty" role="status">오늘의 건강관리 포스터를 준비하고 있습니다…</div>';
    el.innerHTML = '<div class="mp-empty" role="status">시간별 그래프를 준비하고 있습니다…</div>';
  }
  try {
    if (!wxForecastPending) wxForecastPending = wxForecast ? Promise.resolve(wxForecast) : fetchWxForecast();
    const forecast = await wxForecastPending;
    if (key !== wxViewKey || token !== wxPageRequest) return;
    wxForecast = forecast;
    await renderWxSitePoster(forecast);
    el.innerHTML = wxHourlyHtml(forecast);
    wxViewLoaded.add('poster');
    wxViewLoaded.add('hourly');
  } catch (error) {
    if (key !== wxViewKey || token !== wxPageRequest) return;
    const message = `<div class="mp-empty">${escapeHtml(error.message)}<br><button class="btn btn-outline btn-sm" onclick="loadWeatherPage(true)">다시 시도</button></div>`;
    latest.innerHTML = message;
    el.innerHTML = message;
    document.getElementById('wxDownloadPosterBtn').style.display = 'none';
    wxForecastPending = null;
  }
};

// A screen left open overnight gets a new forecast and new daily health guidance.
function refreshWeatherDate() {
  if (document.getElementById('page-weather')?.classList.contains('active') && wxViewKey && !wxViewKey.endsWith(kstDate())) loadWeatherPage(true);
}
setInterval(refreshWeatherDate, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshWeatherDate(); });

async function loadWxPosters() {
  const grid = document.getElementById('wxPosterGrid');
  document.getElementById('wxTabForecast').className =
    'btn btn-sm ' + (wxTab === 'forecast' ? 'btn-primary' : 'btn-secondary');
  document.getElementById('wxTabDaily').className =
    'btn btn-sm ' + (wxTab === 'daily' ? 'btn-primary' : 'btn-secondary');
  try {
    const list = (await fetchWxPosterList(wxTab)).slice(0, 30);
    if (!list.length) {
      grid.innerHTML = '<div class="mp-empty">포스터가 없습니다</div>';
      return;
    }
    grid.innerHTML = list
      .map((f) => {
        const m = f.name.match(/(\d{4})(\d{2})(\d{2})[_-]?(\d{2})?(\d{2})?/);
        const label = m
          ? `${m[1]}.${m[2]}.${m[3]}${m[4] ? ` ${m[4]}:${m[5] || '00'}` : ''}`
          : f.name;
        const downloadUrl = safeHttpUrl(f.download_url);
        if (!downloadUrl) return '';
        return `<a class="wx-poster" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeHtml(downloadUrl)}" loading="lazy" alt="${escapeHtml(label)}">
        <div class="wx-poster-label">${escapeHtml(label)}</div>
      </a>`;
      })
      .join('');
  } catch (e) {
    grid.innerHTML = `<div class="mp-empty">${escapeHtml(e.message)}</div>`;
  }
}
window.wxSetTab = function (t) {
  wxTab = t;
  loadWxPosters();
};

// ═══════════════════════════════════════════════
// 취약자 명단 (전입 5일 / 혈압 소견 / 고령자)
// ═══════════════════════════════════════════════
let vulGroups = null; // {g1,g2,g3, baseDate}
const VUL_DEFS = [
  {
    key: 'g1',
    title: '전입 5일 이내 근로자',
    sub: '열순응 프로그램 적용 · 배치전 검진 확인',
    color: '#1d4ed8',
    fname: '전입5일이내',
  },
  {
    key: 'g2',
    title: '혈압 관련 소견자',
    sub: '고온 작업 배치 시 특별 주의 · 우선 보호',
    color: '#c2410c',
    fname: '혈압소견자',
  },
  {
    key: 'g3',
    title: '고령 근로자 (만 60세 이상)',
    sub: '폭염·중량물 작업 시 우선 보호 대상',
    color: '#6d28d9',
    fname: '고령근로자',
  },
];

window.handleVulFile = function (file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
        defval: '',
      });
      const active = rows.filter(
        (r) => String(r['재직상태'] || '').trim() === '재직',
      );
      if (!active.length)
        throw new Error(
          "'재직상태' 컬럼에서 재직자를 찾지 못했습니다 — 건강진단 목록 원본 엑셀인지 확인하세요",
        );
      const now = new Date();
      const g1 = active.filter((r) => {
        const d = new Date(r['최초전입일']);
        return !isNaN(d) && (now - d) / 86400000 <= 5;
      });
      const g2 = active.filter(
        (r) =>
          /혈압|고혈압/.test(String(r['메모'] || '')) ||
          String(r['혈압'] || '').trim() === 'Y',
      );
      const g3 = active.filter(
        (r) =>
          String(r['고령근로자여부'] || '').trim() === 'Y' ||
          String(r['만나이'] || '').includes('고령'),
      );
      const byName = (a, b) =>
        String(a['협력회사']).localeCompare(String(b['협력회사']), 'ko') ||
        String(a['성명']).localeCompare(String(b['성명']), 'ko');
      vulGroups = {
        g1: g1.sort(byName),
        g2: g2.sort(byName),
        g3: g3.sort(byName),
        baseDate: today(),
      };
      renderVulGroups();
      toast(`재직 ${active.length}명 분석 완료`, 'success');
    } catch (err) {
      toast('분석 실패: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
};

function vulAge(r) {
  return String(r['만나이'] || '')
    .replace('(고령자)', '')
    .trim();
}

function renderVulGroups() {
  const { g1, g2, g3, baseDate } = vulGroups;
  document.getElementById('vulEmpty').style.display = 'none';
  document.getElementById('vulResult').style.display = 'block';
  document.getElementById('vulExcelBtn').style.display = 'inline-block';
  document.getElementById('vulCnt1').textContent = g1.length;
  document.getElementById('vulCnt2').textContent = g2.length;
  document.getElementById('vulCnt3').textContent = g3.length;
  const groups = { g1, g2, g3 };
  document.getElementById('vulGroups').innerHTML = VUL_DEFS.map((def) => {
    const rows = groups[def.key];
    const body = rows.length
      ? rows
          .map(
            (r, i) => `<tr>
        <td style="text-align:center;color:var(--text3);">${i + 1}</td>
        <td>${r['협력회사'] || '-'}</td>
        <td style="font-weight:700;">${r['성명'] || '-'}</td>
        <td>${r['직종'] || '-'}</td>
        <td style="color:${def.color};font-weight:700;">${vulAge(r)}</td>
        <td>${r['국적'] || '-'}</td>
        <td>${def.key === 'g1' ? String(r['최초전입일']).split(' ')[0] || '-' : String(r['혈압']).trim() === 'Y' ? '혈압 Y' : '-'}</td>
        <td style="font-size:11.5px;color:var(--text2);">${String(r['메모'] || '').slice(0, 30)}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:14px;">해당 없음</td></tr>`;
    return `<div class="card vul-card" style="border-top-color:${def.color};">
      <div class="dash-section-header">
        <div>
          <div class="dash-section-title" style="color:${def.color};">${def.title} <span style="color:var(--text3);font-weight:400;font-size:13px;">${rows.length}명 · 기준일 ${baseDate}</span></div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">${def.sub}</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="downloadVulImage('${def.key}')" ${rows.length ? '' : 'disabled'}>📷 카톡용 이미지</button>
      </div>
      <div id="vulCapture-${def.key}" style="background:#fff;padding:6px 2px;">
        <div style="display:none;font-weight:800;font-size:16px;color:${def.color};padding:8px 6px;" class="vul-cap-title">${def.title} — ${rows.length}명 (기준일 ${baseDate}) · ${currentWS?.name || '현장'}</div>
        <table class="vul-table">
          <thead><tr><th style="width:30px;">No</th><th>협력회사</th><th>성명</th><th>직종</th><th>나이</th><th>국적</th><th>${VUL_DEFS[0].key === 'g1' ? '' : ''}${def.key === 'g1' ? '전입일' : '혈압'}</th><th>메모</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

window.downloadVulImage = async function (key) {
  const el = document.getElementById('vulCapture-' + key);
  if (!el || typeof html2canvas === 'undefined') {
    toast('이미지 모듈 로드 실패 — 새로고침 후 시도하세요', 'error');
    return;
  }
  const title = el.querySelector('.vul-cap-title');
  title.style.display = 'block';
  try {
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
    });
    const def = VUL_DEFS.find((d) => d.key === key);
    const a = document.createElement('a');
    a.download = `${def.fname}_${vulGroups.baseDate}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    toast('이미지가 저장됐습니다 — 카톡에 바로 올리세요', 'success');
  } catch (e) {
    toast('이미지 생성 실패: ' + e.message, 'error');
  }
  title.style.display = 'none';
};

window.downloadVulSignSheet = function () {
  if (!vulGroups) return;
  const wb = XLSX.utils.book_new();
  const groups = { g1: vulGroups.g1, g2: vulGroups.g2, g3: vulGroups.g3 };
  VUL_DEFS.forEach((def) => {
    const rows = groups[def.key];
    const aoa = [
      [`${def.title} 확인 서명대지`],
      [
        `현장: ${currentWS?.name || '현장'} · 기준일: ${vulGroups.baseDate} · 대상 ${rows.length}명`,
      ],
      [],
      ['No', '협력회사', '성명', '직종', '나이', '국적', '서명'],
      ...rows.map((r, i) => [
        i + 1,
        r['협력회사'] || '',
        r['성명'] || '',
        r['직종'] || '',
        vulAge(r),
        r['국적'] || '',
        '',
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 5 },
      { wch: 16 },
      { wch: 10 },
      { wch: 12 },
      { wch: 8 },
      { wch: 8 },
      { wch: 22 },
    ];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
    ];
    ws['!rows'] = aoa.map((_, i) => ({ hpt: i >= 4 ? 26 : undefined })); // 서명 공간 확보
    XLSX.utils.book_append_sheet(wb, ws, def.fname.slice(0, 28));
  });
  XLSX.writeFile(wb, `취약자_서명대지_${vulGroups.baseDate}.xlsx`);
  toast('서명대지 엑셀 저장 완료 (그룹별 3개 시트)', 'success');
};

// ═══════════════════════════════════════════════
// KOSHA 화학물질정보 연계
// ═══════════════════════════════════════════════
window.openKosha = function (cas) {
  const c = (cas || '').trim();
  if (c) {
    navigator.clipboard?.writeText(c).then(
      () => toast(`CAS ${c} 복사됨 — KOSHA 검색창에 붙여넣으세요`, 'success'),
      () => {},
    );
  }
  window.open(
    'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchAll.do',
    '_blank',
  );
};

// ═══════════════════════════════════════════════
// 고령자 혈압측정 (매주 월·화)
// ═══════════════════════════════════════════════
let bpList = null; // 고령자 rows
let bpBaseDate = null;

function extractElderly(activeRows) {
  return activeRows
    .filter(
      (r) =>
        String(r['고령근로자여부'] || '').trim() === 'Y' ||
        String(r['만나이'] || '').includes('고령'),
    )
    .sort(
      (a, b) =>
        String(a['협력회사']).localeCompare(String(b['협력회사']), 'ko') ||
        String(a['성명']).localeCompare(String(b['성명']), 'ko'),
    );
}

window.handleBpFile = function (file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
        defval: '',
      });
      const active = rows.filter(
        (r) => String(r['재직상태'] || '').trim() === '재직',
      );
      if (!active.length)
        throw new Error("'재직상태' 컬럼에서 재직자를 찾지 못했습니다");
      bpList = extractElderly(active);
      bpBaseDate = today();
      renderBpPage();
      toast(`고령근로자 ${bpList.length}명 추출 완료`, 'success');
    } catch (err) {
      toast('분석 실패: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
};

function initBpPage() {
  // 취약자 명단에서 이미 분석했으면 이어받기
  if (!bpList && vulGroups?.g3?.length) {
    bpList = vulGroups.g3;
    bpBaseDate = vulGroups.baseDate;
  }
  // 이번 주 월요일 기본값
  const inp = document.getElementById('bpMonday');
  if (inp && !inp.value) {
    const d = new Date();
    const day = d.getDay(); // 0=일
    d.setDate(d.getDate() - ((day + 6) % 7)); // 이번 주 월요일
    inp.value = d.toISOString().slice(0, 10);
  }
  if (bpList) renderBpPage();
}

function renderBpPage() {
  if (!bpList) return;
  document.getElementById('bpEmpty').style.display = 'none';
  document.getElementById('bpResult').style.display = 'block';
  document.getElementById('bpSheetBtn').style.display = 'inline-block';
  document.getElementById('bpCount').textContent =
    `${bpList.length}명 · 기준일 ${bpBaseDate}`;
  document.getElementById('bpTableBody').innerHTML = bpList.length
    ? bpList
        .map(
          (r, i) => `<tr>
      <td style="text-align:center;color:var(--text3);">${i + 1}</td>
      <td>${r['협력회사'] || '-'}</td>
      <td style="font-weight:700;">${r['성명'] || '-'}</td>
      <td>${r['직종'] || '-'}</td>
      <td style="color:#6d28d9;font-weight:700;">${vulAge(r)}</td>
      <td>${r['국적'] || '-'}</td>
      <td style="text-align:center;">${String(r['혈압'] || '').trim() === 'Y' ? '<b style="color:var(--danger)">Y</b>' : '-'}</td>
      <td style="font-size:11.5px;color:var(--text2);">${String(r['메모'] || '').slice(0, 26)}</td>
    </tr>`,
        )
        .join('')
    : '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:14px;">고령근로자가 없습니다</td></tr>';
}

window.downloadBpImage = async function () {
  const el = document.getElementById('bpCapture');
  if (!el || typeof html2canvas === 'undefined') {
    toast('이미지 모듈 로드 실패 — 새로고침 후 시도하세요', 'error');
    return;
  }
  const t = document.getElementById('bpCapTitle');
  t.textContent = `🩺 고령근로자 혈압측정 대상 명단 — ${bpList.length}명 (매주 월·화 측정 · 기준일 ${bpBaseDate}) · ${currentWS?.name || '현장'}`;
  t.style.display = 'block';
  try {
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
    });
    const a = document.createElement('a');
    a.download = `고령자_혈압측정명단_${bpBaseDate}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    toast('이미지 저장 완료 — 카톡에 올리세요', 'success');
  } catch (e) {
    toast('이미지 생성 실패: ' + e.message, 'error');
  }
  t.style.display = 'none';
};

window.downloadBpSheet = function () {
  if (!bpList?.length) {
    toast('고령근로자 명단이 없습니다', 'error');
    return;
  }
  const mon = document.getElementById('bpMonday').value;
  if (!mon) {
    toast('측정 주간의 월요일을 선택하세요', 'error');
    return;
  }
  const monD = new Date(mon + 'T00:00:00');
  const tueD = new Date(monD.getTime() + 86400000);
  const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const aoa = [
    ['고령근로자 주간 혈압측정 기록지'],
    [
      `현장: ${currentWS?.name || '현장'} · 측정주간: ${fmt(monD)}(월) ~ ${fmt(tueD)}(화) · 대상 ${bpList.length}명`,
    ],
    [],
    [
      'No',
      '협력회사',
      '성명',
      '직종',
      '나이',
      `${fmt(monD)}(월) 혈압`,
      '서명',
      `${fmt(tueD)}(화) 혈압`,
      '서명',
    ],
    ...bpList.map((r, i) => [
      i + 1,
      r['협력회사'] || '',
      r['성명'] || '',
      r['직종'] || '',
      vulAge(r),
      '',
      '',
      '',
      '',
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 5 },
    { wch: 15 },
    { wch: 9 },
    { wch: 11 },
    { wch: 7 },
    { wch: 13 },
    { wch: 12 },
    { wch: 13 },
    { wch: 12 },
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
  ];
  ws['!rows'] = aoa.map((_, i) => ({ hpt: i >= 4 ? 27 : undefined }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '혈압측정');
  XLSX.writeFile(wb, `고령자_혈압측정기록지_${mon}.xlsx`);
  toast('측정 기록지 저장 완료 (월·화 혈압/서명란 포함)', 'success');
};

// ═══════════════════════════════════════════════
// KOSHA 물질 검색 (kosha-search 엣지펑션)
// ═══════════════════════════════════════════════
window.openKoshaSearch = function () {
  document.getElementById('koshaResults').innerHTML =
    '<div class="mp-empty" style="padding:20px;">검색어를 입력하세요</div>';
  openModal('koshaModal');
  setTimeout(() => document.getElementById('koshaQuery')?.focus(), 100);
};

window.runKoshaSearch = async function () {
  const q = document.getElementById('koshaQuery').value.trim();
  const mode = document.getElementById('koshaMode').value;
  const out = document.getElementById('koshaResults');
  const btn = document.getElementById('koshaSearchBtn');
  if (!q) {
    toast('검색어를 입력하세요', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = '검색 중...';
  out.innerHTML =
    '<div class="mp-empty" style="padding:20px;">KOSHA 데이터베이스 조회 중...</div>';
  try {
    const { data, error } = await supabase.functions.invoke('kosha-search', {
      body: { query: q, mode },
    });
    if (error || data?.error) throw new Error(error?.message || data.error);
    const { list, firstDetail } = data.result;
    if (!list.length) {
      out.innerHTML =
        '<div class="mp-empty" style="padding:20px;">검색 결과가 없습니다 — 다른 이름이나 CAS로 시도해보세요</div>';
      return;
    }
    out.innerHTML = list
      .map(
        (c, i) => `
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <b style="font-size:14px;">${c.name}</b>
          <span class="badge badge-gray">CAS ${c.casNo || '-'}</span>
          ${c.keNo ? `<span class="badge badge-gray">${c.keNo}</span>` : ''}
          <a href="https://msds.kosha.or.kr/MSDSInfo/kcic/msdsdetail.do?chem_id=${c.chemId}" target="_blank" class="btn btn-outline btn-sm" style="margin-left:auto;">KOSHA 원문 →</a>
        </div>
        ${i === 0 && firstDetail?.lines?.length ? `<div style="margin-top:8px;font-size:12px;color:var(--text2);border-top:1px dashed var(--border);padding-top:8px;">${firstDetail.lines.map((l) => `<div style="padding:2px 0;">· ${l}</div>`).join('')}</div>` : ''}
      </div>`,
      )
      .join('');
  } catch (e) {
    out.innerHTML = `<div class="mp-empty" style="padding:20px;">${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '검색';
  }
};

// ═══════════════════════════════════════════════
// ── 조문 검색: 키워드 하나로 여러 법령의 조문을 한번에 훑어서 법령별 카드로 표시 ──
window.clauseQuick = function (q) {
  document.getElementById('clauseQuery').value = q;
  runClauseSearch();
};

function clauseCardHtml(title, bodyHtml, badge) {
  return `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;">
    <div style="background:var(--primary);color:#fff;padding:10px 14px;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:space-between;">
      <span>${escapeHtml(title)}</span>${badge ? `<span style="font-size:11px;font-weight:600;opacity:.85;">${escapeHtml(badge)}</span>` : ''}
    </div>
    <div style="max-height:260px;overflow-y:auto;padding:10px 14px;">${bodyHtml}</div>
  </div>`;
}

window.clauseSearchStore = []; // 팝업에서 참조할 최근 검색 결과 (법령별 원문 보관) — inline onclick에서 접근해야 해서 window에 부착
window.koshaGuideSearchStore = [];
let clauseSearchQuery = '';

function highlightedSearchHtml(value, query = clauseSearchQuery) {
  const text = String(value ?? '');
  const keyword = String(query ?? '').trim();
  if (!keyword) return escapeHtml(text);

  const source = text.toLocaleLowerCase('ko');
  const target = keyword.toLocaleLowerCase('ko');
  let cursor = 0;
  let index = source.indexOf(target);
  if (index < 0) return escapeHtml(text);

  let html = '';
  while (index >= 0) {
    html += escapeHtml(text.slice(cursor, index));
    html += `<mark class="search-keyword-mark">${escapeHtml(text.slice(index, index + keyword.length))}</mark>`;
    cursor = index + keyword.length;
    index = source.indexOf(target, cursor);
  }
  return html + escapeHtml(text.slice(cursor));
}

window.openClauseDetail = function (lawName, jo, title, content) {
  document.getElementById('clauseDetailTitle').textContent =
    `${lawName} 제${jo}조${title ? ' ' + title : ''}`;
  document.getElementById('clauseDetailKeyword').innerHTML =
    `검색어 <b>${escapeHtml(clauseSearchQuery)}</b>가 강조되어 있습니다.`;
  document.getElementById('clauseDetailBody').innerHTML =
    highlightedSearchHtml(content);
  openModal('clauseDetailModal');
};

window.openKoshaGuideDetail = function (index) {
  const guide = window.koshaGuideSearchStore[index];
  if (!guide) return;

  document.getElementById('koshaGuideDetailTitle').innerHTML =
    highlightedSearchHtml(guide.title || 'KOSHA GUIDE');
  const meta = [
    guide.guideNo
      ? `<span><b>지침번호</b> ${escapeHtml(guide.guideNo)}</span>`
      : '',
    guide.category
      ? `<span><b>분야</b> ${escapeHtml(guide.category)}</span>`
      : '',
    guide.date ? `<span><b>공표일</b> ${escapeHtml(guide.date)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  document.getElementById('koshaGuideDetailMeta').innerHTML =
    meta || '<span>상세 정보 없음</span>';
  document.getElementById('koshaGuideDetailKeyword').innerHTML =
    `검색어 <b>${escapeHtml(clauseSearchQuery)}</b>로 원문 검색을 시도합니다.`;

  const frame = document.getElementById('koshaGuideDetailFrame');
  const empty = document.getElementById('koshaGuideDetailEmpty');
  const originalBtn = document.getElementById('koshaGuideOriginalBtn');
  if (guide.url) {
    const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const proxyUrl = `${base}/functions/v1/kosha-guide-search?file=${encodeURIComponent(guide.url)}`;
    const fragment = clauseSearchQuery
      ? `#search=${encodeURIComponent(clauseSearchQuery)}`
      : '';
    frame.src = proxyUrl + fragment;
    frame.style.display = 'block';
    empty.style.display = 'none';
    originalBtn.href = guide.url;
    originalBtn.style.display = 'inline-flex';
  } else {
    frame.src = 'about:blank';
    frame.style.display = 'none';
    empty.style.display = 'flex';
    originalBtn.removeAttribute('href');
    originalBtn.style.display = 'none';
  }
  openModal('koshaGuideDetailModal');
};

window.closeKoshaGuideDetail = function () {
  const frame = document.getElementById('koshaGuideDetailFrame');
  if (frame) frame.src = 'about:blank';
  closeModal('koshaGuideDetailModal');
};

window.runClauseSearch = async function () {
  const q = document.getElementById('clauseQuery').value.trim();
  const out = document.getElementById('clauseResults');
  const btn = document.getElementById('clauseSearchBtn');
  if (!q) {
    toast('검색어를 입력하세요', 'error');
    return;
  }
  clauseSearchQuery = q;
  btn.disabled = true;
  btn.textContent = '검색 중...';
  out.innerHTML = `<div class="mp-empty" style="padding:16px;">법령 여러 건을 훑는 중이라 몇 초 걸릴 수 있어요...</div>`;
  try {
    const [lawRes, kgRes] = await Promise.all([
      supabase.functions.invoke('law-clause-search', { body: { query: q } }),
      supabase.functions
        .invoke('kosha-guide-search', { body: { query: q } })
        .catch((e) => ({ error: e })),
    ]);
    const { data, error } = lawRes;
    if (error || data?.error) throw new Error(error?.message || data.error);
    const laws = data.result.laws || [];
    window.clauseSearchStore = laws;

    const cards = laws.map((l, li) => {
      if (l.error) {
        return clauseCardHtml(
          l.lawName,
          `<div style="color:var(--text3);font-size:12px;">${escapeHtml(l.error)}</div>`,
        );
      }
      if (!l.articles.length) {
        return clauseCardHtml(
          l.lawName,
          `<div style="color:var(--text3);font-size:12px;">일치하는 조문 없음</div>`,
        );
      }
      const body = l.articles
        .map(
          (a, ai) => `
        <button type="button" class="clause-result-item" onclick="openClauseDetail(clauseSearchStore[${li}].lawName, clauseSearchStore[${li}].articles[${ai}].jo, clauseSearchStore[${li}].articles[${ai}].title, clauseSearchStore[${li}].articles[${ai}].content)">
          <div style="font-weight:700;font-size:13px;margin-bottom:2px;">제${escapeHtml(a.jo)}조 ${highlightedSearchHtml(a.title || '', q)}</div>
          <div style="font-size:12px;color:var(--text2);line-height:1.6;">${highlightedSearchHtml(a.snippet, q)}</div>
        </button>`,
        )
        .join('');
      return clauseCardHtml(l.lawName, body, `${l.articles.length}건`);
    });

    // KOSHA GUIDE: 실시간 API 우선, 실패 시에만 업로드된 CSV 카탈로그로 폴백
    let kgList = null,
      kgSource = 'api',
      kgFailure = '';
    if (!kgRes.error && !kgRes.data?.error) {
      kgList = (kgRes.data.result.list || []).slice(0, 15);
    } else {
      kgFailure =
        kgRes.error?.message ||
        kgRes.data?.error ||
        'KOSHA GUIDE API 응답을 받지 못했습니다.';
      await loadKgCatalog();
      kgSource = 'catalog';
      const ql = q.toLowerCase();
      kgList = (kgCatalog || [])
        .filter((g) =>
          [g.guide_no, g.title, g.category, g.committee, g.code]
            .join(' ')
            .toLowerCase()
            .includes(ql),
        )
        .slice(0, 15)
        .map((g) => ({
          guideNo: g.guide_no,
          title: g.title,
          category: g.category,
          date: '',
          url: '',
        }));
    }
    window.koshaGuideSearchStore = kgList || [];
    const kgBody = !kgList.length
      ? kgSource === 'catalog'
        ? `<div class="kg-api-error"><b>실시간 API 연결 실패</b><span>${escapeHtml(kgFailure)}</span><small>CSV 예비 데이터에도 일치하는 지침이 없습니다. Supabase 함수 배포와 KOSHA_API_KEY 설정을 확인하세요.</small></div>`
        : `<div style="color:var(--text3);font-size:12px;">일치하는 지침 없음</div>`
      : kgList
          .map(
            (
              g,
              gi,
            ) => `<button type="button" class="kg-result-item" onclick="openKoshaGuideDetail(${gi})">
          <span class="kg-result-title">${highlightedSearchHtml(g.title, q)}</span>
          <span class="kg-result-meta">${escapeHtml(g.guideNo || '')}${g.category ? ' · ' + escapeHtml(g.category) : ''}${g.date ? ' · ' + escapeHtml(g.date) : ''}</span>
          <span class="kg-result-action">원문 보기 ›</span>
        </button>`,
          )
          .join('');
    const kgBadge =
      kgSource === 'catalog'
        ? kgList.length
          ? `${kgList.length}건 · API 오류/CSV 대체`
          : 'API 오류'
        : kgList.length
          ? `${kgList.length}건 · 실시간`
          : '실시간';
    cards.push(
      clauseCardHtml(
        'KOSHA GUIDE' + (kgSource === 'catalog' ? ' (CSV 대체)' : ''),
        kgBody,
        kgBadge,
      ),
    );

    out.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">${cards.join('')}</div>`;
  } catch (e) {
    out.innerHTML = `<div class="mp-empty" style="padding:16px;">${e.message}<br><span style="font-size:11px;">law-clause-search 엣지펑션 배포 여부를 확인하세요</span></div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '검색';
  }
};

// 자료실: KOSHA GUIDE 카탈로그
// ═══════════════════════════════════════════════
// (lawQuick, runLawSearch 제거됨 — '법령 원문 찾기' 카드 삭제에 따라 불필요)

// ── KOSHA GUIDE ──
let kgCatalog = null; // [{guide_no,title,committee,category,code}]

async function loadKgCatalog() {
  if (kgCatalog) return;
  const { data, error } = await supabase
    .from('kosha_guides')
    .select('guide_no,title,committee,category,code')
    .eq('workspace_id', currentWS.id)
    .order('guide_no');
  kgCatalog = error ? [] : data || [];
}

async function initLibraryPage() {
  await loadKgCatalog();
  document.getElementById('kgCount').textContent = kgCatalog.length
    ? `(${kgCatalog.length}건 등록됨 — 예비용)`
    : '';
}

window.handleKgFile = function (file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
        defval: '',
      });
      // 공식 CSV 컬럼: 연번/위원회/등록일/분류기호/분류내용/공표순/년도/지침번호/명칭
      const items = rows
        .map((r) => ({
          workspace_id: currentWS.id,
          guide_no: String(r['지침번호'] || '').trim(),
          title: String(r['명칭'] || '').trim(),
          committee: String(r['위원회'] || '').trim(),
          category: String(r['분류내용'] || '').trim(),
          code: String(r['분류기호'] || '').trim(),
          reg_date: String(r['등록일'] || '').trim(),
        }))
        .filter((x) => x.guide_no && x.title);
      if (!items.length)
        throw new Error(
          "'지침번호'와 '명칭' 컬럼을 찾지 못했습니다 — data.go.kr의 공식 KOSHA Guide 목록 CSV인지 확인하세요",
        );
      toast(`저장 중... (${items.length}건)`);
      for (let i = 0; i < items.length; i += 500) {
        const { error } = await supabase
          .from('kosha_guides')
          .upsert(items.slice(i, i + 500), {
            onConflict: 'workspace_id,guide_no',
          });
        if (error) throw error;
      }
      kgCatalog = null;
      await initLibraryPage();
      toast(
        `KOSHA GUIDE ${items.length}건 등록 완료 — 팀 전체가 검색할 수 있어요`,
        'success',
      );
    } catch (err) {
      toast('업로드 실패: ' + (err?.message || err), 'error');
    }
  };
  reader.readAsArrayBuffer(file);
};

// GS health and site workspace. Only preview mode uses sample records/weather.
let contractorTab = 'companies';
let pkgSelected = new Set();
let gsHomeForecast = null;
let gsHomeForecastKey = '';
let gsHomeForecastPending = false;
const gsCombos = new Map();

function msdsReceived(record) {
  return Boolean(
    record.has_pdf || record.pdf_path || record.receipt_status === 'received',
  );
}

function mountGsWorkspace() {
  const content = document.querySelector('#page-contractors > .content-scroll');
  if (!content || document.getElementById('gsContractorTabs')) return;
  const originals = [...content.children];
  const tabs = document.createElement('div');
  tabs.id = 'gsContractorTabs';
  tabs.className = 'gs-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = ['companies', 'licenses', 'links']
    .map(
      (id, i) =>
        `<button role="tab" id="gs-tab-${id}" aria-controls="gs-con-${id}" onclick="switchContractorTab('${id}')">${['협력사 관리', '사업자등록증 미제출 협력사', '업로드 링크'][i]}</button>`,
    )
    .join('');
  content.prepend(tabs);
  ['companies', 'licenses', 'links'].forEach((id) => {
    const pane = document.createElement('div');
    pane.id = 'gs-con-' + id;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', 'gs-tab-' + id);
    content.appendChild(pane);
  });
  originals.forEach((el) =>
    document
      .getElementById(
        el.id === 'businessLicenseCard'
          ? 'gs-con-licenses'
          : 'gs-con-companies',
      )
      .appendChild(el),
  );
  const linkContent = document.querySelector(
    '#page-upload-link > .content-scroll',
  );
  if (linkContent)
    [...linkContent.children].forEach((el) =>
      document.getElementById('gs-con-links').appendChild(el),
    );
  // Remove separate search/select pairs; retain hidden select as the value source for existing handlers.
  [
    'batchContractor',
    'batchWorkType',
    'warnFilterContractor',
    'linkContractor',
  ].forEach((id) => mountGsCombo(id));
  document.querySelectorAll('.nav-item').forEach((el, i) => {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    };
    const icon = el.querySelector('.nav-icon');
    if (icon) icon.innerHTML = gsIcon(i);
  });
  document.querySelectorAll('.more-item').forEach((el) => {
    if (el.getAttribute('onclick')?.includes("'calendar'")) el.remove();
  });
  switchContractorTab('companies');
}

function gsIcon(index) {
  const paths = [
    'M3 10 12 3l9 7v10H3Z M9 20v-7h6v7',
    'M5 3h14v18H5Z M8 8h8M8 12h8M8 16h5',
    'm12 3 10 17H2ZM12 9v4m0 3v1',
    'M5 6h13m-4-4 4 4-4 4M19 18H6m4-4-4 4 4 4',
    'M4 5h16v14H4Z M8 2v6m8-6v6M8 12h8',
    'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',
    'M3 6h18v14H3Z M7 6l2-3h6l2 3M8 13a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
    'M7 7a5 5 0 1 0 10 0 5 5 0 1 0-10 0M3 22v-3a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v3',
    'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2',
  ];
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[index % paths.length]}"/></svg>`;
}

window.switchContractorTab = function (tab) {
  contractorTab = ['companies', 'licenses', 'links'].includes(tab)
    ? tab
    : 'companies';
  ['companies', 'licenses', 'links'].forEach((id) => {
    const pane = document.getElementById('gs-con-' + id),
      button = document.getElementById('gs-tab-' + id);
    if (pane) pane.hidden = id !== contractorTab;
    if (button) {
      button.classList.toggle('active', id === contractorTab);
      button.setAttribute('aria-selected', String(id === contractorTab));
      button.tabIndex = id === contractorTab ? 0 : -1;
      button.onkeydown = (e) => {
        if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          const ids = ['companies', 'licenses', 'links'];
          switchContractorTab(
            ids[(ids.indexOf(id) + (e.key === 'ArrowRight' ? 1 : 2)) % 3],
          );
          document.getElementById('gs-tab-' + contractorTab).focus();
        }
      };
    }
  });
  if (contractorTab === 'companies' && !getDevPreviewPage()) {
    Promise.all([loadContractors(),loadMsdsRecords(),loadBusinessLicenses(),loadPublicLink()]).then(() => { renderContractorTags(); renderSiteDirectoryLink(); });
  }
  if (contractorTab === 'links') {
    renderTokenList();
    renderPublicLinkUI();
  }
  if (contractorTab === 'licenses') renderBusinessLicenseStatus();
};

window.addContractorFromSearch = async function () {
  const name = document.getElementById('conMgrSearch').value.trim();
  if (!name) return;
  const existing = contractors.find(
    (c) => normalizeContractorName(c.name) === normalizeContractorName(name),
  );
  if (existing) {
    renderContractorTags();
    return;
  }
  try {
    const { contractor } = await insertContractor(name);
    populateContractorSelects();
    renderContractorTags();
    toast(`${contractor.name} 등록 완료`, 'success');
  } catch (e) {
    toast('협력사 등록 실패: ' + e.message, 'error');
  }
};

function mountGsCombo(id) {
  const select = document.getElementById(id);
  if (!select) return;
  const inputId = id + 'Search';
  let input = document.getElementById(inputId);
  if (input) {
    const row = input.closest('.contractor-search-row');
    if (row) row.removeChild(input);
    if (row) row.remove();
  } else {
    input = document.createElement('input');
    input.id = inputId;
    input.className = 'form-input';
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'gs-combobox';
  select.before(wrapper);
  wrapper.appendChild(input);
  const list = document.createElement('div');
  list.className = 'gs-combo-options';
  list.id = id + 'Options';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrapper.appendChild(list);
  input.removeAttribute('oninput');
  input.removeAttribute('onkeydown');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.autocomplete = 'off';
  input.placeholder =
    id === 'batchWorkType'
      ? '공종 검색 또는 새 공종 입력'
      : id === 'warnFilterContractor'
        ? '전체 협력사 · 검색해서 선택'
        : '협력사 검색 또는 이름 입력';
  select.hidden = true;
  select.classList.add('gs-value-select');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  const oldAdd = document.getElementById(id + 'AddBtn');
  if (oldAdd) oldAdd.hidden = true;
  const state = { input, select, list, wrapper, index: 0 };
  gsCombos.set(id, state);
  input.oninput = () => {
    select.value = '';
    if (id === 'batchContractor') {
      updateBatchWorkTypes();
      const wt = gsCombos.get('batchWorkType');
      if (wt) wt.input.value = '';
    }
    if (id === 'warnFilterContractor') renderWarnPickList();
    renderGsCombo(id);
  };
  input.onfocus = () => renderGsCombo(id);
  input.onkeydown = async (e) => {
    if (e.key === 'Escape') {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      if (list.hidden) renderGsCombo(id);
      const options = [...list.querySelectorAll('button')];
      state.index =
        (state.index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) %
        Math.max(1, options.length);
      options.forEach((el, i) =>
        el.classList.toggle('highlighted', i === state.index),
      );
      if (options[state.index])
        input.setAttribute('aria-activedescendant', options[state.index].id);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (list.hidden) renderGsCombo(id);
      const options = [...list.querySelectorAll('button')];
      options[state.index]?.click();
    }
  };
  select.addEventListener('change', () => {
    input.value = select.selectedOptions[0]?.value
      ? select.selectedOptions[0].textContent
      : '';
  });
  document.addEventListener('pointerdown', (e) => {
    if (!wrapper.contains(e.target)) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
  });
}

function renderGsCombo(id) {
  const state = gsCombos.get(id);
  if (!state) return;
  const { input, select, list } = state,
    q = input.value.trim(),
    key = q.toLowerCase();
  state.index = 0;
  const isWork = id === 'batchWorkType',
    isName = id === 'warnFilterContractor';
  const items = isWork
    ? getWorkTypesForContractor(
        document.getElementById('batchContractor').value,
      ).map((w) => ({ value: w.name, name: w.name }))
    : contractors.map((c) => ({ value: isName ? c.name : c.id, name: c.name }));
  const matches = items.filter((c) => c.name.toLowerCase().includes(key));
  list.replaceChildren();
  function addOption(label, fn) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id + 'Option' + list.children.length;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.textContent = label;
    button.onclick = async () => {
      try {
        await fn();
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    list.appendChild(button);
  }
  addOption(
    isWork
      ? '공종 미선택 (선택사항)'
      : isName
        ? '전체 협력사'
        : '협력사 선택 해제',
    () => {
      select.value = '';
      input.value = '';
      select.dispatchEvent(new Event('change'));
    },
  );
  matches.forEach((c) =>
    addOption(c.name, () => {
      if (![...select.options].some((o) => o.value === c.value))
        select.add(new Option(c.name, c.value));
      select.value = c.value;
      input.value = c.name;
      select.dispatchEvent(new Event('change'));
    }),
  );
  if (
    q &&
    !items.some(
      (c) => normalizeContractorName(c.name) === normalizeContractorName(q),
    ) &&
    !isName
  ) {
    addOption(`+ '${q}' ${isWork ? '공종' : '협력사'} 추가하기`, async () => {
      if (isWork) {
        const conId = document.getElementById('batchContractor').value;
        if (!conId) throw new Error('협력사를 먼저 선택해주세요');
        let item;
        if (getDevPreviewPage())
          item = {
            id: 'preview-wt-' + Date.now(),
            contractor_id: conId,
            name: q,
          };
        else {
          const { data, error } = await supabase
            .from('work_types')
            .insert({
              workspace_id: currentWS.id,
              contractor_id: conId,
              name: q,
            })
            .select()
            .single();
          if (error) throw error;
          item = data;
        }
        workTypes.push(item);
        updateBatchWorkTypes();
        select.value = item.name;
        input.value = item.name;
      } else {
        const { contractor } = await insertContractor(q);
        input.value = contractor.name;
        populateContractorSelects();
        if (![...select.options].some((o) => o.value === contractor.id))
          select.add(new Option(contractor.name, contractor.id));
        select.value = contractor.id;
        select.dispatchEvent(new Event('change'));
        renderContractorTags();
      }
      toast('추가했습니다', 'success');
    });
  }
  if (!matches.length && !q) input.removeAttribute('aria-activedescendant');
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

window.renderPkgOptions = function () {
  const q = document
    .getElementById('pkgContractorSearch')
    .value.trim()
    .toLowerCase();
  const list = document.getElementById('pkgContractorOptions');
  list.replaceChildren();
  contractors
    .filter((c) => c.name.toLowerCase().includes(q))
    .forEach((c) => {
      const label = document.createElement('label'),
        cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = pkgSelected.has(c.name);
      cb.onchange = () => {
        cb.checked ? pkgSelected.add(c.name) : pkgSelected.delete(c.name);
        updatePkgCount();
        document.getElementById('pkgSelectAll').checked =
          pkgSelected.size === contractors.length;
      };
      label.append(cb, document.createTextNode(c.name));
      list.appendChild(label);
    });
  if (!list.children.length) list.textContent = '검색 결과가 없습니다';
  document.getElementById('pkgSelectAll').checked =
    contractors.length > 0 && pkgSelected.size === contractors.length;
};
window.selectAllPkg = function (checked) {
  pkgSelected = new Set(checked ? contractors.map((c) => c.name) : []);
  renderPkgOptions();
  updatePkgCount();
};
window.filterFullPrintContractors = function () {
  const q = document
    .getElementById('fullPrintSearch')
    .value.trim()
    .toLowerCase();
  document
    .querySelectorAll('#fullPrintContractorList label')
    .forEach((el) => (el.hidden = !el.textContent.toLowerCase().includes(q)));
};

window.renderMsdsRequests = function () {
  const q = (
    document.getElementById('requestSearch')?.value || ''
  ).toLowerCase();
  const list = contractors
    .map((c) => {
      const issued = tokens
        .filter(
          (t) =>
            (t.contractor_id || t.contractor?.id) === c.id ||
            t.contractor?.name === c.name,
        )
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      const records = msdsRecords.filter((r) => r.contractor === c.name);
      const received = records.filter(msdsReceived);
      const redo = records.filter((r) => r.reupload_requested);
      return { c, token: issued[0], records, received, redo };
    })
    .filter((x) => x.token || x.records.length)
    .filter((x) => x.c.name.toLowerCase().includes(q));
  const pending = list.filter(
    (x) => !x.received.length || x.redo.length,
  ).length;
  document.getElementById('gsRequestStats').innerHTML = [
    ['요청·등록 협력사', list.length],
    ['확인 필요', pending],
    ['원본 등록 완료', list.length - pending],
  ]
    .map(
      ([title, n]) =>
        `<div class="card"><span>${title}</span><b>${n}<small>개사</small></b></div>`,
    )
    .join('');
  document.getElementById('gsRequestRows').innerHTML =
    list
      .map(
        ({ c, token, received, redo }) =>
          `<tr><td><strong>${escapeHtml(c.name)}</strong></td><td>${token?.created_at ? escapeHtml(token.created_at.slice(0, 10)) : '—'}</td><td><span class="badge ${redo.length ? 'badge-warn' : received.length ? 'badge-ok' : 'badge-gray'}">${redo.length ? '재업로드 요청' : received.length ? '원본 등록 완료' : token ? '제출 대기' : '원본 확인 필요'}</span></td><td>원본 ${received.length}건${redo.length ? ' · 재요청 ' + redo.length + '건' : ''}</td><td><div class="gs-inline-actions"><button class="btn btn-secondary btn-sm" onclick="openContractorMsds('${c.id}')">대장 보기</button><button class="btn btn-outline btn-sm" onclick="openContractorUploadLink('${c.id}')">링크 관리</button></div></td></tr>`,
      )
      .join('') ||
    '<tr class="empty-row"><td colspan="5">요청 내역이 없습니다. 협력사 관리에서 업로드 링크를 발급하세요.</td></tr>';
};

function gsWeatherIcon(code) {
  if (code === null || code === undefined) return '—';
  if (code >= 95) return '⛈';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄';
  if (code >= 51 && code <= 82) return '☂';
  if (code >= 45 && code <= 48) return '≋';
  if (code >= 2) return '☁';
  return '☀';
}
function gsWeatherLabel(code) {
  if (code === null || code === undefined) return '미제공';
  if (code >= 95) return '뇌우';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '눈';
  if (code >= 51 && code <= 82) return '비';
  if (code >= 45 && code <= 48) return '안개';
  if (code >= 2) return '흐림';
  return '맑음';
}
function renderGsHome() {
  const name =
    profile?.name ||
    user?.user_metadata?.name ||
    user?.email?.split('@')[0] ||
    '관리자';
  document.getElementById('gsGreeting').textContent =
    `${name}님,\n오늘 하루도 좋은 하루 되세요!`;
  document.getElementById('gsSiteName').textContent =
    currentWS?.name || '현장 홈';
  document.getElementById('gsPreviewLabel').textContent = getDevPreviewPage()
    ? '미리보기 · 예시 데이터'
    : '';
  document.getElementById('homeDate').textContent =
    new Date().toLocaleDateString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
  const month = Number(
    new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
    }).format(new Date()),
  );
  const season =
    month >= 6 && month <= 9
      ? 'summer'
      : month >= 11 || month <= 2
        ? 'winter'
        : month >= 3 && month <= 5
          ? 'spring'
          : 'autumn';
  const seasonal = {
    summer: [
      '여름철, 온열질환을 예방하세요',
      [
        '물·그늘·휴식 준비',
        '체감온도와 휴식시간 확인',
        '취약 근로자 건강상태 확인',
      ],
    ],
    winter: [
      '겨울철, 한랭질환에 대비하세요',
      [
        '방한복·따뜻한 휴게공간 준비',
        '저체온증·동상 증상 확인',
        '결빙 구간과 난방기 환기 점검',
      ],
    ],
    spring: [
      '봄철, 호흡기 건강을 살펴주세요',
      [
        '미세먼지 예보 확인',
        '작업에 맞는 호흡 보호구 점검',
        '일교차에 따른 체온 관리',
      ],
    ],
    autumn: [
      '가을철, 일교차에 대비하세요',
      [
        '작업 전 근로자 건강상태 확인',
        '아침·저녁 보온과 수분 섭취',
        '건조한 날 분진·환기 상태 점검',
      ],
    ],
  };
  const [title, checks] = seasonal[season];
  document.getElementById('gsSeasonTitle').textContent = title;
  document.getElementById('gsSeasonChecks').innerHTML = checks
    .map(
      (t, i) =>
        `<div class="gs-check"><span>${String(i + 1).padStart(2, '0')}</span><p>${t}</p></div>`,
    )
    .join('');
  const cards = [
    [
      '☀',
      '더운 날',
      '식수·그늘·휴게공간을 점검하고 온열질환 의심 증상을 확인하세요.',
    ],
    [
      '☂',
      '비 오는 날',
      '미끄럼·감전 위험과 젖은 보호구, 작업장 배수 상태를 확인하세요.',
    ],
    [
      '≋',
      '건조하고 바람 부는 날',
      '비산먼지와 눈·호흡기 보호구, 국소배기 상태를 살펴보세요.',
    ],
  ];
  document.getElementById('gsWeatherChecks').innerHTML = cards
    .map(
      ([icon, t, d]) =>
        `<div><span class="gs-weather-symbol">${icon}</span><h3>${t}</h3><p>${d}</p></div>`,
    )
    .join('');
  if (gsHomeForecast && gsHomeForecastKey === currentWS?.id)
    renderGsWeek(gsHomeForecast);
  else if (!gsHomeForecastPending) loadGsWeekWeather();
}
async function loadGsWeekWeather() {
  const el = document.getElementById('gsWeekWeather'),
    source = document.getElementById('gsWeatherSource');
  if (!currentWS?.latitude || !currentWS?.longitude) {
    el.innerHTML =
      '<div class="gs-weather-empty">현장 주소를 설정하면 이번 주 예보를 볼 수 있습니다.<button class="btn btn-outline btn-sm" onclick="openSiteLocationSettings()">현장 주소 설정</button></div>';
    source.textContent = '';
    return;
  }
  gsHomeForecastPending = true;
  const workspaceId = currentWS.id;
  el.innerHTML = '<p class="gs-muted">현장 날씨를 불러오는 중입니다…</p>';
  try {
    let fc;
    if (getDevPreviewPage()) {
      const day = new Date(
        new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }) +
          'T12:00:00+09:00',
      );
      const monday = new Date(day);
      monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
      fc = {
        week: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(monday);
          d.setDate(d.getDate() + i);
          return {
            date: d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
            code: [0, 2, 3, 61, 2, 0, 1][i],
            max: [23, 22, 21, 19, 20, 22, 23][i],
            min: [13, 14, 14, 15, 12, 11, 12][i],
          };
        }),
        source: 'preview',
      };
    } else {
      const { data, error } = await supabase.functions.invoke('site-weather', {
        body: {
          action: 'forecast',
          address: currentWS.address,
          latitude: currentWS.latitude,
          longitude: currentWS.longitude,
        },
      });
      if (error || data?.error) throw new Error(error?.message || data.error);
      fc = data.result;
    }
    if (currentWS.id !== workspaceId) return;
    gsHomeForecast = fc;
    gsHomeForecastKey = workspaceId;
    renderGsWeek(fc);
  } catch (e) {
    el.innerHTML =
      '<div class="gs-weather-empty">예보를 불러오지 못했습니다.<button class="btn btn-outline btn-sm" onclick="retryGsWeather()">다시 시도</button></div>';
    source.textContent = e.message;
  } finally {
    gsHomeForecastPending = false;
    if (
      currentWS?.id !== workspaceId &&
      document.getElementById('page-home')?.classList.contains('active')
    )
      loadGsWeekWeather();
  }
}
window.retryGsWeather = function () {
  gsHomeForecast = null;
  loadGsWeekWeather();
};
function renderGsWeek(fc) {
  const el = document.getElementById('gsWeekWeather');
  const source = document.getElementById('gsWeatherSource');
  if (!Array.isArray(fc.week) || !fc.week.length) {
    el.innerHTML =
      '<div class="gs-weather-empty">주간 예보를 준비 중입니다. 잠시 후 새로고침해주세요.<button class="btn btn-outline btn-sm" onclick="retryGsWeather()">새로고침</button></div>';
    source.textContent = '';
    return;
  }
  const todayKst = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Seoul',
  });
  el.innerHTML = fc.week
    .map(
      (d) =>
        `<div class="gs-day ${d.date === todayKst ? 'today' : ''}"><b>${d.date === todayKst ? '오늘' : new Date(d.date + 'T12:00:00+09:00').toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' })}</b><small>${Number(d.date.slice(5, 7))}.${Number(d.date.slice(8))}</small><span class="gs-day-icon" aria-label="${gsWeatherLabel(d.code)}">${gsWeatherIcon(d.code)}</span><span class="gs-day-description">${gsWeatherLabel(d.code)}</span><div><strong>${Math.round(d.max)}°</strong><span>${Math.round(d.min)}°</span></div></div>`,
    )
    .join('');
  source.textContent =
    fc.source === 'preview'
      ? '미리보기 예시 · 실제 현장 날씨가 아닙니다.'
      : 'Open-Meteo · 현장 저장 좌표 기준 · 이번 주 월–일';
}

init();

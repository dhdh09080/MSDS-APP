// ═══════════════════════════════════════════════
// 앱 전역에서 쓰는 고정 상수 (재할당 없음 — 상태 아님)
// ═══════════════════════════════════════════════

export const PAGES = ['home', 'calendar', 'msds', 'warning', 'upload-link', 'measure', 'health', 'photos', 'manpower', 'weather', 'vulnerable', 'bp', 'library', 'contractors', 'settings'];
export const MOBILE_TABS = ['home', 'calendar', 'msds', 'health', 'settings'];

// 경고표지 라벨 크기 프리셋 (A4 용지 분할 기준, 고시 제2023-9호 별표 규격 대응)
export const WARN_SIZES = {
  a4: { name: 'A4 전면', perPage: 1, picto: 140, area: '약 620㎠' },
  a5: { name: 'A4 2분할 (A5)', perPage: 2, picto: 96, area: '약 310㎠' },
  a6: { name: 'A4 4분할 (A6)', perPage: 4, picto: 74, area: '약 155㎠' },
  mini: { name: 'A4 8분할 (소분용기)', perPage: 8, picto: 60, area: '약 77㎠' },
};

export const CAL_CATEGORY_COLOR = { general: '#64748B', meeting: '#2563EB', inspection: '#DC2626', contractor: '#D97706' };
export const CAL_CATEGORY_LABEL = { general: '일반', meeting: '협력사 미팅', inspection: '점검일', contractor: '협력사 일정' };

export const PHOTO_FOLDER_PRESETS = ['혹서기', '휴게시간', '휴게실', '보냉장구', '그늘막', '식염포도당/음용수', '안전보건교육', '추락방지', '안전보건교육'];

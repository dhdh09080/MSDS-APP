// Browser port of dhdh09080/gsold: app.py, worker_filter.py and excel_export.py.
export const COLUMNS = ['No.', '협력회사', '이름', '공종', '혈압잰 일자', '오늘의 혈압', '고혈압 복용 여부', '서명란'];
export const GROUPS = { older: '고령자', pressure: '고혈압 근로자' };

export function koreanToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) throw new Error('올바른 날짜를 선택해 주세요.');
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new Error('올바른 날짜를 선택해 주세요.');
  return { year, month, day, iso: match[0] };
}

export function calculateAge(value, asOf = koreanToday()) {
  const today = dateParts(asOf);
  const text = String(value ?? '').trim();
  let year, month, day;
  const full = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/.exec(text) || /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (full) [year, month, day] = full.slice(1).map(Number);
  else {
    const compact = /^(\d{2})(\d{2})(\d{2})(?:[-\s]?([1-8])\d{0,6})?$/.exec(text);
    if (!compact) return null;
    const [, yy, mm, dd, century] = compact;
    // Resident/foreign registration century digits take priority over the YY pivot.
    year = Number(yy) + (century ? ('3478'.includes(century) ? 2000 : 1900) : (Number(yy) <= today.year % 100 ? 2000 : 1900));
    month = Number(mm); day = Number(dd);
  }
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() + 1 !== month || birth.getUTCDate() !== day) return null;
  const age = today.year - year - (today.month < month || (today.month === month && today.day < day) ? 1 : 0);
  return age >= 0 && age <= 130 ? age : null;
}

export function parseBloodPressure(value) {
  const text = String(value ?? '').replaceAll('／', '/');
  const pairs = [...text.matchAll(/(?<![\d/])(\d{2,3})\s*\/\s*(\d{2,3})(?![\d/])/g)];
  if (pairs.length === 1) return [Number(pairs[0][1]), Number(pairs[0][2])];
  if (pairs.length > 1) return null;
  const systolic = /(?:수축기|최고)\s*[:：]?\s*(\d{2,3})(?!\d)/.exec(text);
  const diastolic = /(?:이완기|최저)\s*[:：]?\s*(\d{2,3})(?!\d)/.exec(text);
  return systolic && diastolic ? [Number(systolic[1]), Number(diastolic[1])] : null;
}

export function analyzeRows(rows, asOf = koreanToday()) {
  dateParts(asOf);
  if (!rows.length || rows.reduce((max, row) => Math.max(max, row.length), 0) < 12) throw new Error('L열까지 포함된 원본 엑셀 파일을 선택해 주세요.');
  const hasPressure = rows.some(row => row.length >= 17);
  const workers = rows.slice(1).filter(row => [3, 4, 5, 9, 11, 16].some(i => String(row[i] ?? '').trim())).map(row => ({
    company: String(row[3] ?? '').trim(), trade: String(row[4] ?? '').trim(), name: String(row[5] ?? '').trim(),
    age: calculateAge(row[11], asOf), pressure: parseBloodPressure(row[16]),
  }));
  if (!workers.length) throw new Error('첫 행 아래에서 근로자 자료를 찾지 못했습니다.');
  const sort = list => list.sort((a, b) => a.company.localeCompare(b.company, 'ko') || a.name.localeCompare(b.name, 'ko'));
  const older = sort(workers.filter(w => w.age !== null && w.age >= 63));
  const pressure = sort(workers.filter(w => w.age !== null && w.age < 63 && w.pressure && (w.pressure[0] >= 150 || w.pressure[1] >= 100)));
  return { total: workers.length, older, pressure, hasPressure, asOf,
    unknownAge: workers.filter(w => w.age === null).length,
    unreadablePressure: workers.filter(w => w.age !== null && w.age < 63 && !w.pressure).length };
}

export function measurementTitle(start, end, group = 'older') {
  const first = dateParts(start), last = dateParts(end);
  if (end < start) throw new Error('종료일을 시작일과 같거나 이후 날짜로 설정해 주세요.');
  if (!GROUPS[group]) throw new Error('명단 구분을 확인해 주세요.');
  let label = start.replaceAll('-', '.');
  if (start !== end) label += '~' + (first.year === last.year ? end.slice(5) : end).replaceAll('-', '.');
  return `${label} ${GROUPS[group]} 혈압측정`;
}

export function measurementDateLabel(start, end) {
  measurementTitle(start, end);
  const a = dateParts(start), b = dateParts(end);
  if (start === end) return `${a.year}년 ${a.month}월 ${a.day}일`;
  if (a.year === b.year && a.month === b.month) return `${a.year}년 ${a.month}월      일`;
  return '        년     월     일';
}

export function createRoster(workers, start, end) {
  const date = measurementDateLabel(start, end);
  return workers.map((w, i) => [i + 1, w.company, w.name, w.trade, date, '     /     ', '□예  □아니오', '']);
}

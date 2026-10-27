export const PMX_URL = 'https://pmx.gsenc.com/com/';

export function searchProjects(projects, query) {
  const key = v => String(v ?? '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
  const term = key(query);
  return projects.filter(p => [p.prjNm, p.prjCd, p.bizFldNm].some(v => key(v).includes(term)));
}

export function manualProject({name, code = '', category, start = '', end = ''}) {
  name = name.trim(); code = code.trim();
  if (!name || name.length > 200) throw new Error('현장명은 1~200자로 입력해주세요.');
  if (!['주택', '플랜트', '인프라', '기타'].includes(category)) throw new Error('현장 분류를 선택해주세요.');
  if (code && !/^[A-Za-z0-9_-]{1,32}$/.test(code)) throw new Error('현장코드는 영문·숫자·밑줄·하이픈으로 입력해주세요.');
  for (const date of [start, end]) {
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('착공일·준공일을 확인해주세요.');
  }
  if (start && end && start > end) throw new Error('준공일은 착공일 이후로 입력해주세요.');
  return {prjCd: code || null, prjNm: name, bizFldNm: category, cstrnStrtYmd: start || null, cstrnEndYmd: end || null, actlTProgrt: null};
}

export function normalizeProject(row) {
  if (!row || typeof row.prjCd !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(row.prjCd) || !row.prjNm?.trim()) throw new Error('현장 정보 형식이 올바르지 않습니다.');
  const date = (v) => {
    if (!v) return null;
    const s = String(v).replaceAll('-', '');
    if (!/^\d{8}$/.test(s)) return null;
    const iso = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`;
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === iso ? iso : null;
  };
  const p = row.actlTProgrt === null || row.actlTProgrt === undefined || row.actlTProgrt === '' ? null : Number(row.actlTProgrt);
  return { prjCd: row.prjCd, prjNm: row.prjNm.trim().slice(0,200), bizFldNm: String(row.bizFldNm || '').slice(0,100), cstrnStrtYmd: date(row.cstrnStrtYmd), cstrnEndYmd: date(row.cstrnEndYmd), actlTProgrt: p !== null && Number.isFinite(p) && p >= 0 && p <= 100 ? p : null };
}

export function estimatedCare(progress, category = '주택') {
  if (progress === null || progress === undefined) return { stage: '공정 정보 없음', care: '공정률을 동기화한 뒤 실제 작업 내용을 확인해주세요.' };
  if (category !== '주택') return {stage:'실제 작업계획 확인 필요',care:'플랜트·인프라 등은 공정률만으로 작업 단계를 판단하기 어렵습니다. 실제 작업계획에서 용접·도장·굴착·밀폐공간 작업을 확인하고, 유해인자에 맞는 환기·노출 관리·보호구를 점검하세요.'};
  if (progress >= 100) return { stage: '준공·정리 예상', care: '청소 분진·세정제 노출, 중량물 운반과 잔여 작업의 환기 상태를 확인하세요.' };
  if (progress < 15) return { stage: '토공·기초 예상', care: '굴착·절단 분진과 장비 소음을 확인하고, 습식 작업·호흡 및 청력 보호구를 점검하세요.' };
  if (progress < 60) return { stage: '골조 작업 예상', care: '콘크리트 분진·시멘트 피부 접촉, 용접 흄과 중량물 취급을 확인하세요. 국소배기·보호구·근골격계 부담을 점검하세요.' };
  if (progress < 90) return { stage: '설비·마감 작업 예상', care: '도장·방수·접착제의 유기용제와 절단 분진을 확인하세요. MSDS·환기·호흡 보호구와 밀폐공간 작업 여부를 점검하세요.' };
  return { stage: '마감·시운전 예상', care: '보수 도장·청소 화학물질, 시운전 소음과 밀폐공간 출입 여부를 확인하세요. 환기와 작업 전 건강상태를 점검하세요.' };
}

export function kstDay(value = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}


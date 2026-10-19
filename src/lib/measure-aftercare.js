const rank = { '해당없음': 0, '미만': 1, '초과': 2 };
const text = value => String(value ?? '').trim();

export function measureConstructionName(value) {
  const name = text(value).replace(/\s+/g, ' ');
  return name.match(/^(.+?공사(?:\([^)]*\))?)(?:\s|$)/)?.[1] || (/^감시단(?:\s|$)/.test(name) ? '감시단' : name);
}

export function groupMeasureResults(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = measureConstructionName(row.workType);
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, { no: groups.size + 1, workType: name, singleStatus: '해당없음', mixedStatus: '해당없음', noiseStatus: '해당없음', exceededMeasurements: [] });
    const group = groups.get(name);
    for (const field of ['singleStatus', 'mixedStatus', 'noiseStatus']) {
      if (!(row[field] in rank)) throw new Error(`${name}의 측정 판정을 확인해주세요.`);
      if (rank[row[field]] > rank[group[field]]) group[field] = row[field];
    }
    if ([row.singleStatus, row.mixedStatus, row.noiseStatus].includes('초과') && !row.exceededMeasurements?.length) throw new Error(`${name}의 초과 유해인자·측정치·기준치를 확인해주세요.`);
    for (const item of row.exceededMeasurements || []) {
      const previous = group.exceededMeasurements.find(candidate => candidate.agent === item.agent && candidate.measured?.unit === item.measured?.unit && candidate.limit?.value === item.limit?.value && candidate.limit?.unit === item.limit?.unit);
      if (!previous) group.exceededMeasurements.push({ ...item });
      else if (Number.isFinite(Number(item.measured?.value)) && Number(item.measured.value) > Number(previous.measured?.value)) previous.measured = { ...item.measured };
    }
  }
  return [...groups.values()];
}

function compactReportMeasures(data, rows) {
  const original = data.aftercare?.improvements || data.improvements || [];
  if (original.length <= 12 && data.aftercare?.analysisMethod !== 'local') return original.map((row, i) => ({ ...row, no: i + 1 }));
  const names = rows.map(row => text(row.workType)), used = new Set(), result = [];
  const add = (pattern, qualifier, method, extraNames = []) => {
    const targets = [...new Set([...names.filter(name => pattern.test(name)).map(measureConstructionName), ...extraNames])];
    if (!targets.length) return;
    targets.forEach(name => used.add(name));
    result.push({ no: result.length + 1, target: `${targets.map(name => /^(석|직영|전기)공사$|^설비공사/.test(name) ? name : name.replace(/공사$/, '')).join('·')}${qualifier}`, method, assignee: text(data.defaultAssignee || data.aftercare?.defaultAssignee), source: '사후관리 작성안' });
  };
  add(/(?:부대토목|조경).*(?:굴착|토목|조경공)/, ' (굴착·토목 작업)', '분진(산화규소 포함) 저감을 위한 살수·청소 및 비산방지 조치 실시, 방진마스크·보안경 착용 후 작업');
  const weldingGroups = [...(data.measurements || []), ...(data.dust || [])].filter(row => /용접흄/.test(row.agent || '')).map(row => measureConstructionName(row.workType || row.process));
  add(/용접/, ' (용접 작업)', '용접흄·금속류 저감을 위한 이동식 집진장치 또는 강제배기팬 가동(배기방향 실외), 적합한 용접흄용 방진마스크·보안면 착용 및 작업구역 구획', weldingGroups);
  add(/도장|뿜칠|방수/, ' (도장·방수 작업)', '유기화합물·금속류 저감을 위한 강제환기(송풍기), 취급물질에 적합한 방독마스크·보안경·내화학장갑 착용 및 작업 전 MSDS 교육 실시');
  add(/설비공사.*(?:오배수|배관|소방)/, ' (접착제 등 취급 작업)', '접착제·세척제 등 혼합유기화합물 노출 저감을 위한 환기 확보 및 적합한 방독마스크 착용, 임시작업 화학제품 사용시간·빈도 관리');
  add(/수장|경량|(?:인테리어공사(?!.*용접))/, ' (내장재 취급 작업)', '유리섬유·석고 등 내장재 분진 저감을 위한 방진마스크·보안경·보호복(긴팔) 착용 및 작업 후 신체 세척');
  add(/일반가구|목창호/, ' (목재 취급 작업)', '목재분진 저감을 위한 방진마스크·보안경 착용, 작업장 청결 유지 및 분진 비산 방지');
  const remainder = [...new Set(names.map(measureConstructionName))].filter(name => !used.has(name));
  if (remainder.length) result.push({ no: result.length + 1, target: `${remainder.map(name => /^(석|직영|전기)공사$/.test(name) ? name : name.replace(/공사$/, '')).join('·')} (일반 분진·소음 작업)`, method: '작업 전 유해인자·주의사항 전파, 분진·소음 발생 및 인근 작업 시 적합한 방진마스크·귀마개 지급·착용 확인 후 작업 실시', assignee: text(data.defaultAssignee || data.aftercare?.defaultAssignee), source: '사후관리 작성안' });
  if (result.length) result.push({ no: result.length + 1, target: '전 공종 (공통)', method: '청력보호구(귀마개) 등 개인전용 보호구 여유분 현장 비치, 오염·훼손 시 교체 및 보호구 지급대장(근로자 서명·날인) 관리', assignee: text(data.defaultAssignee || data.aftercare?.defaultAssignee), source: '사후관리 작성안' });
  return result;
}

export function buildMeasureAftercare(data) {
  const sourceRows = data.aftercare?.resultRows?.length ? data.aftercare.resultRows : data.resultRows || [];
  return { ...data.aftercare, resultRows: groupMeasureResults(sourceRows), improvements: compactReportMeasures(data, sourceRows) };
}

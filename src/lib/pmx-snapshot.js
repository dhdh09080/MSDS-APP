import {normalizeProject} from './pmx.js';

export const PMX_INCOMING_KEY = 'gs_pmx_incoming_v1';
export const PMX_MAX_SNAPSHOT_BYTES = 500_000;
const fields = ['prjCd','prjNm','bizFldNm','cstrnStrtYmd','cstrnEndYmd','actlTProgrt'];

export function validatePmxSnapshot(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['version','source','projects','fetchedAt'].includes(k)) || value.version !== 1 || value.source !== 'pmx-bookmark') throw new Error('PMX 정보 파일 형식이 올바르지 않습니다.');
  if (!Array.isArray(value.projects) || !value.projects.length || value.projects.length > 500) throw new Error('현장 목록은 1~500개여야 합니다.');
  const stamp = Date.parse(value.fetchedAt);
  if (typeof value.fetchedAt !== 'string' || !Number.isFinite(stamp) || stamp > now + 300_000 || stamp < now - 86_400_000) throw new Error('PMX 정보가 오래됐거나 조회 시각이 올바르지 않습니다. PMX에서 다시 보내주세요.');
  if (new TextEncoder().encode(JSON.stringify(value)).length > PMX_MAX_SNAPSHOT_BYTES) throw new Error('PMX 정보 크기가 너무 큽니다.');
  const codes = new Set();
  const projects = value.projects.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== fields.length || fields.some(k => !Object.hasOwn(row,k)) || Object.keys(row).some(k => !fields.includes(k))) throw new Error('허용되지 않은 현장 정보 항목이 있습니다.');
    if (typeof row.prjNm !== 'string' || row.prjNm.length > 200 || (row.bizFldNm !== null && (typeof row.bizFldNm !== 'string' || row.bizFldNm.length > 100))) throw new Error('현장명 또는 분류 형식이 올바르지 않습니다.');
    for (const key of ['cstrnStrtYmd','cstrnEndYmd']) {
      const raw = row[key];
      if (raw !== null && (typeof raw !== 'string' || !/^(\d{8}|\d{4}-\d{2}-\d{2})$/.test(raw))) throw new Error('현장 일정 형식이 올바르지 않습니다.');
    }
    const n = row.actlTProgrt;
    if (n !== null && ((typeof n !== 'number' && typeof n !== 'string') || String(n).trim() === '' || !Number.isFinite(Number(n)) || Number(n) < 0 || Number(n) > 100)) throw new Error('공정률은 0~100이어야 합니다.');
    const normalized = normalizeProject(row);
    for (const key of ['cstrnStrtYmd','cstrnEndYmd']) if (row[key] !== null && !normalized[key]) throw new Error('현장 일정을 확인해주세요.');
    if (codes.has(normalized.prjCd)) throw new Error('중복된 현장코드가 있습니다.');
    codes.add(normalized.prjCd);
    return normalized;
  });
  return {version:1,source:'pmx-bookmark',fetchedAt:new Date(stamp).toISOString(),projects};
}

export function parsePmxSnapshot(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > PMX_MAX_SNAPSHOT_BYTES) throw new Error('PMX 정보 크기가 너무 큽니다.');
  let value;
  try {value = JSON.parse(text);} catch {throw new Error('PMX 정보 파일을 읽을 수 없습니다.');}
  return validatePmxSnapshot(value);
}

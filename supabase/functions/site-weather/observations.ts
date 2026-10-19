import { distanceKm, parseObservation, parseStations } from './lib/observations.js';

type Kind = 'AWS' | 'ASOS';
type Station = { id: number; latitude: number; longitude: number };
const stationCache = new Map<Kind, { expires: number; stations: Station[] }>();
const observationCache = new Map<string, { expires: number; text: string }>();

class HubError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
async function hubText(path: string, params: Record<string, string>, key: string) {
  const url = new URL(`https://apihub.kma.go.kr/api/typ01/${path}`);
  url.search = new URLSearchParams({ ...params, authKey: key }).toString();
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(12000) }); }
  catch { throw new HubError('HUB_UNAVAILABLE'); }
  // Do not propagate raw provider bodies/URLs: they may contain the credential.
  if (response.status === 401) throw new HubError('HUB_INVALID_KEY');
  if (response.status === 403) throw new HubError('HUB_NOT_APPROVED');
  if (!response.ok) throw new HubError('HUB_UNAVAILABLE');
  const bytes = await response.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(bytes);
  if (/유효한 인증키|인증키가 올바르지|INVALID.*KEY/i.test(text)) throw new HubError('HUB_INVALID_KEY');
  if (/활용신청이 필요한|활용 신청.*필요/.test(text)) throw new HubError('HUB_NOT_APPROVED');
  return text;
}

async function stations(kind: Kind, key: string) {
  const cached = stationCache.get(kind);
  if (cached && cached.expires > Date.now()) return cached.stations;
  const text = await hubText('url/stn_inf.php', { inf: kind === 'ASOS' ? 'SFC' : 'AWS', stn: '0', help: '0' }, key);
  const result = parseStations(text);
  if (!result.length) throw new HubError('HUB_STATIONS_UNAVAILABLE');
  stationCache.set(kind, { stations: result, expires: Date.now() + 6 * 3600000 });
  return result;
}

async function current(kind: Kind, latitude: number, longitude: number, key: string) {
  let catalog: Station[];
  try { catalog = await stations(kind, key); }
  catch (error) {
    // Verify observation-service permission separately from station metadata.
    if (error instanceof HubError && error.code === 'HUB_NOT_APPROVED') {
      const path = kind === 'AWS' ? 'cgi-bin/url/nph-aws2_min' : 'url/kma_sfctm2.php';
      await hubText(path, { stn: '0', help: '0' }, key);
      throw new HubError('HUB_STATIONS_NOT_APPROVED');
    }
    throw error;
  }
  const candidates = catalog.map(s => ({ ...s, distanceKm: distanceKm(latitude, longitude, s) }))
    .filter(s => s.distanceKm <= 100).sort((a,b) => a.distanceKm - b.distanceKm).slice(0, 3);
  if (!candidates.length) throw new HubError('HUB_NO_NEARBY_STATION');
  let stale = null;
  for (const station of candidates) {
    const cacheKey = `${kind}:${station.id}`;
    const cached = observationCache.get(cacheKey);
    let text = cached && cached.expires > Date.now() ? cached.text : null;
    if (!text) {
      const path = kind === 'AWS' ? 'cgi-bin/url/nph-aws2_min' : 'url/kma_sfctm2.php';
      text = await hubText(path, { stn: String(station.id), help: '0', ...(kind === 'AWS' ? { disp: '1' } : {}) }, key);
      if (observationCache.size >= 100) observationCache.delete(observationCache.keys().next().value!);
      observationCache.set(cacheKey, {text, expires: Date.now() + 60000});
    }
    const observation = parseObservation(text, kind, station.id);
    if (!observation) continue;
    const result = { ...observation, station: { ...station, name: `${kind} 관측소 ${station.id}` } };
    if (!result.stale) return result;
    if (!stale) stale = result;
  }
  if (stale) return stale;
  throw new HubError('HUB_NO_OBSERVATIONS');
}

const messages: Record<string, string> = {
  HUB_INVALID_KEY: '기상청 API허브 인증키를 확인해주세요.',
  HUB_NOT_APPROVED: '해당 관측자료 또는 관측소 정보 API의 활용승인을 확인해주세요.',
  HUB_STATIONS_NOT_APPROVED: '관측자료 연결 확인 · 가까운 관측소 자동 선택을 위해 API허브의 지상관측 지점정보(지상·AWS) 활용승인이 필요합니다.',
  HUB_STATIONS_UNAVAILABLE: '관측소 위치 정보를 불러오지 못했습니다.',
  HUB_NO_NEARBY_STATION: '100km 이내에 조회 가능한 관측소가 없습니다.',
  HUB_NO_OBSERVATIONS: '주변 관측소의 관측자료가 아직 제공되지 않습니다.',
  HUB_UNAVAILABLE: '기상청 API허브 연결이 지연되고 있습니다.',
};
export async function siteObservations(latitude: number, longitude: number) {
  const key = Deno.env.get('KMA_APIHUB_KEY')?.trim();
  if (!key) return { observations: [], warnings: ['기상청 API허브 키 미설정 · 관측자료를 표시할 수 없습니다.'] };
  const kinds: Kind[] = ['AWS', 'ASOS'];
  const results = await Promise.allSettled(kinds.map(kind => current(kind, latitude, longitude, key)));
  return {
    observations: results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []),
    warnings: results.flatMap((r,i) => r.status === 'rejected' ? [`${kinds[i]}: ${messages[r.reason?.code] || messages.HUB_UNAVAILABLE}`] : []),
    retrievedAt: new Date().toISOString(),
  };
}

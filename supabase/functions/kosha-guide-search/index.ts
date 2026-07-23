import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// 한국산업안전보건공단 기술지원규정(KOSHA GUIDE) 조회 서비스
// https://www.data.go.kr/data/15144147/openapi.do
const BASE = 'https://apis.data.go.kr/B552468/koshaguide';
const CALL_API_ID = '1050';

type JsonRecord = Record<string, unknown>;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function pick(item: JsonRecord, exactKeys: string[], keyPattern?: RegExp): string {
  for (const key of exactKeys) {
    const value = stringValue(item[key]);
    if (value) return value;
  }
  if (keyPattern) {
    for (const [key, rawValue] of Object.entries(item)) {
      const value = stringValue(rawValue);
      if (value && keyPattern.test(key)) return value;
    }
  }
  return '';
}

function findItemArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    if (records.length) return records;
    for (const child of value) {
      const found = findItemArray(child);
      if (found.length) return found;
    }
    return [];
  }
  if (!isRecord(value)) return [];

  for (const preferred of ['items', 'item', 'list', 'data', 'result']) {
    if (preferred in value) {
      const found = findItemArray(value[preferred]);
      if (found.length) return found;
    }
  }
  for (const child of Object.values(value)) {
    const found = findItemArray(child);
    if (found.length) return found;
  }
  return [];
}

function findByKey(value: unknown, wantedKeys: string[]): unknown {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findByKey(child, wantedKeys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of wantedKeys) {
    if (value[key] !== undefined) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findByKey(child, wantedKeys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function xmlError(text: string): string {
  const resultCode = text.match(/<resultCode>([\s\S]*?)<\/resultCode>/i)?.[1]?.trim();
  const resultMsg = text.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/i)?.[1]?.trim();
  const gatewayMsg = text.match(/<(?:returnAuthMsg|errMsg)>([\s\S]*?)<\/(?:returnAuthMsg|errMsg)>/i)?.[1]?.trim();
  if (gatewayMsg) return gatewayMsg;
  if (resultCode && !['0', '00'].includes(resultCode)) return `${resultCode}: ${resultMsg || 'API 요청 실패'}`;
  return '';
}

function isAllowedKoshaFileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'portal.kosha.or.kr'
      && url.pathname.startsWith('/openapi/v1/file/down/');
  } catch {
    return false;
  }
}

async function proxyKoshaPdf(req: Request): Promise<Response> {
  const fileUrl = new URL(req.url).searchParams.get('file') || '';
  if (!isAllowedKoshaFileUrl(fileUrl)) {
    return json({ error: '허용되지 않은 KOSHA 원문 주소입니다.' }, 400);
  }

  const upstreamHeaders = new Headers();
  const range = req.headers.get('range');
  if (range) upstreamHeaders.set('range', range);

  const upstream = await fetch(fileUrl, {
    headers: upstreamHeaders,
    signal: AbortSignal.timeout(20000),
  });
  if (!upstream.ok && upstream.status !== 206) {
    return json({ error: `KOSHA 원문을 불러오지 못했습니다. (HTTP ${upstream.status})` }, 502);
  }

  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', upstream.headers.get('content-type') || 'application/pdf');
  headers.set('Content-Disposition', 'inline; filename="kosha-guide.pdf"');
  headers.set('Cache-Control', 'public, max-age=3600');
  for (const name of ['accept-ranges', 'content-range', 'content-length', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method === 'GET') {
    try {
      return await proxyKoshaPdf(req);
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : String(error),
        code: 'KOSHA_GUIDE_FILE_FAILED',
      }, 502);
    }
  }
  if (req.method !== 'POST') return json({ error: 'POST 요청만 지원합니다.' }, 405);

  try {
    const apiKey = Deno.env.get('KOSHA_API_KEY');
    if (!apiKey) {
      return json({
        error: 'Supabase에 KOSHA_API_KEY가 설정되지 않았습니다. data.go.kr의 API 15144147 활용신청 후 일반 인증키(Decoding)를 Supabase Secret에 등록하세요.',
        code: 'KOSHA_API_KEY_MISSING',
      });
    }

    const body = await req.json().catch(() => ({}));
    const query = String(body?.query || '').trim();
    const url = new URL(`${BASE}/getKoshaGuide`);
    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('callApiId', CALL_API_ID);
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', '100');
    if (query) url.searchParams.set('techGdlnNm', query);

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`KOSHA GUIDE API HTTP ${response.status}: ${responseText.slice(0, 180)}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      const gatewayError = xmlError(responseText);
      if (gatewayError) {
        throw new Error(`데이터포털 인증 오류: ${gatewayError}. API 15144147의 활용승인과 Decoding 인증키를 확인하세요.`);
      }
      throw new Error('KOSHA GUIDE API가 JSON이 아닌 응답을 반환했습니다.');
    }

    const resultCode = stringValue(findByKey(payload, ['resultCode', 'returnReasonCode']));
    const resultMessage = stringValue(findByKey(payload, ['resultMsg', 'resultMessage', 'returnAuthMsg', 'errMsg']));
    if (resultCode && !['0', '00', '0000'].includes(resultCode)) {
      throw new Error(`KOSHA GUIDE API 오류 (${resultCode}): ${resultMessage || '요청 실패'}`);
    }
    if (resultMessage && /SERVICE KEY|AUTH|인증|승인|등록되지/i.test(resultMessage)) {
      throw new Error(`데이터포털 인증 오류: ${resultMessage}`);
    }

    const rawItems = findItemArray(payload);
    const normalized = rawItems.map((item) => ({
      title: pick(item,
        ['techGdlnNm', 'techGuidelineName', 'guideNm', 'gdlnNm', 'title', 'name'],
        /(?:tech)?(?:gdln|guide).*(?:nm|name|title)|^title$/i),
      guideNo: pick(item,
        ['techGdlnNo', 'techGuidelineNo', 'guideNo', 'gdlnNo', 'code'],
        /(?:tech)?(?:gdln|guide).*(?:no|number|code)|^code$/i),
      date: pick(item,
        ['ofancYmd', 'pblcnYmd', 'regYmd', 'regDate', 'publicationDate', 'date'],
        /(?:date|ymd|published|publication)/i),
      category: pick(item,
        ['techGdlnSeNm', 'category', 'fieldNm', 'clNm', 'divisionName'],
        /(?:category|field|division|seNm|clNm)/i),
      url: pick(item,
        ['techGdlnUrl', 'flDwnUrl', 'dwnldUrl', 'downloadUrl', 'fileUrl', 'atchFileUrl', 'url'],
        /(?:download|dwn|file|atch|gdln).*url|^url$/i),
      raw: item,
    })).filter((item) => item.title || item.guideNo);

    const queryLower = query.toLocaleLowerCase('ko');
    const list = queryLower
      ? normalized.filter((item) =>
          [item.title, item.guideNo, item.category, JSON.stringify(item.raw)]
            .join(' ')
            .toLocaleLowerCase('ko')
            .includes(queryLower))
      : normalized;

    const totalRaw = findByKey(payload, ['totalCount', 'totalCnt', 'total']);
    const totalCount = Number(totalRaw);

    return json({
      result: {
        list,
        totalCount: Number.isFinite(totalCount) ? totalCount : list.length,
        source: 'data.go.kr/15144147',
      },
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
      code: 'KOSHA_GUIDE_API_FAILED',
    });
  }
});

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 한국산업안전보건공단_기술지원규정(KOSHA GUIDE) 조회 서비스 (data.go.kr 15144147)
const BASE = 'https://apis.data.go.kr/B552468/koshaguide';
const CALL_API_ID = '1050'; // 고정값 (기술지원규정 호출)

// XML 어디에 있든 <item> 블록들을 찾아 필드명 그대로 객체로 변환 (필드명을 100% 확신 못해 방어적으로 전부 수집)
function xmlItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const obj: Record<string, string> = {};
    const fieldRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let f;
    while ((f = fieldRe.exec(m[1])) !== null) {
      obj[f[1]] = f[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    }
    items.push(obj);
  }
  return items;
}

function pick(obj: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (obj[k]) return obj[k];
  return '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const KEY = Deno.env.get('KOSHA_API_KEY');
    if (!KEY) {
      return new Response(JSON.stringify({
        error: 'KOSHA_API_KEY 미설정 — 이미 등록하셨다면 그대로 재사용됩니다. 안 되면 data.go.kr에서 발급받은 일반 인증키(Decoding)를 supabase secrets set KOSHA_API_KEY=발급키 로 등록하세요.'
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { query } = await req.json();
    const q = String(query || '').trim();
    const url = `${BASE}/getKoshaGuide?serviceKey=${encodeURIComponent(KEY)}`
      + `&callApiId=${CALL_API_ID}&pageNo=1&numOfRows=50`
      + (q ? `&techGdlnNm=${encodeURIComponent(q)}` : '');
    const res = await fetch(url);
    const xml = await res.text();

    const resultCode = xml.match(/<resultCode>(\w+)<\/resultCode>/)?.[1];
    if (resultCode && resultCode !== '00' && resultCode !== '0') {
      const resultMsg = xml.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/)?.[1] || '';
      throw new Error(`KOSHA GUIDE API 오류 (${resultCode}): ${resultMsg}`);
    }
    // data.go.kr 게이트웨이 공통 에러 envelope (서비스키 미승인 등) — resultCode와 태그명이 달라 별도 체크
    const gwErrMsg = xml.match(/<errMsg>([\s\S]*?)<\/errMsg>/)?.[1];
    const gwAuthMsg = xml.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/)?.[1];
    if (gwErrMsg || gwAuthMsg) {
      throw new Error(`데이터포털 게이트웨이 오류: ${gwAuthMsg || gwErrMsg} — 활용신청이 이 API(15144147)에도 승인됐는지 확인하세요`);
    }

    const raw = xmlItems(xml);
    const list = raw.map(it => ({
      title: pick(it, ['techGdlnNm', 'title', 'gdlnNm']),
      guideNo: pick(it, ['techGdlnNo', 'guideNo', 'gdlnNo']),
      date: pick(it, ['ofancYmd', 'regDate', 'pblcnYmd']),
      category: pick(it, ['techGdlnSeNm', 'category', 'fieldNm', 'clNm']),
      url: pick(it, ['techGdlnUrl', 'flDwnUrl', 'dwnldUrl', 'fileUrl', 'atchFileUrl']),
      raw: it, // 매핑 안 된 필드도 프런트에서 확인 가능하도록 원본 보존
    }));

    const totalCount = xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1];
    return new Response(JSON.stringify({
      result: {
        list,
        totalCount: totalCount ? Number(totalCount) : list.length,
        debug: list.length === 0 ? xml.slice(0, 400) : undefined, // 결과 0건일 때 원인 파악용 (정상 응답이면 프런트에서 무시)
      }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

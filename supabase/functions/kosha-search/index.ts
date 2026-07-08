import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// KOSHA 물질안전보건자료 조회 서비스 (data.go.kr 15157612)
// searchCnd: 0=국문명, 1=CAS No, 3=KE No
const BASE = 'https://msds.kosha.or.kr/openapi/service/msdschem';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const KEY = Deno.env.get('KOSHA_API_KEY');
    if (!KEY) {
      return new Response(JSON.stringify({
        error: 'KOSHA_API_KEY 미설정 — data.go.kr에서 "한국산업안전보건공단_물질안전보건자료 조회 서비스" 활용신청 후, supabase secrets set KOSHA_API_KEY=발급키 를 실행하세요.'
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { query, mode } = await req.json(); // mode: 'name' | 'cas'
    if (!query || !String(query).trim()) throw new Error('검색어가 없습니다');
    const searchCnd = mode === 'cas' ? 1 : 0;
    const url = `${BASE}/chemlist?serviceKey=${encodeURIComponent(KEY)}`
      + `&searchWrd=${encodeURIComponent(String(query).trim())}`
      + `&searchCnd=${searchCnd}&numOfRows=15&pageNo=1`;
    const res = await fetch(url);
    const xml = await res.text();
    const resultCode = xml.match(/<resultCode>(\w+)<\/resultCode>/)?.[1];
    if (resultCode && resultCode !== '00') {
      const resultMsg = xml.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/)?.[1] || '';
      throw new Error(`KOSHA API 오류 (${resultCode}): ${resultMsg}`);
    }
    const list = xmlItems(xml).map(it => ({
      chemId: it.chemId || '',
      name: it.chemNameKor || it.chemName || '',
      casNo: it.casNo || '',
      keNo: it.keNo || '',
      enNo: it.enNo || '',
      lastDate: it.lastDate || '',
    }));

    // 첫 결과의 유해성·위험성(2항) 요약을 함께 (선택적 — 실패해도 목록은 반환)
    let firstDetail: { chemId: string; lines: string[] } | null = null;
    if (list.length && list[0].chemId) {
      try {
        const dRes = await fetch(`${BASE}/chemdetail02?serviceKey=${encodeURIComponent(KEY)}&chemId=${list[0].chemId}`);
        const dXml = await dRes.text();
        const lines = xmlItems(dXml)
          .map(it => `${it.msdsItemNameKor || it.itemName || ''}: ${it.itemDetail || ''}`.trim())
          .filter(l => l.length > 3)
          .slice(0, 10);
        firstDetail = { chemId: list[0].chemId, lines };
      } catch { /* 요약 실패는 무시 */ }
    }

    return new Response(JSON.stringify({ result: { list, firstDetail } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

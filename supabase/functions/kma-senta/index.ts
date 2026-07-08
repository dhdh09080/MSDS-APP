import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 기상청 생활기상지수 건설현장(A48) 체감온도 — seongdongxi 포스터와 동일 데이터원
// 발표: 매일 06시·18시. 발표분 기준 시간 오프셋(h1,h2,...)으로 시간별 값 제공.
const AREA_NO = '1123060000'; // 성동자이리버뷰 (답십리제1동 격자)
const pad = (n: number) => String(n).padStart(2, '0');

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const KEY = Deno.env.get('KMA_API_KEY');
    if (!KEY) {
      return new Response(JSON.stringify({ error: 'KMA_API_KEY 미설정 — seongdongxi에서 쓰는 기상청 키를 supabase secrets set KMA_API_KEY=키 로 등록하세요.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const ymd = `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`;

    // 최신 발표분부터 역순 시도: 오늘 18시 → 오늘 06시 → 어제 18시
    const yest = new Date(kst.getTime() - 86400000);
    const yYmd = `${yest.getUTCFullYear()}${pad(yest.getUTCMonth() + 1)}${pad(yest.getUTCDate())}`;
    const bases = [`${ymd}18`, `${ymd}06`, `${yYmd}18`];

    for (const base of bases) {
      const url = `https://apis.data.go.kr/1360000/LivingWthrIdxServiceV2/getSenTaIdxV2`
        + `?serviceKey=${encodeURIComponent(KEY)}&numOfRows=10&pageNo=1&dataType=JSON`
        + `&areaNo=${AREA_NO}&time=${base}&requestCode=A48`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        const item = data?.response?.body?.items?.item?.[0] || data?.response?.body?.items?.item;
        if (!item) continue;
        // h1..h31 = 발표시각+n시간의 체감온도. 오늘 06~18시 구간만 추출.
        const by = +base.slice(0, 4), bm = +base.slice(4, 6), bd = +base.slice(6, 8), bh = +base.slice(8, 10);
        const baseMs = Date.UTC(by, bm - 1, bd, bh);
        const hours: { hour: number; feel: number }[] = [];
        for (let n = 1; n <= 31; n++) {
          const v = parseFloat(item['h' + n]);
          if (isNaN(v)) continue;
          const t = new Date(baseMs + n * 3600000);
          const tYmd = `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
          const h = t.getUTCHours();
          if (tYmd === ymd && h >= 6 && h <= 19) hours.push({ hour: h, feel: v });
        }
        if (hours.length) {
          return new Response(JSON.stringify({ result: { base, date: ymd, hours } }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      } catch { /* 다음 발표분 시도 */ }
    }
    throw new Error('오늘자 체감온도 예보를 찾지 못했습니다 (발표분 없음)');
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

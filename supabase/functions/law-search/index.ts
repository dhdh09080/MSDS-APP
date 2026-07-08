import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 법제처 국가법령정보 Open API (open.law.go.kr — DRF lawSearch)
// OC = open.law.go.kr에서 무료 발급하는 이메일 아이디. 미설정 시 공식 샘플 계정('test')으로 폴백.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const OC = Deno.env.get('LAW_OC') || 'test';
    const { query, sort } = await req.json();
    if (!query || !String(query).trim()) throw new Error('검색어가 없습니다');
    const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(OC)}`
      + `&target=law&type=JSON&display=20`
      + `&sort=${encodeURIComponent(sort || 'efdes')}`  // 기본: 시행일자 내림차순 (최신 개정 먼저)
      + `&query=${encodeURIComponent(String(query).trim())}`;
    const res = await fetch(url);
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); }
    catch { throw new Error('법제처 응답 파싱 실패 — OC 계정 상태를 확인하세요'); }
    let laws = data?.LawSearch?.law || [];
    if (!Array.isArray(laws)) laws = [laws];
    const fmtDate = (v: any) => { const s = String(v || ''); return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : s; };
    const list = laws.map((l: any) => ({
      name: l['법령명한글'] || '',
      abbr: l['법령약칭명'] || '',
      kind: l['법령구분명'] || '',
      dept: l['소관부처명'] || '',
      revision: l['제개정구분명'] || '',
      efDate: fmtDate(l['시행일자']),
      ancDate: fmtDate(l['공포일자']),
      link: l['법령상세링크'] ? `https://www.law.go.kr${l['법령상세링크']}` : '',
    }));
    return new Response(JSON.stringify({ result: { totalCnt: Number(data?.LawSearch?.totalCnt || list.length), list, oc: OC === 'test' ? 'test' : 'own' } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

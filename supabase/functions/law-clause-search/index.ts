import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 산업안전보건 관련 고정 법령 세트 (법제처 정식 법령명 기준)
const PINNED_LAWS = [
  '산업안전보건법',
  '산업안전보건법 시행령',
  '산업안전보건법 시행규칙',
  '산업안전보건기준에 관한 규칙',
  '유해·위험작업의 취업 제한에 관한 규칙',
  '중대재해 처벌 등에 관한 법률',
  '중대재해 처벌 등에 관한 법률 시행령',
];

// JSON 어디에 박혀있든 상관없이 조문 배열을 찾아냄 (법제처 API 응답 envelope이 문서마다 조금씩 달라서 방어적으로 탐색)
function findArticleArray(obj: any): any[] | null {
  if (Array.isArray(obj)) {
    if (obj.length && obj[0] && typeof obj[0] === 'object' && ('조문내용' in obj[0] || '조문번호' in obj[0])) return obj;
    for (const item of obj) { const r = findArticleArray(item); if (r) return r; }
    return null;
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) { const r = findArticleArray(obj[k]); if (r) return r; }
  }
  return null;
}

// 값이 문자열/배열/객체 뭐든 안의 텍스트를 전부 이어붙임 (항·호처럼 중첩된 구조 대응)
function flattenText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(flattenText).join(' ');
  if (typeof v === 'object') return Object.values(v).map(flattenText).join(' ');
  return String(v);
}

function asArray(v: any): any[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// 특정 키(하위 항목·번호)는 제외하고 나머지 텍스트만 이어붙임 — 항 텍스트에 호 내용이 중복 포함되는 것 방지
function flattenTextExcept(obj: any, except: string[]): string {
  if (obj == null) return '';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) return obj.map(v => flattenTextExcept(v, except)).join(' ');
  return Object.entries(obj).filter(([k]) => !except.includes(k)).map(([, v]) => flattenText(v)).join(' ');
}

const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
function circledNum(n: string): string {
  const num = parseInt(n, 10);
  return (num >= 1 && num <= 20) ? CIRCLED[num] : (n || '');
}

// 조문내용만으로는 안 됨 — 실제 본문은 항/호/목(하위 단위)에 들어있는 경우가 많음.
// 국가법령정보센터 표기처럼 항은 ①②③, 호는 "1. 2. 3.", 목은 "가. 나. 다." + 들여쓰기로 줄바꿈해서 조립
function formatArticleText(a: any): string {
  const lines: string[] = [];
  const intro = flattenText(a['조문내용']).trim();
  if (intro) lines.push(intro);

  for (const hang of asArray(a['항'])) {
    const hangNo = hang['항번호'] ? circledNum(hang['항번호']) + ' ' : '';
    const hangText = flattenTextExcept(hang, ['항번호', '호']).trim();
    if (hangText) lines.push(`${hangNo}${hangText}`);
    for (const ho of asArray(hang['호'])) {
      const hoNo = ho['호번호'] ? `${ho['호번호']}. ` : '';
      const hoText = flattenTextExcept(ho, ['호번호', '목']).trim();
      if (hoText) lines.push(`  ${hoNo}${hoText}`);
      for (const mok of asArray(ho['목'])) {
        const mokNo = mok['목번호'] ? `${mok['목번호']}. ` : '';
        const mokText = flattenTextExcept(mok, ['목번호']).trim();
        if (mokText) lines.push(`    ${mokNo}${mokText}`);
      }
    }
  }
  return lines.join('\n');
}

// 태그만 제거, 줄바꿈은 보존 (기존 stripTags는 \s+를 공백 하나로 뭉개서 들여쓰기/줄바꿈이 다 사라짐)
function stripTagsKeepBreaks(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function makeSnippet(text: string, query: string, radius = 90): string {
  const idx = text.indexOf(query);
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

async function fetchJson(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error('법제처 응답 파싱 실패 (JSON 아님) — OC 계정 상태를 확인하세요'); }
}

async function findMST(OC: string, lawName: string): Promise<string | null> {
  const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(OC)}`
    + `&target=law&type=JSON&display=5&query=${encodeURIComponent(lawName)}`;
  const data = await fetchJson(url);
  let laws = data?.LawSearch?.law || [];
  if (!Array.isArray(laws)) laws = [laws];
  if (!laws.length) return null;
  const exact = laws.find((l: any) => l['법령명한글'] === lawName);
  return (exact || laws[0])?.['법령일련번호'] || null;
}

async function fetchArticles(OC: string, mst: string) {
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(OC)}&target=law&type=JSON&MST=${encodeURIComponent(mst)}`;
  const data = await fetchJson(url);
  const arr = findArticleArray(data);
  return arr || [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const OC = Deno.env.get('LAW_OC') || 'test';
    const { query } = await req.json();
    const q = String(query || '').trim();
    if (!q) throw new Error('검색어가 없습니다');

    const results = await Promise.all(PINNED_LAWS.map(async (lawName) => {
      try {
        const mst = await findMST(OC, lawName);
        if (!mst) return { lawName, error: '법령을 찾지 못했습니다', articles: [] };
        const raw = await fetchArticles(OC, mst);
        const matched = raw.filter((a: any) => {
          if (a['조문여부'] === '전문') return false; // 전문(머리말) 제외, 실제 조문만
          return formatArticleText(a).includes(q);
        });
        const articles = matched.slice(0, 15).map((a: any) => {
          const title = stripTags(flattenText(a['조문제목']));
          const content = stripTagsKeepBreaks(formatArticleText(a));
          const flatForSnippet = content.replace(/\n/g, ' ').replace(/\s+/g, ' ');
          return {
            jo: a['조문번호'] || '',
            title,
            snippet: makeSnippet(flatForSnippet, q) || flatForSnippet.slice(0, 180),
            content: content.slice(0, 4000),
          };
        });
        return { lawName, articles };
      } catch (e) {
        return { lawName, error: e?.message || String(e), articles: [] };
      }
    }));

    return new Response(JSON.stringify({ result: { query: q, laws: results } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

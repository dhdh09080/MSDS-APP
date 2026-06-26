import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT = `이 MSDS(물질안전보건자료) PDF에서 다음 항목을 추출하세요. JSON만 응답:
{
  "productName":"제품명",
  "manufacturer":"제조사(제품을 만든 회사)",
  "supplier":"공급업체(국내 공급/유통/판매 회사, MSDS 1항 공급자 정보). 제조사와 같으면 제조사명 그대로",
  "casNo":"CAS 번호들 쉼표구분",
  "components":"구성성분 (성분명 농도% 형태)",
  "signalWord":"신호어 (위험/경고/해당없음)",
  "specialSubstance":"발암성→Y_cancer, 생식독성→Y_repro, 변이원성→Y_mutagen, 과민성→Y_sensitizer, 기타→Y_other, 해당없음→N",
  "hCodes":"H코드들 쉼표구분",
  "pCodes":"P코드들 쉼표구분",
  "pictograms":"GHS 그림문자 (예: GHS02(불꽃), GHS07(느낌표))",
  "issueDate":"작성/개정일 YYYY-MM-DD"
}
없으면 빈 문자열. JSON만 반환.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { pdfBase64 } = await req.json();
    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: 'PDF 데이터가 없습니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API 키가 서버에 설정되지 않았습니다' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    };

    let res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 500 || res.status === 529) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: `Claude API 오류 ${res.status}: ${errText}` }), {
        status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const text = data.content.map((i: any) => i.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('JSON 파싱 실패');
    }

    return new Response(JSON.stringify({ result: parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
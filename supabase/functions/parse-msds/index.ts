import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PROMPT = `당신은 한국 산업안전보건법(산안법)에 정통한 보건관리자입니다.
이 MSDS(물질안전보건자료)에서 다음 항목을 추출하고, 화학물질 규제 여부를 판정하세요. JSON만 응답:
{
  "productName":"제품명",
  "supplier":"공급업체(국내 공급/유통/판매 회사명, MSDS 1항 공급자 정보)",
  "supplierContact":"공급업체 전화번호 (MSDS 1항)",
  "casNo":"주요 구성성분 CAS 번호들. 여러 개면 쉼표로 구분",
  "components":"구성성분명과 함유량. 형식: 성분명(CAS번호) 함유량% 를 쉼표로 구분. 예: 아세톤(67-64-1) 30%, 톨루엔(108-88-3) 20%",
  "signalWord":"신호어 (위험/경고/해당없음 중 하나)",
  "hCodes":"유해위험문구 H코드들 쉼표구분 (예: H225, H319, H336)",
  "pCodes":"예방조치 P코드들 쉼표구분 (예: P210, P280, P305)",
  "pictograms":"GHS 그림문자 코드만 쉼표구분. 반드시 GHS01~GHS09 형식. 예: GHS02, GHS07, GHS08",
  "issueDate":"MSDS 작성/개정일 YYYY-MM-DD",
  "protectiveEquipment":"권장 개인보호구를 한글로 간결히. 예: 내화학성 장갑, 보안경, 방독마스크(유기증기용), 보호복",
  "legalMeasurement":"구성성분이 작업환경측정 대상물질이면 Y, 아니면 N",
  "legalExam":"구성성분이 특수건강진단 대상물질이면 Y, 아니면 N",
  "legalExamCycle":"특수건강진단 대상이면 일반적 주기를 배치후 1차: O개월, 이후: O개월 형식으로. 대상 아니면 빈 문자열",
  "legalManage":"관리대상 유해물질(유기화합물 금속류 산알칼리류 등)이면 Y, 아니면 N",
  "legalPermit":"허가대상 유해물질이면 Y, 아니면 N",
  "legalSpecial":"특별관리물질(발암성 생식독성 생식세포변이원성 CMR)이면 Y, 아니면 N",
  "legalDangerous":"위험물안전관리법상 위험물이면 Y, 아니면 N"
}

판정 시 주의:
- CAS 번호를 근거로 산안법 시행규칙 별표를 기준으로 판단하되, 불확실하면 보수적으로 Y(대상 가능성 있음)로 표기
- 정보가 없으면 빈 문자열 또는 N
JSON만 반환하고 다른 설명 금지.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { fileBase64, mediaType } = await req.json();
    if (!fileBase64) {
      return new Response(JSON.stringify({ error: '파일 데이터가 없습니다' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API 키가 서버에 설정되지 않았습니다' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const type = mediaType || 'application/pdf';
    const sourceBlock = type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: type, data: fileBase64 } };

    const body = {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: PROMPT }] }],
    };

    let res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });

    if (res.status === 500 || res.status === 529) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
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
    const text = data.content.map((i) => i.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('JSON 파싱 실패');
    }

    return new Response(JSON.stringify({ result: parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
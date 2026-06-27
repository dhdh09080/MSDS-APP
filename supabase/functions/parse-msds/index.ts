import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MSDS_PROMPT = `당신은 한국 산업안전보건법(산안법)에 정통한 보건관리자입니다.
이 MSDS(물질안전보건자료)에서 다음 항목을 추출하고, 화학물질 규제 여부를 판정하세요. JSON만 응답:
{
  "productName":"제품명",
  "supplier":"공급업체(국내 공급/유통/판매 회사명, MSDS 1항 공급자 정보)",
  "supplierContact":"공급업체 전화번호 (MSDS 1항)",
  "casNo":"주요 구성성분 CAS 번호들. 여러 개면 쉼표로 구분",
  "components":"구성성분명과 함유량. 형식: 성분명(CAS번호) 함유량% 를 쉼표로 구분",
  "signalWord":"신호어 (위험/경고/해당없음 중 하나)",
  "hCodes":"유해위험문구 H코드들 쉼표구분",
  "pCodes":"예방조치 P코드들 쉼표구분",
  "pictograms":"GHS 그림문자 코드만 쉼표구분. 반드시 GHS01~GHS09 형식",
  "issueDate":"MSDS 작성/개정일 YYYY-MM-DD",
  "protectiveEquipment":"권장 개인보호구를 한글로 간결히",
  "legalMeasurement":"작업환경측정 대상물질이면 Y, 아니면 N",
  "legalExam":"특수건강진단 대상물질이면 Y, 아니면 N",
  "legalExamCycle":"특수건강진단 대상이면 주기를 배치후 1차: O개월, 이후: O개월 형식으로",
  "legalManage":"관리대상 유해물질이면 Y, 아니면 N",
  "legalPermit":"허가대상 유해물질이면 Y, 아니면 N",
  "legalSpecial":"특별관리물질(CMR)이면 Y, 아니면 N",
  "legalDangerous":"위험물안전관리법상 위험물이면 Y, 아니면 N"
}
불확실하면 보수적으로 Y로 표기. JSON만 반환.`;

const MEASURE_PROMPT = `이 작업환경측정 결과 보고서에서 분진 측정결과와 소음 측정결과를 추출하세요. JSON만 응답:
{
  "dust": [{"no":1,"process":"공정명","agent":"유해인자명","measured":"측정치(단위포함)","limit":"노출기준(단위포함)","reason":"적용사유"}],
  "noise": [{"no":1,"process":"공종명","measured":"측정치 dB(A)","limit":"90dB(A)","reason":"적용사유"}],
  "workTypes": ["공종명1","공종명2"],
  "dustExceeded": false,
  "noiseExceeded": false,
  "mixedExceeded": false
}
dust가 없으면 빈 배열, noise가 없으면 빈 배열. JSON만 반환.`;

const HEALTH_PROMPT = `이 건강진단 결과 문서에서 근로자별 정보를 추출하세요. 여러 명이면 모두 추출. JSON 배열만 응답:
[{
  "name":"이름",
  "contractor":"협력사명",
  "jobType":"직무구분(예:소음작업,분진작업,일반)",
  "examDate":"검진일자 YYYY.MM.DD",
  "examType":"1(일반)/2(특수)/3(배치전)",
  "resultCode":"A|B|C1|C2|CN|D1|D2|DN|R|U|V",
  "hazardResult":"유해인자별 판정이 A가 아닌 것만. 예: 소음(우) D1, 소음(좌) C1"
}]
JSON 배열만 반환.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { fileBase64, mediaType, mode } = body;

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

    // 모드에 따라 프롬프트 선택
    let prompt = MSDS_PROMPT;
    if (mode === 'measure') prompt = MEASURE_PROMPT;
    else if (mode === 'health') prompt = HEALTH_PROMPT;

    const type = mediaType || 'application/pdf';
    const sourceBlock = type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: type, data: fileBase64 } };

    const reqBody = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: prompt }] }],
    };

    let res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(reqBody),
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
        body: JSON.stringify(reqBody),
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
    try { parsed = JSON.parse(clean); }
    catch (e) {
      const match = clean.match(/[\[{][\s\S]*[\]}]/);
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
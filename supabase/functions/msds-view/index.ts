import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════════
// msds-view — 경고표지 QR코드 → MSDS 원본 PDF 열람 (공개 리다이렉트)
//
// 배포 시 반드시 JWT 검증을 꺼야 현장 근로자가 로그인 없이 열람 가능:
//   supabase functions deploy msds-view --no-verify-jwt
// (또는 supabase/config.toml 에 [functions.msds-view] verify_jwt = false)
//
// 흐름: QR 스캔 → GET /functions/v1/msds-view?id=<record_id>
//       → service role로 pdf_path 조회 → 10분짜리 서명 URL 생성 → 302 리다이렉트
// 인쇄된 QR은 record id만 담으므로 만료되지 않으며,
// MSDS를 재업로드해도 (pdf_path만 갱신되면) 같은 QR이 항상 최신본을 연다.
// ═══════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f6f8;color:#222;}
.card{background:#fff;border-radius:14px;padding:32px 28px;max-width:340px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.08);}
.icon{font-size:44px;margin-bottom:12px;}h1{font-size:17px;margin:0 0 8px;}p{font-size:13px;color:#666;line-height:1.7;margin:0;}</style></head>
<body><div class="card"><div class="icon">📄</div><h1>${title}</h1><p>${body}</p></div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

serve(async (req) => {
  try {
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!UUID_RE.test(id)) {
      return page('잘못된 요청입니다', 'QR코드가 손상되었거나 주소가 올바르지 않습니다.', 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: rec, error } = await supabase
      .from('msds_records')
      .select('pdf_path, product_name')
      .eq('id', id)
      .maybeSingle();

    if (error || !rec) {
      return page('물질을 찾을 수 없습니다', '삭제되었거나 존재하지 않는 물질입니다.<br>보건관리자에게 문의해 주세요.', 404);
    }
    if (!rec.pdf_path) {
      return page(`${rec.product_name || 'MSDS'}`, '이 물질은 아직 원본 MSDS PDF가 등록되지 않았습니다.<br>보건관리자에게 문의해 주세요.', 404);
    }

    const { data: signed, error: sErr } = await supabase.storage
      .from('msds-pdfs')
      .createSignedUrl(rec.pdf_path, 600); // 10분 유효 — 스캔 시마다 새로 발급되므로 충분

    if (sErr || !signed?.signedUrl) {
      return page('파일을 열 수 없습니다', '원본 파일 접근에 실패했습니다. 잠시 후 다시 시도해 주세요.', 500);
    }

    return new Response(null, { status: 302, headers: { Location: signed.signedUrl } });
  } catch (e) {
    return page('오류가 발생했습니다', String(e?.message || e), 500);
  }
});

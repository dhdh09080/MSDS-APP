import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const providers = ['claude', 'openai', 'gemini'] as const;
type Provider = typeof providers[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isProvider(value: unknown): value is Provider {
  return providers.includes(value as Provider);
}

function keyHint(key: string) {
  const clean = key.trim();
  return clean.length <= 8 ? '••••••••' : `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

function providerError(provider: Provider, status: number, detail: string) {
  const lower = detail.toLowerCase();
  if (status === 401 || status === 403 || lower.includes('api key not valid') || lower.includes('invalid api key')) {
    return { code: 'AI_KEY_INVALID', message: `${provider} API 키가 올바르지 않습니다. 키를 다시 복사해 입력해주세요.` };
  }
  if (status === 402 || lower.includes('billing') || lower.includes('credit balance') || lower.includes('insufficient_quota')) {
    return { code: 'AI_BILLING_REQUIRED', message: `${provider} API 결제 잔액 또는 크레딧을 확인해주세요.` };
  }
  if (status === 429 || lower.includes('quota') || lower.includes('rate limit') || lower.includes('resource_exhausted')) {
    return { code: 'AI_QUOTA_EXCEEDED', message: `${provider} API 사용 한도에 도달했습니다. 토큰·크레딧·사용량 제한을 확인해주세요.` };
  }
  return { code: 'AI_PROVIDER_ERROR', message: `${provider} API 연결에 실패했습니다. 잠시 후 다시 시도하거나 API 설정을 확인해주세요.` };
}

async function validateKey(provider: Provider, apiKey: string) {
  let response: Response;
  if (provider === 'claude') {
    response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    });
  } else if (provider === 'openai') {
    response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } else {
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': apiKey },
    });
  }
  if (!response.ok) {
    const detail = await response.text();
    const mapped = providerError(provider, response.status, detail);
    throw Object.assign(new Error(mapped.message), { code: mapped.code, status: response.status });
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: '지원하지 않는 요청입니다.' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: '로그인 세션이 만료됐습니다. 다시 로그인해주세요.', code: 'AUTH_REQUIRED' }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'status';

    if (action === 'status') {
      const monthStart = new Date();
      monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
      const [{ data: credentials, error: credError }, { data: preference, error: prefError }] = await Promise.all([
        admin.from('user_ai_credentials').select('provider,key_hint,status,last_error,last_validated_at').eq('user_id', user.id),
        admin.from('user_ai_preferences').select('preferred_provider,allow_sensitive_documents,gemini_paid_data_protection_confirmed,monthly_request_limit').eq('user_id', user.id).maybeSingle(),
      ]);
      if (credError || prefError) throw credError || prefError;
      const { count: monthlyUsed, error: usageError } = await admin.from('ai_usage_events')
        .select('id', { count: 'exact', head: true }).eq('user_id', user.id)
        .eq('status', 'success').gte('created_at', monthStart.toISOString());
      if (usageError) throw usageError;
      return json({
        preferredProvider: preference?.preferred_provider || credentials?.[0]?.provider || 'claude',
        privacy: {
          allowSensitiveDocuments: preference?.allow_sensitive_documents || false,
          geminiPaidDataProtectionConfirmed: preference?.gemini_paid_data_protection_confirmed || false,
          monthlyRequestLimit: preference?.monthly_request_limit ?? 0,
          monthlyUsed: monthlyUsed || 0,
        },
        providers: Object.fromEntries(providers.map((provider) => {
          const row = credentials?.find((item) => item.provider === provider);
          return [provider, row ? {
            configured: true, keyHint: row.key_hint, status: row.status,
            lastError: row.last_error, lastValidatedAt: row.last_validated_at,
          } : { configured: false }];
        })),
      });
    }

    if (action === 'privacy') {
      const monthlyRequestLimit = Math.max(0, Math.min(Number(body.monthlyRequestLimit ?? 0), 200));
      const { error } = await admin.from('user_ai_preferences').upsert({
        user_id: user.id,
        allow_sensitive_documents: body.allowSensitiveDocuments === true,
        gemini_paid_data_protection_confirmed: body.geminiPaidDataProtectionConfirmed === true,
        monthly_request_limit: monthlyRequestLimit,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ ok: true, message: 'AI 개인정보 보호와 사용 한도를 저장했습니다.' });
    }

    if (!isProvider(body.provider)) return json({ error: '지원하지 않는 AI 제공자입니다.' }, 400);
    const provider = body.provider;

    if (action === 'save') {
      const apiKey = String(body.apiKey || '').trim();
      if (apiKey.length < 12) return json({ error: 'API 키를 정확히 입력해주세요.', code: 'AI_KEY_INVALID' }, 400);
      await validateKey(provider, apiKey);
      const { error } = await admin.rpc('save_user_ai_credential', {
        p_user_id: user.id, p_provider: provider, p_api_key: apiKey, p_key_hint: keyHint(apiKey),
      });
      if (error) throw error;
      return json({ ok: true, keyHint: keyHint(apiKey), message: 'API 키를 안전하게 저장하고 연결을 확인했습니다.' });
    }

    if (action === 'select') {
      const { data: existing } = await admin.from('user_ai_credentials')
        .select('provider').eq('user_id', user.id).eq('provider', provider).maybeSingle();
      if (!existing) return json({ error: '먼저 이 제공자의 API 키를 저장해주세요.', code: 'AI_KEY_REQUIRED' }, 400);
      const { error } = await admin.from('user_ai_preferences').upsert({
        user_id: user.id, preferred_provider: provider, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === 'test') {
      const { data, error } = await admin.rpc('get_user_ai_context', { p_user_id: user.id, p_provider: provider });
      if (error) throw error;
      if (!data?.[0]?.api_key) return json({ error: '저장된 API 키가 없습니다.', code: 'AI_KEY_REQUIRED' }, 400);
      await validateKey(provider, data[0].api_key);
      await admin.from('user_ai_credentials').update({
        status: 'active', last_error: null, last_validated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('user_id', user.id).eq('provider', provider);
      return json({ ok: true, message: 'API 연결이 정상입니다.' });
    }

    if (action === 'delete') {
      const { error } = await admin.rpc('delete_user_ai_credential', { p_user_id: user.id, p_provider: provider });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: '지원하지 않는 작업입니다.' }, 400);
  } catch (error) {
    const err = error as Error & { code?: string; status?: number };
    return json({ error: err.message || 'API 설정 처리 중 오류가 발생했습니다.', code: err.code || 'AI_SETTINGS_ERROR' }, err.status && err.status < 500 ? err.status : 500);
  }
});

-- 사용자별 AI API 키는 Supabase Vault에 암호화 저장합니다.
create extension if not exists supabase_vault with schema vault;

create table if not exists public.user_ai_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('claude', 'openai', 'gemini')),
  secret_id uuid not null,
  key_hint text not null,
  status text not null default 'active' check (status in ('active', 'error')),
  last_error text,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists public.user_ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_provider text not null default 'claude'
    check (preferred_provider in ('claude', 'openai', 'gemini')),
  updated_at timestamptz not null default now()
);

alter table public.user_ai_credentials enable row level security;
alter table public.user_ai_preferences enable row level security;

-- API 키 메타데이터도 브라우저에서 직접 읽지 못하게 하고 Edge Function만 접근합니다.
revoke all on public.user_ai_credentials from public, anon, authenticated;
revoke all on public.user_ai_preferences from public, anon, authenticated;
grant all on public.user_ai_credentials to service_role;
grant all on public.user_ai_preferences to service_role;

create or replace function public.save_user_ai_credential(
  p_user_id uuid,
  p_provider text,
  p_api_key text,
  p_key_hint text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  v_secret_id uuid;
begin
  if p_provider not in ('claude', 'openai', 'gemini') then
    raise exception 'unsupported provider';
  end if;
  if length(trim(p_api_key)) < 12 then
    raise exception 'invalid api key';
  end if;

  select secret_id into v_secret_id
  from public.user_ai_credentials
  where user_id = p_user_id and provider = p_provider;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      trim(p_api_key),
      'user_ai_' || p_user_id::text || '_' || p_provider,
      '현장관리시스템 사용자별 ' || p_provider || ' API 키'
    );
  else
    perform vault.update_secret(v_secret_id, trim(p_api_key));
  end if;

  insert into public.user_ai_credentials (
    user_id, provider, secret_id, key_hint, status, last_error,
    last_validated_at, updated_at
  ) values (
    p_user_id, p_provider, v_secret_id, p_key_hint, 'active', null,
    now(), now()
  )
  on conflict (user_id, provider) do update set
    secret_id = excluded.secret_id,
    key_hint = excluded.key_hint,
    status = 'active',
    last_error = null,
    last_validated_at = now(),
    updated_at = now();

  insert into public.user_ai_preferences (user_id, preferred_provider)
  values (p_user_id, p_provider)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.get_user_ai_context(
  p_user_id uuid,
  p_provider text default null
) returns table(provider text, api_key text)
language sql
security definer
set search_path = pg_catalog, public, vault
as $$
  with requested as (
    select coalesce(
      p_provider,
      (select preferred_provider from public.user_ai_preferences where user_id = p_user_id),
      'claude'
    ) as provider
  )
  select c.provider, v.decrypted_secret
  from requested r
  join public.user_ai_credentials c
    on c.user_id = p_user_id and c.provider = r.provider
  join vault.decrypted_secrets v on v.id = c.secret_id
  limit 1;
$$;

create or replace function public.delete_user_ai_credential(
  p_user_id uuid,
  p_provider text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  v_secret_id uuid;
begin
  delete from public.user_ai_credentials
  where user_id = p_user_id and provider = p_provider
  returning secret_id into v_secret_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  update public.user_ai_preferences p
  set preferred_provider = coalesce(
    (select c.provider from public.user_ai_credentials c
     where c.user_id = p_user_id order by c.updated_at desc limit 1),
    'claude'
  ), updated_at = now()
  where p.user_id = p_user_id and p.preferred_provider = p_provider;
end;
$$;

revoke all on function public.save_user_ai_credential(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_user_ai_context(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_user_ai_credential(uuid, text) from public, anon, authenticated;
grant execute on function public.save_user_ai_credential(uuid, text, text, text) to service_role;
grant execute on function public.get_user_ai_context(uuid, text) to service_role;
grant execute on function public.delete_user_ai_credential(uuid, text) to service_role;


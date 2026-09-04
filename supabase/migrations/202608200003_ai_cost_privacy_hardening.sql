-- AI 비용/개인정보 보호 설정과 최소 메타데이터 사용량 기록
alter table public.user_ai_preferences
  add column if not exists allow_sensitive_documents boolean not null default false,
  add column if not exists gemini_paid_data_protection_confirmed boolean not null default false,
  add column if not exists monthly_request_limit integer not null default 30;

alter table public.user_ai_preferences
  drop constraint if exists user_ai_preferences_monthly_request_limit_check;
alter table public.user_ai_preferences
  add constraint user_ai_preferences_monthly_request_limit_check
  check (monthly_request_limit between 1 and 200);

create table if not exists public.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('claude', 'openai', 'gemini')),
  mode text not null check (mode in ('msds', 'measure', 'health')),
  status text not null check (status in ('success', 'error', 'cache_hit')),
  input_bytes integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_events_user_month_idx
  on public.ai_usage_events (user_id, created_at desc);

-- 원문을 저장하지 않고 사용자별 파일 지문과 분석 JSON만 30일간 재사용합니다.
-- 건강진단(민감정보) 결과는 캐시하지 않습니다.
create table if not exists public.ai_analysis_cache (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('claude', 'openai', 'gemini')),
  mode text not null check (mode in ('msds', 'measure')),
  file_hash text not null,
  prompt_version text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (user_id, provider, mode, file_hash, prompt_version)
);
create index if not exists ai_analysis_cache_expiry_idx
  on public.ai_analysis_cache (expires_at);

alter table public.ai_usage_events enable row level security;
alter table public.ai_analysis_cache enable row level security;
revoke all on public.ai_usage_events from public, anon, authenticated;
revoke all on public.ai_analysis_cache from public, anon, authenticated;
grant all on public.ai_usage_events to service_role;
grant all on public.ai_analysis_cache to service_role;

-- 공개 업로드 링크는 기본 30일 후 만료합니다. 기존 링크도 적용일부터 30일간 유예합니다.
alter table public.public_upload_links
  add column if not exists expires_at timestamptz;
update public.public_upload_links
set expires_at = now() + interval '30 days'
where expires_at is null;
alter table public.public_upload_links
  alter column expires_at set default (now() + interval '30 days');

-- 재업로드 자료는 공개 테이블 정책으로 노출하지 않습니다.
drop policy if exists "anon can select reupload requested msds" on public.msds_records;
drop policy if exists "anon can update reupload requested msds" on public.msds_records;
drop policy if exists "anon can insert notifications" on public.notifications;

-- 공개 재업로드는 토큰과 협력사를 함께 검증하는 제한 RPC만 허용합니다.
create or replace function public.get_public_reupload_requests(p_token text, p_contractor_id uuid)
returns table (id uuid, product_name text, supplier text, version integer, reupload_reason text, reupload_requested_at timestamptz)
language sql security definer set search_path = pg_catalog, public
as $$
  select r.id, r.product_name, r.supplier, r.version, r.reupload_reason, r.reupload_requested_at
  from public.msds_records r
  join public.contractors c on c.id = p_contractor_id and c.workspace_id = r.workspace_id
  where r.contractor = c.name and r.reupload_requested = true
    and (exists (select 1 from public.upload_tokens t where t.token = p_token and t.contractor_id = c.id and t.workspace_id = r.workspace_id and (t.expires_at is null or t.expires_at > now()))
      or exists (select 1 from public.public_upload_links l where l.token = p_token and l.workspace_id = r.workspace_id and l.allow_msds = true and (l.expires_at is null or l.expires_at > now())))
  order by r.reupload_requested_at;
$$;

create or replace function public.complete_public_reupload(p_token text, p_contractor_id uuid, p_record_id uuid, p_file_name text, p_file_path text)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_record public.msds_records%rowtype;
  v_contractor public.contractors%rowtype;
  v_new_version integer;
begin
  select * into v_contractor from public.contractors where id = p_contractor_id;
  select * into v_record from public.msds_records where id = p_record_id and workspace_id = v_contractor.workspace_id and contractor = v_contractor.name and reupload_requested = true for update;
  if v_record.id is null or not (
    exists (select 1 from public.upload_tokens t where t.token = p_token and t.contractor_id = v_contractor.id and t.workspace_id = v_record.workspace_id and (t.expires_at is null or t.expires_at > now()))
    or exists (select 1 from public.public_upload_links l where l.token = p_token and l.workspace_id = v_record.workspace_id and l.allow_msds = true and (l.expires_at is null or l.expires_at > now()))
  ) then raise exception 'invalid or expired upload token'; end if;
  v_new_version := coalesce(v_record.version, 1) + 1;
  update public.msds_records set
    version = v_new_version,
    history = coalesce(v_record.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('version', coalesce(v_record.version, 1), 'date', current_date::text, 'note', '협력사 재업로드 (' || coalesce(v_record.reupload_reason, '요청') || ')')),
    receipt_status = 'received', receipt_date = current_date, has_pdf = true,
    pdf_name = left(p_file_name, 255), pdf_path = p_file_path,
    reupload_requested = false, reupload_reason = null, reupload_requested_at = null, updated_at = now()
  where id = v_record.id;
  insert into public.notifications (workspace_id, type, title, body, record_id)
  values (v_record.workspace_id, 'reupload', v_contractor.name || ' · ' || v_record.product_name, 'v' || v_new_version || ' 파일 접수 완료 · 관리자 AI 분석 대기', v_record.id);
end;
$$;

revoke all on function public.get_public_reupload_requests(text, uuid) from public, authenticated;
revoke all on function public.complete_public_reupload(text, uuid, uuid, text, text) from public, authenticated;
grant execute on function public.get_public_reupload_requests(text, uuid) to anon;
grant execute on function public.complete_public_reupload(text, uuid, uuid, text, text) to anon;

-- 초대 관리는 현장 관리자만 수행합니다.
drop policy if exists "invites_select" on public.workspace_invites;
create policy "invites_select" on public.workspace_invites for select to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspace_invites.workspace_id
      and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

drop policy if exists "invites_insert" on public.workspace_invites;
create policy "invites_insert" on public.workspace_invites for insert to authenticated
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspace_invites.workspace_id
      and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

drop policy if exists "invites_update" on public.workspace_invites;
create policy "invites_update" on public.workspace_invites for update to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspace_invites.workspace_id
      and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ))
  with check (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspace_invites.workspace_id
      and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

drop policy if exists "invites_delete" on public.workspace_invites;
create policy "invites_delete" on public.workspace_invites for delete to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspace_invites.workspace_id
      and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ));

-- SECURITY DEFINER 함수는 필요한 역할에만 실행 권한을 둡니다.
revoke all on function public.get_user_id_by_email(text) from public, anon;
grant execute on function public.get_user_id_by_email(text) to authenticated;
revoke all on function public.handle_invite_on_signup() from public, anon, authenticated;
do $$
begin
  if to_regprocedure('public.handle_new_user_workspace_invite()') is not null then
    execute 'revoke all on function public.handle_new_user_workspace_invite() from public, anon, authenticated';
  end if;
end $$;

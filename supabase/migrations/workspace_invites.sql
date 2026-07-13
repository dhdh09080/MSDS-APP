-- ═══════════════════════════════════════════════
-- 팀원 초대 (workspace_invites) — 코드가 기대하는 스키마 복원본
-- 멱등적(idempotent)으로 작성됨: 이미 적용된 DB에 재실행해도 안전
-- ═══════════════════════════════════════════════

-- 1) 초대 대기 테이블
create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('member','admin')),
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

alter table public.workspace_invites enable row level security;

-- 같은 워크스페이스 멤버만 초대 목록 조회/관리 가능
drop policy if exists "invites_select" on public.workspace_invites;
create policy "invites_select" on public.workspace_invites for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

drop policy if exists "invites_insert" on public.workspace_invites;
create policy "invites_insert" on public.workspace_invites for insert
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

drop policy if exists "invites_update" on public.workspace_invites;
create policy "invites_update" on public.workspace_invites for update
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

drop policy if exists "invites_delete" on public.workspace_invites;
create policy "invites_delete" on public.workspace_invites for delete
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- 2) 이메일로 기존 가입자 user_id 조회 (auth.users는 클라이언트에서 직접 못 읽으므로 RPC)
create or replace function public.get_user_id_by_email(email_input text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(email_input) limit 1;
$$;

grant execute on function public.get_user_id_by_email(text) to authenticated;

-- 3) 신규 가입 시 대기 중인 초대를 자동 수락 → 워크스페이스 자동 합류
create or replace function public.handle_invite_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  select i.workspace_id, new.id, i.role
  from public.workspace_invites i
  where lower(i.email) = lower(new.email) and i.accepted_at is null
  on conflict do nothing;

  update public.workspace_invites
  set accepted_at = now()
  where lower(email) = lower(new.email) and accepted_at is null;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_invite on auth.users;
create trigger on_auth_user_created_invite
  after insert on auth.users
  for each row execute function public.handle_invite_on_signup();

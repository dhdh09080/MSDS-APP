-- ═══════════════════════════════════════════════
-- MSDS 재업로드 요청 + 알림
-- ═══════════════════════════════════════════════

-- 1) msds_records에 재업로드 요청 상태 컬럼
alter table msds_records add column if not exists reupload_requested boolean not null default false;
alter table msds_records add column if not exists reupload_reason text;
alter table msds_records add column if not exists reupload_requested_at timestamptz;

-- 2) 협력사(비로그인 anon)는 "재업로드 요청된" 레코드만 조회/수정 가능 (최소 권한)
drop policy if exists "anon can select reupload requested msds" on msds_records;
create policy "anon can select reupload requested msds"
  on msds_records for select
  to anon
  using (reupload_requested = true);

drop policy if exists "anon can update reupload requested msds" on msds_records;
create policy "anon can update reupload requested msds"
  on msds_records for update
  to anon
  using (reupload_requested = true)
  with check (true);

-- 3) 알림 테이블
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null default 'reupload',       -- 'reupload' 등
  title text not null,
  body text,
  record_id uuid,                              -- 관련 msds_records.id
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_ws on notifications(workspace_id, read, created_at desc);

alter table notifications enable row level security;

create policy "ws members can select notifications"
  on notifications for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can update notifications"
  on notifications for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete notifications"
  on notifications for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

-- 협력사(비로그인)가 재업로드 완료 시 알림을 남길 수 있어야 함
create policy "anon can insert notifications"
  on notifications for insert
  to anon
  with check (true);

-- 로그인 사용자도 알림 생성 가능 (향후 확장)
create policy "authenticated can insert notifications"
  on notifications for insert
  to authenticated
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

-- 4) 실시간 알림 (이미 등록돼 있으면 무시)
do $$
begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null;
end $$;

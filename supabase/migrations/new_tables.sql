-- ═══════════════════════════════════════════════
-- 1. 배치전 확인서 추적 스냅샷
-- ═══════════════════════════════════════════════
create table if not exists placement_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid references auth.users(id),
  snapshot_label text not null,           -- 예: "2026-06-30 15:32"
  filter_codes text[] not null default '{}',
  include_missing boolean not null default true,
  total_active int not null default 0,    -- 업로드 시점 전체 재직자 수
  matched_count int not null default 0,   -- 필터링된 인원 수
  data jsonb not null,                    -- placementFiltered 배열 그대로 저장
  created_at timestamptz not null default now()
);

create index if not exists idx_placement_snapshots_ws on placement_snapshots(workspace_id, created_at desc);

alter table placement_snapshots enable row level security;

create policy "ws members can select placement_snapshots"
  on placement_snapshots for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert placement_snapshots"
  on placement_snapshots for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete placement_snapshots"
  on placement_snapshots for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));


-- ═══════════════════════════════════════════════
-- 2. 캘린더 일정 (팀 공유)
-- ═══════════════════════════════════════════════
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid references auth.users(id),
  title text not null,
  description text,
  event_date date not null,
  start_time time,             -- null이면 종일 일정
  end_time time,
  category text default 'general',   -- general, meeting, inspection(점검), contractor(협력사)
  color text default '#2563EB',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_calendar_events_ws_date on calendar_events(workspace_id, event_date);

alter table calendar_events enable row level security;

create policy "ws members can select calendar_events"
  on calendar_events for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert calendar_events"
  on calendar_events for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can update calendar_events"
  on calendar_events for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete calendar_events"
  on calendar_events for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));


-- ═══════════════════════════════════════════════
-- 3. 투두리스트 (개인용, 캘린더와 무관)
-- ═══════════════════════════════════════════════
create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_todos_user on todos(workspace_id, user_id, sort_order);

alter table todos enable row level security;

create policy "user can select own todos"
  on todos for select
  using (user_id = auth.uid());

create policy "user can insert own todos"
  on todos for insert
  with check (user_id = auth.uid());

create policy "user can update own todos"
  on todos for update
  using (user_id = auth.uid());

create policy "user can delete own todos"
  on todos for delete
  using (user_id = auth.uid());

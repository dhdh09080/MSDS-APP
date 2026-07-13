-- ═══════════════════════════════════════════════
-- 투입인원 (일별 협력사 출력인원)
-- 같은 (현장, 날짜, 협력사)가 다시 올라오면 덮어쓰기(병합)
-- ═══════════════════════════════════════════════
create table if not exists manpower_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  work_date date not null,
  company text not null,
  work_type text not null default '기타',
  headcount int not null default 0,
  updated_at timestamptz not null default now(),
  unique (workspace_id, work_date, company)
);

create index if not exists idx_manpower_ws_date on manpower_records(workspace_id, work_date);

alter table manpower_records enable row level security;

create policy "ws members can select manpower"
  on manpower_records for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert manpower"
  on manpower_records for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can update manpower"
  on manpower_records for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete manpower"
  on manpower_records for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

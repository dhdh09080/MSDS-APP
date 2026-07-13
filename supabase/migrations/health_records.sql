-- ═══════════════════════════════════════════════
-- 건강진단 분석 결과 영구 저장 (기존: DOM에만 표시되고 새로고침 시 소실되던 버그 수정)
-- ═══════════════════════════════════════════════
create table if not exists health_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  round text not null,           -- 분석 회차 라벨 (예: 2026. 7. 8.)
  entries jsonb not null default '[]',  -- [{name, contractor, jobType, examDate, examType, resultCode, hazardResult}]
  created_at timestamptz not null default now()
);

create index if not exists idx_health_records_ws on health_records(workspace_id, created_at desc);

alter table health_records enable row level security;

create policy "ws members can select health_records"
  on health_records for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert health_records"
  on health_records for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can update health_records"
  on health_records for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete health_records"
  on health_records for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

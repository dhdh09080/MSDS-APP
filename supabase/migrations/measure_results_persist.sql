-- ═══════════════════════════════════════════════
-- 10. 작업환경측정 분석 결과 영구 저장
-- ═══════════════════════════════════════════════
create table if not exists measure_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  round text not null,            -- 예: "2026년 상반기"
  period text not null,           -- 예: "2026-06-10 ~ 2026-06-12"
  dust jsonb not null default '[]',
  noise jsonb not null default '[]',
  work_types jsonb not null default '[]',
  dust_exceeded boolean not null default false,
  noise_exceeded boolean not null default false,
  mixed_exceeded boolean not null default false,
  file_name text,
  file_path text,                 -- storage path in measure-pdfs bucket (원본 템플릿 PDF)
  created_at timestamptz not null default now()
);

create index if not exists idx_measure_results_ws on measure_results(workspace_id, created_at desc);

alter table measure_results enable row level security;

create policy "ws members can select measure_results"
  on measure_results for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert measure_results"
  on measure_results for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete measure_results"
  on measure_results for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

-- Storage 버킷 (원본 측정결과 PDF 보관)
insert into storage.buckets (id, name, public)
values ('measure-pdfs', 'measure-pdfs', false)
on conflict (id) do nothing;

create policy "ws members can read measure pdfs"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'measure-pdfs');

create policy "ws members can upload measure pdfs"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'measure-pdfs');

create policy "ws members can delete measure pdfs"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'measure-pdfs');

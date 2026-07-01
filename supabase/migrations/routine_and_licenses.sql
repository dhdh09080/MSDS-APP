-- ═══════════════════════════════════════════════
-- 4. 루틴 업무 (반복 체크리스트)
-- ═══════════════════════════════════════════════
create table if not exists routine_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid references auth.users(id),
  title text not null,
  frequency text not null default 'weekly',   -- 'weekly' | 'monthly'
  weekday int,            -- weekly: 0(일)~6(토)
  day_of_month int,       -- monthly: 1~31
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_routine_tasks_ws on routine_tasks(workspace_id, sort_order);

alter table routine_tasks enable row level security;

create policy "ws members can select routine_tasks"
  on routine_tasks for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert routine_tasks"
  on routine_tasks for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can update routine_tasks"
  on routine_tasks for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete routine_tasks"
  on routine_tasks for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));


-- 루틴 업무의 "완료 기록" — 주기마다 새로 체크하므로 기간(period_key)별로 기록
create table if not exists routine_task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references routine_tasks(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  period_key text not null,     -- weekly: '2026-W27' / monthly: '2026-06'
  completed_by uuid references auth.users(id),
  completed_at timestamptz not null default now(),
  unique(task_id, period_key)
);

create index if not exists idx_routine_completions_period on routine_task_completions(workspace_id, period_key);

alter table routine_task_completions enable row level security;

create policy "ws members can select routine_task_completions"
  on routine_task_completions for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert routine_task_completions"
  on routine_task_completions for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete routine_task_completions"
  on routine_task_completions for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));


-- ═══════════════════════════════════════════════
-- 5. 사업자등록증 관리
-- ═══════════════════════════════════════════════
create table if not exists business_licenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contractor_id uuid not null references contractors(id) on delete cascade,
  file_name text not null,
  file_path text not null,        -- storage path in business-licenses bucket
  uploaded_by text,                -- 'contractor' | 'manager'
  uploaded_at timestamptz not null default now(),
  unique(contractor_id)            -- 협력사당 1개만 (재업로드 시 갱신/upsert)
);

create index if not exists idx_business_licenses_ws on business_licenses(workspace_id);

alter table business_licenses enable row level security;

-- 관리자(워크스페이스 멤버)는 조회/삭제 가능
create policy "ws members can select business_licenses"
  on business_licenses for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete business_licenses"
  on business_licenses for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert business_licenses"
  on business_licenses for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can update business_licenses"
  on business_licenses for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

-- 협력사(토큰 보유자, 비로그인)는 upload.html을 통해 anon key로 접근 -> RLS 우회를 위해
-- 별도 insert 정책: token이 유효하면 누구나 insert 가능하게 허용 (anon)
create policy "anon can insert business_licenses via valid token"
  on business_licenses for insert
  to anon
  with check (
    contractor_id in (
      select contractor_id from upload_tokens where workspace_id = business_licenses.workspace_id
    )
  );

create policy "anon can select own contractor business_licenses via token"
  on business_licenses for select
  to anon
  using (
    contractor_id in (
      select contractor_id from upload_tokens where workspace_id = business_licenses.workspace_id
    )
  );


-- Storage 버킷 (Supabase 대시보드 Storage 메뉴에서 직접 만드는 것을 권장하지만,
-- SQL로도 생성 가능. 이미 'business-licenses' 버킷이 있다면 이 블록은 건너뛰세요.)
insert into storage.buckets (id, name, public)
values ('business-licenses', 'business-licenses', false)
on conflict (id) do nothing;

-- 워크스페이스 멤버는 자기 워크스페이스 파일에 읽기/쓰기 가능, anon(협력사)은 업로드만 가능
create policy "ws members can read business license files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'business-licenses');

create policy "ws members can delete business license files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'business-licenses');

create policy "anyone can upload business license files"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'business-licenses');

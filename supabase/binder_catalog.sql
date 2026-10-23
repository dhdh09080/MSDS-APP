-- 현장문서 표준 목록은 앱의 불변 기본값이며 현장별 수정본만 이 테이블에 저장한다.
create table if not exists public.binder_catalogs (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 catalog jsonb not null check (jsonb_typeof(catalog) = 'array' and jsonb_array_length(catalog) <= 200),
 revision integer not null default 1 check (revision > 0),
 updated_at timestamptz not null default now()
);
alter table public.binder_catalogs enable row level security;
revoke all on public.binder_catalogs from anon;
grant select, insert, update on public.binder_catalogs to authenticated;
create policy "Workspace members read binder catalogs" on public.binder_catalogs for select to authenticated
using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())) or exists (select 1 from public.workspace_members m where m.workspace_id = binder_catalogs.workspace_id and m.user_id = (select auth.uid())));
create policy "Workspace members create binder catalogs" on public.binder_catalogs for insert to authenticated
with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())) or exists (select 1 from public.workspace_members m where m.workspace_id = binder_catalogs.workspace_id and m.user_id = (select auth.uid())));
create policy "Workspace members update binder catalogs" on public.binder_catalogs for update to authenticated
using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())) or exists (select 1 from public.workspace_members m where m.workspace_id = binder_catalogs.workspace_id and m.user_id = (select auth.uid())))
with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())) or exists (select 1 from public.workspace_members m where m.workspace_id = binder_catalogs.workspace_id and m.user_id = (select auth.uid())));

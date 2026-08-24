create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  content text not null,
  is_important boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint announcements_title_length_check
    check (char_length(btrim(title)) between 2 and 120),
  constraint announcements_content_length_check
    check (char_length(btrim(content)) between 1 and 10000),
  constraint announcements_schedule_check
    check (ends_at is null or ends_at > starts_at)
);

comment on table public.announcements is
  '현장별 공지사항. 종료일이 null이면 무기한 게시한다.';
comment on column public.announcements.starts_at is '공지 게시 시작 시각';
comment on column public.announcements.ends_at is '공지 게시 종료 시각. null이면 종료일 없음';

create index announcements_workspace_fk_idx
  on public.announcements (workspace_id);
create index announcements_active_lookup_idx
  on public.announcements (workspace_id, starts_at, ends_at);
create index announcements_admin_list_idx
  on public.announcements (workspace_id, is_important desc, created_at desc);

create trigger announcements_touch_updated_at
before update on public.announcements
for each row execute function private.touch_feedback_post();

alter table public.announcements enable row level security;

create policy "Announcement managers can view all"
on public.announcements for select to authenticated
using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = announcements.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_members member
    where member.workspace_id = announcements.workspace_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.system_admins system_admin
    where system_admin.user_id = (select auth.uid())
  )
);

create policy "Workspace members can view active announcements"
on public.announcements for select to authenticated
using (
  starts_at <= now()
  and (ends_at is null or ends_at > now())
  and exists (
    select 1 from public.workspace_members member
    where member.workspace_id = announcements.workspace_id
      and member.user_id = (select auth.uid())
  )
);

create policy "Announcement managers can create"
on public.announcements for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    exists (
      select 1 from public.workspaces workspace
      where workspace.id = announcements.workspace_id
        and workspace.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.workspace_members member
      where member.workspace_id = announcements.workspace_id
        and member.user_id = (select auth.uid())
        and member.role in ('owner', 'admin')
    )
    or exists (
      select 1 from public.system_admins system_admin
      where system_admin.user_id = (select auth.uid())
    )
  )
);

create policy "Announcement managers can update"
on public.announcements for update to authenticated
using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = announcements.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_members member
    where member.workspace_id = announcements.workspace_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.system_admins system_admin
    where system_admin.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = announcements.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_members member
    where member.workspace_id = announcements.workspace_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.system_admins system_admin
    where system_admin.user_id = (select auth.uid())
  )
);

create policy "Announcement managers can delete"
on public.announcements for delete to authenticated
using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = announcements.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
  or exists (
    select 1 from public.workspace_members member
    where member.workspace_id = announcements.workspace_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'admin')
  )
  or exists (
    select 1 from public.system_admins system_admin
    where system_admin.user_id = (select auth.uid())
  )
);

revoke all on table public.announcements from public, anon, authenticated;
grant select, delete on table public.announcements to authenticated;
grant insert (
  workspace_id, title, content, is_important, starts_at, ends_at, created_by
) on table public.announcements to authenticated;
grant update (
  title, content, is_important, starts_at, ends_at
) on table public.announcements to authenticated;

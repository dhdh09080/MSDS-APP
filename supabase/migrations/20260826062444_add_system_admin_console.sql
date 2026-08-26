alter table public.workspaces
  add column if not exists status text not null default 'active';

do $$
begin
  alter table public.workspaces
    add constraint workspaces_status_check
    check (status in ('active', 'suspended', 'archived'));
exception when duplicate_object then null;
end $$;

create index if not exists idx_workspaces_status on public.workspaces(status);

create table if not exists public.system_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (char_length(action) between 3 and 80),
  target_type text not null check (char_length(target_type) between 2 and 40),
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.system_admin_audit_logs enable row level security;

drop policy if exists "System admins can view audit logs" on public.system_admin_audit_logs;
create policy "System admins can view audit logs"
on public.system_admin_audit_logs
for select
to authenticated
using (
  exists (
    select 1 from public.system_admins
    where system_admins.user_id = (select auth.uid())
  )
);

revoke all on table public.system_admin_audit_logs from public, anon, authenticated;
grant select on table public.system_admin_audit_logs to authenticated;

create index if not exists idx_system_admin_audit_created
  on public.system_admin_audit_logs(created_at desc);
create index if not exists idx_system_admin_audit_actor
  on public.system_admin_audit_logs(actor_id, created_at desc);

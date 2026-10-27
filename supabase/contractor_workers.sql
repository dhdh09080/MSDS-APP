-- Contractor-maintained roster. These are not automatically imported PMX registrations.
create table public.contractor_workers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  contractor_id uuid not null,
  name text not null check(length(btrim(name)) between 1 and 50),
  phone_last4 text not null check(phone_last4 ~ '^[0-9]{4}$'),
  job text not null default '' check(length(job)<=100),
  registered_on date not null default (now() at time zone 'Asia/Seoul')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(workspace_id,contractor_id) references public.contractors(workspace_id,id) on delete cascade
);
create unique index contractor_workers_identity on public.contractor_workers(contractor_id,lower(name),phone_last4);
create index contractor_workers_scope on public.contractor_workers(workspace_id,contractor_id,registered_on desc);
alter table public.contractor_workers enable row level security;
revoke all on public.contractor_workers from public,anon,authenticated;
grant select,insert,update,delete on public.contractor_workers to authenticated;
create policy contractor_workers_members on public.contractor_workers to authenticated
using(exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())) or exists(select 1 from public.workspace_members m where m.workspace_id=contractor_workers.workspace_id and m.user_id=(select auth.uid())))
with check(exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())) or exists(select 1 from public.workspace_members m where m.workspace_id=contractor_workers.workspace_id and m.user_id=(select auth.uid())));
create function public.get_contractor_workers(p_token text,p_contractor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;
begin
  ctx:=public.get_contractor_workspace(p_token,p_contractor_id);
  return coalesce((select jsonb_agg(to_jsonb(w) order by w.registered_on desc,w.created_at desc,w.id) from public.contractor_workers w where w.contractor_id=p_contractor_id),'[]'::jsonb);
end; $$;
revoke all on function public.get_contractor_workers(text,uuid) from public,authenticated;
grant execute on function public.get_contractor_workers(text,uuid) to anon;
create function public.save_contractor_worker(p_token text,p_contractor_id uuid,p_action text,p_worker_id uuid default null,p_name text default '',p_phone_last4 text default '',p_job text default '',p_registered_on date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; ws uuid;
begin
  ctx:=public.get_contractor_workspace(p_token,p_contractor_id);
  select workspace_id into ws from public.contractors where id=p_contractor_id for update;
  if p_action is null or p_action not in ('save','delete') then raise exception 'invalid action'; end if;
  if p_worker_id is not null and not exists(select 1 from public.contractor_workers where id=p_worker_id and workspace_id=ws and contractor_id=p_contractor_id) then raise exception 'worker not found'; end if;
  if p_action='delete' then
    if p_worker_id is null then raise exception 'worker required'; end if;
    delete from public.contractor_workers where id=p_worker_id;
  else
    if p_name is null or length(btrim(p_name)) not between 1 and 50 or p_phone_last4 is null or p_phone_last4 !~ '^[0-9]{4}$' or length(coalesce(p_job,''))>100 then raise exception 'invalid worker information'; end if;
    if p_worker_id is null then
      insert into public.contractor_workers(workspace_id,contractor_id,name,phone_last4,job,registered_on) values(ws,p_contractor_id,btrim(p_name),p_phone_last4,btrim(coalesce(p_job,'')),coalesce(p_registered_on,(now() at time zone 'Asia/Seoul')::date));
    else
      update public.contractor_workers set name=btrim(p_name),phone_last4=p_phone_last4,job=btrim(coalesce(p_job,'')),registered_on=coalesce(p_registered_on,registered_on),updated_at=now() where id=p_worker_id;
    end if;
  end if;
  return public.get_contractor_workers(p_token,p_contractor_id);
exception when unique_violation then raise exception 'worker already registered';
end; $$;
revoke all on function public.save_contractor_worker(text,uuid,text,uuid,text,text,text,date) from public,authenticated;
grant execute on function public.save_contractor_worker(text,uuid,text,uuid,text,text,text,date) to anon;

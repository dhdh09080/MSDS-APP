-- Shared contractor workspace data; all anonymous operations validate the existing bearer link.
create table public.contractor_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  contractor_id uuid not null,
  name text not null default '' check(length(name)<=100),
  phone text not null check(phone ~ '^[0-9+() .-]{7,30}$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key(workspace_id,contractor_id) references public.contractors(workspace_id,id) on delete cascade
);
create unique index contractor_contact_primary on public.contractor_contacts(contractor_id) where is_primary;
create index contractor_contacts_scope on public.contractor_contacts(workspace_id,contractor_id);
alter table public.contractor_contacts enable row level security;
revoke all on public.contractor_contacts from public,anon,authenticated;
grant select,insert,update,delete on public.contractor_contacts to authenticated;
create policy contractor_contacts_members on public.contractor_contacts to authenticated
using(exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())) or exists(select 1 from public.workspace_members m where m.workspace_id=contractor_contacts.workspace_id and m.user_id=(select auth.uid())))
with check(exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())) or exists(select 1 from public.workspace_members m where m.workspace_id=contractor_contacts.workspace_id and m.user_id=(select auth.uid())));
insert into public.contractor_contacts(workspace_id,contractor_id,name,phone,is_primary)
select workspace_id,id,manager_name,manager_phone,true from public.contractors where manager_phone ~ '^[0-9+() .-]{7,30}$';

create table public.contractor_portal_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  worker_site_code text not null default '' check(worker_site_code='' or worker_site_code ~ '^[0-9]{6}$')
);
alter table public.contractor_portal_settings enable row level security;
revoke all on public.contractor_portal_settings from public,anon,authenticated;
grant select,insert,update on public.contractor_portal_settings to authenticated;
create policy contractor_portal_settings_admin on public.contractor_portal_settings to authenticated
using(exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())) or exists(select 1 from public.workspace_members m where m.workspace_id=contractor_portal_settings.workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')))
with check(exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid())) or exists(select 1 from public.workspace_members m where m.workspace_id=contractor_portal_settings.workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')));

-- Administrator edits to the existing representative fields update the same primary contact.
create function public.sync_contractor_primary_contact() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.manager_phone ~ '^[0-9+() .-]{7,30}$' then
    update public.contractor_contacts set name=new.manager_name,phone=new.manager_phone
      where contractor_id=new.id and is_primary;
    if not found then
      insert into public.contractor_contacts(workspace_id,contractor_id,name,phone,is_primary)
        values(new.workspace_id,new.id,new.manager_name,new.manager_phone,true);
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.sync_contractor_primary_contact() from public,anon,authenticated;
create trigger sync_contractor_primary_contact after update of manager_name,manager_phone on public.contractors
for each row when(old.manager_name is distinct from new.manager_name or old.manager_phone is distinct from new.manager_phone)
execute function public.sync_contractor_primary_contact();

create function public.get_contractor_workspace(p_token text,p_contractor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; ws uuid;
begin
  ctx:=public.get_contractor_portal(p_token,p_contractor_id);
  ws:=(ctx->'workspace'->>'id')::uuid;
  if p_contractor_id is null or (ctx->'contractor'->>'id')::uuid is distinct from p_contractor_id then raise exception 'contractor does not match upload token'; end if;
  return jsonb_build_object('contacts',coalesce((select jsonb_agg(to_jsonb(c) order by c.is_primary desc,c.created_at,c.id) from public.contractor_contacts c where c.workspace_id=ws and c.contractor_id=p_contractor_id),'[]'::jsonb),
    'worker_site_code',coalesce(nullif((select worker_site_code from public.contractor_portal_settings where workspace_id=ws),''),(select project_code from public.pmx_sites where workspace_id=ws and project_code ~ '^[0-9]{6}$'),''));
end; $$;
revoke all on function public.get_contractor_workspace(text,uuid) from public,authenticated;
grant execute on function public.get_contractor_workspace(text,uuid) to anon;

create function public.save_contractor_contact(p_token text,p_contractor_id uuid,p_action text,p_contact_id uuid default null,p_name text default '',p_phone text default '',p_primary boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; ws uuid; target uuid; representative public.contractor_contacts%rowtype;
begin
  ctx:=public.get_contractor_workspace(p_token,p_contractor_id);
  select workspace_id into ws from public.contractors where id=p_contractor_id for update;
  if p_action not in ('save','primary','delete') or p_action is null then raise exception 'invalid action'; end if;
  if p_contact_id is not null and not exists(select 1 from public.contractor_contacts where id=p_contact_id and contractor_id=p_contractor_id and workspace_id=ws) then raise exception 'contact not found'; end if;
  if p_action='save' then
    if length(btrim(coalesce(p_name,'')))>100 or p_phone is null or btrim(p_phone) !~ '^[0-9+() .-]{7,30}$' then raise exception 'invalid contact'; end if;
    if p_contact_id is null then
      insert into public.contractor_contacts(workspace_id,contractor_id,name,phone) values(ws,p_contractor_id,btrim(coalesce(p_name,'')),btrim(p_phone)) returning id into target;
    else
      update public.contractor_contacts set name=btrim(coalesce(p_name,'')),phone=btrim(p_phone) where id=p_contact_id returning id into target;
    end if;
  elsif p_action='delete' then
    if p_contact_id is null then raise exception 'contact required'; end if;
    delete from public.contractor_contacts where id=p_contact_id;
  else
    if p_contact_id is null then raise exception 'contact required'; end if;
    target:=p_contact_id;
  end if;
  if p_action='primary' or (p_action='save' and p_primary) then
    update public.contractor_contacts set is_primary=false where contractor_id=p_contractor_id and is_primary and id<>target;
    update public.contractor_contacts set is_primary=true where id=target;
  end if;
  if not exists(select 1 from public.contractor_contacts where contractor_id=p_contractor_id and is_primary) then
    update public.contractor_contacts set is_primary=true where id=(select id from public.contractor_contacts where contractor_id=p_contractor_id order by created_at,id limit 1);
  end if;
  select * into representative from public.contractor_contacts where contractor_id=p_contractor_id and is_primary;
  update public.contractors set manager_name=coalesce(representative.name,''),manager_phone=coalesce(representative.phone,'') where id=p_contractor_id;
  return public.get_contractor_workspace(p_token,p_contractor_id);
end; $$;
revoke all on function public.save_contractor_contact(text,uuid,text,uuid,text,text,boolean) from public,authenticated;
grant execute on function public.save_contractor_contact(text,uuid,text,uuid,text,text,boolean) to anon;

-- Preserve the anonymous contractor origin as NULL rather than attributing it to an administrator.
alter table public.hazard_markers alter column created_by drop not null;
create function public.get_contractor_hazard_maps(p_token text,p_contractor_id uuid,p_map_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; ws uuid;
begin
  ctx:=public.get_contractor_portal(p_token,p_contractor_id); ws:=(ctx->'workspace'->>'id')::uuid;
  if p_contractor_id is null or (ctx->'contractor'->>'id')::uuid is distinct from p_contractor_id then raise exception 'contractor does not match upload token'; end if;
  if ctx->'public_link'<>'null'::jsonb and not coalesce((ctx->'public_link'->>'allow_msds')::boolean,false) then raise exception 'MSDS permission required'; end if;
  if p_map_id is not null and not exists(select 1 from public.hazard_maps where id=p_map_id and workspace_id=ws) then raise exception 'map not found'; end if;
  return jsonb_build_object('maps',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'workspace_id',ws,'title',m.title,'storage_path',m.storage_path,'width',m.width,'height',m.height) order by m.created_at desc) from public.hazard_maps m where m.workspace_id=ws),'[]'::jsonb),
    'markers',coalesce((select jsonb_agg(case when h.contractor_id=p_contractor_id then to_jsonb(h) else to_jsonb(h)-'access_code' end order by h.created_at,h.id) from public.hazard_markers h where h.workspace_id=ws and h.map_id=p_map_id and (h.contractor_id=p_contractor_id or (h.contractor_id is null and h.marker_type in ('building','gate')))),'[]'::jsonb));
end; $$;
revoke all on function public.get_contractor_hazard_maps(text,uuid,uuid) from public,authenticated;
grant execute on function public.get_contractor_hazard_maps(text,uuid,uuid) to anon;

create function public.save_contractor_hazard_marker(p_token text,p_contractor_id uuid,p_map_id uuid,p_marker_id uuid,p_action text,p_values jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; ws uuid; row public.hazard_markers%rowtype;
begin
  ctx:=public.get_contractor_hazard_maps(p_token,p_contractor_id,p_map_id);
  select workspace_id into ws from public.hazard_maps where id=p_map_id;
  if p_map_id is null or ws is null then raise exception 'map required'; end if;
  if p_action is null or p_action not in ('save','move','delete') then raise exception 'invalid action'; end if;
  if p_marker_id is not null then
    select * into row from public.hazard_markers where id=p_marker_id and workspace_id=ws and map_id=p_map_id and contractor_id=p_contractor_id for update;
    if row.id is null then raise exception 'marker not found'; end if;
  elsif p_action<>'save' then raise exception 'marker required'; end if;
  if p_action='delete' then delete from public.hazard_markers where id=row.id; return jsonb_build_object('id',row.id); end if;
  if p_action='move' then
    if p_values->>'x' is null or p_values->>'y' is null then raise exception 'position required'; end if;
    update public.hazard_markers set x=(p_values->>'x')::float8,y=(p_values->>'y')::float8 where id=row.id returning * into row;
  else
    if p_values->>'marker_type' is null or p_values->>'marker_type' not in ('locker','hazard','fuel') then raise exception 'invalid marker type'; end if;
    if p_values->>'storage_name' is null or p_values->'items' is null then raise exception 'marker fields required'; end if;
    if p_marker_id is null then
      if p_values->>'x' is null or p_values->>'y' is null then raise exception 'position required'; end if;
      insert into public.hazard_markers(workspace_id,map_id,contractor_id,x,y,storage_name,marker_type,items,access_code,content,created_by)
        values(ws,p_map_id,p_contractor_id,(p_values->>'x')::float8,(p_values->>'y')::float8,p_values->>'storage_name',p_values->>'marker_type',p_values->'items',coalesce(p_values->>'access_code',''),coalesce(p_values->>'content',''),null) returning * into row;
    else
      update public.hazard_markers set storage_name=p_values->>'storage_name',marker_type=p_values->>'marker_type',items=p_values->'items',access_code=coalesce(p_values->>'access_code',''),content=coalesce(p_values->>'content','') where id=row.id returning * into row;
    end if;
  end if;
  return to_jsonb(row);
end; $$;
revoke all on function public.save_contractor_hazard_marker(text,uuid,uuid,uuid,text,jsonb) from public,authenticated;
grant execute on function public.save_contractor_hazard_marker(text,uuid,uuid,uuid,text,jsonb) to anon;
create trigger sync_new_contractor_primary_contact after insert on public.contractors
for each row execute function public.sync_contractor_primary_contact();

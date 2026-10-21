-- One source of truth: contact details belong to contractors, not a separate link database.
alter table public.contractors add column if not exists manager_name text not null default '';
alter table public.contractors add column if not exists manager_phone text not null default '';
-- Legacy anonymous list access must not expose newly added contact fields.
revoke select,insert,update on public.contractors from anon;
grant select(id,workspace_id,name,created_at) on public.contractors to anon;
grant insert(workspace_id,name) on public.contractors to anon;

create or replace function public.register_public_contractor(p_token text,p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_id uuid; v_name text:=trim(coalesce(p_name,''));
begin
  select workspace_id into v_workspace from public.public_upload_links
    where token=p_token and (expires_at is null or expires_at>now()) and (allow_msds or allow_license);
  if v_workspace is null then raise exception 'invalid or expired public token'; end if;
  if length(v_name)<1 or length(v_name)>150 then raise exception 'invalid contractor name'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text,232));
  select id into v_id from public.contractors where workspace_id=v_workspace and lower(regexp_replace(trim(name),'\s+','','g'))=lower(regexp_replace(v_name,'\s+','','g')) limit 1;
  if v_id is null then insert into public.contractors(workspace_id,name) values(v_workspace,v_name) returning id into v_id; end if;
  return (select jsonb_build_object('id',id,'name',name) from public.contractors where id=v_id);
end;
$$;
revoke all on function public.register_public_contractor(text,text) from public,authenticated;
grant execute on function public.register_public_contractor(text,text) to anon;

-- Directory bearer tokens must not live in public_upload_links: legacy anonymous
-- SELECT policies on that table would let callers enumerate new contact-edit links.
create table if not exists public.contractor_directory_links (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
alter table public.contractor_directory_links enable row level security;
revoke all on public.contractor_directory_links from public,anon,authenticated;
grant select on public.contractor_directory_links to authenticated;
grant all on public.contractor_directory_links to service_role;
drop policy if exists directory_link_admin_read on public.contractor_directory_links;
create policy directory_link_admin_read on public.contractor_directory_links for select to authenticated using (
  exists(select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=(select auth.uid()))
  or exists(select 1 from public.workspace_members m where m.workspace_id=contractor_directory_links.workspace_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin'))
);

-- Only existing site members/owners can issue or revoke directory links.
create or replace function public.manage_contractor_directory_link(p_workspace uuid, p_revoke boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_token text; v_expiry timestamptz;
begin
  if auth.uid() is null or not (
    exists(select 1 from public.workspaces w where w.id=p_workspace and w.owner_id=auth.uid())
    or exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=auth.uid() and m.role in ('owner','admin'))
  ) then raise exception 'workspace admin permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text, 231));
  if p_revoke then
    delete from public.contractor_directory_links where workspace_id=p_workspace;
    return jsonb_build_object('revoked',true);
  end if;
  select token,expires_at into v_token,v_expiry from public.contractor_directory_links where workspace_id=p_workspace;
  if v_token is not null and v_expiry > now() then return jsonb_build_object('token',v_token,'expires_at',v_expiry); end if;
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  v_expiry := now()+interval '30 days';
  insert into public.contractor_directory_links(workspace_id,token,expires_at,created_by)
    values(p_workspace,v_token,v_expiry,auth.uid())
    on conflict(workspace_id) do update set token=excluded.token,expires_at=excluded.expires_at,created_by=excluded.created_by,created_at=now();
  return jsonb_build_object('token',v_token,'expires_at',v_expiry);
end;
$$;
revoke all on function public.manage_contractor_directory_link(uuid,boolean) from public,anon;
grant execute on function public.manage_contractor_directory_link(uuid,boolean) to authenticated;

-- Directory token is distinct from upload tokens; no new anonymous table privileges.
create or replace function public.get_contractor_directory(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from public.contractor_directory_links where token=p_token and expires_at>now();
  if v_workspace is null then raise exception 'invalid or expired directory token'; end if;
  return jsonb_build_object('workspace',(select jsonb_build_object('id',id,'name',name) from public.workspaces where id=v_workspace),
    'contractors',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'manager_name',c.manager_name,'manager_phone',c.manager_phone,
      'license_submitted',exists(select 1 from public.business_licenses bl where bl.workspace_id=v_workspace and bl.contractor_id=c.id),
      'msds_count',(select count(*) from public.msds_records r where r.workspace_id=v_workspace and r.contractor=c.name
         and (r.has_pdf or nullif(r.pdf_path,'') is not null or r.receipt_status='received'))
    ) order by c.name) from public.contractors c where c.workspace_id=v_workspace),'[]'::jsonb));
end;
$$;
revoke all on function public.get_contractor_directory(text) from public,authenticated;
grant execute on function public.get_contractor_directory(text) to anon;

create or replace function public.save_directory_contractor(p_token text,p_contractor_id uuid,p_name text,p_manager_name text,p_manager_phone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_id uuid; v_name text := trim(coalesce(p_name,'')); v_manager text := trim(coalesce(p_manager_name,'')); v_phone text := trim(coalesce(p_manager_phone,''));
begin
  select workspace_id into v_workspace from public.contractor_directory_links where token=p_token and expires_at>now();
  if v_workspace is null then raise exception 'invalid or expired directory token'; end if;
  if length(v_manager)>100 or length(v_phone)>30 or (v_phone<>'' and v_phone !~ '^[0-9+() .-]{7,30}$') then raise exception 'invalid contact details'; end if;
  if p_contractor_id is not null then
    update public.contractors set manager_name=v_manager,manager_phone=v_phone where id=p_contractor_id and workspace_id=v_workspace returning id into v_id;
    if v_id is null then raise exception 'contractor not found in workspace'; end if;
    return v_id;
  end if;
  if length(v_name)<1 or length(v_name)>150 then raise exception 'invalid contractor name'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_workspace::text,232));
  if exists(select 1 from public.contractors where workspace_id=v_workspace and lower(regexp_replace(trim(name),'\s+','','g'))=lower(regexp_replace(v_name,'\s+','','g'))) then
    raise exception 'contractor already exists';
  end if;
  insert into public.contractors(workspace_id,name,manager_name,manager_phone) values(v_workspace,v_name,v_manager,v_phone) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.save_directory_contractor(text,uuid,text,text,text) from public,authenticated;
grant execute on function public.save_directory_contractor(text,uuid,text,text,text) to anon;

create or replace function public.get_contractor_portal(p_token text, p_contractor_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid;
  v_contractor uuid;
  v_public public.public_upload_links%rowtype;
  v_name text;
  v_result jsonb;
begin
  if p_token is null or length(p_token) < 16 then raise exception 'invalid or expired upload token'; end if;
  select t.workspace_id, t.contractor_id into v_workspace, v_contractor
    from public.upload_tokens t where t.token = p_token and (t.expires_at is null or t.expires_at > now());
  if v_workspace is null then
    select * into v_public from public.public_upload_links l
      where l.token = p_token and (l.expires_at is null or l.expires_at > now());
    if v_public.id is null then
      select d.workspace_id into v_public.workspace_id from public.contractor_directory_links d
        where d.token=p_token and d.expires_at>now();
    end if;
    v_workspace := v_public.workspace_id;
    v_contractor := p_contractor_id;
  elsif p_contractor_id is not null and p_contractor_id <> v_contractor then
    raise exception 'contractor does not match upload token';
  end if;
  if v_workspace is null then raise exception 'invalid or expired upload token'; end if;
  select jsonb_build_object('workspace', jsonb_build_object('id', w.id, 'name', w.name),
    'public_link', case when v_public.id is null then null else jsonb_build_object('allow_msds', v_public.allow_msds, 'allow_license', v_public.allow_license) end)
    into v_result from public.workspaces w where w.id = v_workspace;
  if v_result is null then raise exception 'workspace not found'; end if;
  if v_contractor is null then
    return v_result || jsonb_build_object('contractors', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
      from public.contractors c where c.workspace_id = v_workspace), '[]'::jsonb));
  end if;
  select c.name into v_name from public.contractors c where c.id = v_contractor and c.workspace_id = v_workspace;
  if v_name is null then raise exception 'contractor not found'; end if;
  return v_result || jsonb_build_object(
    'contractor', jsonb_build_object('id', v_contractor, 'name', v_name),
    'work_types', coalesce((select jsonb_agg(jsonb_build_object('id', wt.id, 'name', wt.name) order by wt.created_at)
      from public.work_types wt where wt.workspace_id = v_workspace and wt.contractor_id = v_contractor), '[]'::jsonb),
    'license', case when v_public.id is null or v_public.allow_license then
      (select jsonb_build_object('file_name', bl.file_name, 'uploaded_at', bl.uploaded_at)
       from public.business_licenses bl where bl.workspace_id = v_workspace and bl.contractor_id = v_contractor limit 1) else null end,
    'records', case when v_public.id is null or v_public.allow_msds then coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'product_name', r.product_name, 'supplier', r.supplier, 'supplier_contact', r.supplier_contact,
      'work_type', r.work_type, 'pdf_name', r.pdf_name, 'pdf_path', r.pdf_path, 'signal_word', r.signal_word,
      'h_codes', r.h_codes, 'p_codes', r.p_codes, 'pictograms', r.pictograms, 'protective_equipment', r.protective_equipment,
      'handling_precautions', r.handling_precautions, 'first_aid', r.first_aid, 'emergency_response', r.emergency_response,
      'legal_special', r.legal_special) order by r.created_at desc)
      from public.msds_records r where r.workspace_id = v_workspace and r.contractor = v_name and coalesce(r.status, 'active') = 'active'), '[]'::jsonb) else '[]'::jsonb end);
end;
$$;
revoke all on function public.get_contractor_portal(text, uuid) from public, authenticated;
grant execute on function public.get_contractor_portal(text, uuid) to anon;


-- Directory visitors can also fulfill the existing scoped reupload workflow.
create or replace function public.get_public_reupload_requests(p_token text, p_contractor_id uuid)
returns table (id uuid, product_name text, supplier text, version integer, reupload_reason text, reupload_requested_at timestamptz)
language sql security definer set search_path = pg_catalog, public
as $$
  select r.id, r.product_name, r.supplier, r.version, r.reupload_reason, r.reupload_requested_at
  from public.msds_records r
  join public.contractors c on c.id = p_contractor_id and c.workspace_id = r.workspace_id
  where r.contractor = c.name and r.reupload_requested = true
    and (exists (select 1 from public.upload_tokens t where t.token = p_token and t.contractor_id = c.id and t.workspace_id = r.workspace_id and (t.expires_at is null or t.expires_at > now()))
      or exists (select 1 from public.public_upload_links l where l.token = p_token and l.workspace_id = r.workspace_id and l.allow_msds = true and (l.expires_at is null or l.expires_at > now()))
      or exists(select 1 from public.contractor_directory_links d where d.workspace_id=r.workspace_id and d.token=p_token and d.expires_at>now()))
  order by r.reupload_requested_at;
$$;

create or replace function public.complete_public_reupload(p_token text, p_contractor_id uuid, p_record_id uuid, p_file_name text, p_file_path text)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_record public.msds_records%rowtype;
  v_contractor public.contractors%rowtype;
  v_new_version integer;
begin
  select * into v_contractor from public.contractors where id = p_contractor_id;
  select * into v_record from public.msds_records where id = p_record_id and workspace_id = v_contractor.workspace_id and contractor = v_contractor.name and reupload_requested = true for update;
  if v_record.id is null or not (
    exists (select 1 from public.upload_tokens t where t.token = p_token and t.contractor_id = v_contractor.id and t.workspace_id = v_record.workspace_id and (t.expires_at is null or t.expires_at > now()))
    or exists (select 1 from public.public_upload_links l where l.token = p_token and l.workspace_id = v_record.workspace_id and l.allow_msds = true and (l.expires_at is null or l.expires_at > now()))
      or exists(select 1 from public.contractor_directory_links d where d.workspace_id=v_record.workspace_id and d.token=p_token and d.expires_at>now())
  ) then raise exception 'invalid or expired upload token'; end if;
  v_new_version := coalesce(v_record.version, 1) + 1;
  update public.msds_records set
    version = v_new_version,
    history = coalesce(v_record.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('version', coalesce(v_record.version, 1), 'date', current_date::text, 'note', '협력사 재업로드 (' || coalesce(v_record.reupload_reason, '요청') || ')')),
    receipt_status = 'received', receipt_date = current_date, has_pdf = true,
    pdf_name = left(p_file_name, 255), pdf_path = p_file_path,
    reupload_requested = false, reupload_reason = null, reupload_requested_at = null, updated_at = now()
  where id = v_record.id;
  insert into public.notifications (workspace_id, type, title, body, record_id)
  values (v_record.workspace_id, 'reupload', v_contractor.name || ' · ' || v_record.product_name, 'v' || v_new_version || ' 파일 접수 완료 · 관리자 AI 분석 대기', v_record.id);
end;
$$;

revoke all on function public.get_public_reupload_requests(text, uuid) from public, authenticated;
revoke all on function public.complete_public_reupload(text, uuid, uuid, text, text) from public, authenticated;
grant execute on function public.get_public_reupload_requests(text, uuid) to anon;
grant execute on function public.complete_public_reupload(text, uuid, uuid, text, text) to anon;


-- Contact edits in the signed-in application must not silently depend on a
-- legacy contractors UPDATE policy that is absent in some installations.
create or replace function public.save_workspace_contractor_contact(p_workspace uuid,p_contractor_id uuid,p_manager_name text,p_manager_phone text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_manager text:=trim(coalesce(p_manager_name,'')); v_phone text:=trim(coalesce(p_manager_phone,''));
begin
  if auth.uid() is null or not (
    exists(select 1 from public.workspaces w where w.id=p_workspace and w.owner_id=auth.uid())
    or exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=auth.uid())
  ) then raise exception 'workspace permission required'; end if;
  if length(v_manager)>100 or length(v_phone)>30 or (v_phone<>'' and v_phone !~ '^[0-9+() .-]{7,30}$') then raise exception 'invalid contact details'; end if;
  update public.contractors set manager_name=v_manager,manager_phone=v_phone where workspace_id=p_workspace and id=p_contractor_id;
  if not found then raise exception 'contractor not found in workspace'; end if;
end;
$$;
revoke all on function public.save_workspace_contractor_contact(uuid,uuid,text,text) from public,anon;
grant execute on function public.save_workspace_contractor_contact(uuid,uuid,text,text) to authenticated;

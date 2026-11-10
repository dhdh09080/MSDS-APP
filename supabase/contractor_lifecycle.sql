-- Apply after contractor_directory.sql. No existing documents are deleted.
begin;
alter table public.contractors add column if not exists is_active boolean not null default true;
create or replace function public.set_contractor_active(p_workspace uuid,p_contractor uuid,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.can_manage_workspace_links(p_workspace) then raise exception '관리 권한이 필요합니다'; end if;
 update public.contractors set is_active=p_active where id=p_contractor and workspace_id=p_workspace;
 if not found then raise exception '협력사를 찾을 수 없습니다'; end if;
end; $$;
revoke all on function public.set_contractor_active(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_contractor_active(uuid,uuid,boolean) to authenticated;

-- Atomic transfer: a constraint conflict rolls back the entire operation.
-- Keep source identity, links, contacts, workers and map assignments for auditing.
create or replace function public.transfer_contractor_documents(p_workspace uuid,p_source uuid,p_target uuid)
returns void language plpgsql security definer set search_path='' as $$
declare source_name text; target_name text;
begin
 if auth.uid() is null or not public.can_manage_workspace_links(p_workspace) then raise exception '관리 권한이 필요합니다'; end if;
 if p_source=p_target then raise exception '서로 다른 협력사를 선택하세요'; end if;
 perform id from public.contractors where workspace_id=p_workspace and id in(p_source,p_target) order by id for update;
 select name into source_name from public.contractors where workspace_id=p_workspace and id=p_source;
 select name into target_name from public.contractors where workspace_id=p_workspace and id=p_target and is_active;
 if source_name is null or target_name is null then raise exception '같은 현장의 사용 중인 이관 대상이 필요합니다'; end if;
 if exists(select 1 from public.business_licenses where workspace_id=p_workspace and contractor_id=p_source) and exists(select 1 from public.business_licenses where workspace_id=p_workspace and contractor_id=p_target) then raise exception '양쪽 업체에 사업자등록증이 있습니다. 담당자에게 등록증 정리를 요청한 뒤 다시 이관해주세요'; end if;
 update public.work_types set contractor_id=p_target where workspace_id=p_workspace and contractor_id=p_source;
 update public.msds_records set contractor=target_name where workspace_id=p_workspace and contractor=source_name;
 update public.business_licenses set contractor_id=p_target where workspace_id=p_workspace and contractor_id=p_source;
 update public.contractors set is_active=false where workspace_id=p_workspace and id=p_source;
end; $$;
revoke all on function public.transfer_contractor_documents(uuid,uuid,uuid) from public,anon;
grant execute on function public.transfer_contractor_documents(uuid,uuid,uuid) to authenticated;
-- Return only active companies from the public directory.
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
    ) order by c.name) from public.contractors c where c.workspace_id=v_workspace and c.is_active),'[]'::jsonb));
end;
$$;
revoke all on function public.get_contractor_directory(text) from public,authenticated;
grant execute on function public.get_contractor_directory(text) to anon;


alter table public.contractors add column if not exists pmx_company_name text;
alter table public.contractors add column if not exists pmx_synced_at timestamptz;
create unique index if not exists contractors_pmx_company_per_workspace on public.contractors(workspace_id,pmx_company_name) where pmx_company_name is not null;
create or replace function public.import_pmx_partners(p_workspace uuid,p_project_code text,p_date date,p_fetched_at timestamptz,p_partners jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare row jsonb; company text; target uuid; trade text; matches integer;
begin
 if auth.uid() is null or not public.can_manage_workspace_links(p_workspace) then raise exception '관리 권한이 필요합니다'; end if;
 -- Serialize imports per workspace and prevent a concurrent change of PMX linkage.
 perform id from public.workspaces where id=p_workspace and pmx_prj_cd=p_project_code for update;
 if not found then raise exception 'PMX 현장코드가 일치하지 않습니다'; end if;
 if p_date is null or p_fetched_at is null or p_fetched_at<now()-interval '1 day' or p_fetched_at>now()+interval '5 minutes' then raise exception '조회 시각을 확인해주세요'; end if;
 if jsonb_typeof(p_partners) is distinct from 'array' then raise exception '업체 목록 형식 오류'; end if;
 if jsonb_array_length(p_partners)>1000 or octet_length(p_partners::text)>500000 then raise exception '업체 목록 크기 초과'; end if;
 for row in select value from jsonb_array_elements(p_partners) loop
  if jsonb_typeof(row) is distinct from 'object' or jsonb_typeof(row->'companyNm') is distinct from 'string' or jsonb_typeof(row->'contracts') is distinct from 'array' then raise exception '업체 형식 오류'; end if;
  if exists(select 1 from jsonb_object_keys(row) k where k not in ('companyNm','contracts')) then raise exception '허용되지 않은 업체 정보'; end if;
  company:=regexp_replace(btrim(row->>'companyNm'),'\s+',' ','g');
  if company='' or length(company)>200 or jsonb_array_length(row->'contracts')>100 then raise exception '업체명 또는 공종 형식 오류'; end if;
  if exists(select 1 from jsonb_array_elements(row->'contracts') c where jsonb_typeof(c)<>'string' or length(c#>>'{}')>200) then raise exception '공종 형식 오류'; end if;
  select count(*),min(id::text)::uuid into matches,target from public.contractors where workspace_id=p_workspace and (pmx_company_name=company or (pmx_company_name is null and name=company));
  if matches>1 then raise exception '같은 이름의 업체가 여러 개입니다. 먼저 업체 목록을 정리해주세요'; end if;
  if target is null then
   insert into public.contractors(workspace_id,name,pmx_company_name,pmx_synced_at) values(p_workspace,company,company,p_fetched_at) returning id into target;
  else
   update public.contractors set pmx_company_name=company,pmx_synced_at=greatest(pmx_synced_at,p_fetched_at) where id=target;
  end if;
  for trade in select distinct btrim(value) from jsonb_array_elements_text(row->'contracts') loop
   if trade<>'' and trade<>'-' and not exists(select 1 from public.work_types where workspace_id=p_workspace and contractor_id=target and name=trade) then
    insert into public.work_types(workspace_id,contractor_id,name) values(p_workspace,target,trade);
   end if;
  end loop;
 end loop;
end; $$;
revoke all on function public.import_pmx_partners(uuid,text,date,timestamptz,jsonb) from public,anon;
grant execute on function public.import_pmx_partners(uuid,text,date,timestamptz,jsonb) to authenticated;

commit;

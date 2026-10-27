-- Production permission regression. Every fixture/metadata write is rolled back;
-- no physical Storage file is uploaded and no existing document is changed.
begin;
set local role anon;
do $storage$
declare
  path text := '__upload_permission_probe__/' || gen_random_uuid()::text || '.pdf';
  insert_allowed boolean := false;
  upsert_denied boolean := false;
begin
  begin
    perform storage.can_insert_object('business-licenses', path, null, '{}'::jsonb);
  exception when sqlstate 'PT200' then insert_allowed := true;
  end;
  begin
    insert into storage.objects(bucket_id,name,metadata)
      values('business-licenses',path,'{}'::jsonb)
      on conflict(id) do update set metadata=excluded.metadata;
  exception when insufficient_privilege then upsert_denied := true;
  end;
  assert insert_allowed, 'new license files must be insertable';
  assert upsert_denied, 'anonymous callers must not acquire overwrite permission';
end;
$storage$;
reset role;
do $fixtures$
declare
  owner_id uuid;
  workspace_id uuid := gen_random_uuid();
  company_id uuid := gen_random_uuid();
  other_company_id uuid := gen_random_uuid();
  token text := 'license-rollback-' || gen_random_uuid()::text;
begin
  select id into owner_id from auth.users order by id limit 1;
  insert into public.workspaces(id,name,code,owner_id)
    values(workspace_id,'License upload rollback test',substr(workspace_id::text,1,8),owner_id);
  insert into public.contractors(id,workspace_id,name)
    values(company_id,workspace_id,'Upload test company'),(other_company_id,workspace_id,'Other test company');
  insert into public.upload_tokens(workspace_id,contractor_id,token,expires_at)
    values(workspace_id,company_id,token,now()+interval '1 hour');
  perform set_config('test.license_token',token,true);
  perform set_config('test.license_company',company_id::text,true);
  perform set_config('test.other_company',other_company_id::text,true);
  perform set_config('test.license_path',workspace_id::text||'/'||company_id::text||'_1793070000000_'||gen_random_uuid()::text||'.pdf',true);
end;
$fixtures$;
set local role anon;
do $registration$
declare blocked boolean;
begin
  perform public.register_contractor_license(current_setting('test.license_token'),current_setting('test.license_company')::uuid,'사업자등록증.pdf',current_setting('test.license_path'));
  blocked:=false;
  begin
    perform public.register_contractor_license('invalid-token',current_setting('test.other_company')::uuid,'사업자등록증.pdf',current_setting('test.license_path'));
  exception when others then blocked:=true;
  end;
  assert blocked, 'invalid token accepted';
  blocked:=false;
  begin
    perform public.register_contractor_license(current_setting('test.license_token'),current_setting('test.other_company')::uuid,'사업자등록증.pdf',current_setting('test.license_path'));
  exception when others then blocked:=true;
  end;
  assert blocked, 'wrong company accepted';
end;
$registration$;
reset role;
do $verify$
begin
  assert exists(select 1 from public.business_licenses where contractor_id=current_setting('test.license_company')::uuid and file_path=current_setting('test.license_path')), 'valid license missing';
end;
$verify$;
select 'PASS: INSERT-only license storage, unchanged overwrite restrictions, valid token registration and invalid/mismatched token rejection' as result;
rollback;

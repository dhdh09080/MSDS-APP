-- Run inside BEGIN / ROLLBACK after loading contractor_directory.sql.
-- No fixture data or link changes are persisted.
do $tests$
declare v_ws uuid; v_owner uuid; v_other uuid; v_id uuid; v_context jsonb; v_token text := 'directory-test-'||gen_random_uuid()::text; blocked boolean;
begin
  select id,owner_id into v_ws,v_owner from public.workspaces limit 1;
  assert not has_column_privilege('anon','public.contractors','manager_name','select'), 'contact field leaked via legacy list';
  assert not has_column_privilege('anon','public.contractors','manager_phone','insert'), 'contact field writable without token';
  assert not has_table_privilege('anon','public.contractor_directory_links','select'), 'anonymous link enumeration allowed';
  assert v_ws is not null, 'integration fixture needs a workspace';
  insert into public.contractor_directory_links(workspace_id,token,expires_at,created_by)
    values(v_ws,v_token,now()+interval '1 day',v_owner)
    on conflict(workspace_id) do update set token=excluded.token,expires_at=excluded.expires_at;
  v_context:=public.get_contractor_directory(v_token);
  assert (v_context->'workspace'->>'id')::uuid=v_ws;
  v_id:=public.save_directory_contractor(v_token,null,'directory-fixture-'||gen_random_uuid()::text,'테스트 관리자','010-1234-5678');
  assert exists(select 1 from public.contractors where id=v_id and workspace_id=v_ws and manager_name='테스트 관리자' and manager_phone='010-1234-5678');
  perform public.save_directory_contractor(v_token,v_id,'ignored rename','수정 관리자','02-1234-5678');
  assert exists(select 1 from public.contractors where id=v_id and manager_name='수정 관리자' and name<>'ignored rename');
  v_context:=public.get_contractor_portal(v_token,v_id);
  assert (v_context->'contractor'->>'id')::uuid=v_id;
  assert (v_context->'workspace'->>'id')::uuid=v_ws;
  blocked:=false;
  begin perform public.save_directory_contractor(v_token,null,(select name from public.contractors where id=v_id),'',''); exception when others then blocked:=true; end;
  assert blocked,'duplicate company allowed';
  blocked:=false;
  begin perform public.save_directory_contractor(v_token,'00000000-0000-0000-0000-000000000000'::uuid,'','name','010-1111-2222'); exception when others then blocked:=true; end;
  assert blocked,'cross-site/nonexistent contact edit allowed';
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform public.save_workspace_contractor_contact(v_ws,v_id,'현장관리자 수정','010-8888-9999');
  assert exists(select 1 from public.contractors where id=v_id and manager_name='현장관리자 수정');
  perform set_config('request.jwt.claim.sub','',true);
  blocked:=false;
  begin perform public.get_contractor_directory('invalid-directory-token'); exception when others then blocked:=true; end;
  assert blocked,'invalid directory token allowed';
  update public.contractor_directory_links set expires_at=now()-interval '1 second' where workspace_id=v_ws;
  blocked:=false;
  begin perform public.get_contractor_directory(v_token); exception when others then blocked:=true; end;
  assert blocked,'expired directory allowed';
  blocked:=false;
  begin perform public.save_directory_contractor(v_token,v_id,'','test','010-0000-0000'); exception when others then blocked:=true; end;
  assert blocked,'expired directory writes allowed';
end;
$tests$;
select 'PASS: shared data, contact update, registration, portal navigation, duplicates, invalid/cross-site/expired denial' as result;

begin;
do $test$
declare
  ws uuid; owner_id uuid; company uuid; other_company uuid; result jsonb; again jsonb;
  v_token text := 'worktype-test-'||gen_random_uuid()::text;
  public_token text := 'license-only-test-'||gen_random_uuid()::text;
  blocked boolean;
begin
  select id,workspaces.owner_id into ws,owner_id from public.workspaces limit 1;
  assert ws is not null;
  insert into public.contractors(workspace_id,name) values(ws,'test-trade-'||gen_random_uuid()::text) returning id into company;
  insert into public.contractors(workspace_id,name) values(ws,'test-other-'||gen_random_uuid()::text) returning id into other_company;
  insert into public.upload_tokens(workspace_id,contractor_id,token,expires_at) values(ws,company,v_token,now()+interval '1 day');
  result:=public.register_contractor_work_type(v_token,company,' 도장 ');
  again:=public.register_contractor_work_type(v_token,company,'도장');
  assert result->>'id'=again->>'id', 'duplicate work type';
  assert exists(select 1 from public.work_types where id=(result->>'id')::uuid and workspace_id=ws and contractor_id=company and name='도장');
  assert exists(select 1 from jsonb_array_elements(public.get_contractor_portal(v_token,company)->'work_types') item where item->>'id'=result->>'id'), 'work type missing after reload';
  blocked:=false;
  begin perform public.register_contractor_work_type(v_token,other_company,'다른협력사'); exception when others then blocked:=true; end;
  assert blocked,'other contractor allowed';
  blocked:=false;
  begin perform public.register_contractor_work_type('invalid-v_token-0000',company,'잘못된링크'); exception when others then blocked:=true; end;
  assert blocked,'invalid v_token allowed';
  blocked:=false;
  begin perform public.register_contractor_work_type(v_token,company,' '); exception when others then blocked:=true; end;
  assert blocked,'empty name allowed';
  update public.upload_tokens set expires_at=now()-interval '1 second' where upload_tokens.token=v_token;
  blocked:=false;
  begin perform public.register_contractor_work_type(v_token,company,'만료'); exception when others then blocked:=true; end;
  assert blocked,'expired v_token allowed';
  insert into public.public_upload_links(workspace_id,token,allow_msds,allow_license,expires_at)
    values(ws,public_token,false,true,now()+interval '1 day') on conflict(workspace_id) do update set token=excluded.token,allow_msds=false,expires_at=excluded.expires_at;
  blocked:=false;
  begin perform public.register_contractor_work_type(public_token,company,'권한없음'); exception when others then blocked:=true; end;
  assert blocked,'license-only v_token allowed';
  assert has_function_privilege('anon','public.register_contractor_work_type(text,uuid,text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.register_contractor_work_type(text,uuid,text)','EXECUTE');
end;
$test$;
rollback;

-- Synthetic invitation fixture only; preserves all customer invitations.
begin;
do $test$
declare owner_user uuid; worker_user uuid; ws uuid:=gen_random_uuid(); invite jsonb; other_invite jsonb; req jsonb; rid uuid; blocked boolean;
begin
 select id into owner_user from auth.users order by id limit 1;
 select id into worker_user from auth.users where id<>owner_user order by id limit 1;
 if worker_user is null then raise exception 'Two accounts required'; end if;
 insert into public.workspaces(id,name,code,owner_id) values(ws,'Invitation deletion rollback fixture',substr(ws::text,1,8),owner_user);
 insert into public.workspace_members(workspace_id,user_id,role) values(ws,owner_user,'admin') on conflict do nothing;
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 invite:=public.create_workspace_invite_link(ws);
 other_invite:=public.create_workspace_invite_link(ws);
 perform set_config('request.jwt.claim.sub',worker_user::text,true);
 blocked:=false;begin perform public.delete_workspace_invite_link((invite->>'id')::uuid);exception when others then blocked:=true;end;assert blocked,'non-manager deletion';
 req:=public.accept_workspace_invite_link(invite->>'token'); assert (req->>'pendingApproval')::boolean;
 perform set_config('request.jwt.claim.sub',owner_user::text,true);
 perform public.delete_workspace_invite_link((invite->>'id')::uuid);
 perform public.delete_workspace_invite_link((other_invite->>'id')::uuid);
 assert public.list_workspace_invite_links(ws)='[]'::jsonb,'deleted links still listed';
 assert (select count(*)=1 from public.workspace_join_requests where workspace_id=ws and status='pending'),'pending request lost';
 blocked:=false;begin perform public.preview_workspace_invite_link(other_invite->>'token');exception when others then blocked:=true;end;assert blocked,'deleted active link usable';
 select id into rid from public.workspace_join_requests where workspace_id=ws;
 perform public.review_workspace_join(rid,true);
 assert (select count(*)=2 from public.workspace_members where workspace_id=ws),'pending request could not be approved after link deletion';
 assert not has_function_privilege('anon','public.delete_workspace_invite_link(uuid)','execute');
 assert not has_column_privilege('authenticated','public.workspace_invite_links','deleted_at','update');
end;
$test$;
rollback;

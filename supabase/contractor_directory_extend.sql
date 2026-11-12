begin;
create or replace function public.extend_contractor_directory_link(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token text; v_expiry timestamptz;
begin
 if auth.uid() is null or not (
  exists(select 1 from public.workspaces w where w.id=p_workspace and w.owner_id=auth.uid())
  or exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=auth.uid() and m.role in ('owner','admin'))
 ) then raise exception 'workspace admin permission required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,231));
 update public.contractor_directory_links
 set expires_at=greatest(expires_at,now()+interval '3 years')
 where workspace_id=p_workspace
 returning token,expires_at into v_token,v_expiry;
 if not found then raise exception '공유 링크가 없습니다. 먼저 링크를 만들어주세요.'; end if;
 return jsonb_build_object('token',v_token,'expires_at',v_expiry);
end; $$;
revoke all on function public.extend_contractor_directory_link(uuid) from public,anon;
grant execute on function public.extend_contractor_directory_link(uuid) to authenticated;
commit;

begin;
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
  v_expiry := now()+interval '3 years';
  insert into public.contractor_directory_links(workspace_id,token,expires_at,created_by)
    values(p_workspace,v_token,v_expiry,auth.uid())
    on conflict(workspace_id) do update set token=excluded.token,expires_at=excluded.expires_at,created_by=excluded.created_by,created_at=now();
  return jsonb_build_object('token',v_token,'expires_at',v_expiry);
end;
$$;
revoke all on function public.manage_contractor_directory_link(uuid,boolean) from public,anon;
grant execute on function public.manage_contractor_directory_link(uuid,boolean) to authenticated;


-- Atomic replacement: failures roll back revocation and preserve the old link.
create or replace function public.regenerate_contractor_directory_link(p_workspace uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform public.manage_contractor_directory_link(p_workspace,true);
 return public.manage_contractor_directory_link(p_workspace,false);
end; $$;
revoke all on function public.regenerate_contractor_directory_link(uuid) from public,anon;
grant execute on function public.regenerate_contractor_directory_link(uuid) to authenticated;
-- Preserve previously shared addresses; extend only still-valid links.
update public.contractor_directory_links set expires_at=greatest(expires_at,created_at+interval '3 years') where expires_at>now();
commit;

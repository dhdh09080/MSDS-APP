-- Keep invitation history and join requests while removing a link from the
-- administrator's list and invalidating the shared token immediately.
alter table public.workspace_invite_links add column deleted_at timestamptz;

create function private.delete_workspace_invite_link(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;
begin
 select workspace_id into v_workspace from public.workspace_invite_links where id=p_id for update;
 if v_workspace is null or auth.uid() is null or not public.can_manage_workspace_links(v_workspace) then
  raise exception '현장 관리자만 초대 링크를 삭제할 수 있습니다.' using errcode='42501';
 end if;
 update public.workspace_invite_links set deleted_at=coalesce(deleted_at,now()),revoked_at=coalesce(revoked_at,now()) where id=p_id;
end; $$;
revoke all on function private.delete_workspace_invite_link(uuid) from public,anon;
grant execute on function private.delete_workspace_invite_link(uuid) to authenticated;
grant usage on schema private to authenticated;
create function public.delete_workspace_invite_link(p_id uuid)
returns void language sql security invoker set search_path='' as $$select private.delete_workspace_invite_link(p_id);$$;
revoke all on function public.delete_workspace_invite_link(uuid) from public,anon;
grant execute on function public.delete_workspace_invite_link(uuid) to authenticated;

create or replace function public.list_workspace_invite_links(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage_workspace_links(p_workspace) then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
  select id,role,created_at,expires_at,revoked_at,accepted_at from public.workspace_invite_links
  where workspace_id=p_workspace and deleted_at is null order by created_at desc limit 50
 ) x),'[]'::jsonb);
end; $$;

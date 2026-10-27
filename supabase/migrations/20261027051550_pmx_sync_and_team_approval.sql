-- PMX cookies never leave the user's browser. Only selected project fields are stored.
alter table public.workspaces
 add column pmx_prj_cd text,
 add column pmx_category text,
 add column pmx_start_date date,
 add column pmx_end_date date,
 add column pmx_progress numeric check (pmx_progress between 0 and 100),
 add column pmx_synced_at timestamptz;

create schema if not exists private;
revoke all on schema private from public;

create function private.require_workspace_manager(p_workspace uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.can_manage_workspace_links(p_workspace) then
  raise exception '담당자 권한이 필요합니다.' using errcode='42501';
 end if;
end; $$;

create function private.sync_pmx_project(p_workspace uuid, p_project jsonb, p_fetched_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws public.workspaces;
begin
 perform private.require_workspace_manager(p_workspace);
 select * into v_ws from public.workspaces where id=p_workspace for update;
 if v_ws.pmx_prj_cd is null or v_ws.pmx_prj_cd is distinct from p_project->>'prjCd' then
  raise exception '선택한 현장코드와 PMX 현장코드가 일치하지 않습니다.';
 end if;
 if p_fetched_at is null or p_fetched_at > now() + interval '5 minutes' then raise exception '갱신 시각이 올바르지 않습니다.'; end if;
 if v_ws.pmx_synced_at is not null and v_ws.pmx_synced_at >= p_fetched_at then return to_jsonb(v_ws); end if;
 if nullif(trim(p_project->>'prjNm'),'') is null then raise exception '현장명이 없습니다.'; end if;
 update public.workspaces set name=left(p_project->>'prjNm',200),
  pmx_category=left(p_project->>'bizFldNm',100),
  pmx_start_date=nullif(p_project->>'cstrnStrtYmd','')::date,
  pmx_end_date=nullif(p_project->>'cstrnEndYmd','')::date,
  pmx_progress=nullif(p_project->>'actlTProgrt','')::numeric,
  pmx_synced_at=p_fetched_at where id=p_workspace returning * into v_ws;
 return to_jsonb(v_ws);
end; $$;
create function public.sync_pmx_project(p_workspace uuid, p_project jsonb, p_fetched_at timestamptz)
returns jsonb language sql security invoker set search_path = '' as $$ select private.sync_pmx_project(p_workspace,p_project,p_fetched_at); $$;

-- Admission requires explicit approval, even when an invitation exists.
create table public.workspace_join_requests (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id) on delete set null,
 unique(workspace_id,user_id)
);
alter table public.workspace_join_requests enable row level security;
revoke all on public.workspace_join_requests from public,anon,authenticated;
create index workspace_join_requests_user_idx on public.workspace_join_requests(user_id);

create function private.request_workspace_join(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.workspace_invite_links; v_preview jsonb;
begin
 v_preview := public.preview_workspace_invite_link(p_token);
 select * into v_inv from public.workspace_invite_links
 where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 -- Recheck after acquiring the lock so a single-use link cannot be reused concurrently.
 v_preview := public.preview_workspace_invite_link(p_token);
 if exists(select 1 from public.workspace_members where workspace_id=v_inv.workspace_id and user_id=auth.uid()) then
  return v_preview || jsonb_build_object('alreadyMember',true);
 end if;
 insert into public.workspace_join_requests(workspace_id,user_id) values(v_inv.workspace_id,auth.uid())
 on conflict(workspace_id,user_id) do update set status='pending',created_at=now(),reviewed_at=null,reviewed_by=null;
 update public.workspace_invite_links set accepted_at=now(),accepted_by=auth.uid() where id=v_inv.id;
 return v_preview || jsonb_build_object('pendingApproval',true);
end; $$;
create or replace function public.accept_workspace_invite_link(p_token text)
returns jsonb language sql security invoker set search_path = '' as $$ select private.request_workspace_join(p_token); $$;

create function private.list_workspace_join_requests(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_workspace_manager(p_workspace);
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'email',u.email,'created_at',r.created_at) order by r.created_at)
 from public.workspace_join_requests r join auth.users u on u.id=r.user_id
 where r.workspace_id=p_workspace and r.status='pending'),'[]'::jsonb);
end; $$;
create function public.list_workspace_join_requests(p_workspace uuid)
returns jsonb language sql security invoker set search_path = '' as $$ select private.list_workspace_join_requests(p_workspace); $$;

create function private.review_workspace_join(p_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.workspace_join_requests;
begin
 select * into v_req from public.workspace_join_requests where id=p_id for update;
 if not found then raise exception '가입 신청을 찾지 못했습니다.'; end if;
 perform private.require_workspace_manager(v_req.workspace_id);
 if v_req.status <> 'pending' then raise exception '이미 처리된 신청입니다.'; end if;
 if p_approve is null then raise exception '승인 여부가 필요합니다.'; end if;
 if p_approve then
  insert into public.workspace_members(workspace_id,user_id,role) values(v_req.workspace_id,v_req.user_id,'member') on conflict(workspace_id,user_id) do nothing;
 end if;
 update public.workspace_join_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewed_at=now(),reviewed_by=auth.uid() where id=p_id;
end; $$;
create function public.review_workspace_join(p_id uuid,p_approve boolean)
returns void language sql security invoker set search_path = '' as $$ select private.review_workspace_join(p_id,p_approve); $$;

create function private.transfer_workspace_manager(p_workspace uuid,p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
 select owner_id into v_owner from public.workspaces where id=p_workspace for update;
 perform private.require_workspace_manager(p_workspace);
 if v_owner is distinct from auth.uid() then raise exception '현재 대표 담당자만 권한을 이전할 수 있습니다.' using errcode='42501'; end if;
 if p_user = auth.uid() or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user) then raise exception '다른 현장 직원을 선택해주세요.'; end if;
 update public.workspace_members set role='member' where workspace_id=p_workspace and user_id=auth.uid();
 update public.workspace_members set role='admin' where workspace_id=p_workspace and user_id=p_user;
 update public.workspaces set owner_id=p_user where id=p_workspace;
 -- Existing invitations must not retain the previous manager's authorization.
 update public.workspace_invite_links set revoked_at=now() where workspace_id=p_workspace and revoked_at is null and accepted_at is null;
end; $$;
create function public.transfer_workspace_manager(p_workspace uuid,p_user uuid)
returns void language sql security invoker set search_path = '' as $$ select private.transfer_workspace_manager(p_workspace,p_user); $$;

-- The browser cannot use a permissive legacy membership policy to bypass approval.
drop policy if exists "ws admin can add workspace_members" on public.workspace_members;
-- Also prevent owner_id being reassigned through a generic workspace UPDATE.
create function private.guard_workspace_owner()
returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='authenticated' and new.owner_id is distinct from old.owner_id then
  raise exception '담당자 이전 기능을 사용해주세요.' using errcode='42501';
 end if;
 return new;
end; $$;
create trigger guard_workspace_owner before update on public.workspaces for each row execute function private.guard_workspace_owner();

revoke all on function private.require_workspace_manager(uuid),private.sync_pmx_project(uuid,jsonb,timestamptz),private.request_workspace_join(text),private.list_workspace_join_requests(uuid),private.review_workspace_join(uuid,boolean),private.transfer_workspace_manager(uuid,uuid),private.guard_workspace_owner() from public,anon,authenticated;
grant usage on schema private to authenticated;
-- Only explicit RPC implementations are callable by authenticated users. Every one checks identity and scope.
grant execute on function private.sync_pmx_project(uuid,jsonb,timestamptz),private.request_workspace_join(text),private.list_workspace_join_requests(uuid),private.review_workspace_join(uuid,boolean),private.transfer_workspace_manager(uuid,uuid) to authenticated;
revoke all on function public.sync_pmx_project(uuid,jsonb,timestamptz),public.list_workspace_join_requests(uuid),public.review_workspace_join(uuid,boolean),public.transfer_workspace_manager(uuid,uuid) from public,anon;
grant execute on function public.sync_pmx_project(uuid,jsonb,timestamptz),public.list_workspace_join_requests(uuid),public.review_workspace_join(uuid,boolean),public.transfer_workspace_manager(uuid,uuid) to authenticated;

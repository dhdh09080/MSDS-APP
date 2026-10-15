-- Email-free, single-use team invitations. Only a token hash is stored.
create table public.workspace_invite_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token_hash text not null unique,
  role text not null check (role in ('member','admin')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create index workspace_invite_links_workspace_idx on public.workspace_invite_links(workspace_id, created_at desc);
alter table public.workspace_invite_links enable row level security;
revoke all on public.workspace_invite_links from public, anon, authenticated;

create function public.can_manage_workspace_links(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspaces w where w.id = p_workspace
    and coalesce(w.status,'active') not in ('suspended','archived')
    and (w.owner_id = auth.uid() or exists (
      select 1 from public.workspace_members m where m.workspace_id = w.id
      and m.user_id = auth.uid() and m.role = 'admin'
    ))
  );
$$;
revoke all on function public.can_manage_workspace_links(uuid) from public, anon, authenticated;

create function public.create_workspace_invite_link(p_workspace uuid, p_role text default 'member')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_token text; v_row public.workspace_invite_links;
begin
  if not public.can_manage_workspace_links(p_workspace) then
    raise exception '현장 관리자만 초대 링크를 만들 수 있습니다.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('member','admin') then raise exception '초대 권한이 올바르지 않습니다.'; end if;
  -- Serialize creation per workspace to enforce the active-link cap.
  perform 1 from public.workspaces where id = p_workspace for update;
  if (select count(*) from public.workspace_invite_links where workspace_id = p_workspace
    and revoked_at is null and accepted_at is null and expires_at > now()) >= 20 then
    raise exception '사용 가능한 초대 링크가 20개입니다. 기존 링크를 취소한 뒤 다시 만드세요.';
  end if;
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into public.workspace_invite_links(workspace_id,token_hash,role,created_by)
  values(p_workspace,encode(sha256(convert_to(v_token,'UTF8')),'hex'),p_role,auth.uid()) returning * into v_row;
  return jsonb_build_object('id',v_row.id,'token',v_token,'expiresAt',v_row.expires_at,'role',v_row.role);
end;
$$;

create function public.list_workspace_invite_links(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_workspace_links(p_workspace) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select id,role,created_at,expires_at,revoked_at,accepted_at
    from public.workspace_invite_links where workspace_id = p_workspace order by created_at desc limit 50
  ) x),'[]'::jsonb);
end;
$$;

create function public.preview_workspace_invite_link(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.workspace_invite_links; v_name text;
begin
  if auth.uid() is null then raise exception '먼저 로그인해주세요.' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '유효하지 않은 초대 링크입니다.'; end if;
  select * into v_row from public.workspace_invite_links
  where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not found or v_row.revoked_at is not null or v_row.expires_at <= now()
    or (v_row.accepted_at is not null and v_row.accepted_by is distinct from auth.uid()) then
    raise exception '만료·취소되었거나 이미 사용한 초대 링크입니다. 관리자에게 새 링크를 요청하세요.';
  end if;
  select w.name into v_name from public.workspaces w where w.id=v_row.workspace_id
    and coalesce(w.status,'active') not in ('suspended','archived')
    and (w.owner_id=v_row.created_by or exists(select 1 from public.workspace_members m
      where m.workspace_id=w.id and m.user_id=v_row.created_by and m.role='admin'));
  if not found then raise exception '현재 참여할 수 없는 현장입니다. 관리자에게 문의하세요.'; end if;
  return jsonb_build_object('workspaceId',v_row.workspace_id,'workspaceName',v_name,'role',v_row.role,'expiresAt',v_row.expires_at);
end;
$$;

create function public.accept_workspace_invite_link(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.workspace_invite_links; v_preview jsonb;
begin
  if auth.uid() is null then raise exception '먼저 로그인해주세요.' using errcode = '42501'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception '유효하지 않은 초대 링크입니다.'; end if;
  select * into v_row from public.workspace_invite_links
  where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found then raise exception '유효하지 않은 초대 링크입니다.'; end if;
  v_preview := public.preview_workspace_invite_link(p_token);
  -- An existing member keeps their role and does not consume someone else's invitation.
  if exists(select 1 from public.workspace_members where workspace_id=v_row.workspace_id and user_id=auth.uid()) then
    return v_preview || jsonb_build_object('alreadyMember',true);
  end if;
  insert into public.workspace_members(workspace_id,user_id,role) values(v_row.workspace_id,auth.uid(),v_row.role)
    on conflict(workspace_id,user_id) do nothing;
  update public.workspace_invite_links set accepted_at=now(),accepted_by=auth.uid() where id=v_row.id;
  return v_preview || jsonb_build_object('alreadyMember',false);
end;
$$;

create function public.revoke_workspace_invite_link(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from public.workspace_invite_links where id=p_id;
  if not public.can_manage_workspace_links(v_workspace) then
    raise exception '현장 관리자만 초대 링크를 취소할 수 있습니다.' using errcode = '42501';
  end if;
  update public.workspace_invite_links set revoked_at=now() where id=p_id and revoked_at is null;
end;
$$;

-- Explicitly scoped directory; auth.users cannot be joined through PostgREST.
create function public.list_workspace_team(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.workspaces w where w.id=p_workspace
    and (w.owner_id=auth.uid() or exists(select 1 from public.workspace_members m
      where m.workspace_id=w.id and m.user_id=auth.uid()))
  ) then raise exception '현장 접근 권한이 없습니다.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'user_id',m.user_id,'role',m.role,
    'user',jsonb_build_object('email',u.email,'raw_user_meta_data',jsonb_build_object('name',u.raw_user_meta_data->>'name')))
    order by m.created_at) from public.workspace_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=p_workspace),'[]'::jsonb);
end;
$$;

revoke all on function public.create_workspace_invite_link(uuid,text) from public,anon;
revoke all on function public.list_workspace_invite_links(uuid) from public,anon;
revoke all on function public.preview_workspace_invite_link(text) from public,anon;
revoke all on function public.accept_workspace_invite_link(text) from public,anon;
revoke all on function public.revoke_workspace_invite_link(uuid) from public,anon;
revoke all on function public.list_workspace_team(uuid) from public,anon;
grant execute on function public.create_workspace_invite_link(uuid,text) to authenticated;
grant execute on function public.list_workspace_invite_links(uuid) to authenticated;
grant execute on function public.preview_workspace_invite_link(text) to authenticated;
grant execute on function public.accept_workspace_invite_link(text) to authenticated;
grant execute on function public.revoke_workspace_invite_link(uuid) to authenticated;
grant execute on function public.list_workspace_team(uuid) to authenticated;

-- Link acceptance replaces automatic joining by an unverified signup email.
drop trigger if exists on_auth_user_created_invite on auth.users;
drop trigger if exists on_auth_user_created_workspace_invite on auth.users;

-- Own-user insert must not bypass link validation for an arbitrary workspace.
drop policy if exists wm_insert on public.workspace_members;
create policy wm_insert on public.workspace_members for insert to authenticated with check (
  user_id=auth.uid() and role='admin' and exists(
    select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=auth.uid()
  )
);

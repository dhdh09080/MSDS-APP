-- 기존 가입자 이메일 조회는 해당 현장의 관리자만 호출할 수 있도록 범위를 제한합니다.
create or replace function public.get_workspace_user_id_by_email(email_input text, workspace_input uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid;
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = workspace_input and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'workspace admin permission required';
  end if;
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(trim(email_input)) limit 1;
  return v_user_id;
end;
$$;

revoke all on function public.get_workspace_user_id_by_email(text, uuid) from public, anon;
grant execute on function public.get_workspace_user_id_by_email(text, uuid) to authenticated;
revoke all on function public.get_user_id_by_email(text) from public, anon, authenticated;

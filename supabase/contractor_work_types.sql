-- Token-scoped work-type registration for the contractor upload portal.
create or replace function public.register_contractor_work_type(p_token text, p_contractor_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_context jsonb;
  v_workspace uuid;
  v_name text := btrim(p_name);
  v_type public.work_types%rowtype;
begin
  v_context := public.get_contractor_portal(p_token, p_contractor_id);
  v_workspace := (v_context->'workspace'->>'id')::uuid;
  if p_contractor_id is null or (v_context->'contractor'->>'id')::uuid is distinct from p_contractor_id then
    raise exception 'contractor does not match upload token';
  end if;
  if v_context->'public_link' <> 'null'::jsonb
    and not coalesce((v_context->'public_link'->>'allow_msds')::boolean, false) then
    raise exception 'MSDS upload is not allowed';
  end if;
  if v_name is null or length(v_name) = 0 or length(v_name) > 100 or v_name ~ '[[:cntrl:]]' then
    raise exception 'invalid work type name';
  end if;
  -- Serialize additions for this contractor to avoid duplicates on concurrent retries.
  perform 1 from public.contractors where id=p_contractor_id and workspace_id=v_workspace for update;
  if not found then raise exception 'contractor not found'; end if;
  select * into v_type from public.work_types
    where workspace_id=v_workspace and contractor_id=p_contractor_id and lower(btrim(name))=lower(v_name)
    order by created_at limit 1;
  if v_type.id is null then
    insert into public.work_types(workspace_id,contractor_id,name)
      values(v_workspace,p_contractor_id,v_name) returning * into v_type;
  end if;
  return jsonb_build_object('id',v_type.id,'name',v_type.name);
end;
$$;
revoke all on function public.register_contractor_work_type(text,uuid,text) from public,authenticated;
grant execute on function public.register_contractor_work_type(text,uuid,text) to anon;

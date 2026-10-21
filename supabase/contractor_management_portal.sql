-- Capability-based portal API: a valid, unexpired token is required on every call.
-- These intentionally support logged-out contractors without broadening table RLS.
create or replace function public.get_contractor_portal(p_token text, p_contractor_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace uuid;
  v_contractor uuid;
  v_public public.public_upload_links%rowtype;
  v_name text;
  v_result jsonb;
begin
  if p_token is null or length(p_token) < 16 then raise exception 'invalid or expired upload token'; end if;
  select t.workspace_id, t.contractor_id into v_workspace, v_contractor
    from public.upload_tokens t where t.token = p_token and (t.expires_at is null or t.expires_at > now());
  if v_workspace is null then
    select * into v_public from public.public_upload_links l
      where l.token = p_token and (l.expires_at is null or l.expires_at > now());
    v_workspace := v_public.workspace_id;
    v_contractor := p_contractor_id;
  elsif p_contractor_id is not null and p_contractor_id <> v_contractor then
    raise exception 'contractor does not match upload token';
  end if;
  if v_workspace is null then raise exception 'invalid or expired upload token'; end if;
  select jsonb_build_object('workspace', jsonb_build_object('id', w.id, 'name', w.name),
    'public_link', case when v_public.id is null then null else jsonb_build_object('allow_msds', v_public.allow_msds, 'allow_license', v_public.allow_license) end)
    into v_result from public.workspaces w where w.id = v_workspace;
  if v_result is null then raise exception 'workspace not found'; end if;
  if v_contractor is null then
    return v_result || jsonb_build_object('contractors', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
      from public.contractors c where c.workspace_id = v_workspace), '[]'::jsonb));
  end if;
  select c.name into v_name from public.contractors c where c.id = v_contractor and c.workspace_id = v_workspace;
  if v_name is null then raise exception 'contractor not found'; end if;
  return v_result || jsonb_build_object(
    'contractor', jsonb_build_object('id', v_contractor, 'name', v_name),
    'work_types', coalesce((select jsonb_agg(jsonb_build_object('id', wt.id, 'name', wt.name) order by wt.created_at)
      from public.work_types wt where wt.workspace_id = v_workspace and wt.contractor_id = v_contractor), '[]'::jsonb),
    'license', case when v_public.id is null or v_public.allow_license then
      (select jsonb_build_object('file_name', bl.file_name, 'uploaded_at', bl.uploaded_at)
       from public.business_licenses bl where bl.workspace_id = v_workspace and bl.contractor_id = v_contractor limit 1) else null end,
    'records', case when v_public.id is null or v_public.allow_msds then coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'product_name', r.product_name, 'supplier', r.supplier, 'supplier_contact', r.supplier_contact,
      'work_type', r.work_type, 'pdf_name', r.pdf_name, 'pdf_path', r.pdf_path, 'signal_word', r.signal_word,
      'h_codes', r.h_codes, 'p_codes', r.p_codes, 'pictograms', r.pictograms, 'protective_equipment', r.protective_equipment,
      'handling_precautions', r.handling_precautions, 'first_aid', r.first_aid, 'emergency_response', r.emergency_response,
      'legal_special', r.legal_special) order by r.created_at desc)
      from public.msds_records r where r.workspace_id = v_workspace and r.contractor = v_name and coalesce(r.status, 'active') = 'active'), '[]'::jsonb) else '[]'::jsonb end);
end;
$$;
revoke all on function public.get_contractor_portal(text, uuid) from public, authenticated;
grant execute on function public.get_contractor_portal(text, uuid) to anon;

create or replace function public.register_contractor_license(p_token text, p_contractor_id uuid, p_file_name text, p_file_path text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_context jsonb;
  v_workspace uuid;
begin
  v_context := public.get_contractor_portal(p_token, p_contractor_id);
  v_workspace := (v_context->'workspace'->>'id')::uuid;
  if v_context->'public_link' is not null and v_context->'public_link' <> 'null'::jsonb
    and not coalesce((v_context->'public_link'->>'allow_license')::boolean, false) then
    raise exception 'license upload is not allowed';
  end if;
  if p_file_name is null or length(p_file_name) > 255 or p_file_name !~* '\.(pdf|jpe?g|png)$'
    or p_file_path is null or p_file_path not like v_workspace::text || '/' || p_contractor_id::text || '\_%'
    or p_file_path ~ '\.\.' then raise exception 'invalid license file'; end if;
  insert into public.business_licenses(workspace_id, contractor_id, file_name, file_path, uploaded_by)
    values(v_workspace, p_contractor_id, p_file_name, p_file_path, 'contractor');
end;
$$;
revoke all on function public.register_contractor_license(text, uuid, text, text) from public, authenticated;
grant execute on function public.register_contractor_license(text, uuid, text, text) to anon;

-- Free-form notes share the existing location, permission and drag model.
alter table public.hazard_markers drop constraint hazard_markers_marker_type_check;
alter table public.hazard_markers add constraint hazard_markers_marker_type_check
 check(marker_type in ('locker','hazard','fuel','building','gate','warehouse','issue','memo'));
alter table public.hazard_markers drop constraint hazard_markers_content_check;
alter table public.hazard_markers add constraint hazard_markers_content_check
 check(length(content)<=case when marker_type='memo' then 10000 else 3000 end);

create or replace function public.save_contractor_hazard_marker(p_token text,p_contractor_id uuid,p_map_id uuid,p_marker_id uuid,p_action text,p_values jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; ws uuid; row public.hazard_markers%rowtype;
begin
  ctx:=public.get_contractor_hazard_maps(p_token,p_contractor_id,p_map_id);
  select workspace_id into ws from public.hazard_maps where id=p_map_id;
  if p_map_id is null or ws is null then raise exception 'map required'; end if;
  if p_action is null or p_action not in ('save','move','delete') then raise exception 'invalid action'; end if;
  if p_marker_id is not null then
    select * into row from public.hazard_markers where id=p_marker_id and workspace_id=ws and map_id=p_map_id and contractor_id=p_contractor_id for update;
    if row.id is null then raise exception 'marker not found'; end if;
  elsif p_action<>'save' then raise exception 'marker required'; end if;
  if row.marker_type='issue' then raise exception '부적합 사항은 현장 관리자만 수정할 수 있습니다. 조치 사진을 제출해 주세요.'; end if;
  if p_action='delete' and exists(select 1 from public.hazard_location_photos where marker_id=row.id) then raise exception '사진이 있는 위치는 현장 관리자에게 삭제를 요청해 주세요.'; end if;
  if p_action='delete' then delete from public.hazard_markers where id=row.id; return jsonb_build_object('id',row.id); end if;
  if p_action='move' then
    if p_values->>'x' is null or p_values->>'y' is null then raise exception 'position required'; end if;
    update public.hazard_markers set x=(p_values->>'x')::float8,y=(p_values->>'y')::float8 where id=row.id returning * into row;
  else
    if p_values->>'marker_type' is null or p_values->>'marker_type' not in ('locker','hazard','fuel','warehouse','issue','memo') then raise exception 'invalid marker type'; end if;
    if p_values->>'storage_name' is null or p_values->'items' is null then raise exception 'marker fields required'; end if;
    if p_marker_id is null then
      if p_values->>'x' is null or p_values->>'y' is null then raise exception 'position required'; end if;
      insert into public.hazard_markers(workspace_id,map_id,contractor_id,x,y,storage_name,marker_type,items,access_code,content,created_by)
        values(ws,p_map_id,p_contractor_id,(p_values->>'x')::float8,(p_values->>'y')::float8,p_values->>'storage_name',p_values->>'marker_type',p_values->'items',coalesce(p_values->>'access_code',''),coalesce(p_values->>'content',''),null) returning * into row;
    else
      update public.hazard_markers set storage_name=p_values->>'storage_name',marker_type=p_values->>'marker_type',items=p_values->'items',access_code=coalesce(p_values->>'access_code',''),content=coalesce(p_values->>'content','') where id=row.id returning * into row;
    end if;
  end if;
  return to_jsonb(row);
end; $$;
revoke all on function public.save_contractor_hazard_marker(text,uuid,uuid,uuid,text,jsonb) from public,authenticated;
grant execute on function public.save_contractor_hazard_marker(text,uuid,uuid,uuid,text,jsonb) to anon;

-- Extend existing locations without changing IDs, coordinates or stored details.
alter table public.hazard_markers drop constraint hazard_markers_marker_type_check;
alter table public.hazard_markers add constraint hazard_markers_marker_type_check
 check(marker_type in ('locker','hazard','fuel','building','gate','warehouse','issue'));
alter table public.hazard_markers
 add column review_status text not null default 'open' check(review_status in ('open','pending','verified')),
 add column review_note text not null default '' check(length(review_note)<=2000),
 add column reviewed_at timestamptz,
 add column reviewed_by uuid references auth.users(id),
 add column photo_revision integer not null default 0,
 add constraint hazard_markers_workspace_id_id_key unique(workspace_id,id);
-- Review fields deliberately have no client INSERT/UPDATE privilege.
-- Existing table-level INSERT must be narrowed to prevent forged approvals.
revoke insert on public.hazard_markers from authenticated;
grant insert(id,workspace_id,map_id,x,y,storage_name,material,quantity,manager,content,created_by,created_at,marker_type,items,access_code,contractor_id)
 on public.hazard_markers to authenticated;

create table public.hazard_location_photos(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 marker_id uuid not null,
 storage_path text not null unique,
 kind text not null check(kind in ('finding','remedy')),
 note text not null default '' check(length(note)<=2000),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(workspace_id,marker_id) references public.hazard_markers(workspace_id,id) on delete cascade,
 check(storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+\.jpg$'
  and split_part(storage_path,'/',1)=workspace_id::text and split_part(storage_path,'/',2)=marker_id::text)
);
create index hazard_location_photos_marker_idx on public.hazard_location_photos(workspace_id,marker_id,created_at);
create index hazard_location_photos_creator_idx on public.hazard_location_photos(created_by);
create index hazard_markers_reviewer_idx on public.hazard_markers(reviewed_by);
alter table public.hazard_location_photos enable row level security;
revoke all on public.hazard_location_photos from anon,authenticated;
grant select,delete on public.hazard_location_photos to authenticated;
grant select,insert,delete on public.hazard_location_photos to service_role;
grant insert(workspace_id,marker_id,storage_path,kind,note,created_by) on public.hazard_location_photos to authenticated;
create policy location_photos_read on public.hazard_location_photos for select to authenticated using(exists(select 1 from public.workspace_members m where m.workspace_id=hazard_location_photos.workspace_id and m.user_id=(select auth.uid())));
create policy location_photos_insert on public.hazard_location_photos for insert to authenticated with check(created_by=(select auth.uid()) and exists(select 1 from public.workspace_members m where m.workspace_id=hazard_location_photos.workspace_id and m.user_id=(select auth.uid())));
create policy location_photos_delete on public.hazard_location_photos for delete to authenticated using(exists(select 1 from public.workspace_members m where m.workspace_id=hazard_location_photos.workspace_id and m.user_id=(select auth.uid())));

create schema if not exists private;
create function private.hazard_photo_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- The trigger can only touch the photo's validated parent, including contractor submissions.
 update public.hazard_markers set photo_revision=photo_revision+1,
 review_status=case when TG_OP='INSERT' and NEW.kind='remedy' then 'pending' else 'open' end,
 review_note='',reviewed_by=null,reviewed_at=null
 where id=case when TG_OP='DELETE' then OLD.marker_id else NEW.marker_id end;
 return null;
end; $$;
revoke all on function private.hazard_photo_changed() from public,anon,authenticated;
create trigger hazard_photo_changed after insert or delete on public.hazard_location_photos for each row execute function private.hazard_photo_changed();
create function private.review_hazard_marker(p_marker_id uuid,p_status text,p_note text,p_photo_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.hazard_markers;
begin
 select * into h from public.hazard_markers where id=p_marker_id for update;
 if h.id is null or auth.uid() is null or not public.can_manage_workspace_links(h.workspace_id) then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
 if p_status is null or p_status not in ('open','verified') then raise exception '잘못된 확인 상태입니다.'; end if;
 if h.photo_revision is distinct from p_photo_revision then raise exception '사진이 변경되었습니다. 창을 닫고 사진을 다시 확인해 주세요.'; end if;
 if p_status='verified' and not exists(select 1 from public.hazard_location_photos where marker_id=h.id and kind='remedy') then raise exception '조치 사진을 먼저 등록해 주세요.'; end if;
 if p_status='open' and coalesce(trim(p_note),'')='' then raise exception '재조치 요청 내용을 입력해 주세요.'; end if;
 update public.hazard_markers set review_status=p_status,review_note=coalesce(p_note,''),reviewed_by=auth.uid(),reviewed_at=now() where id=h.id returning * into h;
 return to_jsonb(h);
end; $$;
revoke all on function private.review_hazard_marker(uuid,text,text,integer) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.review_hazard_marker(uuid,text,text,integer) to authenticated;
create function public.review_hazard_marker(p_marker_id uuid,p_status text,p_note text,p_photo_revision integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.review_hazard_marker(p_marker_id,p_status,p_note,p_photo_revision); $$;
revoke all on function public.review_hazard_marker(uuid,text,text,integer) from public,anon;
grant execute on function public.review_hazard_marker(uuid,text,text,integer) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('hazard-location-photos','hazard-location-photos',false,20971520,array['image/jpeg']);
create policy location_photo_files_read on storage.objects for select to authenticated using(bucket_id='hazard-location-photos' and exists(select 1 from public.workspace_members m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid())));
create policy location_photo_files_insert on storage.objects for insert to authenticated with check(bucket_id='hazard-location-photos' and name ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+\.jpg$' and exists(select 1 from public.hazard_markers h join public.workspace_members m on m.workspace_id=h.workspace_id where h.workspace_id::text=(storage.foldername(name))[1] and h.id::text=(storage.foldername(name))[2] and m.user_id=(select auth.uid())));
create policy location_photo_files_delete on storage.objects for delete to authenticated using(bucket_id='hazard-location-photos' and exists(select 1 from public.workspace_members m where m.workspace_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid())));

create or replace function public.get_contractor_hazard_maps(p_token text,p_contractor_id uuid,p_map_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb; ws uuid;
begin
  ctx:=public.get_contractor_portal(p_token,p_contractor_id); ws:=(ctx->'workspace'->>'id')::uuid;
  if p_contractor_id is null or (ctx->'contractor'->>'id')::uuid is distinct from p_contractor_id then raise exception 'contractor does not match upload token'; end if;
  if ctx->'public_link'<>'null'::jsonb and not coalesce((ctx->'public_link'->>'allow_msds')::boolean,false) then raise exception 'MSDS permission required'; end if;
  if p_map_id is not null and not exists(select 1 from public.hazard_maps where id=p_map_id and workspace_id=ws) then raise exception 'map not found'; end if;
  return jsonb_build_object('maps',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'workspace_id',ws,'title',m.title,'storage_path',m.storage_path,'width',m.width,'height',m.height) order by m.created_at desc) from public.hazard_maps m where m.workspace_id=ws),'[]'::jsonb),
    'markers',coalesce((select jsonb_agg(case when h.contractor_id=p_contractor_id then to_jsonb(h) else to_jsonb(h)-'access_code' end order by h.created_at,h.id) from public.hazard_markers h where h.workspace_id=ws and h.map_id=p_map_id and (h.contractor_id=p_contractor_id or (h.contractor_id is null and h.marker_type in ('building','gate')))),'[]'::jsonb));
end; $$;
revoke all on function public.get_contractor_hazard_maps(text,uuid,uuid) from public,authenticated;
grant execute on function public.get_contractor_hazard_maps(text,uuid,uuid) to anon;

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
    if p_values->>'marker_type' is null or p_values->>'marker_type' not in ('locker','hazard','fuel','warehouse','issue') then raise exception 'invalid marker type'; end if;
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

-- Service-only finalization revalidates link and assignment after the file upload.
create function public.add_contractor_location_photo(p_token text,p_contractor_id uuid,p_map_id uuid,p_marker_id uuid,p_path text,p_kind text,p_note text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ctx jsonb; h public.hazard_markers; photo public.hazard_location_photos;
begin
 ctx:=public.get_contractor_hazard_maps(p_token,p_contractor_id,p_map_id);
 select * into h from public.hazard_markers where id=p_marker_id and map_id=p_map_id and contractor_id=p_contractor_id for update;
 if h.id is null then raise exception '담당 업체 위치가 아닙니다.'; end if;
 insert into public.hazard_location_photos(workspace_id,marker_id,storage_path,kind,note,created_by)
 values(h.workspace_id,h.id,p_path,p_kind,p_note,null) returning * into photo;
 return to_jsonb(photo);
end; $$;
revoke all on function public.add_contractor_location_photo(text,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.add_contractor_location_photo(text,uuid,uuid,uuid,text,text,text) to service_role;

-- A changed location, issue description or assignment needs a fresh review.
create function private.hazard_details_changed() returns trigger language plpgsql set search_path='' as $$
begin
 if row(NEW.x,NEW.y,NEW.storage_name,NEW.marker_type,NEW.content,NEW.contractor_id,NEW.items,NEW.access_code)
 is distinct from row(OLD.x,OLD.y,OLD.storage_name,OLD.marker_type,OLD.content,OLD.contractor_id,OLD.items,OLD.access_code) then
  NEW.review_status:='open'; NEW.review_note:=''; NEW.reviewed_by:=null; NEW.reviewed_at:=null;
  NEW.photo_revision:=OLD.photo_revision+1;
 end if;
 return NEW;
end; $$;
revoke all on function private.hazard_details_changed() from public,anon,authenticated;
create trigger hazard_details_changed before update on public.hazard_markers for each row execute function private.hazard_details_changed();

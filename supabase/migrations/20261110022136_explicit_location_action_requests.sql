-- Ordinary locations and reference photos do not imply an action request.
alter table public.hazard_markers drop constraint hazard_markers_review_status_check;
alter table public.hazard_markers add constraint hazard_markers_review_status_check check(review_status in ('none','open','pending','verified'));
alter table public.hazard_markers alter column review_status set default 'none';
alter table public.hazard_location_photos drop constraint hazard_location_photos_kind_check;
alter table public.hazard_location_photos add constraint hazard_location_photos_kind_check check(kind in ('record','finding','remedy'));

-- Preserve actual corrective evidence and administrator decisions. Earlier
-- generic "finding" photos were reference photos unless tied to an issue.
update public.hazard_markers h set review_status='none',review_note='',reviewed_by=null,reviewed_at=null
where h.review_status='open' and h.review_note='' and h.reviewed_by is null
and not exists(select 1 from public.hazard_location_photos p where p.marker_id=h.id and (p.kind='remedy' or (h.marker_type='issue' and p.kind='finding')));
update public.hazard_location_photos p set kind='record'
where p.kind='finding' and exists(select 1 from public.hazard_markers h where h.id=p.marker_id and h.review_status='none');

create or replace function private.hazard_photo_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare h public.hazard_markers; mid uuid; next_status text;
begin
 if (case when TG_OP='DELETE' then OLD.kind else NEW.kind end)='record' then return null; end if;
 mid:=case when TG_OP='DELETE' then OLD.marker_id else NEW.marker_id end;
 select * into h from public.hazard_markers where id=mid for update;
 if h.id is null then return null; end if; -- Parent cascade deletion.
 if TG_OP='INSERT' then
  if NEW.kind='remedy' and h.review_status='none' then raise exception '조치 요청 사진을 먼저 등록해 주세요.'; end if;
  next_status:=case when NEW.kind='finding' then 'open' else 'pending' end;
 else
  next_status:=case when h.review_status='none' or not exists(select 1 from public.hazard_location_photos p where p.marker_id=mid and p.kind in ('finding','remedy')) then 'none' else 'open' end;
 end if;
 update public.hazard_markers set photo_revision=photo_revision+1,review_status=next_status,review_note='',reviewed_by=null,reviewed_at=null where id=mid;
 return null;
end; $$;

create or replace function private.hazard_details_changed() returns trigger language plpgsql set search_path='' as $$
begin
 if row(NEW.x,NEW.y,NEW.storage_name,NEW.marker_type,NEW.content,NEW.contractor_id,NEW.items,NEW.access_code)
 is distinct from row(OLD.x,OLD.y,OLD.storage_name,OLD.marker_type,OLD.content,OLD.contractor_id,OLD.items,OLD.access_code) then
  if OLD.review_status<>'none' then
   NEW.review_status:='open'; NEW.review_note:=''; NEW.reviewed_by:=null; NEW.reviewed_at:=null;
   NEW.photo_revision:=OLD.photo_revision+1;
  end if;
 end if;
 return NEW;
end; $$;

create or replace function private.review_hazard_marker(p_marker_id uuid,p_status text,p_note text,p_photo_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.hazard_markers;
begin
 select * into h from public.hazard_markers where id=p_marker_id for update;
 if h.id is null or auth.uid() is null or not public.can_manage_workspace_links(h.workspace_id) then raise exception '관리자 권한이 필요합니다.' using errcode='42501'; end if;
 if h.review_status='none' then raise exception '조치 요청 사진이 등록된 위치만 확인할 수 있습니다.'; end if;
 if p_status is null or p_status not in ('open','verified') then raise exception '잘못된 확인 상태입니다.'; end if;
 if h.photo_revision is distinct from p_photo_revision then raise exception '사진이 변경되었습니다. 창을 닫고 사진을 다시 확인해 주세요.'; end if;
 if p_status='verified' and not exists(select 1 from public.hazard_location_photos where marker_id=h.id and kind='remedy') then raise exception '조치 사진을 먼저 등록해 주세요.'; end if;
 if p_status='open' and coalesce(trim(p_note),'')='' then raise exception '재조치 요청 내용을 입력해 주세요.'; end if;
 update public.hazard_markers set review_status=p_status,review_note=coalesce(p_note,''),reviewed_by=auth.uid(),reviewed_at=now() where id=h.id returning * into h;
 return to_jsonb(h);
end; $$;

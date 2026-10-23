-- Extend the existing sticker rows without changing their IDs or coordinates.
create function public.hazard_marker_items_valid(p_items jsonb)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select case when jsonb_typeof(p_items) = 'array' then
    jsonb_array_length(p_items) <= 50 and not exists (
      select 1 from jsonb_array_elements(p_items) entry
      where not coalesce(case when jsonb_typeof(entry) = 'object' then
        jsonb_typeof(entry->'name') = 'string'
        and length(trim(entry->>'name')) between 1 and 200
        and jsonb_typeof(entry->'quantity') = 'string'
        and length(entry->>'quantity') <= 120
        and entry - 'name' - 'quantity' = '{}'::jsonb
      else false end, false)
    )
  else false end;
$$;
revoke all on function public.hazard_marker_items_valid(jsonb) from public, anon;
grant execute on function public.hazard_marker_items_valid(jsonb) to authenticated, service_role;

alter table public.hazard_markers
  add column marker_type text not null default 'hazard'
    check (marker_type in ('locker', 'hazard', 'fuel', 'building', 'gate')),
  add column items jsonb not null default '[]'::jsonb
    check (public.hazard_marker_items_valid(items)),
  add column access_code text not null default '' check (length(access_code) <= 100),
  add column contractor_id uuid;

-- Preserve previous free-text entries as one explicit legacy line. Multiple
-- substances previously typed into one string cannot be assigned invented counts.
update public.hazard_markers
set items = jsonb_build_array(jsonb_build_object(
  'name', coalesce(nullif(trim(material), ''), '(기존 물질명 미입력)'),
  'quantity', quantity))
where trim(material) <> '' or trim(quantity) <> '';

create unique index contractors_workspace_id_id_hazard_key on public.contractors (workspace_id, id);
alter table public.hazard_markers add constraint hazard_markers_contractor_workspace_fk
  foreign key (workspace_id, contractor_id) references public.contractors (workspace_id, id)
  on delete set null (contractor_id);
create index hazard_markers_workspace_contractor_idx on public.hazard_markers (workspace_id, contractor_id);

grant update (marker_type, items, access_code, contractor_id) on public.hazard_markers to authenticated;
grant update (storage_path, width, height) on public.hazard_maps to authenticated;

comment on column public.hazard_markers.items is '물질별 이름과 단위 포함 수량. [{name,quantity}]';
comment on column public.hazard_markers.access_code is '현장 구성원에게 원문 표시하는 보관함/저장소 비밀번호';
comment on column public.hazard_markers.marker_type is '락카 보관함 / 위험물 / 유류 / 동 / 게이트';

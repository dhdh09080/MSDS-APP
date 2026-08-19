-- 현장별 주소 및 좌표. 기존 현장은 null로 유지되어 위치 설정 안내가 표시된다.
alter table public.workspaces
  add column if not exists address text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workspaces_latitude_range'
  ) then
    alter table public.workspaces
      add constraint workspaces_latitude_range
      check (latitude is null or latitude between -90 and 90);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'workspaces_longitude_range'
  ) then
    alter table public.workspaces
      add constraint workspaces_longitude_range
      check (longitude is null or longitude between -180 and 180);
  end if;
end
$$;

comment on column public.workspaces.address is '현장별 도로명/지번 주소';
comment on column public.workspaces.latitude is '현장 날씨 조회용 WGS84 위도';
comment on column public.workspaces.longitude is '현장 날씨 조회용 WGS84 경도';

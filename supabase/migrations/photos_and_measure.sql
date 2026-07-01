-- ═══════════════════════════════════════════════
-- 6. 사진 클라우드 (주제별 증빙 사진첩)
-- ═══════════════════════════════════════════════

-- 주제(앨범). 사전 정의 주제는 워크스페이스 생성 시 자동 생성하거나, 처음 진입 시 시드해도 됨.
create table if not exists photo_albums (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  is_preset boolean not null default false,   -- 사전 정의 주제 여부 (삭제 방지용 표시)
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique(workspace_id, name)
);

alter table photo_albums enable row level security;

create policy "ws members can select photo_albums"
  on photo_albums for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert photo_albums"
  on photo_albums for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can update photo_albums"
  on photo_albums for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete photo_albums"
  on photo_albums for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));


-- 개별 사진
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  album_id uuid not null references photo_albums(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  file_path text not null,         -- storage path in site-photos bucket
  file_name text not null,
  shot_date date not null,         -- 사진이 속하는 날짜 (현장에서의 촬영/해당 일자 기준)
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists idx_photos_album_date on photos(album_id, shot_date desc);
create index if not exists idx_photos_ws_date on photos(workspace_id, shot_date desc);

alter table photos enable row level security;

create policy "ws members can select photos"
  on photos for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert photos"
  on photos for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete photos"
  on photos for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));


-- Storage 버킷
insert into storage.buckets (id, name, public)
values ('site-photos', 'site-photos', false)
on conflict (id) do nothing;

create policy "ws members can read site photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'site-photos');

create policy "ws members can upload site photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'site-photos');

create policy "ws members can delete site photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'site-photos');


-- ═══════════════════════════════════════════════
-- 7. 작업환경측정 연간 체크리스트 (상/하반기)
-- ═══════════════════════════════════════════════
create table if not exists measure_rounds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  year int not null,
  half text not null,              -- 'H1' | 'H2'
  done boolean not null default false,
  done_date date,
  memo text,
  updated_at timestamptz not null default now(),
  unique(workspace_id, year, half)
);

alter table measure_rounds enable row level security;

create policy "ws members can select measure_rounds"
  on measure_rounds for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert measure_rounds"
  on measure_rounds for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can update measure_rounds"
  on measure_rounds for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

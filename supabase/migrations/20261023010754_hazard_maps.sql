-- Private site panoramas and normalized sticker positions. No anonymous access.
create table public.hazard_maps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  storage_path text not null unique,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (split_part(storage_path, '/', 1) = workspace_id::text
    and split_part(storage_path, '/', 2) = id::text
    and storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+\.(jpg|png|webp)$')
);
create index hazard_maps_workspace_created_idx on public.hazard_maps (workspace_id, created_at desc);

create table public.hazard_markers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  map_id uuid not null,
  x double precision not null check (x between 0 and 1),
  y double precision not null check (y between 0 and 1),
  storage_name text not null check (length(trim(storage_name)) between 1 and 120),
  material text not null default '' check (length(material) <= 200),
  quantity text not null default '' check (length(quantity) <= 120),
  manager text not null default '' check (length(manager) <= 100),
  content text not null default '' check (length(content) <= 3000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, map_id) references public.hazard_maps (workspace_id, id) on delete cascade
);
create index hazard_markers_map_created_idx on public.hazard_markers (workspace_id, map_id, created_at, id);
create index hazard_maps_created_by_idx on public.hazard_maps (created_by);
create index hazard_markers_created_by_idx on public.hazard_markers (created_by);

alter table public.hazard_maps enable row level security;
alter table public.hazard_markers enable row level security;
revoke all on public.hazard_maps, public.hazard_markers from anon, authenticated;
grant select, insert, delete on public.hazard_maps, public.hazard_markers to authenticated;
-- Site/photo ownership and creator cannot be reassigned by a client update.
grant update (title) on public.hazard_maps to authenticated;
grant update (x, y, storage_name, material, quantity, manager, content) on public.hazard_markers to authenticated;

create policy hazard_maps_read on public.hazard_maps for select to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = hazard_maps.workspace_id and m.user_id = (select auth.uid())));
create policy hazard_maps_insert on public.hazard_maps for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.workspace_members m where m.workspace_id = hazard_maps.workspace_id and m.user_id = (select auth.uid())));
create policy hazard_maps_update on public.hazard_maps for update to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = hazard_maps.workspace_id and m.user_id = (select auth.uid())))
with check (exists (select 1 from public.workspace_members m where m.workspace_id = hazard_maps.workspace_id and m.user_id = (select auth.uid())));
create policy hazard_maps_delete on public.hazard_maps for delete to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = hazard_maps.workspace_id and m.user_id = (select auth.uid())));

create policy hazard_markers_read on public.hazard_markers for select to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = hazard_markers.workspace_id and m.user_id = (select auth.uid())));
create policy hazard_markers_insert on public.hazard_markers for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.workspace_members m where m.workspace_id = hazard_markers.workspace_id and m.user_id = (select auth.uid())));
create policy hazard_markers_update on public.hazard_markers for update to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = hazard_markers.workspace_id and m.user_id = (select auth.uid())))
with check (exists (select 1 from public.workspace_members m where m.workspace_id = hazard_markers.workspace_id and m.user_id = (select auth.uid())));
create policy hazard_markers_delete on public.hazard_markers for delete to authenticated
using (exists (select 1 from public.workspace_members m where m.workspace_id = hazard_markers.workspace_id and m.user_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hazard-map-photos', 'hazard-map-photos', false, 20971520, array['image/jpeg', 'image/png', 'image/webp']);
create policy hazard_map_photos_read on storage.objects for select to authenticated
using (bucket_id = 'hazard-map-photos' and exists (select 1 from public.workspace_members m where m.workspace_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid())));
create policy hazard_map_photos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'hazard-map-photos' and array_length(storage.foldername(name), 1) = 2
  and name ~ '^[0-9a-f-]+/[0-9a-f-]+/[0-9a-f-]+\.(jpg|png|webp)$'
  and exists (select 1 from public.workspace_members m where m.workspace_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid())));
create policy hazard_map_photos_delete on storage.objects for delete to authenticated
using (bucket_id = 'hazard-map-photos' and exists (select 1 from public.workspace_members m where m.workspace_id::text = (storage.foldername(name))[1] and m.user_id = (select auth.uid())));

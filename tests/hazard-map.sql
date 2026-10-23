-- Rollback-only authorization/constraint verification. Creates synthetic sites
-- using two existing account IDs without modifying customer sites or documents.
begin;
do $$
declare
  u1 uuid; u2 uuid;
  w1 uuid := gen_random_uuid(); w2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
begin
  select id into u1 from auth.users order by id limit 1;
  select id into u2 from auth.users where id <> u1 order by id limit 1;
  if u2 is null then raise exception 'Two existing testable accounts required'; end if;
  perform set_config('test.hazard_uid', u1::text, true);
  perform set_config('test.hazard_w1', w1::text, true);
  perform set_config('test.hazard_w2', w2::text, true);
  perform set_config('test.hazard_p1', p1::text, true);
  perform set_config('test.hazard_p2', p2::text, true);
  perform set_config('test.hazard_c1', c1::text, true);
  perform set_config('test.hazard_c2', c2::text, true);
  insert into public.workspaces(id, name, code, owner_id) values
    (w1, 'hazard-map rollback fixture A', substr(w1::text, 1, 8), u1),
    (w2, 'hazard-map rollback fixture B', substr(w2::text, 1, 8), u2);
  insert into public.workspace_members(workspace_id, user_id, role) values (w1, u1, 'admin'), (w2, u2, 'admin') on conflict do nothing;
  insert into public.contractors(id, workspace_id, name) values (c1, w1, 'Fixture contractor A'), (c2, w2, 'Fixture contractor B');
  insert into public.hazard_maps(id, workspace_id, title, storage_path, width, height, created_by) values
    (p1, w1, 'Fixture A', w1||'/'||p1||'/'||gen_random_uuid()||'.png', 1200, 700, u1),
    (p2, w2, 'Fixture B', w2||'/'||p2||'/'||gen_random_uuid()||'.png', 700, 1200, u2);
  insert into public.hazard_markers(workspace_id, map_id, x, y, storage_name, quantity, manager, content, created_by) values
    (w1, p1, .25, .75, 'Fixture marker A', '200 L', 'Fixture manager', 'Fixture content', u1),
    (w2, p2, .5, .5, 'Fixture marker B', '10통', 'Fixture manager B', '', u2);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hazard_uid'), true) is not null as jwt_configured;
do $$
declare
  w1 uuid := current_setting('test.hazard_w1')::uuid;
  w2 uuid := current_setting('test.hazard_w2')::uuid;
  p1 uuid := current_setting('test.hazard_p1')::uuid;
  p2 uuid := current_setting('test.hazard_p2')::uuid;
  c1 uuid := current_setting('test.hazard_c1')::uuid;
  c2 uuid := current_setting('test.hazard_c2')::uuid;
  n integer;
  k text; sticker_snapshot jsonb;
begin
  if (select count(*) from public.hazard_maps where id in (p1, p2)) <> 1 then raise exception 'Cross-site map read'; end if;
  if (select count(*) from public.hazard_markers where map_id in (p1, p2)) <> 1 then raise exception 'Cross-site marker read'; end if;
  update public.hazard_markers set manager='Updated', x=.45 where map_id=p1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Same-site update failed'; end if;
  update public.hazard_markers set manager='Unauthorized' where map_id=p2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Cross-site update allowed'; end if;
  begin
    insert into public.hazard_markers(workspace_id, map_id, x, y, storage_name) values(w2, p2, .2, .2, 'Unauthorized');
    raise exception 'Cross-site insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.hazard_markers(workspace_id, map_id, x, y, storage_name) values(w1, p2, .2, .2, 'Mismatched photo');
    raise exception 'Cross-site photo association allowed';
  exception when foreign_key_violation then null; end;
  begin
    update public.hazard_markers set workspace_id=w2 where map_id=p1;
    raise exception 'Workspace reassignment allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.hazard_markers set x=1.01 where map_id=p1;
    raise exception 'Out-of-bounds coordinates allowed';
  exception when check_violation then null; end;
  begin
    update public.hazard_markers set x='NaN'::double precision where map_id=p1;
    raise exception 'NaN coordinates allowed';
  exception when check_violation then null; end;
  begin
    update public.hazard_markers set storage_name=' ' where map_id=p1;
    raise exception 'Blank names allowed';
  exception when check_violation then null; end;
  update public.hazard_markers set contractor_id=c1, access_code='1234',
    items='[{"name":"신나","quantity":"20 L × 10통"},{"name":"페인트","quantity":"18 L × 5통"}]'::jsonb where map_id=p1;
  if not exists (select 1 from public.hazard_markers where map_id=p1 and contractor_id=c1 and access_code='1234' and jsonb_array_length(items)=2) then
    raise exception 'Per-material quantities/contractor/code not saved';
  end if;
  foreach k in array array['locker','hazard','fuel','building','gate'] loop
    update public.hazard_markers set marker_type=k where map_id=p1;
  end loop;
  begin
    update public.hazard_markers set marker_type='invalid' where map_id=p1;
    raise exception 'Unknown sticker type allowed';
  exception when check_violation then null; end;
  begin
    update public.hazard_markers set contractor_id=c2 where map_id=p1;
    raise exception 'Cross-site contractor association allowed';
  exception when foreign_key_violation then null; end;
  begin
    update public.hazard_markers set items='[{"name":"신나","quantity":200}]'::jsonb where map_id=p1;
    raise exception 'Non-string quantities allowed';
  exception when check_violation then null; end;
  begin
    update public.hazard_markers set items='[{"quantity":"20 L"}]'::jsonb where map_id=p1;
    raise exception 'Unnamed material allowed';
  exception when check_violation then null; end;
  begin
    update public.hazard_markers set items='{}'::jsonb where map_id=p1;
    raise exception 'Non-array items allowed';
  exception when check_violation then null; end;
  begin
    update public.hazard_markers set items=(select jsonb_agg(jsonb_build_object('name','신나','quantity','1 L')) from generate_series(1,51)) where map_id=p1;
    raise exception 'Unbounded item rows allowed';
  exception when check_violation then null; end;
  select jsonb_agg(to_jsonb(m)) into sticker_snapshot from public.hazard_markers m where map_id=p1;
  update public.hazard_maps set storage_path=w1||'/'||p1||'/'||gen_random_uuid()||'.jpg', width=400, height=900 where id=p1;
  if (select jsonb_agg(to_jsonb(m)) from public.hazard_markers m where map_id=p1) is distinct from sticker_snapshot then
    raise exception 'Replacing photo changed sticker positions or data';
  end if;
  delete from public.hazard_maps where id=p2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Cross-site delete allowed'; end if;
  delete from public.hazard_maps where id=p1;
  if exists (select 1 from public.hazard_markers where map_id=p1) then raise exception 'Photo delete did not cascade'; end if;
end $$;
set local role anon;
do $$
begin
  begin
    perform 1 from public.hazard_maps;
    raise exception 'Anonymous map access allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.hazard_markers;
    raise exception 'Anonymous marker access allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: same-site CRUD, cross-site/anonymous denial, immutable workspace, bounds/name/type/item validation, material quantities, contractor scope, visible code, photo replacement preserves every sticker, cascade' as result;
rollback;

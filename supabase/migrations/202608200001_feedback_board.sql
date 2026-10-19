create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.system_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.feedback_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete restrict,
  author_name text not null,
  category text not null check (category in ('bug', 'improvement', 'question', 'other')),
  feature_area text not null check (char_length(feature_area) between 1 and 50),
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent')),
  title text not null check (char_length(title) between 2 and 120),
  content text not null check (char_length(content) between 5 and 4000),
  reproduction_steps text check (reproduction_steps is null or char_length(reproduction_steps) <= 3000),
  expected_result text check (expected_result is null or char_length(expected_result) <= 2000),
  status text not null default 'received' check (status in ('received', 'reviewing', 'planned', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.feedback_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feedback_posts(id) on delete cascade,
  admin_id uuid not null references auth.users(id) on delete restrict,
  admin_name text not null,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index feedback_posts_author_created_idx on public.feedback_posts (author_id, created_at desc);
create index feedback_posts_status_created_idx on public.feedback_posts (status, created_at desc);
create index feedback_comments_post_created_idx on public.feedback_comments (post_id, created_at);
create index feedback_comments_admin_idx on public.feedback_comments (admin_id);

create or replace function private.is_system_admin(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.system_admins
    where user_id = check_user_id
  );
$$;

create or replace function private.set_feedback_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  new.author_id := current_user_id;
  select coalesce(nullif(trim(raw_user_meta_data->>'name'), ''), split_part(email, '@', 1), '사용자')
    into new.author_name
  from auth.users
  where id = current_user_id;

  return new;
end;
$$;

create or replace function private.set_feedback_comment_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or not private.is_system_admin(current_user_id) then
    raise exception 'System administrator access required';
  end if;

  new.admin_id := current_user_id;
  select coalesce(nullif(trim(raw_user_meta_data->>'name'), ''), split_part(email, '@', 1), '시스템 관리자')
    into new.admin_name
  from auth.users
  where id = current_user_id;

  return new;
end;
$$;

create or replace function private.touch_feedback_post()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.is_system_admin(uuid) from public, anon, authenticated;
revoke all on function private.set_feedback_author() from public, anon, authenticated;
revoke all on function private.set_feedback_comment_admin() from public, anon, authenticated;
revoke all on function private.touch_feedback_post() from public, anon, authenticated;

create trigger feedback_posts_set_author
before insert on public.feedback_posts
for each row execute function private.set_feedback_author();

create trigger feedback_posts_touch_updated_at
before update on public.feedback_posts
for each row execute function private.touch_feedback_post();

create trigger feedback_comments_set_admin
before insert on public.feedback_comments
for each row execute function private.set_feedback_comment_admin();

alter table public.system_admins enable row level security;
alter table public.feedback_posts enable row level security;
alter table public.feedback_comments enable row level security;

create policy "System admins can view their own role"
on public.system_admins for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view own feedback and admins can view all"
on public.feedback_posts for select
to authenticated
using (
  (select auth.uid()) = author_id
  or exists (
    select 1 from public.system_admins
    where user_id = (select auth.uid())
  )
);

create policy "Users can create their own feedback"
on public.feedback_posts for insert
to authenticated
with check ((select auth.uid()) = author_id);

create policy "System admins can update feedback status"
on public.feedback_posts for update
to authenticated
using (exists (select 1 from public.system_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.system_admins where user_id = (select auth.uid())));

create policy "System admins can delete feedback"
on public.feedback_posts for delete
to authenticated
using (exists (select 1 from public.system_admins where user_id = (select auth.uid())));

create policy "Feedback participants can view admin comments"
on public.feedback_comments for select
to authenticated
using (
  exists (
    select 1
    from public.feedback_posts post
    where post.id = post_id
      and (
        post.author_id = (select auth.uid())
        or exists (select 1 from public.system_admins where user_id = (select auth.uid()))
      )
  )
);

create policy "Only system admins can add comments"
on public.feedback_comments for insert
to authenticated
with check (
  admin_id = (select auth.uid())
  and exists (select 1 from public.system_admins where user_id = (select auth.uid()))
);

create policy "System admins can delete comments"
on public.feedback_comments for delete
to authenticated
using (exists (select 1 from public.system_admins where user_id = (select auth.uid())));

revoke all on table public.system_admins, public.feedback_posts, public.feedback_comments from anon, authenticated;
grant select on table public.system_admins to authenticated;
grant select, insert, update, delete on table public.feedback_posts to authenticated;
grant select, insert, delete on table public.feedback_comments to authenticated;

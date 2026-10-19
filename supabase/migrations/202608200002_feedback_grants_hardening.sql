revoke all on table public.system_admins, public.feedback_posts, public.feedback_comments from anon, authenticated;

grant select on table public.system_admins to authenticated;
grant select, insert, update, delete on table public.feedback_posts to authenticated;
grant select, insert, delete on table public.feedback_comments to authenticated;

create index if not exists feedback_comments_admin_idx on public.feedback_comments (admin_id);

-- Contractor pages resolve bearer links through scoped RPCs. Retain table
-- privileges for compatibility but prevent anonymous enumeration of link tokens.
alter policy "anon can select public_upload_links by token" on public.public_upload_links using (false);

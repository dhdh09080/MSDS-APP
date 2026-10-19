-- Preserve existing workspace RLS and permissions; add document-derived safety text only.
alter table public.msds_records
  add column if not exists handling_precautions text not null default '',
  add column if not exists first_aid text not null default '',
  add column if not exists emergency_response text not null default '';

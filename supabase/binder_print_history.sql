-- 현장별 최근 인쇄 요청 기록. 기존 binder_catalogs RLS/권한을 그대로 적용한다.
alter table public.binder_catalogs
 add column if not exists print_history jsonb not null default '[]'::jsonb
 check (jsonb_typeof(print_history) = 'array' and jsonb_array_length(print_history) <= 100);
comment on column public.binder_catalogs.print_history is
 '최근 100건의 인쇄 요청 스냅샷. requested/confirmed/cancelled는 실제 출력과 요청을 구분한다.';
-- 최근 100건을 넘어도 각 문서의 마지막 번호는 별도로 유지한다.
alter table public.binder_catalogs
 add column if not exists last_print_numbers jsonb not null default '{}'::jsonb
 check (jsonb_typeof(last_print_numbers) = 'object');

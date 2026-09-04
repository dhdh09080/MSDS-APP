alter table public.measure_results
  add column if not exists aftercare jsonb not null default '{}'::jsonb;

comment on column public.measure_results.aftercare is
  '작업환경측정 사후관리 Word 생성용 공종별 판정, 초과 단위값 및 개선대책';

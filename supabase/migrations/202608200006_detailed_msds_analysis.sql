-- Store structured MSDS composition and regulatory assessments.
-- Existing msds_records RLS policies and grants continue to apply to these columns.

alter table public.msds_records
  add column if not exists component_details jsonb not null default '[]'::jsonb,
  add column if not exists dangerous_goods_details jsonb not null default '{}'::jsonb,
  add column if not exists occupational_safety_details jsonb not null default '{}'::jsonb,
  add column if not exists chemical_regulation_details jsonb not null default '{}'::jsonb,
  add column if not exists analysis_provider text,
  add column if not exists analysis_model text;

alter table public.msds_records
  drop constraint if exists msds_records_component_details_array,
  drop constraint if exists msds_records_dangerous_goods_object,
  drop constraint if exists msds_records_occupational_safety_object,
  drop constraint if exists msds_records_chemical_regulation_object,
  drop constraint if exists msds_records_analysis_provider_valid;

alter table public.msds_records
  add constraint msds_records_component_details_array
    check (jsonb_typeof(component_details) = 'array'),
  add constraint msds_records_dangerous_goods_object
    check (jsonb_typeof(dangerous_goods_details) = 'object'),
  add constraint msds_records_occupational_safety_object
    check (jsonb_typeof(occupational_safety_details) = 'object'),
  add constraint msds_records_chemical_regulation_object
    check (jsonb_typeof(chemical_regulation_details) = 'object'),
  add constraint msds_records_analysis_provider_valid
    check (analysis_provider is null or analysis_provider in ('claude', 'openai', 'gemini'));

comment on column public.msds_records.component_details is
  'MSDS 3항에서 추출한 CAS별 물질명과 최소/최대 함유량. 원문 파일은 포함하지 않는다.';
comment on column public.msds_records.dangerous_goods_details is
  '위험물안전관리법 관련 구조화 판정과 문서 근거.';
comment on column public.msds_records.occupational_safety_details is
  '산업안전보건법 관련 구조화 판정과 문서 근거. 조건부는 현장 공정/취급량 추가 확인이 필요함을 뜻한다.';
comment on column public.msds_records.chemical_regulation_details is
  '화평법/화관법 관련 구조화 판정과 문서 근거.';
comment on column public.msds_records.analysis_provider is
  '가장 최근 MSDS 분석에 자동 선택된 AI 제공자.';
comment on column public.msds_records.analysis_model is
  '가장 최근 MSDS 분석에 사용된 모델 식별자.';

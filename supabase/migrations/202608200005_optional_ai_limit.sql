-- 개인 API 과금이므로 시스템 기본 제한은 두지 않습니다. 0은 무제한입니다.
alter table public.user_ai_preferences
  alter column monthly_request_limit set default 0;

alter table public.user_ai_preferences
  drop constraint if exists user_ai_preferences_monthly_request_limit_check;
alter table public.user_ai_preferences
  add constraint user_ai_preferences_monthly_request_limit_check
  check (monthly_request_limit between 0 and 200);

update public.user_ai_preferences
set monthly_request_limit = 0, updated_at = now()
where monthly_request_limit = 30;

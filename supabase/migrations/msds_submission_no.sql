-- ═══════════════════════════════════════════════
-- 8. MSDS 제출번호 검증
-- ═══════════════════════════════════════════════
alter table msds_records add column if not exists submission_no text;
alter table msds_records add column if not exists submission_no_valid text default 'N'; -- 'Y' | 'N'

create index if not exists idx_msds_submission_invalid on msds_records(workspace_id, submission_no_valid);

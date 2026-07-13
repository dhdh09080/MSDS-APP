-- ═══════════════════════════════════════════════
-- KOSHA GUIDE 카탈로그 (공공데이터포털 공식 CSV를 1회 업로드해 팀 공유)
-- 출처: 한국산업안전보건공단_안전보건기술지침(KOSHA Guide) 목록 (data.go.kr/data/15116595)
-- ═══════════════════════════════════════════════
create table if not exists kosha_guides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  guide_no text not null,        -- 지침번호 (예: H-206-2023 형식은 원본 CSV 그대로)
  title text not null,           -- 명칭
  committee text,                -- 위원회 (분야)
  category text,                 -- 분류내용
  code text,                     -- 분류기호
  reg_date text,                 -- 등록일
  created_at timestamptz not null default now(),
  unique (workspace_id, guide_no)
);

create index if not exists idx_kosha_guides_ws on kosha_guides(workspace_id);

alter table kosha_guides enable row level security;

create policy "ws members can select kosha_guides"
  on kosha_guides for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert kosha_guides"
  on kosha_guides for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete kosha_guides"
  on kosha_guides for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

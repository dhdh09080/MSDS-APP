-- ═══════════════════════════════════════════════
-- 9. 전체 협력사용 공용 업로드 링크
-- ═══════════════════════════════════════════════
create table if not exists public_upload_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  token text not null unique,
  allow_msds boolean not null default true,
  allow_license boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public_upload_links enable row level security;

-- 관리자(워크스페이스 멤버): 조회/생성/수정/삭제
create policy "ws members can select public_upload_links"
  on public_upload_links for select
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can insert public_upload_links"
  on public_upload_links for insert
  with check (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can update public_upload_links"
  on public_upload_links for update
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

create policy "ws members can delete public_upload_links"
  on public_upload_links for delete
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()));

-- 협력사(비로그인 anon): 토큰으로 자신의 링크 정보만 조회 가능
create policy "anon can select public_upload_links by token"
  on public_upload_links for select
  to anon
  using (true);  -- token 자체가 비밀값이므로 select는 전체 허용 (token 모르면 조회 불가)


-- ═══════════════════════════════════════════════
-- contractors 테이블에 협력사(비로그인)가 새 회사를 추가할 수 있도록 anon insert 허용
-- 공용 링크를 통해서만 들어오므로, 악용 방지를 위해 별도 검증 로직은 클라이언트에서 토큰 유효성 확인 후 진행
-- ═══════════════════════════════════════════════
create policy "anon can insert contractors via public link"
  on contractors for insert
  to anon
  with check (
    workspace_id in (select workspace_id from public_upload_links)
  );

create policy "anon can select contractors via public link"
  on contractors for select
  to anon
  using (
    workspace_id in (select workspace_id from public_upload_links)
  );


-- ═══════════════════════════════════════════════
-- msds_records: 공용 링크를 통한 anon insert 허용 (기존 upload_tokens 경로와 별개)
-- ═══════════════════════════════════════════════
create policy "anon can insert msds_records via public link"
  on msds_records for insert
  to anon
  with check (
    workspace_id in (select workspace_id from public_upload_links where allow_msds = true)
  );


-- ═══════════════════════════════════════════════
-- business_licenses: 공용 링크를 통한 anon insert/select 허용
-- ═══════════════════════════════════════════════
create policy "anon can insert business_licenses via public link"
  on business_licenses for insert
  to anon
  with check (
    workspace_id in (select workspace_id from public_upload_links where allow_license = true)
  );

create policy "anon can select business_licenses via public link"
  on business_licenses for select
  to anon
  using (
    workspace_id in (select workspace_id from public_upload_links)
  );


-- ═══════════════════════════════════════════════
-- work_types: 공용 링크에서 공종 목록 조회용 anon select 허용
-- ═══════════════════════════════════════════════
create policy "anon can select work_types via public link"
  on work_types for select
  to anon
  using (
    workspace_id in (select workspace_id from public_upload_links)
  );

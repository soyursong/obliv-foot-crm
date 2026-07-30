-- Rollback: T-20260730-foot-ASSIGN-FULLSPEC-IMPL — 비TM 6경로 분리 되돌림 (CHECK 6→3, 신값 행 소멸).
--
-- 순서 중요: 3값 CHECK 로 되돌리기 전에 6값 신규 행(NAVER/REFERRAL/HOMEPAGE)을 먼저 삭제해야 CHECK 재적용이 통과한다.
--   되돌림 후 엔진 동작: 신 3경로는 다시 매핑 미스로 WALK_IN 수렴(deriveAssignLeadSource fallback) → 기존 워크인 동선.
--   ★ 신값 policy/pointer 행 소멸은 의도된 되돌림. TM/INBOUND/WALK_IN 기존 행·커서는 불변.
-- 멱등: DELETE(대상 없으면 no-op) + DROP CONSTRAINT IF EXISTS 후 재생성.

BEGIN;

-- (1) 신값 행 먼저 제거(포인터 커서 → 정책 순).
DELETE FROM assignment_pointer_state    WHERE lead_source IN ('NAVER', 'REFERRAL', 'HOMEPAGE');
DELETE FROM assignment_leadsource_policy WHERE lead_source IN ('NAVER', 'REFERRAL', 'HOMEPAGE');

-- (2) CHECK 6→3 복원.
ALTER TABLE assignment_leadsource_policy
  DROP CONSTRAINT IF EXISTS assignment_leadsource_policy_lead_source_check;
ALTER TABLE assignment_leadsource_policy
  ADD CONSTRAINT assignment_leadsource_policy_lead_source_check
  CHECK (lead_source IN ('TM', 'INBOUND', 'WALK_IN'));

ALTER TABLE assignment_pointer_state
  DROP CONSTRAINT IF EXISTS assignment_pointer_state_lead_source_check;
ALTER TABLE assignment_pointer_state
  ADD CONSTRAINT assignment_pointer_state_lead_source_check
  CHECK (lead_source IN ('TM', 'INBOUND', 'WALK_IN'));

-- (3) ledger 제거.
DELETE FROM supabase_migrations.schema_migrations WHERE version='20260730120000';

COMMIT;

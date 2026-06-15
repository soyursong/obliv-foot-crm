-- Rollback: 20260615190000_koh_lifecycle_publish.sql
-- T-20260615-foot-KOHTEST-LIFECYCLE-PUBLISH
-- ⚠️ 발행된 결과지(form_submissions status='published')가 있으면 status CHECK 복원이 막힐 수 있음.
--    롤백 전 점검: SELECT count(*) FROM form_submissions WHERE status='published';
--    > 0 이면 데이터 보존 위해 status CHECK 복원은 SKIP(아래 가드). 컬럼/RPC만 제거.

BEGIN;

-- RPC 제거
DROP FUNCTION IF EXISTS publish_koh_result(uuid, jsonb);
DROP FUNCTION IF EXISTS next_koh_request_no(uuid, date);
DROP FUNCTION IF EXISTS next_koh_specimen_no(uuid, date);
DROP FUNCTION IF EXISTS set_koh_requested(uuid, boolean);

-- koh_result form_template 비활성화(seed 제거 대신 soft) — 발행 이력 FK 보존
UPDATE form_templates SET active = false
 WHERE form_key = 'koh_result';

-- form_submissions.status CHECK 복원 — published 발행분 없을 때만(데이터 보존)
DO $rb$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM form_submissions WHERE status = 'published') THEN
    ALTER TABLE form_submissions DROP CONSTRAINT IF EXISTS form_submissions_status_check;
    ALTER TABLE form_submissions
      ADD CONSTRAINT form_submissions_status_check
      CHECK (status IN ('draft', 'printed', 'signed', 'voided', 'completed'));
  ELSE
    RAISE NOTICE '발행된 결과지(published) 존재 → status CHECK 복원 SKIP(데이터 보존)';
  END IF;
END
$rb$;

-- koh_requested 컬럼 제거(ADDITIVE 역연산)
ALTER TABLE check_in_services DROP COLUMN IF EXISTS koh_requested;

COMMIT;

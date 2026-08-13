-- ============================================================
-- ROLLBACK — T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK CARVE-B staff_attendance envelope
-- ============================================================
-- ⚠ 롤백 전: staff_attendance 에 deleted_at IS NOT NULL(soft-delete 마킹된 시트제거 근태행) 이 존재하면
--   컬럼 DROP 시 그 마킹이 소실 → 물리행은 남되 활성/비활성 구분이 사라진다(정합 검토 후에만 DROP).
--   (envelope 미apply 상태면 무영향.)
-- ⚠ EF(attendance-sync) 의 soft-UPDATE 라우팅이 배포된 뒤라면 반드시 EF 롤백을 동시/선행할 것
--   (컬럼 DROP 후 soft UPDATE 시도 = 런타임 실패).
-- ============================================================

BEGIN;

ALTER TABLE staff_attendance
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS deleted_reason;

COMMIT;

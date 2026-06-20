-- ============================================================
-- ROLLBACK — T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY (Phase B 단계1·2)
-- ============================================================
-- ⚠️ 컬럼 DROP 은 데이터 손실 가능 → 운영 롤백 시 신중. 통상은 RLS/CHECK/트리거만 원복하고 컬럼은 유지.
--   (additive 컬럼은 미사용 시 무해. soft-delete 데이터 보존이 의료법상 안전.)
-- ⚠️ partial UNIQUE index 는 본 마이그에 없음 → 별도 apply 스크립트에서 DROP INDEX CONCURRENTLY uix_mc_customer_clinic_date.

BEGIN;

-- 1) RESTRICTIVE 가시성 정책 원복
DROP POLICY IF EXISTS "mc_deleted_rows_director_only" ON medical_charts;

-- 2) 감사 트리거 함수 원복(DELETE 라벨링 제거 → 기존 'UPDATE' 고정)
CREATE OR REPLACE FUNCTION medical_charts_body_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO medical_charts_audit_log (
    medical_chart_id, clinic_id, old_data, new_data, changed_by, operation
  ) VALUES (
    OLD.id, OLD.clinic_id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, auth.uid(), 'UPDATE'
  );
  RETURN NEW;
END;
$$;

-- 3) audit_log operation CHECK 원복(IN('UPDATE','DELETE') → 'UPDATE' 단일)
--    ⚠️ operation='DELETE' 행이 이미 존재하면 원복 시 CHECK 위반으로 FAIL → 먼저 정리 필요.
ALTER TABLE medical_charts_audit_log
  DROP CONSTRAINT IF EXISTS medical_charts_audit_log_operation_check;
ALTER TABLE medical_charts_audit_log
  ADD CONSTRAINT medical_charts_audit_log_operation_check
  CHECK (operation IN ('UPDATE'));

-- 4) (선택·기본 비활성) soft-delete 컬럼 DROP — 데이터 손실 위험으로 주석 처리.
--    완전 원복이 필요하고 데이터 손실이 허용될 때만 수동 해제.
-- ALTER TABLE medical_charts
--   DROP COLUMN IF EXISTS delete_reason,
--   DROP COLUMN IF EXISTS deleted_by,
--   DROP COLUMN IF EXISTS deleted_at,
--   DROP COLUMN IF EXISTS is_deleted;

COMMIT;

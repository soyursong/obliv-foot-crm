-- ============================================================
-- DRY-RUN (no-persistence) — T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK Leg2 envelope
-- ============================================================
-- 목적: apply 前 사전검증. (1) 6개 대상 테이블 실재 확인 (2) ADDITIVE 안전성(기존 동명 컬럼 부재) 확인.
-- 무영속: 마지막에 강제 ROLLBACK — 어떤 DDL 도 확정하지 않는다(sentinel-bypass 방지, txn-control 문 미포함).
-- ============================================================

DO $$
DECLARE
  v_missing text := '';
  v_conflict text := '';
  t text;
  c text;
  tables text[] := ARRAY['customers','reservations','packages','chart_treatment_requests','patient_file_records','reservation_memo_history'];
  cols   text[] := ARRAY['is_deleted','deleted_at','deleted_by','deleted_reason'];
BEGIN
  -- (1) 대상 테이블 실재
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      v_missing := v_missing || t || ' ';
    END IF;
  END LOOP;
  IF length(v_missing) > 0 THEN
    RAISE EXCEPTION '[DRY-RUN] 대상 테이블 부재: %', v_missing;
  END IF;

  -- (2) ADDITIVE 안전성 — 동명 컬럼이 이미 존재하면 (예상외) 경고. IF NOT EXISTS 로 무해하나 census 재확인 신호.
  FOREACH t IN ARRAY tables LOOP
    FOREACH c IN ARRAY cols LOOP
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=t AND column_name=c) THEN
        v_conflict := v_conflict || t || '.' || c || ' ';
      END IF;
    END LOOP;
  END LOOP;
  IF length(v_conflict) > 0 THEN
    RAISE NOTICE '[DRY-RUN] ⚠ 기존 동명 컬럼 존재(IF NOT EXISTS 로 무해하나 census 재확인 요): %', v_conflict;
  ELSE
    RAISE NOTICE '[DRY-RUN] ✔ 6개 테이블 전건 실재 · 동명 컬럼 충돌 0 · ADDITIVE 안전.';
  END IF;
END $$;

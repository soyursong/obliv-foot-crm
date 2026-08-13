-- ============================================================
-- DRY-RUN (no-persistence) — T-20260813-foot-SOFTDELETE-REACTIVATION-LOCK CARVE-B staff_attendance envelope
-- ============================================================
-- 목적: apply 前 사전검증. (1) staff_attendance 실재 확인 (2) ADDITIVE 안전성(동명 컬럼 부재)
--   (3) two-dialect 오염 가드(stored is_deleted 부재 확인 — Q3 BINDING = deleted_at 단일 dialect).
-- 무영속: 마지막에 강제 ROLLBACK — 어떤 DDL 도 확정하지 않는다(sentinel-bypass 방지 · txn-control 문 미포함).
-- ============================================================

DO $$
DECLARE
  v_conflict text := '';
  c text;
  cols text[] := ARRAY['deleted_at','deleted_by','deleted_reason'];
BEGIN
  -- (1) 대상 테이블 실재
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='staff_attendance') THEN
    RAISE EXCEPTION '[DRY-RUN] 대상 테이블 부재: staff_attendance';
  END IF;

  -- (2) ADDITIVE 안전성 — canonical 3컬럼 동명 존재 시 (예상외) 경고. IF NOT EXISTS 로 무해하나 census 재확인 신호.
  FOREACH c IN ARRAY cols LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='staff_attendance' AND column_name=c) THEN
      v_conflict := v_conflict || 'staff_attendance.' || c || ' ';
    END IF;
  END LOOP;
  IF length(v_conflict) > 0 THEN
    RAISE NOTICE '[DRY-RUN] (예상외) 동명 컬럼 이미 존재(IF NOT EXISTS 로 무해·census 재확인): %', v_conflict;
  ELSE
    RAISE NOTICE '[DRY-RUN] ADDITIVE 안전: deleted_at/deleted_by/deleted_reason 신규 3컬럼.';
  END IF;

  -- (3) two-dialect 오염 가드: stored is_deleted 가 이미 있으면 Q3 BINDING(deleted_at 단일) 위반 신호.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='staff_attendance' AND column_name='is_deleted') THEN
    RAISE WARNING '[DRY-RUN] staff_attendance.is_deleted 존재 → Q3 BINDING(deleted_at 단일 dialect) 위반 신호. census 재확인 필요.';
  END IF;

  -- (4) 실제 DDL 검증(무영속) — IF NOT EXISTS 로 멱등, 이후 강제 ROLLBACK.
  ALTER TABLE staff_attendance
    ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS deleted_by     UUID        NULL,
    ADD COLUMN IF NOT EXISTS deleted_reason TEXT        NULL;

  RAISE NOTICE '[DRY-RUN] ALTER 검증 통과 — 무영속 ROLLBACK 예정.';
  RAISE EXCEPTION '[DRY-RUN] intentional rollback (no-persistence sentinel)';
END $$;

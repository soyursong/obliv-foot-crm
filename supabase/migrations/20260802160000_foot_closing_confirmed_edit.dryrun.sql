-- DRYRUN (no-persistence): T-20260730-foot-DAYCLOSE-CONFIRMED-EDIT-NO-UNLOCK
--   목적: up.sql 의 전제(herald port 소유 DDL 실재 + 편집대상 스키마 실재)를 prod 무영속 검증.
--   Migration Dry-Run No-Persistence Protocol 준수: COMMIT 없음 · 순수 SELECT/RAISE · DDL 미영속.
--   실행: psql -f 이 파일. 전제 위반 시 EXCEPTION. 영속 0.

DO $$
DECLARE
  v_missing TEXT := '';
  v_bad     TEXT := '';
BEGIN
  -- ── 1) up.sql 신설객체는 아직 없어야(멱등 재실행이면 존재 허용) ──
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='closing_edit_log') THEN
    RAISE NOTICE 'INFO: closing_edit_log 이미 존재 — 멱등 재실행(CREATE IF NOT EXISTS 무해)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='closing_confirmed_edit') THEN
    RAISE NOTICE 'INFO: closing_confirmed_edit() 이미 존재 — CREATE OR REPLACE 무해';
  END IF;

  -- ── 2) herald port GOLDEN 소유 DDL 실재(재사용 전제 — 없으면 revision-bump/재발행 불가) ──
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='daily_closings' AND column_name='revision') THEN
    v_missing := v_missing || ' daily_closings.revision(herald port 미적재?)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='daily_closings' AND column_name='unconfirmed_at') THEN
    v_missing := v_missing || ' daily_closings.unconfirmed_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='daily_closings' AND column_name='confirmed_by') THEN
    v_missing := v_missing || ' daily_closings.confirmed_by';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_daily_closing_confirm_guard') THEN
    v_missing := v_missing || ' trigger trg_daily_closing_confirm_guard(revision 규칙)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_enqueue_closing_confirmed') THEN
    v_missing := v_missing || ' trigger trg_enqueue_closing_confirmed(outbox 재발행)';
  END IF;

  -- ── 3) 편집대상 스키마 전제 ──
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='daily_closings' AND column_name='actual_card_total') THEN
    v_missing := v_missing || ' daily_closings.actual_card_total';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='daily_closings' AND column_name='single_card_total') THEN
    v_missing := v_missing || ' daily_closings.single_card_total';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='closing_manual_payments' AND column_name='voided_at') THEN
    v_missing := v_missing || ' closing_manual_payments.voided_at(softvoid 프리미티브)';
  END IF;
  -- 권한/스코프 헬퍼
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_floor_staff') THEN
    v_missing := v_missing || ' is_floor_staff()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    v_missing := v_missing || ' current_user_clinic_id()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='user_profiles') THEN
    v_missing := v_missing || ' user_profiles';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — up.sql 전제 스키마 부재:%', v_missing;
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — 전제 불일치:%', v_bad;
  END IF;

  RAISE NOTICE 'DRYRUN PASS (no-persistence): herald port 소유 DDL + 편집대상 스키마 전부 실재. up.sql 적용 안전. 영속 0.';
END $$;

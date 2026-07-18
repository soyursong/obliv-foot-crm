-- DRYRUN (no-persistence): T-20260718-foot-CLOSING-HERALD-PORT-GOLDEN
-- 목적: up.sql이 의존하는 전제(스키마 실재/미실재)를 prod 무영속으로 검증.
--   Migration Dry-Run No-Persistence Protocol 준수: COMMIT 없음 · 순수 SELECT/RAISE · DDL 미영속.
--   (실 DDL 트라이얼은 supervisor deploy-precheck C11 prod-schema 원자성 게이트에서 별도 수행.)
-- 실행: psql -f 이 파일 — 어떤 assert 든 실패 시 EXCEPTION, 전제 위반 즉시 노출. 영속 0.

DO $$
DECLARE
  v_missing TEXT := '';
  v_bad     TEXT := '';
BEGIN
  -- ── 1) up.sql이 신설할 객체는 아직 없어야(멱등 재실행이면 존재 허용) ──
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='daily_closings' AND column_name='revision') THEN
    RAISE NOTICE 'INFO: daily_closings.revision 이미 존재 — 멱등 재실행(ADD IF NOT EXISTS 무해)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='closing_confirmed_outbox') THEN
    RAISE NOTICE 'INFO: closing_confirmed_outbox 이미 존재 — 멱등 재실행(CREATE IF NOT EXISTS 무해)';
  END IF;

  -- ── 2) up.sql이 의존하는 기존 스키마 전제(반드시 실재해야) ──
  -- daily_closings 버킷/status/close_date
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='daily_closings' AND column_name='actual_card_total') THEN
    v_missing := v_missing || ' daily_closings.actual_card_total';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='daily_closings' AND column_name='actual_transfer_total') THEN
    v_missing := v_missing || ' daily_closings.actual_transfer_total';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='daily_closings' AND column_name='package_card_total') THEN
    v_missing := v_missing || ' daily_closings.package_card_total';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='daily_closings' AND column_name='closed_at') THEN
    v_missing := v_missing || ' daily_closings.closed_at';
  END IF;
  -- status CHECK 에 'closed' 포함(확정 전이 기준)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relname='daily_closings' AND pg_get_constraintdef(c.oid) LIKE '%closed%') THEN
    v_bad := v_bad || ' daily_closings.status CHECK(closed 미포함?)';
  END IF;
  -- clinics.slug (Q6 HARD 게이트 소스)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='clinics' AND column_name='slug') THEN
    v_missing := v_missing || ' clinics.slug';
  END IF;
  -- payments 조인 컬럼
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='payments' AND column_name='check_in_id') THEN
    v_missing := v_missing || ' payments.check_in_id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='payments' AND column_name='method') THEN
    v_missing := v_missing || ' payments.method';
  END IF;
  -- check_ins.checked_in_at (날짜 귀속)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='check_ins' AND column_name='checked_in_at') THEN
    v_missing := v_missing || ' check_ins.checked_in_at';
  END IF;
  -- reservations.source_system (유입축)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='reservations' AND column_name='source_system') THEN
    v_missing := v_missing || ' reservations.source_system';
  END IF;
  -- service_charges 보험축(급여 split)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='service_charges' AND column_name='is_insurance_covered') THEN
    v_missing := v_missing || ' service_charges.is_insurance_covered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='service_charges' AND column_name='insurance_covered_amount') THEN
    v_missing := v_missing || ' service_charges.insurance_covered_amount';
  END IF;
  -- foot 이디엄 helper
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_vault_secret') THEN
    v_missing := v_missing || ' get_vault_secret()';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — up.sql 전제 스키마 부재:%', v_missing;
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'DRYRUN FAIL — 전제 불일치:%', v_bad;
  END IF;

  -- ── 3) Q6 preflight 미리보기(slug 현황) ──
  RAISE NOTICE 'DRYRUN Q6 preflight: clinics slug 현황 = %',
    (SELECT jsonb_agg(jsonb_build_object('name', name, 'slug', slug)) FROM public.clinics);

  RAISE NOTICE 'DRYRUN PASS (no-persistence): 전제 스키마 전부 실재. up.sql 적용 안전. 영속 0.';
END $$;

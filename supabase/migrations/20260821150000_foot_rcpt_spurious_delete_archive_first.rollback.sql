-- ============================================================================
-- ROLLBACK — T-20260715-foot-RCPT-SPURIOUS-DELETE
-- 아카이브(_archive_rcpt_spurious_*_20260715)에서 4 customers + aicc 원복 (순소실0 복구).
-- jsonb_populate_record 로 메타컬럼(_archived_at/_ticket) 제외 + 컬럼드리프트 무관 복원.
-- 멱등: 이미 존재하는 id 는 건너뜀. 재실행 안전.
-- 주의: parent(customers) 먼저 복원 → 그다음 aicc(비FK지만 논리적 자식) 복원.
-- ============================================================================
BEGIN;

DO $rb$
DECLARE
  tgt uuid[] := ARRAY[
    'a939ec01-859e-462a-8a47-eb8db90b16bf',
    '2db50bad-e200-4d13-ac2e-2356f8bb136a',
    'a22437a5-6602-4d43-a2f6-5e26b8aac727',
    '7fe8dbdd-702d-4f48-abc2-3dfc0cf97fda']::uuid[];
  n_c int; n_a int;
BEGIN
  IF to_regclass('public._archive_rcpt_spurious_customers_20260715') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK 불가: 아카이브 테이블 부재 — 복원 원천 없음';
  END IF;

  -- 1) customers 복원 (parent first)
  INSERT INTO customers
  SELECT (jsonb_populate_record(NULL::customers,
            to_jsonb(a) - '_archived_at' - '_ticket')).*
  FROM _archive_rcpt_spurious_customers_20260715 a
  WHERE a.id = ANY(tgt)
    AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = a.id);
  GET DIAGNOSTICS n_c = ROW_COUNT;

  -- 2) aicc_crm_phone_match 복원 (child)
  INSERT INTO aicc_crm_phone_match
  SELECT (jsonb_populate_record(NULL::aicc_crm_phone_match,
            to_jsonb(a) - '_archived_at' - '_ticket')).*
  FROM _archive_rcpt_spurious_aicc_20260715 a
  WHERE a.customer_id = ANY(tgt)
    AND NOT EXISTS (
      SELECT 1 FROM aicc_crm_phone_match m
      WHERE m.customer_id = a.customer_id AND m.phone IS NOT DISTINCT FROM a.phone);
  GET DIAGNOSTICS n_a = ROW_COUNT;

  RAISE NOTICE 'ROLLBACK 복원: customers=% aicc=%', n_c, n_a;
END
$rb$;

COMMIT;

-- 아카이브 테이블 폐기는 별도 판단(TTL·감사) — 본 롤백은 데이터 복원까지만.
-- 필요시 수동: DROP TABLE IF EXISTS _archive_rcpt_spurious_customers_20260715, _archive_rcpt_spurious_aicc_20260715;

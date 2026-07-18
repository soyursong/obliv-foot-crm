-- ROLLBACK: T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR-BACKFILL (data lane)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- ============================================================
-- 가역성: 백필 apply 는 batch memo 태그로 append 한 ledger charge tx 뿐이므로,
--   rollback = 동일 batch 태그 행 DELETE(순소실 0 — 재적재분만 제거, 원 credit 근거인
--   payments/package_payments/paid_amount 는 애초에 무접점이라 원복 불요).
--   package_credit_ledger 는 append-only RLS(UPDATE/DELETE 정책 없음)지만 마이그는 postgres 권한
--   → RLS 우회 정상. (운영 정정은 반대부호 tx 가 원칙이나, 백필 batch 회수는 태그 DELETE 가 정확·안전.)
-- ============================================================

BEGIN;

-- 삭제 대상 사전 확인(감사 근거)
DO $chk$
DECLARE v_cnt INTEGER; v_sum BIGINT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(amount),0) INTO v_cnt, v_sum
  FROM public.package_credit_ledger
  WHERE memo LIKE '[BACKFILL:T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR]%'
    AND tx_type = 'charge' AND reanchored_from IS NOT NULL;
  RAISE NOTICE 'ROLLBACK: batch re-anchor % 건 / % 원 제거 예정', v_cnt, v_sum;
END $chk$;

DELETE FROM public.package_credit_ledger
WHERE memo LIKE '[BACKFILL:T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR]%'
  AND tx_type = 'charge'
  AND reanchored_from IS NOT NULL;

-- 사후: batch 잔존 0 확인
DO $post$
DECLARE v_left INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_left FROM public.package_credit_ledger
  WHERE memo LIKE '[BACKFILL:T-20260715-foot-PKG-CREDIT-ORPHAN-REANCHOR]%';
  IF v_left <> 0 THEN RAISE EXCEPTION 'ROLLBACK-FAIL: batch 잔존 % 건', v_left; END IF;
  RAISE NOTICE 'ROLLBACK-OK: batch re-anchor 전량 제거(순소실 0)';
END $post$;

COMMIT;

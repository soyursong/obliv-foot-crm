-- ══════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260708-foot-REDPAY-CLOSING-TAB read-layer
-- ══════════════════════════════════════════════════════════════════
-- ADDITIVE-ONLY(CREATE VIEW/FUNC) 의 역연산 = DROP 만. 기존 테이블·컬럼·원장 무접촉이므로
-- 롤백은 순수 제거이며 데이터 손실 0(뷰/함수는 파생 read-layer).
-- ══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_redpay_feed_freshness();
DROP VIEW IF EXISTS public.v_redpay_reconciliation_daily;

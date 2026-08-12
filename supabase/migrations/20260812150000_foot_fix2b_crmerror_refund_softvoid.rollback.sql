-- ROLLBACK — T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID
--   soft-void 되돌림: 이 티켓이 cancelled 로 만든 정확히 그 3행만 active 로 환원.
--   cancelled_by = 이 티켓 술어로 가드 → 다른 사유의 cancel(예: MATAEMIN)은 절대 건드리지 않음.
--   재실행 안전(없으면 0-row). roll-forward = up.sql 재적용.
-- ⚠ 순수 DML(트랜잭션 제어문 없음). rollback 시 FE/집계는 status='active' 만 보므로 코드 롤백 불요(DML-only).

DO $fix2b_rb$
DECLARE
  v_restored int;
BEGIN
  UPDATE public.payments
     SET status        = 'active',
         cancelled_at  = NULL,
         cancelled_by  = NULL,
         cancel_reason = NULL
   WHERE id IN (
           '2dedc31e-109d-46c6-b592-afe25b8d46b0',
           '1799c939-a810-481d-ae41-1d50937e180b',
           'ea1f5000-b48c-4ddd-9faa-23925a27d40f'
         )
     AND status       = 'cancelled'
     AND cancelled_by = 'dev-foot:T-20260811-foot-CONSULTANT-REVENUE-FIX2B-SOFTVOID';  -- 이 티켓 소행만

  GET DIAGNOSTICS v_restored = ROW_COUNT;
  IF v_restored NOT IN (0, 3) THEN
    RAISE EXCEPTION 'FIX2B_ROLLBACK_ROWCOUNT_ABORT: expected 0 or 3, got %', v_restored;
  END IF;
  RAISE NOTICE 'FIX2B rollback OK: restored=%', v_restored;
END
$fix2b_rb$;

-- 원장 등재 되돌림(apply 시 등재했다면):
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260812150000';

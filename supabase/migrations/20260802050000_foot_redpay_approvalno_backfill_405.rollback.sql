-- ROLLBACK — T-20260730-foot-REDPAY-APPROVALNO-BACKFILL-405 (되돌림)
--   20260802050000_foot_redpay_approvalno_backfill_405.sql 원복.
--   author: dev-foot / 2026-08-02
--
-- ⚠ forward-only 원칙상 통상 롤백 불필요(ADDITIVE NULL→value, 하류 무영향). 긴급 원복이 필요할 때만 사용.
--   원복 = 백필이 채운 정확한 집합(_backup 스냅샷)에 대해서만 external_approval_no 를 사전 상태(NULL)로 재설정.
--   ★_backup 스냅샷의 filled_approval_no 와 현재 값이 일치하는 행만 재-NULL(그 사이 스태프가 수기입력/포워드픽스로
--     다른 값을 넣었으면 건드리지 않음 — 사후 정당 입력 보호).
-- =====================================================

BEGIN;

DO $$
DECLARE
  v_reverted int;
  v_snap_cnt int;
BEGIN
  IF to_regclass('_backup.foot_redpay_approvalno_backfill_405_20260802') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ABORT: _backup 스냅샷 테이블 부재 — 원복 원천 없음(백필 미실행 or 스냅샷 유실)';
  END IF;

  SELECT count(*) INTO v_snap_cnt FROM _backup.foot_redpay_approvalno_backfill_405_20260802;

  -- 백필이 채운 값과 현재 값이 동일한 행만 사전 상태(prior=NULL)로 재설정.
  UPDATE public.payments p
  SET external_approval_no = b.prior_external_approval_no   -- = NULL (백필 대상 predicate 상)
  FROM _backup.foot_redpay_approvalno_backfill_405_20260802 b
  WHERE p.id = b.payment_id
    AND p.external_approval_no IS NOT DISTINCT FROM b.filled_approval_no;
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  RAISE NOTICE 'ROLLBACK OK: % / % 행 재-NULL(스냅샷 대비). 차이=사후 수기입력/포워드픽스 값(보호, 미변경).',
    v_reverted, v_snap_cnt;
END $$;

COMMIT;

-- (선택) 스냅샷 정리 — 원복 검증 후 수동:
--   DROP TABLE IF EXISTS _backup.foot_redpay_approvalno_backfill_405_20260802;
--   DROP TABLE IF EXISTS _backup.foot_redpay_approvalno_ambiguous_20260802;

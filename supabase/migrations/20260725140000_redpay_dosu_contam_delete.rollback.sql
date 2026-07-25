-- ROLLBACK — T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트B (재작성: child-first 818행급 역연산)
--   20260725140000_redpay_dosu_contam_delete.sql 역연산 — 삭제된 도수 오염 parent(raw 2) + child(recon_log N) 원복.
--
-- 복원 원천 = apply 러너가 파괴 前 off-git _backup 에 선적재한 archive(archive-first 1단):
--   _backup.redpay_dosu_contam_raw_20260725       (삭제된 redpay_raw_transactions parent 2행 전체 컬럼)
--   _backup.redpay_dosu_contam_reconlog_20260725  (삭제된 payment_reconciliation_log child N행 전체 컬럼)
-- archive 테이블이 없으면(=apply 미실행/스냅샷 부재) no-op(안전).
--
-- ★복원 순서 = parent 先 → child 後 (FK 무결성: recon_log.raw_transaction_id → raw(id) 이므로 raw 先 복원해야
--   child 의 FK 참조가 성립. 삭제는 child-first, 복원은 parent-first — 역순).
-- ⚠ 원복 후 prod 상태 = 적용 전(도수 오염 parent 2 + child N 복귀). 순소실 0 — 대상은 도수 test telemetry(net~0).
--   원복은 '재오염'을 의미하므로, 재적용 필요 시 파트A merchant-drop 배포 후 재확인.
-- author: dev-foot / 2026-07-25 (재작성)

BEGIN;

DO $$
DECLARE
  v_arch_parent regclass := to_regclass('_backup.redpay_dosu_contam_raw_20260725');
  v_arch_child  regclass := to_regclass('_backup.redpay_dosu_contam_reconlog_20260725');
  v_rp int := 0;
  v_rc int := 0;
BEGIN
  IF v_arch_parent IS NULL AND v_arch_child IS NULL THEN
    RAISE NOTICE 'DOSU-CONTAM-FIX rollback no-op: _backup archive 부재(apply 미실행 추정)';
    RETURN;
  END IF;

  -- parent 先 복원 (FK 성립 선결)
  IF v_arch_parent IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO public.redpay_raw_transactions
      SELECT * FROM _backup.redpay_dosu_contam_raw_20260725
      ON CONFLICT (id) DO NOTHING
    $q$;
    GET DIAGNOSTICS v_rp = ROW_COUNT;
  END IF;

  -- child 後 복원
  IF v_arch_child IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO public.payment_reconciliation_log
      SELECT * FROM _backup.redpay_dosu_contam_reconlog_20260725
      ON CONFLICT (id) DO NOTHING
    $q$;
    GET DIAGNOSTICS v_rc = ROW_COUNT;
  END IF;

  RAISE NOTICE 'DOSU-CONTAM-FIX rollback OK: parent(raw) % 행 + child(recon_log) % 행 재삽입 원복 (approval_no=62071914)',
    v_rp, v_rc;
END $$;

COMMIT;

-- ROLLBACK — T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트B
--   (20260725140000_redpay_dosu_contam_delete.sql 역연산 — 삭제된 도수 오염 2행 원복)
--
-- 복원 원천 = apply 러너가 파괴 前 off-git _backup 에 선적재한 archive(archive-first 1단):
--   _backup.redpay_dosu_contam_62071914_20260725 (삭제된 redpay_raw_transactions 2행 전체 컬럼).
-- archive 테이블이 없으면(=apply 미실행/스냅샷 부재) no-op(안전).
--
-- ⚠ 원복 후 prod 상태 = 적용 전(도수 오염 2행 복귀). 순소실 0 — 대상은 도수 test 2행뿐(net~0).
--   단 원복은 '재오염'을 의미하므로, 재적용 필요 시 파트A merchant-drop 배포 후 재pull 로 자연 미유입 확인.
-- author: dev-foot / 2026-07-25

BEGIN;

DO $$
DECLARE
  v_has_backup boolean;
  v_restored   int := 0;
BEGIN
  SELECT to_regclass('_backup.redpay_dosu_contam_62071914_20260725') IS NOT NULL INTO v_has_backup;
  IF NOT v_has_backup THEN
    RAISE NOTICE 'DOSU-CONTAM-FIX rollback no-op: _backup archive 부재(apply 미실행 추정)';
    RETURN;
  END IF;

  -- archive 전체 컬럼 재삽입 (이미 있으면 skip — 멱등)
  INSERT INTO public.redpay_raw_transactions
  SELECT * FROM _backup.redpay_dosu_contam_62071914_20260725
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  RAISE NOTICE 'DOSU-CONTAM-FIX rollback OK: 도수 오염 % 행 재삽입 원복 (approval_no=62071914)', v_restored;
END $$;

COMMIT;

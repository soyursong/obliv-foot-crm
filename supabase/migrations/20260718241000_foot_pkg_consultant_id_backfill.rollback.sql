-- ROLLBACK — T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE (Phase 1 백필)
--   백필분(+ 이후 트리거 신규분) consultant_id → NULL 복원. 데이터 순소실 0
--   (귀속키만 소실, 원장 package_payments·앵커 check_ins 무접점 → heuristic 재산출 가능).
--   ※ 통상 Phase 1 롤백은 capture.rollback.sql(DROP COLUMN)이 전량 제거 → 본 파일은
--     "컬럼·트리거는 유지하되 데이터만 되돌릴 때"의 data-only 복원.
-- author: dev-foot / 2026-07-18

BEGIN;

UPDATE public.packages
   SET consultant_id = NULL
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND consultant_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

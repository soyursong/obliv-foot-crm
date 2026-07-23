-- ROLLBACK: T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY
--   hold-registry 가드(테이블+함수+트리거) 신규 생성만 되돌린다.
--   ⚠ 되돌리면 dummy-normalize hold 보호(fail-closed)가 해제된다 → 재적용 전 freeze-window 무결성 재확인.
--   ⚠ 롤백 전 레지스트리에 active hold 가 있으면(진행 중 cleanup/forensics) 그 보호가 사라지므로,
--     롤백은 진행 중 hold 없음을 확인한 뒤에만(또는 blocks 트랙 정지 창에서만).
-- ADDITIVE 롤백 = DROP 3종. 기존 스키마/데이터 미변경(테이블 자체가 신규이므로 DROP 으로 순손실 0).
BEGIN;

DROP TRIGGER IF EXISTS trg_data_correction_hold_guard ON public.customers;
DROP FUNCTION IF EXISTS public.fn_data_correction_hold_guard();
DROP TABLE IF EXISTS public.data_correction_hold_registry;   -- uq_hold_active 인덱스 동반 제거

NOTIFY pgrst, 'reload schema';

COMMIT;

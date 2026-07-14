-- Rollback: T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH
-- 신규 함수 refund_package_payment 제거 (ADDITIVE 역). 기존 refund_package_atomic 은 무접점.
-- 주의: 롤백 후 FE 패키지 환불 분기는 배포 전 상태(refund_package_atomic)로 함께 되돌려야 함.

DROP FUNCTION IF EXISTS refund_package_payment(UUID, TEXT);

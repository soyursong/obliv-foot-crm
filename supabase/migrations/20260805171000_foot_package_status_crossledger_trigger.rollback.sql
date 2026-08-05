-- ROLLBACK: T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §2
-- 20260805171000_foot_package_status_crossledger_trigger.sql 역연산.
--   신규 트리거 2개 + 신규 함수 2개 DROP. 순수 additive 역연산 → 데이터/스키마 유실 0.
--   ⚠ 배포순서: 트리거 먼저 DROP(함수 의존 제거) → 함수 DROP.
--   ⚠ 트리거 롤백 시 refund_package_payment(§3 delegate 버전)의 단방향 파생도 이미 제거된
--      상태이므로, 트리거 롤백은 §3 refund RPC 롤백과 함께 수행(status 파생 authority 공백 방지).

BEGIN;

DROP TRIGGER IF EXISTS trg_payments_pkg_status_recompute ON public.payments;
DROP TRIGGER IF EXISTS trg_pkgpay_pkg_status_recompute ON public.package_payments;

DROP FUNCTION IF EXISTS public.foot_trg_recompute_package_status();
DROP FUNCTION IF EXISTS public.foot_recompute_package_status(uuid);

COMMIT;

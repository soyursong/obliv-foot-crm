-- ============================================================
-- ROLLBACK: foot POS 스키마 정합 + PCI/PII 가드
-- Ticket: T-20260703-foot-POS-FORK-SCHEMA-ALIGN
-- ============================================================
-- ⚠️ 주의:
--   1) 이 롤백은 pos_* 3컬럼을 제거한다. fork POS FE 계약이 foot 에 이식·활성된 뒤
--      제거하면 결제 insert 가 42703 으로 실패한다(실수납 재차단). POS 세트 전체를
--      되돌릴 때만 실행할 것. (2026-07-03 기준 foot FE 는 pos_* 미전송 → 안전)
--   2) 트리거/가드 함수 제거 시 pos_response 원문 민감정보 차단이 해제된다.
--      컬럼은 유지하고 가드만 되돌리려면 하단 [가드만 롤백] 블록만 실행.
-- ADDITIVE 롤백 = drop. 데이터 유실: pos_provider/pos_transaction_id/pos_response 값.
-- ============================================================

BEGIN;

-- [가드만 롤백] — 트리거 + 가드/헬퍼 함수 제거
DROP TRIGGER IF EXISTS trg_payments_pos_pci_guard         ON public.payments;
DROP TRIGGER IF EXISTS trg_package_payments_pos_pci_guard ON public.package_payments;
DROP FUNCTION IF EXISTS public.foot_pos_response_pci_guard();
DROP FUNCTION IF EXISTS public.foot_is_luhn(text);

-- [컬럼 롤백] — pos_* 3컬럼 제거 (foot 은 본 migration 으로 최초 추가 → 제거가 정확한 역연산)
ALTER TABLE public.payments
  DROP COLUMN IF EXISTS pos_provider,
  DROP COLUMN IF EXISTS pos_transaction_id,
  DROP COLUMN IF EXISTS pos_response;

ALTER TABLE public.package_payments
  DROP COLUMN IF EXISTS pos_provider,
  DROP COLUMN IF EXISTS pos_transaction_id,
  DROP COLUMN IF EXISTS pos_response;

COMMIT;

NOTIFY pgrst, 'reload schema';

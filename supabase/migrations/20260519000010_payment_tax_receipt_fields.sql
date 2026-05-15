-- T-20260515-foot-RECEIPT-TAX-SPLIT AC-3
-- payments 테이블에 현금영수증·과세/비과세 컬럼 추가
-- 모두 nullable — 기존 데이터 소급 불필요, 기존 수납 플로우 불변

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS cash_receipt_issued  boolean       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cash_receipt_type    text          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cash_receipt_number  text          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS taxable_amount       numeric(12,0) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tax_exempt_amount    numeric(12,0) DEFAULT NULL;

-- cash_receipt_type 값 제한 (NULL 허용)
ALTER TABLE public.payments
  ADD CONSTRAINT payments_cash_receipt_type_check
    CHECK (cash_receipt_type IS NULL OR cash_receipt_type IN ('income_deduction', 'expense_proof'));

COMMENT ON COLUMN public.payments.cash_receipt_issued  IS '현금영수증 발행여부 (현금 결제 시)';
COMMENT ON COLUMN public.payments.cash_receipt_type    IS '현금영수증 유형: income_deduction(소득공제용), expense_proof(지출증빙용)';
COMMENT ON COLUMN public.payments.cash_receipt_number  IS '현금영수증 발행번호 (전화번호 또는 사업자번호)';
COMMENT ON COLUMN public.payments.taxable_amount       IS '과세 금액 (부가세 대상)';
COMMENT ON COLUMN public.payments.tax_exempt_amount    IS '비과세(면세) 금액';

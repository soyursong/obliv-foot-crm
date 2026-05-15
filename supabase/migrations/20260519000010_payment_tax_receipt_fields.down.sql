-- T-20260515-foot-RECEIPT-TAX-SPLIT AC-3 rollback
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_cash_receipt_type_check,
  DROP COLUMN IF EXISTS cash_receipt_issued,
  DROP COLUMN IF EXISTS cash_receipt_type,
  DROP COLUMN IF EXISTS cash_receipt_number,
  DROP COLUMN IF EXISTS taxable_amount,
  DROP COLUMN IF EXISTS tax_exempt_amount;

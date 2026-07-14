-- T-20260714-foot-DAYCLOSE-MANUAL-PAY-CUSTBOX-UNPAID-SYNC — Part1 F-4695 ROLLBACK
-- 옵션A 정본화의 완전 역연산 (net-zero 복원).
-- 전제: apply 스크립트가 집행한 상태에서만 유효. 재실행 안전(멱등).
--
-- FROZEN SET:
--   customer_id = a07a3079-69ba-415a-a0f8-61e8d0921168 (F-4695 이미현)
--   package_id  = e55c868d-7b39-4b50-a98e-305d2353152d (12회권)
--   manual_id   = d993ffc5-8c9b-4ef8-a1cf-df73b51aaba5 (2,890,000 card 송지현 11:09)

BEGIN;

-- (c') closing_manual_payments 복원 (apply 시 DELETE 했던 임시 수기행 재삽입)
INSERT INTO closing_manual_payments
  (id, clinic_id, close_date, pay_time, chart_number, customer_name, lead_source, visit_type, staff_name, amount, method, memo, created_at)
VALUES
  ('d993ffc5-8c9b-4ef8-a1cf-df73b51aaba5',
   '74967aea-a60b-4da3-a0e7-9c997a930bc8',
   '2026-07-14', '11:09', 'F-4695', '이미현', NULL, 'new', '송지현',
   2890000, 'card', NULL, '2026-07-14T11:09:00+09:00')
ON CONFLICT (id) DO NOTHING;

-- (a') package_payments 정본화행 제거 (opt-A 마커로 식별)
DELETE FROM package_payments
WHERE package_id = 'e55c868d-7b39-4b50-a98e-305d2353152d'
  AND memo = '일마감 수기결제 정본화(F-4695, opt-A) T-20260714-DAYCLOSE-MANUAL-PAY';

-- (b') packages.paid_amount 재집계 (남은 package_payments 기준 = 0 복원)
UPDATE packages p
SET paid_amount = COALESCE((
  SELECT SUM(CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END)
  FROM package_payments pp WHERE pp.package_id = p.id
), 0)
WHERE p.id = 'e55c868d-7b39-4b50-a98e-305d2353152d';

COMMIT;

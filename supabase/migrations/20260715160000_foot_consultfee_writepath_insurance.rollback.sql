-- ROLLBACK: T-20260715-foot-CONSULTFEE-WRITEPATH-INSURANCE-SPLIT
-- ADDITIVE 롤백 — 신규 RPC DROP + 신규 컬럼 DROP. 기존 행/컬럼 무영향.
-- ⚠ payments.service_charge_id 는 parent C4 canonical 공유 컬럼.
--   parent(read-side FIX)가 이미 사용 중이면 DROP 금지(공유 자원) — 본 티켓 단독 롤백 시엔 아래 DROP 유효,
--   parent 배포 후에는 컬럼 유지(RPC 만 DROP). 상황에 맞게 선택 적용.

DROP FUNCTION IF EXISTS record_insurance_consult_payment(UUID, UUID, UUID, UUID, TEXT, DATE);

DROP INDEX IF EXISTS idx_payments_service_charge;

-- parent C4 미배포 상태에서 본 티켓 단독 롤백일 때만 컬럼 DROP.
ALTER TABLE payments DROP COLUMN IF EXISTS service_charge_id;

ALTER TABLE service_charges DROP COLUMN IF EXISTS hira_unit_value_year;

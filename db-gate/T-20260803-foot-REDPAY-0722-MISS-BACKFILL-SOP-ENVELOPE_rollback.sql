-- T-20260803-foot-REDPAY-0722-MISS-BACKFILL-SOP-ENVELOPE — 폴백(rollback)
-- ─────────────────────────────────────────────────────────────────────────────
-- 소급 재적재한 정확히 2행만 idempotency-key(external_trxid,external_status,amount)
-- 스코프로 되돌린다. freeze-set 밖은 절대 건드리지 않음(단일-count blanket 금지).
-- 원장(payments/reconcile/ledger) 무접점 — redpay_raw_transactions 단일.
--
-- 실행 전 확인(SELECT)로 정확히 2행인지 검증 후 DELETE. 사람 실행 전용.

BEGIN;

-- (1) 되돌릴 대상 사전 확인 — 반드시 2행이어야 함
SELECT external_trxid, external_status, amount, tid, approved_at
FROM   public.redpay_raw_transactions
WHERE  clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND  tid = '1047479158'
  AND  (external_trxid, external_status, amount) IN (
         ('0722C8038056', 'Y',  5000),
         ('0722C8038132', 'N', -5000)
       );

-- (2) 위 SELECT 가 정확히 2행일 때만 아래 DELETE 실행(수동 확인 게이트)
DELETE FROM public.redpay_raw_transactions
WHERE  clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
  AND  tid = '1047479158'
  AND  (external_trxid, external_status, amount) IN (
         ('0722C8038056', 'Y',  5000),
         ('0722C8038132', 'N', -5000)
       );

-- 예상 삭제행: 2. 다르면 ROLLBACK.
-- COMMIT;  -- 2행 확인 후 주석 해제
ROLLBACK;  -- 기본 안전 — 확인 전 무영속

-- ROLLBACK: T-20260811-foot-CHARTEDIT-TRIAL-PRICE-BACKFILL
-- 가역(reversible). apply 후 이상 시 before-image(unit_price=0)로 원복.
-- per-row·freeze only. 4 PK 외 무접촉. 원장(payments/purchase/service_charges) 무접촉.
BEGIN;

UPDATE package_sessions SET unit_price = 0 WHERE id = '57398393-4911-4eb0-a413-d8440b6b2b04'; -- 차민주 F-5537
UPDATE package_sessions SET unit_price = 0 WHERE id = '63157a7a-88bc-472c-9633-6aa710ca1373'; -- 우경아 F-5668
UPDATE package_sessions SET unit_price = 0 WHERE id = 'd29b8665-910f-4c6b-8296-cd17f0a80823'; -- 정석현 F-5727
UPDATE package_sessions SET unit_price = 0 WHERE id = 'b9eed069-ca0d-454e-b3a9-ed3d17353060'; -- 강득중 F-5538

-- 검증: 4행만 영향 확인 후 COMMIT
COMMIT;

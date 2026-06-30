-- ROLLBACK — T-20260630-foot-DOCCONFIRM-PRICEBRANCH-RELABEL (B안 relabel 슬라이스)
-- 가격 미변경(B안=mutate 0) → 롤백 = category_label 제증명→기본 복원만. service_charges/payments 무영향.
-- §2 bridge 는 forward 미적용(HOLD) → 롤백 대상 무. DA GO 후 bridge 구현 시 본 파일에 역연산 추가.

BEGIN;

-- 1 역: 진료확인서 2 SKU category_label 제증명→기본 복원 (가격 불변)
UPDATE services
   SET category_label = '기본'
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code IN ('진료확인서1', '진료확인서2')
   AND category_label = '제증명';

COMMIT;

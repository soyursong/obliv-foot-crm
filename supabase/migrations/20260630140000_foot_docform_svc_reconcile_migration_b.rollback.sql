-- ROLLBACK — T-20260617-foot-DOCFORM-POPUP-OVERHAUL Migration B
-- 주의: 진료의뢰서 가격 0→3000은 forward-only(과거 service_charges 무영향). 롤백 시 라이브 단가만 0 복원.
--   적용 후 발급된 비급여 charge(3,000)는 service_charges/payments에 스냅샷 보존됨 → 롤백해도 과거 매출 불변(C1 forward-only).
-- 무료 4종 INSERT 롤백: 발급 link(form_templates.service_id) 먼저 NULL 처리 후 행 삭제(FK ON DELETE SET NULL이라 삭제 가능하나 명시).

BEGIN;

-- 6 역: form_templates.service_id 백필 해제
UPDATE form_templates
   SET service_id = NULL
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND form_key IN ('bill_receipt','bill_detail','koh_result','rx_standard',
                    'diag_opinion','opinion_doc','diag_opinion_v2','diagnosis',
                    'referral_letter','visit_confirm','medical_record_request');

-- 4 역: pricing_tiers 해제
UPDATE services SET pricing_tiers = NULL
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8' AND service_code = '진료기록사본1';

-- 3 역: category_label 제증명→기본 복원
UPDATE services SET category_label = '기본'
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code IN ('C5900002','진단서(영문)','진료소견서','소견서(영문)','통원확인서','진료기록사본1');

-- 2 역: 진료의뢰서 가격 3000→0 복원 (forward-only — 과거 charge 무영향)
UPDATE services SET price = 0, category_label = '기본'
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code = '진료의뢰서' AND price = 3000;

-- 1 역: 무료 4종 행 삭제 (FK ON DELETE SET NULL — link 자동 해제)
DELETE FROM services
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND service_code IN ('cert_bill_receipt','cert_bill_detail','cert_koh_result','cert_rx_standard');

COMMIT;

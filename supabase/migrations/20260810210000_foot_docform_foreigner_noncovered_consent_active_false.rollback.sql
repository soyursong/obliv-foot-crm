-- ROLLBACK — T-20260810-foot-FOREIGNER-NONCOVERED-CONSENT-PENCHART-REPLACE
-- 외국인 비급여 진료 동의서 seed row 재활성화(active=true 복원).
-- 주의: 코드측 de-list(DOCLIST_ORDER_10/DOC_CATEGORY_CONSENT_KEYS/FALLBACK active=false)까지 되돌려야
--   서류 발행 화면 재노출이 완성됨(본 롤백은 DB 플래그만 복원).
UPDATE form_templates
SET active = true
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
  AND form_key = 'foreigner_noncovered_consent'
  AND active = false;

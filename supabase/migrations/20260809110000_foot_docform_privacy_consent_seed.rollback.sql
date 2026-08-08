-- ROLLBACK — T-20260808-foot-PENCHART-PRIVACY-CONSENT-FORM seed row 제거.
-- scoped DELETE (clinic_id + form_key). 발행 이력(form_submissions)은 별 테이블이라 무접촉.
-- 안전: 이 form_key로 발행된 서류가 있으면 template 삭제 전 확인(발행이력 보존 원칙). 개인정보 수집·이용
--   동의서는 신규라 배포 직후 발행 0 → 롤백 무손실.
DELETE FROM form_templates
WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
  AND form_key = 'privacy_consent_form';

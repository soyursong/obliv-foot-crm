-- T-20260808-foot-FOREIGNER-NONCOVERED-CONSENT-FORM
-- 외국인 비급여 진료 동의서 form_templates ADDITIVE seed row (무DDL — 순수 데이터 INSERT).
--
-- 근거: 운영 form_templates(foot-service)는 다수 행 실재 → FALLBACK 미사용(footDbTpls>0 경로).
--   신규 서류 목록 노출엔 (a)DOCLIST_ORDER_10 화이트리스트 + '동의서' 그룹(코드, 배포) + (b)본 seed row 둘 다 필요.
-- 성격: ADDITIVE only. 스키마 무변경(신규 컬럼/테이블/enum 없음) → 파괴 0. 기존 서류/동의서 무접점.
-- 자동채움: patient_name(성명)·issue_date(발행일=오늘) — autoBindContext SSOT. 서명=수기(빈칸, field_map 미포함).
-- 멱등: 동일 (clinic_id, form_key) 존재 시 no-op(WHERE NOT EXISTS). 재실행 안전.
-- 롤백: 20260809100000_..._seed.rollback.sql (scoped DELETE).
-- dry-run: 20260809100000_..._seed.dryrun.sql (무영속 검증).

INSERT INTO form_templates
  (clinic_id, category, form_key, name_ko, template_path, template_format,
   field_map, requires_signature, required_role, active, sort_order)
SELECT
  '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,
  'foot-service',
  'foreigner_noncovered_consent',
  '외국인 비급여 진료 동의서',
  '',
  'html',
  '[
    {"key":"patient_name","label":"성명","type":"text","x":0,"y":0},
    {"key":"issue_date","label":"발행일","type":"date","x":0,"y":0}
  ]'::jsonb,
  false,
  'admin|manager|coordinator|therapist',
  true,
  120
WHERE NOT EXISTS (
  SELECT 1 FROM form_templates
  WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND form_key = 'foreigner_noncovered_consent'
);

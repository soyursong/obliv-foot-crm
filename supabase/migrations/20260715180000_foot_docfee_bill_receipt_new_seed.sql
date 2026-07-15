-- T-20260714-foot-DOCFEE-BODYCENTER-REDESIGN — 진료비 계산서·영수증 '신양식' form_templates seed
--
-- 목적(Option A, planner adjudicate MSG-x402): 신양식(form_key=bill_receipt_new)을 운영 서류목록에
--   노출 + form_submissions.template_id(UUID NOT NULL FK) 발행이력 정합 확보. 코드-only fallback 만으로는
--   footDbTpls.length>0 경로에서 목록 미노출 + 합성 id 발행 시 FK 위반 → DB row 1건 seed 필수.
--
-- 대상 clinic: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (오블리브의원 서울오리진점 = jongno-foot)
-- 성격: ADDITIVE 데이터 seed (신규 컬럼/테이블/enum 아님·기존 row 무변경). DDL 없음(DML only).
-- 격리(AC5): 기존 bill_receipt(sort 35) row/렌더 완전 무접촉. 신 form_key 전용 1건 추가.
-- 멱등: ON CONFLICT (clinic_id, form_key) DO UPDATE — 재실행 시 메타만 동기화, 타 row 무영향.
-- AC3(정정): 대표자란 = 개설자 박영진(clinics.representative_name canonical) → {{receipt_representative}} 토큰.
--   field_map 은 FALLBACK_TEMPLATES(formTemplates.ts:bill_receipt_new)와 1:1 정합.
-- 롤백: 20260715180000_foot_docfee_bill_receipt_new_seed.rollback.sql (DELETE by clinic_id+form_key).

INSERT INTO public.form_templates (
  clinic_id, category, form_key, name_ko,
  template_path, template_format, field_map,
  requires_signature, required_role, active, sort_order
) VALUES (
  '74967aea-a60b-4da3-a0e7-9c997a930bc8',
  'foot-service',
  'bill_receipt_new',
  '진료비 계산서·영수증(신양식)',
  '',
  'html',
  '[
    {"key":"patient_name","label":"환자성명","type":"text","x":0,"y":0},
    {"key":"patient_birthdate","label":"생년월일","type":"text","x":0,"y":0},
    {"key":"record_no","label":"환자등록번호","type":"text","x":0,"y":0},
    {"key":"visit_date","label":"진료기간","type":"date","x":0,"y":0},
    {"key":"clinic_name","label":"상호","type":"text","x":0,"y":0},
    {"key":"clinic_address","label":"사업장소재지","type":"text","x":0,"y":0},
    {"key":"copayment","label":"본인부담금","type":"amount","x":0,"y":0},
    {"key":"insurance_covered","label":"공단부담금","type":"amount","x":0,"y":0},
    {"key":"non_covered","label":"비급여","type":"amount","x":0,"y":0},
    {"key":"total_amount","label":"진료비총액","type":"amount","x":0,"y":0},
    {"key":"patient_amount","label":"환자부담총액","type":"amount","x":0,"y":0},
    {"key":"receipt_representative","label":"대표자(개설자)","type":"text","x":0,"y":0},
    {"key":"issue_date","label":"발행일","type":"date","x":0,"y":0}
  ]'::jsonb,
  false,
  'admin|manager|director|consultant|coordinator|therapist',
  true,
  36
)
ON CONFLICT (clinic_id, form_key) DO UPDATE SET
  name_ko = EXCLUDED.name_ko,
  template_format = EXCLUDED.template_format,
  field_map = EXCLUDED.field_map,
  requires_signature = EXCLUDED.requires_signature,
  required_role = EXCLUDED.required_role,
  active = EXCLUDED.active,
  sort_order = EXCLUDED.sort_order;

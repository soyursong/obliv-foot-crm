-- T-20260522-foot-PENCHART-FORM-AUDIT
-- 펜차트 등록 양식 전수 검토 결과 반영 (건 2)
-- Parent: T-20260522-foot-PENCHART-ERASER-CLARITY
--
-- 발견 이슈 3건:
--   [WARN-1] sort_order 중복: visit_confirm=40 (treat_confirm과 동일)
--            → 45로 보정 (원래 시드 의도: treat_confirm=40, visit_confirm=50)
--   [WARN-2] sort_order 중복: referral_letter=90 (pen_chart와 동일)
--            → 96으로 보정 (의무기록사본발급신청서 95 이후)
--   [CRIT-1] DB 레코드 누락: refund_consent.png (public/forms/) 파일 존재하나
--            form_templates 레코드 없음 → INSERT
--
-- 비고 (INFO, 수정 불필요):
--   personal_checklist_general/senior: active=false (2026-05-21 의도적 soft-delete)
--   sort_order 91/92 공존은 UI 필터(active=true) 통과하므로 영향 없음
--
-- 멱등: UPDATE WHERE ... AND sort_order=..., INSERT ON CONFLICT DO NOTHING
-- 롤백: 20260522060000_form_templates_audit_fix.down.sql 참조
--
-- 대상 clinic_id: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (오블리브 풋센터 종로)

DO $$
DECLARE
  v_clinic UUID := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
BEGIN

  -- ────────────────────────────────────────────────────────────────
  -- [WARN-1] visit_confirm sort_order 40 → 45
  --   원인: 시드(20260427) visit_confirm=50이었으나 이후 마이그레이션에서 40으로 변경됨
  --   수정: 45 (treat_confirm=40 직후, bill_detail=30~payment_cert=85 구간 내)
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET sort_order = 45
  WHERE clinic_id = v_clinic
    AND form_key   = 'visit_confirm'
    AND sort_order = 40;          -- 이미 수정된 경우 멱등 보장

  -- ────────────────────────────────────────────────────────────────
  -- [WARN-2] referral_letter sort_order 90 → 96
  --   원인: 신규 등록(20260514) 시 pen_chart(90)와 동일 값 할당
  --   수정: 96 (medical_record_request=95 이후, diag_opinion_v2=100 이전)
  -- ────────────────────────────────────────────────────────────────
  UPDATE form_templates
  SET sort_order = 96
  WHERE clinic_id = v_clinic
    AND form_key   = 'referral_letter'
    AND sort_order = 90;

  -- ────────────────────────────────────────────────────────────────
  -- [CRIT-1] refund_consent 레코드 신규 INSERT
  --   파일: public/forms/refund_consent.png (오블리브 환불동의서)
  --   원본 PDF: 오블리브_문제성발톱환불동의서_ver.02_251205.pdf
  --   template_format: png (캔버스 배경 + 태블릿펜 서명)
  --   requires_signature: true (동의서)
  --   sort_order: 93 (pen_chart=90 ~ medical_record_request=95 사이)
  -- ────────────────────────────────────────────────────────────────
  INSERT INTO form_templates (
    clinic_id, category, form_key, name_ko,
    template_path, template_format,
    field_map, requires_signature, required_role, active, sort_order
  ) VALUES (
    v_clinic,
    'foot-service',
    'refund_consent',
    '환불동의서',
    '/forms/refund_consent.png',
    'png',
    '[]'::jsonb,
    true,
    'admin|manager|coordinator|director',
    true,
    93
  )
  ON CONFLICT (clinic_id, form_key) DO NOTHING;  -- 재실행 시 skip

END $$;

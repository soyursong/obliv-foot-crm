-- ROLLBACK — T-20260811-foot-PENCHART-FORMTPL-SORTORDER-FIX
-- 대상 clinic(74967aea-…930bc8) 6 form_key 의 sort_order 를 apply 前 before-image(2026-08-11 SELECT 실측)로 원복.
-- before-image: pen_chart=90 · privacy_consent_form=130 · health_questionnaire_general=91 ·
--               health_questionnaire_senior=92 · refund_consent=93 · foreigner_noncovered_consent=120.
-- 타 form_key 무접촉. 멱등: 재실행 시 최종상태 불변.

BEGIN;

UPDATE public.form_templates AS ft
   SET sort_order = v.old_order
  FROM (VALUES
    ('pen_chart',                     90),
    ('privacy_consent_form',          130),
    ('health_questionnaire_general',  91),
    ('health_questionnaire_senior',   92),
    ('refund_consent',                93),
    ('foreigner_noncovered_consent',  120)
  ) AS v(form_key, old_order)
 WHERE ft.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
   AND ft.form_key  = v.form_key;   -- expect rows-affected = 6

COMMIT;
-- POSTCHECK: 대상 6 form_key = before-image(90/130/91/92/93/120) 복원 / 타 form_key 무변경.

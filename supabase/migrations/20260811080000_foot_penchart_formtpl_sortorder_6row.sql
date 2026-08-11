-- T-20260811-foot-PENCHART-FORMTPL-SORTORDER-FIX  펜차트 양식 탭 서식 목록 순서 정정 (sort_order 6행)
-- planner NEW-TASK MSG-20260811-122929-tnxs (P2) · 김주연 총괄 확정 순서.
-- 성격: form_templates.sort_order DML UPDATE (무DDL·비파괴·mutable 표시필드). clinic 단일 스코프.
--   Gate-B(DA) 비대상(무DDL·비파괴). 그러나 apply = supervisor DB-GATE GO-token(db_apply_guard.sh 비파괴 guard-lane) 後만.
--   ★ GO-token 前 prod 선집행 금지(apply_before_go 클래스).
--
-- 대상 clinic: 74967aea-a60b-4da3-a0e7-9c997a930bc8 (풋센터 단일)
-- 대상 6 form_key · 목표 순서 (현재값→목표, 2026-08-11 SELECT 실측):
--   pen_chart                     90  → 90  (유지·no-op value)
--   privacy_consent_form          130 → 91
--   health_questionnaire_general  91  → 92
--   health_questionnaire_senior   92  → 93
--   refund_consent                93  → 94
--   foreigner_noncovered_consent  120 → 95  (현재값 120 = SELECT 확인 완료)
--
-- ★ (clinic_id, form_key) UNIQUE 존재 / (clinic_id, sort_order) UNIQUE 부재 → sort_order 중복 허용
--   → 6행 원자 CASE UPDATE 에 중간충돌 위험 없음. 타 form_key(초진차트=90 등)와의 sort_order 공유는 스코프 밖(무변경).
-- 스코프: clinic_id + form_key IN(6종) — VALUES 조인. 타 clinic/타 form_key 절대 무접촉.
-- rows-affected: 최초 apply = 6 (6행 전량 매치·pen_chart 는 same-value 재기입 포함). 재실행 = 6 (매치행 수 동일, 최종상태 불변=멱등).
-- 멱등: 재실행 시 동일 최종상태(90/91/92/93/94/95). WHERE 스코프가 6행으로 고정.
-- rollback: 20260811080000_foot_penchart_formtpl_sortorder_6row.rollback.sql (before-image 원복·타 form_key 무접촉).

BEGIN;

-- ═══ 6행 sort_order UPDATE (VALUES 조인·clinic+form_key 스코프 한정) ═══
UPDATE public.form_templates AS ft
   SET sort_order = v.new_order
  FROM (VALUES
    ('pen_chart',                     90),
    ('privacy_consent_form',          91),
    ('health_questionnaire_general',  92),
    ('health_questionnaire_senior',   93),
    ('refund_consent',                94),
    ('foreigner_noncovered_consent',  95)
  ) AS v(form_key, new_order)
 WHERE ft.clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
   AND ft.form_key  = v.form_key;   -- expect rows-affected = 6

-- ═══ IN-TXN SELF-TEST (대상 6행 90~95 오름차순·유일 확증 + 과잉스코프 차단) ═══
DO $$
DECLARE
  clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid;
  keys text[] := ARRAY['pen_chart','privacy_consent_form','health_questionnaire_general',
                       'health_questionnaire_senior','refund_consent','foreigner_noncovered_consent'];
  n_target int; n_distinct int; got text; mismatch text;
BEGIN
  -- (1) 대상 6행 존재 확증
  SELECT count(*) INTO n_target FROM public.form_templates
    WHERE clinic_id = clinic AND form_key = ANY(keys);
  IF n_target <> 6 THEN RAISE EXCEPTION 'penchart sortorder: target rows expected 6, got %', n_target; END IF;

  -- (2) 6행 sort_order 정확 매핑 확증 (form_key→목표값)
  SELECT string_agg(form_key || '=' || sort_order, ',' ORDER BY sort_order) INTO mismatch
    FROM public.form_templates
   WHERE clinic_id = clinic AND form_key = ANY(keys)
     AND NOT (
       (form_key='pen_chart'                    AND sort_order=90) OR
       (form_key='privacy_consent_form'         AND sort_order=91) OR
       (form_key='health_questionnaire_general' AND sort_order=92) OR
       (form_key='health_questionnaire_senior'  AND sort_order=93) OR
       (form_key='refund_consent'               AND sort_order=94) OR
       (form_key='foreigner_noncovered_consent' AND sort_order=95));
  IF mismatch IS NOT NULL THEN RAISE EXCEPTION 'penchart sortorder: mapping mismatch: %', mismatch; END IF;

  -- (3) 대상 6행 sort_order 집합 = {90,91,92,93,94,95} 오름차순·유일
  SELECT string_agg(sort_order::text, ',' ORDER BY sort_order),
         count(DISTINCT sort_order)
    INTO got, n_distinct
    FROM public.form_templates
   WHERE clinic_id = clinic AND form_key = ANY(keys);
  IF got <> '90,91,92,93,94,95' THEN RAISE EXCEPTION 'penchart sortorder: sequence expected 90,91,92,93,94,95 got %', got; END IF;
  IF n_distinct <> 6 THEN RAISE EXCEPTION 'penchart sortorder: distinct sort_order expected 6 (unique), got %', n_distinct; END IF;
END $$;

COMMIT;
-- POSTCHECK (apply 후): 대상 6 form_key sort_order = 90/91/92/93/94/95 오름차순·유일 / rows-affected=6 /
--   타 clinic·타 form_key 무변경(다른 form_key sort_order 불변).

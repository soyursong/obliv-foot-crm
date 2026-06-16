-- ============================================================
-- ROLLBACK: 20260616160000_opinion_doc_form_stack.sql
-- T-20260616-foot-OPINION-DOC-FEATURE (Phase 2, form 스택 재사용)
-- ⚠ 주의: C1(published 비가역) 롤백은 의료법 잠복 갭을 되살리므로 신중. KOH 발행본도 영향.
--   소견서 발행본(form_submissions status='published', field_data.doc_kind='opinion_doc')은
--   의무기록 → 데이터 자체는 보존(삭제 안 함). 본 롤백은 트리거/RLS술어/seed/RPC만 원복.
-- ============================================================

BEGIN;

-- 3: publish_opinion_doc RPC 제거
DROP FUNCTION IF EXISTS public.publish_opinion_doc(uuid, jsonb);

-- 2: opinion_doc form_template seed 제거 (발행 이력 없을 때만 안전 — template_id 참조 보존 위해 발행본 있으면 비활성만)
DO $rb$
DECLARE
  v_clinic uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  v_tpl uuid;
  v_used int;
BEGIN
  SELECT id INTO v_tpl FROM form_templates WHERE clinic_id=v_clinic AND form_key='opinion_doc' LIMIT 1;
  IF v_tpl IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM form_submissions WHERE template_id=v_tpl;
    IF v_used = 0 THEN
      DELETE FROM form_templates WHERE id=v_tpl;       -- 발행 이력 없음 → 안전 삭제
    ELSE
      UPDATE form_templates SET active=false WHERE id=v_tpl;  -- 발행본 존재 → FK 보존 위해 비활성화만
    END IF;
  END IF;
END
$rb$;

-- 1-b: form_submissions_update USING 을 원본(20260522000010, published 술어 없음)으로 복원
DROP POLICY IF EXISTS "form_submissions_update" ON public.form_submissions;
CREATE POLICY "form_submissions_update" ON public.form_submissions
  FOR UPDATE USING (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles
      WHERE id = auth.uid() AND active = true
    )
  );

-- 1-a: 비가역 트리거 + 가드 함수 제거
DROP TRIGGER IF EXISTS trg_form_submissions_published_immutable ON public.form_submissions;
DROP FUNCTION IF EXISTS public.form_submissions_published_immutable_guard();

COMMIT;

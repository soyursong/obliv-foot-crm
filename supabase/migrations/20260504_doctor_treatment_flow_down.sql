-- ROLLBACK: T-20260502-foot-DOCTOR-TREATMENT-FLOW (풋센터 포팅)
-- Run this to undo the doctor treatment flow migration

-- 1. check_ins 확장 컬럼 제거 (doctor_note, visit_type은 기존 컬럼이므로 제거 안 함)
ALTER TABLE public.check_ins
  DROP COLUMN IF EXISTS prescription_items,
  DROP COLUMN IF EXISTS document_content,
  DROP COLUMN IF EXISTS doctor_confirm_charting,
  DROP COLUMN IF EXISTS doctor_confirm_prescription,
  DROP COLUMN IF EXISTS doctor_confirm_document,
  DROP COLUMN IF EXISTS doctor_confirmed_at,
  DROP COLUMN IF EXISTS healer_laser_confirm;

-- 2. document_templates 삭제
DROP POLICY IF EXISTS "staff_read_document_templates"  ON public.document_templates;
DROP POLICY IF EXISTS "admin_write_document_templates" ON public.document_templates;
DROP TABLE IF EXISTS public.document_templates;

-- 3. prescription_sets 삭제
DROP POLICY IF EXISTS "staff_read_prescription_sets"  ON public.prescription_sets;
DROP POLICY IF EXISTS "admin_write_prescription_sets" ON public.prescription_sets;
DROP TABLE IF EXISTS public.prescription_sets;

-- 4. phrase_templates 삭제
DROP POLICY IF EXISTS "staff_read_phrase_templates"   ON public.phrase_templates;
DROP POLICY IF EXISTS "admin_write_phrase_templates"  ON public.phrase_templates;
DROP TABLE IF EXISTS public.phrase_templates;

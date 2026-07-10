-- ============================================================================
-- T-20260710-foot-CUST-CASCADE-PHI-FK — Phase2 DOWN (원복)
--   [A] CORE PHI 8: RESTRICT → CASCADE (원상)
--   [B] 라이더: consultation_notes FK DROP (ADD FK 원복 = 무제약 복귀)
--
-- 게이트 A(orphan=0)이므로 데이터 손실 없음 → archive-restore 불요.
-- ⚠주의: 원복은 진료기록 CASCADE 파괴 위험(의료법 §22)을 되살리므로
--        운영 사고 롤백 목적으로만 사용. 통상은 forward-fix 우선.
-- ============================================================================

BEGIN;

-- [A] CORE PHI 8: RESTRICT → CASCADE 원복
ALTER TABLE public.clinical_images          DROP CONSTRAINT IF EXISTS clinical_images_customer_id_fkey;
ALTER TABLE public.clinical_images          ADD  CONSTRAINT clinical_images_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_photos         DROP CONSTRAINT IF EXISTS treatment_photos_customer_id_fkey;
ALTER TABLE public.treatment_photos         ADD  CONSTRAINT treatment_photos_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.health_q_results         DROP CONSTRAINT IF EXISTS health_q_results_customer_id_fkey;
ALTER TABLE public.health_q_results         ADD  CONSTRAINT health_q_results_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.patient_past_history     DROP CONSTRAINT IF EXISTS patient_past_history_customer_id_fkey;
ALTER TABLE public.patient_past_history     ADD  CONSTRAINT patient_past_history_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.patient_file_records     DROP CONSTRAINT IF EXISTS patient_file_records_customer_id_fkey;
ALTER TABLE public.patient_file_records     ADD  CONSTRAINT patient_file_records_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.customer_treatment_memos DROP CONSTRAINT IF EXISTS customer_treatment_memos_customer_id_fkey;
ALTER TABLE public.customer_treatment_memos ADD  CONSTRAINT customer_treatment_memos_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.customer_consult_memos   DROP CONSTRAINT IF EXISTS customer_consult_memos_customer_id_fkey;
ALTER TABLE public.customer_consult_memos   ADD  CONSTRAINT customer_consult_memos_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

ALTER TABLE public.customer_special_notes   DROP CONSTRAINT IF EXISTS customer_special_notes_customer_id_fkey;
ALTER TABLE public.customer_special_notes   ADD  CONSTRAINT customer_special_notes_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

-- [B] 라이더 원복: consultation_notes FK 제거(무제약 복귀 = ADD FK 이전 상태)
ALTER TABLE public.consultation_notes       DROP CONSTRAINT IF EXISTS consultation_notes_customer_id_fkey;

COMMIT;

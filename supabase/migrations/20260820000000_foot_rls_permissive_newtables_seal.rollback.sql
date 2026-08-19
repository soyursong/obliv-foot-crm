-- ============================================================================
-- T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL (leg2) · DOWN (rollback)
--   신설 RESTRICTIVE 정책만 DROP → 이전 상태(permissive-only) 완전 복원.
--   permissive 정책은 UP 에서 무DROP(ADDITIVE) → 여기서 재생성 불요.
--   ⚠ rollback = 취약(cross-clinic/anon 도달) 재개통. 회귀 아님(원상 복구).
-- ============================================================================

-- Q1
DROP POLICY IF EXISTS "health_maintenance_balances_clinic_gate_restrict" ON public.health_maintenance_balances;
DROP POLICY IF EXISTS "payment_audit_logs_clinic_read_restrict"          ON public.payment_audit_logs;
DROP POLICY IF EXISTS "receipt_ocr_results_clinic_gate_restrict"         ON public.receipt_ocr_results;
DROP POLICY IF EXISTS "claim_diagnoses_clinic_gate_restrict"             ON public.claim_diagnoses;
DROP POLICY IF EXISTS "handover_notes_clinic_gate_restrict"              ON public.handover_notes;

-- Q2 (A)
DROP POLICY IF EXISTS "diagnosis_folders_clinic_gate_restrict"           ON public.diagnosis_folders;
DROP POLICY IF EXISTS "diagnosis_sets_clinic_gate_restrict"              ON public.diagnosis_sets;
DROP POLICY IF EXISTS "notices_clinic_gate_restrict"                     ON public.notices;
DROP POLICY IF EXISTS "room_role_mapping_clinic_read_restrict"           ON public.room_role_mapping;

-- Q2 (C)
DROP POLICY IF EXISTS "code_availability_anon_deny"                      ON public.code_availability;
DROP POLICY IF EXISTS "redpay_unregistered_line_seen_anon_deny"          ON public.redpay_unregistered_line_seen;

-- ROLLBACK — T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD orphan 정리 되돌림
--   20260727090000_foot_drop_orphan_payment_preempts.sql 의 역: payment_preempts 재생성.
--   DDL 정본 = git @a9aa8b92 (20260725040000_foot_payment_preempts.sql, clinic_id RLS 술어 포함본).
--   비파괴 복원 — 원 orphan 상태(빈 테이블) 복구. 데이터 순소실 0(원본 0행).
-- ══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_preempts (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id           uuid        NOT NULL REFERENCES public.clinics(id),
  check_in_id         uuid        REFERENCES public.check_ins(id) ON DELETE SET NULL,
  customer_id         uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  expected_amount     integer,
  method              text        NOT NULL DEFAULT 'card' CHECK (method IN ('card')),
  status              text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','matched','expired','failed','cancelled')),
  matched_payment_id  uuid        REFERENCES public.payments(id) ON DELETE SET NULL,
  merchant_hint       text,
  created_by          uuid        REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  matched_at          timestamptz,
  resolved_at         timestamptz,
  fail_reason         text
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_preempts_open_per_checkin_unique
  ON public.payment_preempts (check_in_id)
  WHERE status = 'pending' AND check_in_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_preempts_clinic_status_idx
  ON public.payment_preempts (clinic_id, status);
CREATE INDEX IF NOT EXISTS payment_preempts_ttl_sweep_idx
  ON public.payment_preempts (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.payment_preempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_preempts_admin_all       ON public.payment_preempts;
DROP POLICY IF EXISTS payment_preempts_consult_insert  ON public.payment_preempts;
DROP POLICY IF EXISTS payment_preempts_consult_update  ON public.payment_preempts;
DROP POLICY IF EXISTS payment_preempts_approved_read   ON public.payment_preempts;

CREATE POLICY payment_preempts_admin_all ON public.payment_preempts FOR ALL TO authenticated
  USING      (is_admin_or_manager() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_admin_or_manager() AND clinic_id = current_user_clinic_id());
CREATE POLICY payment_preempts_consult_insert ON public.payment_preempts FOR INSERT TO authenticated
  WITH CHECK (is_consultant_or_above() AND clinic_id = current_user_clinic_id());
CREATE POLICY payment_preempts_consult_update ON public.payment_preempts FOR UPDATE TO authenticated
  USING      (is_consultant_or_above() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_consultant_or_above() AND clinic_id = current_user_clinic_id());
CREATE POLICY payment_preempts_approved_read ON public.payment_preempts FOR SELECT TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id());

GRANT SELECT, INSERT, UPDATE ON public.payment_preempts TO authenticated;

COMMIT;

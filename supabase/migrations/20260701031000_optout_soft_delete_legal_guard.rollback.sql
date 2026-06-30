-- ROLLBACK: 20260701031000_optout_soft_delete_legal_guard.sql
--   ⑨ opt-out soft-delete guard 원복 → notif_optout_write FOR ALL(8역할) 복원 + full-unique 재생성 + 컬럼 제거.
--
-- ★C2 검증항목: 롤백 = full-unique(uq_notif_optout_clinic_phone) 재생성.
--   ⚠️ 사전조건: 롤백 시점에 (clinic_id, phone) active 중복이 없어야 full-unique 재생성 성공.
--      soft-delete 후 동일 phone 을 재등록한 케이스가 있으면 deleted_at 무시한 full-unique 가 중복 충돌 →
--      롤백 전 soft-deleted(deleted_at IS NOT NULL) 행을 정리(hard-delete)해야 안전. (운영 롤백 시 수동 점검.)
-- ============================================================================

BEGIN;

-- 1. RLS 원복: INSERT/UPDATE 분리 → FOR ALL(8역할) 복원 (notif_tmpl_write align 상태로 회귀).
DROP POLICY IF EXISTS notif_optout_insert ON public.notification_opt_outs;
DROP POLICY IF EXISTS notif_optout_update ON public.notification_opt_outs;

DROP POLICY IF EXISTS notif_optout_write ON public.notification_opt_outs;
CREATE POLICY notif_optout_write ON public.notification_opt_outs
  FOR ALL
  TO authenticated
  USING (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN (
      'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
    )
  )
  WITH CHECK (
    clinic_id = public.get_user_clinic_id()
    AND public.get_user_role() IN (
      'admin', 'manager', 'director', 'consultant', 'coordinator', 'therapist', 'part_lead', 'staff'
    )
  );

-- 2. partial-unique 원복 → full-unique 재생성. (active 중복 phone 부재 전제 — 상단 주석 참조.)
DROP INDEX IF EXISTS public.uq_notif_optout_clinic_phone_active;
ALTER TABLE public.notification_opt_outs
  ADD CONSTRAINT uq_notif_optout_clinic_phone UNIQUE (clinic_id, phone);

-- 3. soft-delete 컬럼 제거.
ALTER TABLE public.notification_opt_outs
  DROP COLUMN IF EXISTS delete_reason,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS deleted_at;

COMMIT;

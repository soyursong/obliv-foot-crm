-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK (가역 down): T-20260810-foot-REALTIME-PUB-GAP-FIX
--   정본 스코프 = DA-20260810-foot-REALTIME-PUB-GAP-PERTABLE-MATRIX (ALTER PUB ADD 11 · FULL flip 5).
--   up 이 추가/변경한 것만 정확히 되돌림:
--     · publication 멤버십 DROP = up 이 ADD 한 11개 M-gap 만(check_ins·reservations·room_assignments·
--       timer_records·waiting_board 는 본 마이그 이전부터 멤버 → DROP 안 함, 멤버십 유지).
--     · R.I. 는 census 기준선(전량 DEFAULT)으로 복원 — up §2 에서 FULL 로 flip 한 5개 전부 DEFAULT 원복.
--   멱등: 존재/부재 가드로 재실행 안전.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) publication 멤버십 DROP — up 이 ADD 한 11개 M-gap 만 (멱등 가드) ────────────────────
DO $$
DECLARE
  t text;
  m_gap_tables text[] := ARRAY[
    'payments',
    'package_payments',
    'closing_manual_payments',
    'duty_roster',
    'clinic_doctors',
    'redpay_raw_transactions',
    'pending_payment',
    'assignment_actions',
    'staff_temp_off',
    'rooms',
    'check_in_room_logs'
  ];
BEGIN
  FOREACH t IN ARRAY m_gap_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── 2) REPLICA IDENTITY 복원 → DEFAULT (census 기준선: 전량 DEFAULT) ─────────────────────
--   up §2 에서 FULL 로 flip 한 5개(check_ins·reservations·room_assignments·closing_manual_payments·
--   duty_roster)를 DEFAULT 로 원복. (room_assignments 는 멤버십 유지·R.I.만 원복.)
ALTER TABLE public.check_ins                REPLICA IDENTITY DEFAULT;
ALTER TABLE public.reservations             REPLICA IDENTITY DEFAULT;
ALTER TABLE public.room_assignments         REPLICA IDENTITY DEFAULT;
ALTER TABLE public.closing_manual_payments  REPLICA IDENTITY DEFAULT;
ALTER TABLE public.duty_roster              REPLICA IDENTITY DEFAULT;
-- up §3 DEFAULT 명시 테이블(payments·package_payments·… ·check_in_room_logs)은 baseline DEFAULT 와
--   동일 → 원복 불요(pub DROP 으로 멤버십만 제거됨). timer_records·waiting_board 는 무접촉.

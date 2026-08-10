-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK (가역 down): T-20260810-foot-REALTIME-PUB-GAP-FIX
--   up 이 추가한 것만 정확히 되돌림 — check_ins·reservations 는 본 마이그 이전부터 pub 멤버였으므로
--   publication 에서 DROP 하지 않는다(멤버십은 유지). 단 R.I.는 census 기준선(전량 DEFAULT)으로 복원.
--   멱등: 존재/부재 가드로 재실행 안전.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) publication 멤버십 DROP — up 이 ADD 한 9개 M-gap 만 (멱등 가드) ─────────────────────
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
    'staff_temp_off'
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
--   up 2a 에서 FULL 로 바꾼 테이블 전부 DEFAULT 로 원복.
ALTER TABLE public.payments                 REPLICA IDENTITY DEFAULT;
ALTER TABLE public.package_payments         REPLICA IDENTITY DEFAULT;
ALTER TABLE public.closing_manual_payments  REPLICA IDENTITY DEFAULT;
ALTER TABLE public.duty_roster              REPLICA IDENTITY DEFAULT;
ALTER TABLE public.clinic_doctors           REPLICA IDENTITY DEFAULT;
ALTER TABLE public.redpay_raw_transactions  REPLICA IDENTITY DEFAULT;
ALTER TABLE public.pending_payment          REPLICA IDENTITY DEFAULT;
ALTER TABLE public.check_ins                REPLICA IDENTITY DEFAULT;
ALTER TABLE public.reservations             REPLICA IDENTITY DEFAULT;
-- assignment_actions·staff_temp_off 는 up 에서 이미 DEFAULT(변경 없음) → 원복 불요.

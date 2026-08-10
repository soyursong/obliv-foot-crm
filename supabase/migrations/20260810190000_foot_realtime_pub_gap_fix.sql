-- ─────────────────────────────────────────────────────────────────────────
-- T-20260810-foot-REALTIME-PUB-GAP-FIX — Realtime publication M-gap + F-gap remediation
--   change-class = ADDITIVE (가역 down 동봉: 20260810190000_foot_realtime_pub_gap_fix.rollback.sql)
--   블랭킷 ADD/FULL 금지 — 테이블별 소비 근거로 개별 판정(매트릭스: _handoff/artifacts/.../per_table_matrix.md)
--
--   ★ DRAFT — apply 순서 하드가드:
--     DA per-table 매트릭스 GO + phi_rls_drift_guard dual-tag GO ≠ apply 허가.
--     supervisor DB-GATE GO-token(db_apply_guard.sh lane) 발행 後에만 prod apply.
--     GO-token 前 prod DDL 선집행 금지(apply_before_go 클래스).
--   ★ 스코프 확정 대기(DA CONSULT Q1): M-gap `*`+clinic_id 7개(payments·package_payments·
--     closing_manual_payments·duty_roster·clinic_doctors·redpay_raw_transactions·pending_payment)
--     FULL 승격은 게이트 §3 규칙 일관적용에 따른 dev 권고. DA 확정 시 그대로, DEFAULT 지시 시 해당
--     REPLICA IDENTITY 문 제거 후 재-DDL-diff.
--   ★ DIVERGENCE(§C: room_assignments·rooms·timer_records·check_in_room_logs)는 본 스코프 미포함.
--     census 정정 여부 = DA 판정(Q2). 블랭킷 확장 금지 원칙에 따라 여기서 손대지 않음.
--
--   INV-1(txn-control strip): 본 파일은 top-level BEGIN;/COMMIT; 미사용 → dry-run 러너가 단일 txn
--     래핑 후 sentinel RAISE 로 무영속 롤백 가능(조기 COMMIT bypass 원천 부재).
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) M-gap: publication 멤버십 ADD (멱등 가드 — pg_publication_tables 확인) ────────────
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
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── 2) REPLICA IDENTITY — 테이블별 개별 판정 (블랭킷 금지) ────────────────────────────────
-- 2a) FULL: 비-PK(clinic_id/customer_id) 필터 + UPDATE/DELETE(`event:'*'`) 소비 →
--          old-row 에 필터 컬럼이 실려야 오필터/누락 없음. (REPLICA IDENTITY FULL 재실행=no-op·멱등)
--   M-gap `*`+clinic_id (dev 권고 · DA Q1 확정 대상):
ALTER TABLE public.payments                 REPLICA IDENTITY FULL;
ALTER TABLE public.package_payments         REPLICA IDENTITY FULL;
ALTER TABLE public.closing_manual_payments  REPLICA IDENTITY FULL;
ALTER TABLE public.duty_roster              REPLICA IDENTITY FULL;
ALTER TABLE public.clinic_doctors           REPLICA IDENTITY FULL;
ALTER TABLE public.redpay_raw_transactions  REPLICA IDENTITY FULL;
ALTER TABLE public.pending_payment          REPLICA IDENTITY FULL;
--   F-gap (pub O·DEFAULT·비-PK 필터 UPDATE/DELETE 소비 — 티켓 확정):
ALTER TABLE public.check_ins                REPLICA IDENTITY FULL;
ALTER TABLE public.reservations             REPLICA IDENTITY FULL;

-- 2b) DEFAULT(명시 · 문서화 목적): INSERT-only 또는 no-filter → old-row 불요 → FULL 불필요.
--   assignment_actions = INSERT-only(AssignmentNotifyBell.tsx:173),
--   staff_temp_off      = 무필터 전역 `*`(Assignments.tsx:733) → 필터 컬럼 없음.
ALTER TABLE public.assignment_actions       REPLICA IDENTITY DEFAULT;
ALTER TABLE public.staff_temp_off           REPLICA IDENTITY DEFAULT;

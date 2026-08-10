-- ─────────────────────────────────────────────────────────────────────────
-- T-20260810-foot-REALTIME-PUB-GAP-FIX — Realtime publication M-gap + F-gap remediation
--   change-class = ADDITIVE (가역 down 동봉: 20260810190000_foot_realtime_pub_gap_fix.rollback.sql)
--   블랭킷 ADD/FULL 금지 — 테이블별 소비 근거로 개별 판정.
--
--   ★ 정본 스코프 = DA CONSULT-REPLY (DA-20260810-foot-REALTIME-PUB-GAP-PERTABLE-MATRIX,
--     SSOT=agents/docs/da_replies/da_decision_foot_realtime_pub_gap_pertable_matrix_20260810.md)
--     · 조건부 GO(ADDITIVE) · method=DA READ-ONLY prod introspection(ref rxlomoozakkjesdqjtvd).
--     · 블랭킷-7-FULL(구 DRAFT be5f625e) = **REFUTE**. 7中 FULL=2(closing_manual_payments·duty_roster)
--       / DEFAULT=5(payments·package_payments·clinic_doctors·redpay_raw_transactions·pending_payment).
--       근거: '*'+clinic_id ≠ 자동 FULL. UPDATE/INSERT 필터는 NEW-row 로 평가 → DEFAULT delivery 정상.
--       FULL 필요조건 = (a) DELETE 를 비-PK 필터로 소비 AND (b) 런타임 hard-DELETE 실발생.
--
--   ★ dev census 재확인(잔여 census-gate 해소, dev-foot FE 실측):
--     · duty_roster            = HARD .delete() 실존(DutyRosterTab.tsx:169 PK·:229 비-PK[clinic_id+date range])
--                                + soft-delete 컬럼 부재 → **FULL 확정** (census시4 아님, FULL flip=5 유지).
--     · payments               = FE hard-.delete() **0건**(PaymentMiniWindow .delete() 는 check_in_services 대상)
--                                + pg_proc DELETE-producer 0 → **DEFAULT 확정**(PHI 블랭킷 FULL 금지).
--     · pending_payment        = FE hard-.delete() **0건**, soft-cancel(status='cancelled' UPDATE) → **DEFAULT 확정**.
--     · rooms                  = 구독 intended-live **확정**(Dashboard.tsx:4920 event:'*'+clinic_id →
--                                debouncedRoomsRefetch, T-20260614-foot-SLOT-CRUD-ALLTYPES AC-5).
--                                active soft-delete 우세 → DA **DEFAULT** 확정(rooms FULL = HARD REJECT).
--                                [note] hard room delete(PK id·비-PK 소비 아님) 전파는 DEFAULT 하 clinic_id
--                                old-row 누락으로 미도달 가능 = DA-accepted(rare admin·비-PHI·body fork-divergence 동형).
--     · timer_records          = DELETE listener 부재(INSERT+UPDATE 핸들러 NEW-row only, Dashboard.tsx:5071/5085)
--                                → **NO-OP**(DEFAULT 충분·FULL 우려 REFUTE).
--     · room_assignments       = 멤버(O)+DEFAULT+FE구독(Dashboard.tsx:4909)+save_room_assignments RPC
--                                DELETE FROM room_assignments(비-PK) → **FULL flip only**(ADD 불요).
--     · check_in_room_logs     = 구독 O·INSERT-only(CheckInDetailSheet.tsx:969) → **ADD·DEFAULT**.
--
--   ★ apply 순서 하드가드(DA §: DA GO = 스코프/change-class 판정만·apply-gate/순서=supervisor chokepoint):
--     DA per-table 매트릭스 GO + phi_rls_drift_guard dual-tag GO ≠ apply 허가.
--     supervisor DDL-diff + Dry-Run No-Persistence + 물리 GO-token(db_apply_guard.sh lane) 발행 後에만 prod apply.
--     GO-token 前 prod DDL 선집행 금지(apply_before_go 클래스). db_change=TRUE.
--   ★ PHI dual-tag(AC-2, apply 선결 hard CONFIRM): base = payments·package_payments·closing_manual_payments·
--     check_ins·reservations (+ redpay_raw_transactions·pending_payment PHI-adjacent · room_assignments PHI-linking eval).
--     apply 선결 = supervisor prod anon_pii_read_probe = 0.
--
--   INV-1(txn-control strip): 본 파일은 top-level BEGIN;/COMMIT; 미사용 → dry-run 러너가 단일 txn
--     래핑 후 sentinel RAISE 로 무영속 롤백 가능(조기 COMMIT bypass 원천 부재).
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1) M-gap: publication 멤버십 ADD 11 (멱등 가드 — pg_publication_tables 확인) ────────────
--   room_assignments 는 이미 멤버 → ADD 목록에 없음(FULL flip only, §2 참조).
DO $$
DECLARE
  t text;
  m_gap_tables text[] := ARRAY[
    'payments',                 -- ADD·DEFAULT
    'package_payments',         -- ADD·DEFAULT
    'closing_manual_payments',  -- ADD·FULL (§2)
    'duty_roster',              -- ADD·FULL (§2)
    'clinic_doctors',           -- ADD·DEFAULT (active soft-delete)
    'redpay_raw_transactions',  -- ADD·DEFAULT (SELECT-only·append)
    'pending_payment',          -- ADD·DEFAULT (status soft-cancel)
    'assignment_actions',       -- ADD·DEFAULT (INSERT-only)
    'staff_temp_off',           -- ADD·DEFAULT (무필터 전역)
    'rooms',                    -- ADD·DEFAULT (intended-live 구독·active soft-delete)
    'check_in_room_logs'        -- ADD·DEFAULT (INSERT-only)
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

-- ── 2) REPLICA IDENTITY FULL 5 — (a) DELETE 를 비-PK 필터로 소비 AND (b) 런타임 hard-DELETE 실발생 ──
--   (REPLICA IDENTITY FULL 재실행 = no-op·멱등)
--   F-gap(pub O·DEFAULT·비-PK 필터 UPDATE/DELETE 소비 — 기존 멤버):
ALTER TABLE public.check_ins                REPLICA IDENTITY FULL;  -- 비-PK 필터 UPDATE 소비
ALTER TABLE public.reservations             REPLICA IDENTITY FULL;  -- 비-PK 필터 소비
ALTER TABLE public.room_assignments         REPLICA IDENTITY FULL;  -- 멤버(O)+save_room_assignments RPC 비-PK DELETE
--   M-gap 中 FULL(ADD 동반):
ALTER TABLE public.closing_manual_payments  REPLICA IDENTITY FULL;  -- Closing.tsx:1706 hard-.delete() + FE.delete
ALTER TABLE public.duty_roster              REPLICA IDENTITY FULL;  -- DutyRosterTab.tsx:229 비-PK hard-.delete()

-- ── 3) REPLICA IDENTITY DEFAULT (명시 · 문서화 목적) — INSERT/UPDATE(NEW-row 평가) or PK/무필터 ────
--   DELETE producer 부재 or soft-delete or INSERT-only → old-row 불요 → FULL 불필요(PHI 블랭킷 FULL 금지).
ALTER TABLE public.payments                 REPLICA IDENTITY DEFAULT;  -- pg_proc DELETE-producer 0 · FE .delete() 0
ALTER TABLE public.package_payments         REPLICA IDENTITY DEFAULT;
ALTER TABLE public.clinic_doctors           REPLICA IDENTITY DEFAULT;  -- active soft-delete
ALTER TABLE public.redpay_raw_transactions  REPLICA IDENTITY DEFAULT;  -- SELECT-only · append
ALTER TABLE public.pending_payment          REPLICA IDENTITY DEFAULT;  -- status soft-cancel(UPDATE)
ALTER TABLE public.assignment_actions       REPLICA IDENTITY DEFAULT;  -- INSERT-only(AssignmentNotifyBell.tsx:173)
ALTER TABLE public.staff_temp_off           REPLICA IDENTITY DEFAULT;  -- 무필터 전역 `*`(Assignments.tsx:733)
ALTER TABLE public.rooms                    REPLICA IDENTITY DEFAULT;  -- intended-live·active soft-delete(rooms FULL = HARD REJECT)
ALTER TABLE public.check_in_room_logs       REPLICA IDENTITY DEFAULT;  -- INSERT-only(CheckInDetailSheet.tsx:969)

-- ── NO-OP: timer_records(DELETE listener 부재·INSERT+UPDATE NEW-row only) · waiting_board(§16-3a) ──
--   본 마이그 미접촉 — 현행 멤버십·DEFAULT 유지.

-- ============================================================
-- Migration: payments.payment_attempt_id FK(CAT-origin 판별자 + 이중결제 2차방어) + 선택 merchant_no
-- Ticket: T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD  (K7)
-- ============================================================
-- SSOT: memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_cband_cat_direct_pay_3way_canon_20260731.md (§1 순DDL 2)
--   change-class = ADDITIVE (신규 컬럼·인덱스, 파괴변경 0) → autonomy §3.1 대표게이트 면제.
--   gate = supervisor DDL-diff.
--
-- 무엇 (§1 정본 · dead-column-free):
--   · payments.payment_attempt_id uuid FK → cband_payment_attempts(id) ON DELETE SET NULL.
--     = ★CAT-origin 판별자(payment_attempt_id IS NOT NULL) — pos_provider='cband'(dead) 술어 대체.
--   · partial UNIQUE WHERE payment_attempt_id IS NOT NULL = 1 attempt ↔ 0..1 payment
--     = ★이중결제 2차 방어(중복 승인콜백 INSERT → 23505 → 앱레이어 멱등 skip).
--   · 선택 payments.merchant_no text = MERNO 대사(A11/A12 조인) 편의 (redpay_terminal_registry 격리).
--   · ★pos_*/pg_* 무접촉·부활금지(종이 마이그 20260703183000 적용 안 함). external_* 재사용(스키마 무변).
--
-- ★DEDUP(§2 cross-path): CAT payment 는 external_approval_no+external_tid+payment_attempt_id 를 채워 매칭 pool 정상편입 →
--   RedPay 피드행 도착 시 매처가 R↔P 매칭·reconciled_at set·P2 skip(흡수). C2 ISOLATION 아님(RETRACT).
--
-- 무회귀: ADDITIVE-ONLY(ADD COLUMN IF NOT EXISTS + partial UNIQUE INDEX). 기존 payments 행 무변(default NULL).
-- 선행: 20260731190000_foot_cband_payment_attempts.sql (FK 참조 대상 테이블).
-- rollback: 20260731190500_foot_payments_payment_attempt_id_fk.rollback.sql
-- dryrun  : 20260731190500_foot_payments_payment_attempt_id_fk.dryrun.mjs (No-Persistence: txn-strip + ROLLBACK + post-probe)
-- ============================================================

BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS merchant_no        text;

-- FK → cband_payment_attempts. ON DELETE SET NULL(감사테이블 삭제 시 payments 보존).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payments_payment_attempt_id_fkey' AND table_name = 'payments'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_payment_attempt_id_fkey
      FOREIGN KEY (payment_attempt_id)
      REFERENCES public.cband_payment_attempts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ★이중결제 2차방어: 1 attempt ↔ 0..1 payment (partial UNIQUE, NULL 무제약).
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_payment_attempt_id
  ON public.payments (payment_attempt_id)
  WHERE payment_attempt_id IS NOT NULL;

COMMENT ON COLUMN public.payments.payment_attempt_id IS
  '코밴 CAT 직결 결제 시도(cband_payment_attempts.id) FK. ★CAT-origin 판별자 = IS NOT NULL(pos_provider 대체·dead-column-free) + 이중결제 2차방어(partial UNIQUE). T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD';
COMMENT ON COLUMN public.payments.merchant_no IS
  '코밴 CAT 가맹점번호(MERNO) — RedPay 정산 MERNO 대사(A11/A12) 조인. 동 티켓';

COMMIT;

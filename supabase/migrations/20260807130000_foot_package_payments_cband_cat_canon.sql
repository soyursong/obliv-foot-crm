-- ============================================================
-- Migration: package_payments 코밴 CAT 직결결제 canon 컬럼 (플랜A ④ 패키지 결제 확장)
-- Ticket: T-20260806-foot-PLANA-PKG-PAY-EXPAND  (AC-1/AC-3/AC-4 착지모델)
-- ============================================================
-- SSOT: DA-20260806-foot-PLANA-PKG-PAY-LANDING-MODEL (CONSULT-REPLY MSG-20260806-164140-y0ua)
--   verdict = (b) canonical GO(조건부·ADDITIVE). change-class = ADDITIVE → autonomy §3.1 대표게이트 면제.
--   gate = supervisor DDL-diff / MIG-GATE only. da_consult_ref = DA-20260806-foot-PLANA-PKG-PAY-LANDING-MODEL.
--
-- 착지모델 (b): CAT 패키지 결제 = package_payments **행**으로 착지(payments 미착지 = VG-1 double-count firewall).
--   `payments.package_id + union 재계산` 경로 = REJECT(이중소스 SSOT·drift·clobber 영구화).
--
-- 무엇 (DA §신규컬럼, nullable ADDITIVE · dead-column-free):
--   · package_payments.external_approval_no text  — 카드 승인번호(AUTHNO). ★이미 존재(mig 20260523040000
--       PAY-INPUT-001)이나 DA 3컬럼 명세 정합 위해 IF NOT EXISTS 로 idempotent 재선언(기존 시 no-op).
--   · package_payments.external_tid          text  — 단말기 TID. ★동일(20260523040000 기존) → VG-5: RedPay
--       external_trxid 매칭이 package_payments 도달하는 축(matcher reach 목적) 보존.
--   · package_payments.payment_attempt_id    uuid  — ★net-new. CAT-origin 판별자(cband_payment_attempts.id FK,
--       IS NOT NULL) + 이중결제 2차방어(partial UNIQUE). payments.payment_attempt_id(mig 20260731190500) 대칭.
--   · external_trxid 는 **추가 안 함**(RedPay 예약키 = payments 전용, DA 3컬럼 명세 = external_approval_no/
--       external_tid/payment_attempt_id 정확히 3개).
--
-- paid_amount 불변식(VG-0/VG-2): paid_amount = Σ signed package_payments **소스 불변**. CAT 착지 = 신규
--   write-site(supabaseAttemptStore.recordCardPackagePayment)가 기존 recalc 규약(PackagePaymentAdd) 동일
--   적용 → 재계산 site 3곳(PackagePaymentAdd/RefundDialog/recordManualPayment) 및 재계산 RPC body **무접촉**(C19).
--
-- 무회귀: ADDITIVE-ONLY(ADD COLUMN IF NOT EXISTS + FK + partial UNIQUE INDEX). 기존 package_payments 행 무변
--   (default NULL). 파괴변경 0·롤백대칭. cross-product 충돌 0(foot-local·sibling 강제 0).
-- 선행: 20260731190000_foot_cband_payment_attempts.sql (FK 참조 대상 테이블).
-- rollback: 20260807130000_foot_package_payments_cband_cat_canon.rollback.sql
-- dryrun  : 20260807130000_foot_package_payments_cband_cat_canon.dryrun.mjs (No-Persistence: txn-strip + ROLLBACK + post-probe)
-- ============================================================

BEGIN;

-- DA 3컬럼 명세 정합(external_* 2개는 20260523040000 기존 → IF NOT EXISTS no-op, payment_attempt_id 만 net-new).
ALTER TABLE public.package_payments
  ADD COLUMN IF NOT EXISTS external_approval_no text,
  ADD COLUMN IF NOT EXISTS external_tid         text,
  ADD COLUMN IF NOT EXISTS payment_attempt_id   uuid;

-- FK → cband_payment_attempts. ON DELETE SET NULL(감사테이블 삭제 시 package_payments 보존 = payments 대칭).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'package_payments_payment_attempt_id_fkey' AND table_name = 'package_payments'
  ) THEN
    ALTER TABLE public.package_payments
      ADD CONSTRAINT package_payments_payment_attempt_id_fkey
      FOREIGN KEY (payment_attempt_id)
      REFERENCES public.cband_payment_attempts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ★이중결제 2차방어: 1 attempt ↔ 0..1 package_payment (partial UNIQUE, NULL 무제약). payments 대칭
--   (중복 승인콜백 INSERT = 23505 → 앱레이어 멱등 skip). 기존 수기 package_payments(payment_attempt_id NULL) 무영향.
CREATE UNIQUE INDEX IF NOT EXISTS ux_package_payments_payment_attempt_id
  ON public.package_payments (payment_attempt_id)
  WHERE payment_attempt_id IS NOT NULL;

COMMENT ON COLUMN public.package_payments.payment_attempt_id IS
  '코밴 CAT 직결 결제 시도(cband_payment_attempts.id) FK. ★CAT-origin 판별자 = IS NOT NULL + 이중결제 2차방어(partial UNIQUE). 패키지 CAT 결제는 package_payments 행으로 단일 착지(payments 미착지·double-count firewall). T-20260806-foot-PLANA-PKG-PAY-EXPAND / DA-20260806-foot-PLANA-PKG-PAY-LANDING-MODEL(b)';
COMMENT ON COLUMN public.package_payments.external_approval_no IS
  '카드 승인번호(AUTHNO). CAT 착지 시 = 단말 응답 AUTHNO(취소 refund 행 매칭·재취소 멱등 앵커). T-20260522(PAY-INPUT-001) 신설 · T-20260806 CAT 재사용';
COMMENT ON COLUMN public.package_payments.external_tid IS
  '단말기 TID. CAT 착지 시 = 단말 응답 TID. ★VG-5: RedPay external_trxid 매칭이 package_payments 도달하는 축. T-20260522 신설 · T-20260806 CAT 재사용';

COMMIT;

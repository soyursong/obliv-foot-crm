-- T-20260616-foot-PKG-OUTSTANDING-BALANCE — 패키지 미수금(잔금) 추적 + 패키지/진료비 금액 분리
-- 현장요청(박장군님·김주연 총괄, MSG-20260616-164203-8mzp / 통합재진술 MSG-20260616-212307-lpwm):
--   (1) 패키지 분할결제 미납 잔액(미수금)을 시스템이 추적·표기.
--   (2) ★ 핵심: 패키지 금액 / 진료비 금액 을 **별도** 표기 — 합산 단일 "총금액" 절대 금지.
--       → 진료비 금액을 담을 컬럼이 packages 에 없음(현재 total_amount=패키지 금액 only).
--   (3) 진료비 잔금 = 진료비 금액 − Σ(진료비 결제분) 을 패키지 잔금과 **분리** 산출.
--
-- ★ ADDITIVE only — data-architect CONSULT GO (2026-06-16, dev-foot↔DA):
--   · packages.consultation_fee 신규(진료비 금액). NOT NULL DEFAULT 0 → 기존 행 전부 0 으로 backfill-safe.
--   · package_payments.fee_kind 신규(결제 귀속: package/consultation). NOT NULL DEFAULT 'package'
--     → 기존 결제행은 모두 패키지 결제(=package)로 정확히 backfill.
--   · 파괴변경 아님(기존 컬럼 무접촉·default 보유). ADDITIVE+DA GO = CEO 게이트 불요, supervisor DDL-diff만.
--   · 잔금 자체는 파생값(total_amount − Σpackage_payments) → 캐시컬럼 추가 없음(paid_amount 기존 캐시 보존).
--
-- 산출 규칙(FE 단일소스 footBilling.ts):
--   패키지 잔금  = packages.total_amount      − Σ signed(package_payments.amount WHERE fee_kind='package')
--   진료비 잔금  = packages.consultation_fee   − Σ signed(package_payments.amount WHERE fee_kind='consultation')
--   signed: payment_type='refund' → 음수. 두 잔금은 절대 합산 단일표기 금지(§4-A).
--
-- 멱등성: ADD COLUMN IF NOT EXISTS → 재실행 no-op. 안전: 무중단·무손실·완전 가역(rollback=DROP COLUMN).

BEGIN;

-- 1. 진료비 금액 (패키지 금액 total_amount 과 별개 컬럼)
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS consultation_fee INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.packages.consultation_fee IS
  '진료비 금액(패키지 금액 total_amount 과 별도, 합산 단일표기 금지). NOT NULL DEFAULT 0. T-20260616-foot-PKG-OUTSTANDING-BALANCE';

-- 2. 결제 귀속 구분 (패키지 결제 vs 진료비 결제) — 진료비 잔금을 패키지 잔금과 분리 산출
ALTER TABLE public.package_payments
  ADD COLUMN IF NOT EXISTS fee_kind TEXT NOT NULL DEFAULT 'package';

-- CHECK 은 멱등 보강(이미 있으면 skip)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_payments_fee_kind_check'
      AND conrelid = 'public.package_payments'::regclass
  ) THEN
    ALTER TABLE public.package_payments
      ADD CONSTRAINT package_payments_fee_kind_check
      CHECK (fee_kind IN ('package','consultation'));
  END IF;
END $$;

COMMENT ON COLUMN public.package_payments.fee_kind IS
  '결제 귀속: package(패키지 결제) / consultation(진료비 결제). 기존 행=package backfill. T-20260616-foot-PKG-OUTSTANDING-BALANCE';

-- 검증: 2컬럼 + CHECK 존재 확인
DO $$
DECLARE
  col_cnt int;
  chk_cnt int;
BEGIN
  SELECT count(*) INTO col_cnt
  FROM information_schema.columns
  WHERE table_schema='public'
    AND ( (table_name='packages'         AND column_name='consultation_fee')
       OR (table_name='package_payments' AND column_name='fee_kind') );
  SELECT count(*) INTO chk_cnt
  FROM pg_constraint
  WHERE conname='package_payments_fee_kind_check'
    AND conrelid='public.package_payments'::regclass;
  IF col_cnt <> 2 THEN
    RAISE EXCEPTION 'PKG-OUTSTANDING verify FAILED: expected 2 columns, found %', col_cnt;
  END IF;
  IF chk_cnt <> 1 THEN
    RAISE EXCEPTION 'PKG-OUTSTANDING verify FAILED: fee_kind CHECK missing';
  END IF;
END $$;

COMMIT;

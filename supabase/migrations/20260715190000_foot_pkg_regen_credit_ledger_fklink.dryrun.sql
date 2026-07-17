-- DRY-RUN (No-Persistence): T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK (구조 lane)
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 의 txn-control 문(BEGIN/COMMIT)은 여기서 STRIP → 아래는 단일 BEGIN..ROLLBACK 로 감싸 무영속.
--     (up.sql 의 COMMIT 를 그대로 실행하면 sentinel 이전 영속 → evidence divergence hazard. 그래서 제거.)
--   · txn 내부 assertion(DO $chk$): 4개 객체(FK 컬럼 2 + 테이블 2) + 헬퍼 실생성 검증. 실패 시 RAISE 'DRYRUN-FAIL' → abort.
--   · 사후 무영속(post-probe)은 runner 의 별 트랜잭션에서 컬럼/테이블 부재 재확인.
BEGIN;

-- ---- up.sql DDL 본문(txn-control 제거) ----
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES public.packages(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_payments_package ON public.payments(package_id) WHERE package_id IS NOT NULL;

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES public.packages(id);
CREATE INDEX IF NOT EXISTS idx_packages_superseded_by ON public.packages(superseded_by) WHERE superseded_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.package_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES public.clinics(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  account_type TEXT NOT NULL DEFAULT 'package' CHECK (account_type IN ('package','membership','card')),
  account_id UUID NOT NULL,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('charge','use','refund','transfer')),
  amount INTEGER NOT NULL,
  source_payment_id UUID REFERENCES public.payments(id),
  reanchored_from UUID REFERENCES public.packages(id),
  memo TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.package_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.packages(id),
  superseded_by UUID REFERENCES public.packages(id),
  amendment_type TEXT NOT NULL DEFAULT 'regenerate' CHECK (amendment_type IN ('regenerate','edit','cancel','credit_reanchor')),
  reason TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  actor UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.package_credit_balance(p_account_id UUID, p_account_type TEXT DEFAULT 'package')
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(SUM(amount),0)::INTEGER FROM public.package_credit_ledger
  WHERE account_id = p_account_id AND account_type = p_account_type;
$fn$;

-- ---- 검증 assertion ----
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='payments' AND column_name='package_id') THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: payments.package_id 미생성'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='packages' AND column_name='superseded_by') THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: packages.superseded_by 미생성'; END IF;
  IF to_regclass('public.package_credit_ledger') IS NULL THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: package_credit_ledger 미생성'; END IF;
  IF to_regclass('public.package_amendments') IS NULL THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: package_amendments 미생성'; END IF;
  IF public.package_credit_balance(gen_random_uuid()) <> 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: balance 헬퍼 비정상(0-row 기대 0)'; END IF;
  RAISE NOTICE 'DRYRUN-OK: 4 객체 + 헬퍼 실생성 검증 통과';
END
$chk$;

ROLLBACK;  -- 무영속

-- ---- post-probe (runner 별 트랜잭션 — 무영속 재확인) ----
-- SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='package_id');   -- f 기대
-- SELECT to_regclass('public.package_credit_ledger');   -- NULL 기대

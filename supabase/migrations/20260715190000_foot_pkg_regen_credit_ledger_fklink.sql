-- ============================================================
-- T-20260715-foot-PKG-REGEN-CREDIT-ORPHAN-FKLINK
-- 패키지 재생성 시 credit(선납금) 고아화(F-4716) 구조 해소 — 구조 lane (전부 ADDITIVE)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 롤백: 20260715190000_foot_pkg_regen_credit_ledger_fklink.rollback.sql
-- dry-run: 20260715190000_foot_pkg_regen_credit_ledger_fklink.dryrun.sql
-- 고아 백필: 20260715190000_foot_pkg_orphan_credit_freeze.report.sql (data lane — 별도 게이트)
-- 작성: dev-foot / 2026-07-15
-- ============================================================
-- 근거: data-architect CONSULT-REPLY (MSG-20260715-153541 / DA-20260715-...-FKLINK.md)
--   verdict = GO(조건부). cross_crm_data_contract §10-5(선불/잔액 ledger-SSOT — foot 패키지가
--   명시된 cross-CRM seed) 적용. §10-3/§10-7(payment↔purchase FK+NULLABLE 백필 선례),
--   §10-4a Q1/Q2(grain 오염 금지 + append-only supersede 정정) 동형.
--
-- 근본 원인: "패키지 크레딧을 mutable 패키지 행(packages.paid_amount)에 권위 저장" grain 안티패턴.
--   재생성(cancel + 신규 INSERT) 시 새 행이 paid_amount=0 으로 출발 → 원 패키지의 선납 credit 이
--   계보 없이 stranded(고아). package_payments.package_id 는 ON DELETE CASCADE 라 물리삭제 시 소실.
--
-- 처방(§10-5 적용):
--   Q1 권위 grain = NEITHER. 현금흐름=payments(append-only 수납). 크레딧 권위=append-only ledger.
--     → (a) payments.package_id FK 추가(ADDITIVE, ON DELETE RESTRICT) = 현금기록↔패키지 traceability
--           + 무단삭제 fail-closed. 단독으론 고아화 미해소.
--     → (b) credit 권위 = package_credit_ledger(charge/use/refund/transfer, polymorphic account_ref).
--           balance 는 저장이 아니라 ledger 합으로 파생. (paid_amount/credit '승계 로직'=REJECT: §10-5
--           기각한 이중 balance 캐시 안티패턴 재도입 금지.)
--   Q2 재생성 = in-place 강제 아님. credit 을 package 행 수명에서 decouple:
--     → packages.superseded_by = old→new supersedes 링크(append-only lineage, bare cancel+INSERT 금지).
--     → package_amendments = 누가/왜 append-only audit child(§10-4a Q2 조건 승계).
--       파괴적 delete-then-insert(계보·credit 절단) 금지.
--
-- ★ 본 마이그레이션은 전부 ADDITIVE:
--   - payments.package_id : NULLABLE 신규 컬럼(기존행 NULL, 검증 불요)
--   - packages.superseded_by : NULLABLE 신규 컬럼
--   - package_credit_ledger / package_amendments : 신규 테이블(0-row, net-new)
--   회귀0·롤백SQL 준비 → agent_autonomy_policy §3.1 대표게이트 면제, supervisor DDL-diff only.
--   (dev-foot 는 prod 직접 적용하지 않음 — supervisor db-gate 검토 후 적용.)
--   credit 백필(paid_amount → ledger 이관, 고아 re-anchor)은 data lane 별도 게이트(구조 선착지 원칙).
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: payments.package_id FK (linkage + fail-closed)
-- ============================================================
-- 단건 수납(payments) ↔ 패키지 traceability. NULLABLE(패키지 무관 수납 존재) + ON DELETE RESTRICT
-- (패키지에 수납기록이 붙어 있으면 물리삭제 실패 → credit 무단소실 fail-closed).
-- §10-3/§10-7 payments.purchase_id FK 선례 동형.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES public.packages(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_payments_package ON public.payments(package_id)
  WHERE package_id IS NOT NULL;

COMMENT ON COLUMN public.payments.package_id IS
  'T-20260715-...-FKLINK: 단건 수납↔패키지 linkage(NULLABLE). ON DELETE RESTRICT — 수납기록 붙은 패키지 물리삭제 차단(credit fail-closed).';

-- ============================================================
-- SECTION 2: packages.superseded_by (재생성 lineage — old→new)
-- ============================================================
-- 재생성 시 원본 패키지가 후속 패키지로 대체됨을 남기는 append-only 계보 링크.
-- bare cancel+INSERT 로 계보 절단 금지 → old.superseded_by = new.id 로 연결.
-- transferred_from/transferred_to(양도)와 직교: superseded_by 는 "동일 고객 재구성" 계보.
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES public.packages(id);

CREATE INDEX IF NOT EXISTS idx_packages_superseded_by ON public.packages(superseded_by)
  WHERE superseded_by IS NOT NULL;

COMMENT ON COLUMN public.packages.superseded_by IS
  'T-20260715-...-FKLINK: 재생성 계보. 이 패키지를 대체한 후속 패키지 id. 재생성=cancel(status)+링크(append-only lineage). NULL=현행/최신.';

-- ============================================================
-- SECTION 3: package_credit_ledger (credit 권위 = append-only ledger, §10-5 패턴)
-- ============================================================
-- 크레딧/잔액 권위 grain. balance 는 저장하지 않고 ledger 합으로 파생.
-- polymorphic account_ref(account_type + account_id) → 패키지/멤버십/선불카드 공통표준 seed(§10-5).
-- 현 단계 account_type='package' 만 사용. paid_amount 컬럼은 이관 전까지 병존(백필 lane 에서 수렴).
CREATE TABLE IF NOT EXISTS public.package_credit_ledger (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID        REFERENCES public.clinics(id),           -- 지점(NULL=account 로 파생). 통계/스코프용
  customer_id       UUID        NOT NULL REFERENCES public.customers(id),-- 크레딧 귀속 고객(재생성돼도 stable 앵커)
  account_type      TEXT        NOT NULL DEFAULT 'package'
                                CHECK (account_type IN ('package','membership','card')),
  account_id        UUID        NOT NULL,                                -- polymorphic 앵커(account_type='package'→packages.id)
  tx_type           TEXT        NOT NULL
                                CHECK (tx_type IN ('charge','use','refund','transfer')),
  amount            INTEGER     NOT NULL,                                -- 원(charge=+선납, use=-소진, refund=-환불, transfer=±양도)
  source_payment_id UUID        REFERENCES public.payments(id),          -- 이 tx 를 만든 수납행(있으면). 현금흐름 traceability
  reanchored_from   UUID        REFERENCES public.packages(id),          -- 재생성 re-anchor 시 원 소속 패키지(계보)
  memo              TEXT,
  created_by        UUID,                                                -- auth.uid()
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pkg_credit_ledger_account
  ON public.package_credit_ledger(account_type, account_id);
CREATE INDEX IF NOT EXISTS idx_pkg_credit_ledger_customer
  ON public.package_credit_ledger(customer_id);

COMMENT ON TABLE public.package_credit_ledger IS
  'T-20260715-...-FKLINK: 패키지/선불 크레딧 권위 원장(append-only, §10-5 ledger-SSOT). balance=Σamount 파생. polymorphic account_ref. cross-CRM(body/scalp) 공통표준 seed.';
COMMENT ON COLUMN public.package_credit_ledger.amount IS
  '원. charge=선납(+), use=소진(-), refund=환불(-), transfer=양도(±). balance=Σ(파생).';

-- append-only 강제: SELECT + INSERT 정책만 부여(UPDATE/DELETE 정책 없음 → RLS 로 차단, admin 포함).
ALTER TABLE public.package_credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pkg_credit_ledger_read ON public.package_credit_ledger;
CREATE POLICY pkg_credit_ledger_read ON public.package_credit_ledger
  FOR SELECT TO authenticated
  USING (is_approved_user());

DROP POLICY IF EXISTS pkg_credit_ledger_insert ON public.package_credit_ledger;
CREATE POLICY pkg_credit_ledger_insert ON public.package_credit_ledger
  FOR INSERT TO authenticated
  WITH CHECK (
    is_consultant_or_above()
    -- refund/transfer(음수 정정성 tx)는 admin/manager 만
    AND (tx_type IN ('charge','use') OR is_admin_or_manager())
    AND (created_by IS NULL OR created_by = auth.uid())
  );
-- UPDATE/DELETE 정책 없음 = append-only(정정은 반대부호 tx 추가로).

-- ============================================================
-- SECTION 4: package_amendments (재생성 audit child — 누가/왜, append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.package_amendments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id     UUID        NOT NULL REFERENCES public.packages(id),  -- 정정 대상(원본)
  superseded_by  UUID        REFERENCES public.packages(id),           -- 재생성 후속(있으면)
  amendment_type TEXT        NOT NULL DEFAULT 'regenerate'
                             CHECK (amendment_type IN ('regenerate','edit','cancel','credit_reanchor')),
  reason         TEXT,                                                 -- 왜
  before_snapshot JSONB,                                               -- 변경 전 스냅샷
  after_snapshot  JSONB,                                               -- 변경 후 스냅샷
  actor          UUID,                                                 -- auth.uid() (누가)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pkg_amendments_package
  ON public.package_amendments(package_id);

COMMENT ON TABLE public.package_amendments IS
  'T-20260715-...-FKLINK: 패키지 재생성/정정 audit child(append-only). 누가·왜·전후 스냅샷. 파괴적 delete-then-insert 금지 → 계보 보존.';

ALTER TABLE public.package_amendments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pkg_amendments_read ON public.package_amendments;
CREATE POLICY pkg_amendments_read ON public.package_amendments
  FOR SELECT TO authenticated
  USING (is_approved_user());

DROP POLICY IF EXISTS pkg_amendments_insert ON public.package_amendments;
CREATE POLICY pkg_amendments_insert ON public.package_amendments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_consultant_or_above()
    AND (actor IS NULL OR actor = auth.uid())
  );
-- UPDATE/DELETE 정책 없음 = append-only.

-- ============================================================
-- SECTION 5: package_credit_balance() — 파생 잔액 헬퍼(§10-5 "balance=ledger 합")
-- ============================================================
-- 저장 balance 컬럼을 두지 않는 것이 §10-5 확정 → 조회는 이 헬퍼로 ledger 합산.
-- 현 단계 ledger 는 0-row → 백필 이관 전까지는 0 반환(FE 는 기존 paid_amount 계속 사용).
CREATE OR REPLACE FUNCTION public.package_credit_balance(p_account_id UUID, p_account_type TEXT DEFAULT 'package')
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount), 0)::INTEGER
  FROM public.package_credit_ledger
  WHERE account_id = p_account_id
    AND account_type = p_account_type;
$$;

REVOKE EXECUTE ON FUNCTION public.package_credit_balance(UUID, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.package_credit_balance(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.package_credit_balance(UUID, TEXT) IS
  'T-20260715-...-FKLINK: 크레딧 잔액 = package_credit_ledger 합 파생(§10-5, 저장 balance 없음).';

COMMIT;

-- ============================================================
-- POST-DEPLOY CHECKLIST (supervisor — DDL-diff only 게이트)
-- ============================================================
-- [ ] 1. payments.package_id 존재     : \d public.payments      → package_id / FK RESTRICT
-- [ ] 2. packages.superseded_by 존재   : \d public.packages       → superseded_by / FK packages
-- [ ] 3. ledger 0-row + RLS on         : SELECT COUNT(*) FROM public.package_credit_ledger;  -- 0
--                                        SELECT relrowsecurity FROM pg_class WHERE relname='package_credit_ledger';  -- t
-- [ ] 4. ledger append-only            : UPDATE/DELETE 정책 부재 확인(SELECT+INSERT 2개만)
--                                        SELECT polcmd FROM pg_policy WHERE polrelid='public.package_credit_ledger'::regclass;  -- r,a 만
-- [ ] 5. amendments 0-row + RLS on     : SELECT COUNT(*) FROM public.package_amendments;  -- 0
-- [ ] 6. balance 헬퍼                  : SELECT public.package_credit_balance(gen_random_uuid());  -- 0
-- [ ] 7. 기존 회귀 0                    : 기존 packages/payments/package_payments 동선 무변경(신규 컬럼 NULL 기본)
-- ------------------------------------------------------------
-- ⚠ 백필(paid_amount → ledger 이관 + 고아 credit re-anchor)은 본 구조 적용 후
--   20260715190000_foot_pkg_orphan_credit_freeze.report.sql 로 freeze→count 산출 제출 → data-diff 게이트.
-- ============================================================

-- T-20260807-foot-MEDAID1-HEALTHFEE-BALANCE-NOTPERSISTED
-- 건강생활유지비(의료급여 1종 공단 지원금) 잔액 방문 간 이월 저장 — foot-local satellite 1:1.
--
-- 문제(RCA 실측):
--   PaymentMiniWindow.tsx healthMaintenanceBalance = useState<number>(0) + 새 방문 진입 시 setState(0)
--   → 잔액 저장소 부재 → 매 방문 0 초기화 → 스태프가 방문마다 공단 포털 수기 재확인.
--   (Phase A 공단차감 버튼은 배포됨: 317a0c28 + 51562df2. 본건 = "저장소" 신설.)
--
-- DA 설계 제약 (SSOT: da_decision_foot_medaid1_healthfee_balance_persist_20260807 · verdict GO(조건부)·ADDITIVE):
--   · 전용 잔액원장 테이블(차감이력 ledger) = REJECT — 차감이력은 이미 payments 축에 원장화
--     (v2.46 recordManualPayment, method='health_maintenance', Σ(net)==payableTotal). 별도 ledger = dual-ledger drift.
--   · PRIMARY = foot-local satellite 1:1 {verified_balance, verified_at, verified_by} = "스태프가 확인한 잔액 스냅샷"만 영속.
--   · ★현재잔액 = DERIVED(감소 mutable 컬럼/decrement write 금지):
--       current = verified_balance − Σ(HM payments net WHERE created_at >= verified_at)
--     → drift-free · 멱등 by-construction · double-decrement 구조불가 · decrement write 0 ·
--       DoD#2 Σ(payments)==payableTotal 을 by-construction 충족(payments 원장 무접점).
--   · 월전환 재확인(DoD#3) = verified_at 기준 stale 판정(FE, 월 경계 넘으면 재확인 유도).
--
-- change-class: ADDITIVE (net-new 테이블 + RLS only). 기존 테이블/행/제약 mutation 0. 파괴 0.
--   §3.1 CEO 게이트 면제(DA GO+ADDITIVE). 잔여 게이트 = supervisor DDL-diff / MIG-GATE.
--
-- PHI/RLS: PHI-adjacent 재무(급여 balance·patient-bound). foot single-clinic →
--   customers/payments 동급 tier(auth_all: authenticated FOR ALL). anon = 정책 부재 = default-deny
--   (명시 REVOKE 로 anon-deny 이중 확정). 내부 스태프 = copay 동일 정상 read(마스킹 불요).
-- cross-CRM: foot-local NOW. promote(body MEDAID2 등) = NOT-NOW(후속 별건).
--
-- Rollback: 20260807150000_foot_health_maintenance_balances_satellite.rollback.sql
-- Dry-run:  20260807150000_foot_health_maintenance_balances_satellite.dryrun.mjs (No-Persistence)
-- author: dev-foot / 2026-08-07
-- ticket: T-20260807-foot-MEDAID1-HEALTHFEE-BALANCE-NOTPERSISTED

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- satellite 1:1 (customer_id PK = 1:1 with customers)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.health_maintenance_balances (
  customer_id      UUID        PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  clinic_id        UUID        NOT NULL REFERENCES public.clinics(id),
  -- 스태프가 공단 포털에서 확인한 "검증 잔액 스냅샷"(정수 원). 현재잔액은 이 값에서 payments 로 파생(DERIVED).
  verified_balance INTEGER     NOT NULL CHECK (verified_balance >= 0),
  -- 스냅샷 시각 = 파생 기준선. Σ(HM payments WHERE created_at >= verified_at) 만 차감.
  verified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 확인한 스태프(감사). staff 삭제 시 감사값만 소실(잔액 스냅샷은 보존).
  verified_by      UUID        REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.health_maintenance_balances IS
  'T-20260807-foot-MEDAID1-HEALTHFEE-BALANCE-NOTPERSISTED: 의료급여1종 건강생활유지비(공단 지원금) '
  '검증 잔액 스냅샷(satellite 1:1 with customers). 현재잔액=DERIVED(verified_balance − Σ(HM payments >= verified_at)), '
  '이 테이블엔 decrement write 없음(스냅샷만 영속). DA GO(조건부)·ADDITIVE.';
COMMENT ON COLUMN public.health_maintenance_balances.verified_balance IS
  '스태프 확인 검증 잔액 스냅샷(원). 현재잔액 아님 — 현재잔액은 payments 에서 파생.';
COMMENT ON COLUMN public.health_maintenance_balances.verified_at IS
  '스냅샷 검증 시각 = 파생 기준선 + 월전환 stale 판정 기준(DoD#3).';

-- updated_at 자동 갱신(멱등 재선언)
CREATE OR REPLACE FUNCTION public.tg_health_maintenance_balances_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_health_maintenance_balances_touch ON public.health_maintenance_balances;
CREATE TRIGGER trg_health_maintenance_balances_touch
  BEFORE UPDATE ON public.health_maintenance_balances
  FOR EACH ROW EXECUTE FUNCTION public.tg_health_maintenance_balances_touch();

-- ══════════════════════════════════════════════════════════════════
-- RLS: foot single-clinic customers/payments 동급 tier (auth_all) + anon-deny
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE public.health_maintenance_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all" ON public.health_maintenance_balances;
CREATE POLICY "auth_all" ON public.health_maintenance_balances
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- anon-deny 이중 확정: RLS 정책 부재 = default-deny 이나, grant 자체를 회수해 명시적으로 차단.
REVOKE ALL ON public.health_maintenance_balances FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_maintenance_balances TO authenticated;

COMMIT;

-- 검증 (apply 후):
-- SELECT to_regclass('public.health_maintenance_balances');                 -- 기대: 테이블 실재
-- SELECT relrowsecurity FROM pg_class WHERE relname='health_maintenance_balances';  -- 기대: t
-- SELECT polname FROM pg_policy WHERE polrelid='public.health_maintenance_balances'::regclass;  -- 기대: auth_all

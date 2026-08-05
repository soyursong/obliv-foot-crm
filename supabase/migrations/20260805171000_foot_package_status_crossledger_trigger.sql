-- ════════════════════════════════════════════════════════════════════════════
-- T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §2
--   writer-agnostic 패키지 status 재계산 트리거 (신규 ADDITIVE forward DDL)
--
-- SSOT: DA-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX (GO 조건부·census-gated)
--   HARD census C1~C5 finalize(commit 07941264) — 재-CONSULT 트리거 0건 hit.
--
-- ── 왜 트리거인가 (census C4) ────────────────────────────────────────────────
--   패키지 status='refunded' 파생은 현재 refund_package_payment RPC 안의 단방향
--   UPDATE 1곳뿐이고, 그 net_paid 는 package_payments(원장①)만 합산한다. 결제수단-변경
--   재결제가 payments(원장②)에 착지하면(F-4717) 원장①-only 파생이 구조적 blind →
--   refunded 오표시 + 회차권 사용불가. RPC 재정의만으로는 payments 착지를 auto-heal
--   불가(RPC 는 환불시점에만 발화). ∴ payments AND package_payments 양쪽 write 에서
--   발화하는 writer-agnostic 트리거가 유일 정답(VG4 single-authority).
--
-- ── 파생 규칙 (census C4·VG1·VG5) ────────────────────────────────────────────
--   net_paid_crossledger =
--       Σ package_payments(payment:+amount / refund:−amount   for pkg)
--     + Σ payments(payment:+amount / refund:−amount   WHERE package_id=pkg AND status='active')
--   · net > 0  → active   (진성복원 시에만 refunded→active. F-4717 재결제 링크 후 auto-heal)
--   · net ≤ 0  → refunded (진성환불. net_paid=0 유지)
--   결정적 양방향(active↔refunded). 매출 인식축 무접촉(C5 firewall) — packages.status 만 변경.
--
-- ── 자동 파생 축 국한 (안전) ────────────────────────────────────────────────
--   자동 전이는 {active, refunded} 두 상태 사이에서만. completed/cancelled/transferred =
--   수동/터미널 상태 → 트리거 무접촉(현행 RPC 가드도 status='active' 조건이었음).
--
-- ── 매출 firewall (C5) ──────────────────────────────────────────────────────
--   packages.status(패키지-레벨) ≠ payments.status(결제-레벨). v_daily_revenue 는
--   payments.status='active'+package_payments 를 amount 로 합산(package_id 무관) →
--   본 트리거의 packages.status 변경은 매출뷰 무영향·이중계상 0.
--
-- change-class = ADDITIVE:
--   · 신규 함수 2개(재계산 코어 + 트리거 래퍼) + 신규 트리거 2개(payments·package_payments).
--   · 기존 테이블/컬럼/제약/enum/RLS/기존 트리거 무접촉. rollback = DROP(회귀 0).
--   autonomy §3.1: ADDITIVE+파괴0 → 대표 게이트 면제, supervisor DDL-diff + MIG-GATE.
--
-- Rollback = 20260805171000_foot_package_status_crossledger_trigger.rollback.sql
-- Dry-run  = 20260805171000_foot_package_status_crossledger_trigger.dryrun.mjs (no-persistence)
-- author: dev-foot / 2026-08-05
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. 재계산 코어 — 단일 package 의 cross-ledger net_paid → status 파생
--    SECURITY DEFINER: writer-agnostic 보장(authenticated staff·service_role EF 모두
--      writer 권한과 무관하게 status 파생이 확정 적용). search_path 핀(SECDEF seal).
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.foot_recompute_package_status(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_status text;
  v_net    integer;
  v_target text;
BEGIN
  IF p_package_id IS NULL THEN RETURN; END IF;

  -- 대상 패키지 LOCK(동시 write 직렬화). 자동파생은 active↔refunded 축에만 국한.
  SELECT status INTO v_status FROM packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_status NOT IN ('active','refunded') THEN RETURN; END IF;  -- completed/cancelled/transferred 무접촉

  -- cross-ledger net_paid (원장① package_payments + 원장② payments(package_id 링크, active만))
  SELECT
      COALESCE((SELECT SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)
                  FROM package_payments
                 WHERE package_id = p_package_id), 0)
    + COALESCE((SELECT SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)
                  FROM payments
                 WHERE package_id = p_package_id
                   AND status = 'active'
                   AND deleted_at IS NULL), 0)
    INTO v_net;

  v_target := CASE WHEN v_net > 0 THEN 'active' ELSE 'refunded' END;

  -- 실제 전이 필요할 때만 UPDATE(불필요 write·updated_at drift 회피).
  IF v_target IS DISTINCT FROM v_status THEN
    UPDATE packages SET status = v_target WHERE id = p_package_id;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.foot_recompute_package_status(uuid) IS
  'cross-ledger(package_payments 원장① + payments 원장②·package_id 링크·active) net_paid → packages.status 결정적 파생(net>0 active / net≤0 refunded). 자동 전이 축=active↔refunded 국한. T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §2. REVTRANSITION-FWDFIX-STATUS-AUTHORITY.';

-- ──────────────────────────────────────────────────────────────
-- 2. 트리거 래퍼 — NEW/OLD 의 package_id 대상 재계산(양원장 공용). AFTER 문 → RETURN NULL.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.foot_trg_recompute_package_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.foot_recompute_package_status(OLD.package_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.foot_recompute_package_status(NEW.package_id);
    -- package_id 재귀속(드묾) 시 이전 패키지도 재계산.
    IF NEW.package_id IS DISTINCT FROM OLD.package_id THEN
      PERFORM public.foot_recompute_package_status(OLD.package_id);
    END IF;
  ELSE  -- INSERT
    PERFORM public.foot_recompute_package_status(NEW.package_id);
  END IF;
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.foot_trg_recompute_package_status() IS
  'AFTER INSERT/UPDATE/DELETE 트리거 래퍼 — payments·package_payments write 에서 발화, 영향 package status 재계산 위임(writer-agnostic). T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §2.';

-- ──────────────────────────────────────────────────────────────
-- 3. 트리거 부착 — payments(원장②) + package_payments(원장①) 양발화
--    DROP IF EXISTS → CREATE(멱등). 기존 트리거명과 충돌 없음(신규 고유명).
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_payments_pkg_status_recompute ON public.payments;
CREATE TRIGGER trg_payments_pkg_status_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.foot_trg_recompute_package_status();

DROP TRIGGER IF EXISTS trg_pkgpay_pkg_status_recompute ON public.package_payments;
CREATE TRIGGER trg_pkgpay_pkg_status_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.package_payments
  FOR EACH ROW EXECUTE FUNCTION public.foot_trg_recompute_package_status();

-- ──────────────────────────────────────────────────────────────
-- 4. SECDEF grant-seal — intended-caller-tier: backend-only.
--    재계산 코어(RETURNS void·SECDEF·no-authz)는 트리거에서만 발화 → 직접 EXECUTE 전면 차단(C23).
--    foot backend-only 이디엄(REVOKE PUBLIC/anon/authenticated + GRANT service_role) 준수.
--    default-priv 가 신규 함수에 authenticated EXECUTE 를 auto-상속 → authenticated 명시 REVOKE 필수
--    (C23-3 authenticated 잔차 봉인). 트리거 래퍼는 trigger-typed → 직접 호출 불가, 별도 revoke 불요.
-- ──────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.foot_recompute_package_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.foot_recompute_package_status(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.foot_recompute_package_status(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.foot_recompute_package_status(uuid) TO service_role;

COMMIT;

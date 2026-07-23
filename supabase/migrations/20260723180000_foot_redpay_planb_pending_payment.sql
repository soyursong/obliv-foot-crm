-- ══════════════════════════════════════════════════════════════════
-- T-20260723-foot-REDPAY-PLANB-DDL-BUILD — 레드페이 플랜B 선점표 pending_payment 신설 (ADDITIVE)
-- ══════════════════════════════════════════════════════════════════
-- DA 판정: GO_ADDITIVE_WITH_REFINEMENTS (DA-20260723-FOOT-REDPAY-PLANB-DDL). 대표게이트 면제(autonomy §3.1),
--   supervisor DDL-diff 게이트만. cross-product 정책충돌 없음(foot-local per-CRM 테이블, schema_registry blast=0).
-- SSOT(DDL 초안 정본·실측근거): memory/1_Projects/201_메디빌더_AI도입/da_decision_foot_redpay_planb_ddl_20260723.md §①(L47~79).
--
-- ── 설계 근거 (DA 결정문 §① 보정 5+3건) ────────────────────────────────
--   · pending_payment = "선점표": 결제 전 예상금액을 open 으로 선점 → 웹훅/폴러 raw 도착 시 expected_amount 매칭.
--   · clinic_id NOT NULL FK + RLS(canonical 헬퍼 current_user_clinic_id()+is_approved_user(), 인라인 서브쿼리 금지) — 멀티테넌트 표준.
--   · customer_id(RESTRICT 기본, orphan 방지) / check_in_id(ON DELETE CASCADE, 방문 자식) FK.
--   · expected_amount INTEGER NOT NULL = ★매칭 키(예상금액). 선점 매칭의 핵심 컬럼.
--   · matched_raw_txid FK=redpay_raw_transactions(id) ON DELETE SET NULL(nullable, 매칭 시에만 채움) — matched_payment_id→payments 대칭.
--   · matched_at TIMESTAMPTZ nullable = 'matched' 전이 시각(웹훅 지연·감사). created_by TEXT = 선점 등록 staff.
--   · status TEXT+CHECK('open|matched|expired|cancelled') NOT NULL DEFAULT 'open' — foot enum-미사용 패턴(check_ins/services 계승).
--   · 부분유니크 (clinic_id, customer_id) WHERE status='open' — 멀티테넌트 안전 open 중복선점 방지.
--   · 매칭 조회 인덱스 (clinic_id, expected_amount) WHERE status='open'.
--   · expires_at(TTL) 은 이번 미포함(deferred) — received_at 관측(2~3일) 후 별도 ADDITIVE(nullable + expire 배치)로 추가.
--
-- ── ADDITIVE 계약 ─────────────────────────────────────────────────────
--   신규: TABLE pending_payment + 인덱스 2 + updated_at 트리거 + RLS(정책 1). 파괴적 변경 0.
--   무접촉: payments / redpay_raw_transactions / payment_reconciliation_log / customers / check_ins / clinics 의
--     컬럼·제약·트리거·RLS·원장. 매출 split SSOT 무접점(pending_payment 은 예정=선점, payments write 안 함 → AC7).
--   service_role = RLS 바이패스(웹훅 매칭 워커가 INSERT/UPDATE). authenticated = 자기 clinic + 승인유저만 R/W.
--   멱등: CREATE TABLE/INDEX IF NOT EXISTS + DROP POLICY/TRIGGER IF EXISTS(재실행 무해).
--   Rollback: 20260723180000_foot_redpay_planb_pending_payment.rollback.sql (DROP TABLE — 선점행 소실, supervisor 사전확인).
--   Dry-run(무영속): 20260723180000_foot_redpay_planb_pending_payment.dryrun.mjs (canonical dryrun_lib 러너).
--
-- risk: GO(ADDITIVE, 신규 테이블, 소비처 0). db_only(FE/EF 무변경) → E2E spec 면제, MIG-GATE evidence 4필드 의무.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. TABLE pending_payment (선점표) — DA 결정문 §① DDL 초안 그대로 ──────────
CREATE TABLE IF NOT EXISTS public.pending_payment (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        UUID        NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  customer_id      UUID        NOT NULL REFERENCES public.customers(id),          -- RESTRICT(default): orphan 방지
  check_in_id      UUID        NOT NULL REFERENCES public.check_ins(id) ON DELETE CASCADE,  -- 방문 자식
  expected_amount  INTEGER     NOT NULL,                                          -- ★ 매칭 키(예상금액)
  status           TEXT        NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open','matched','expired','cancelled')),
  matched_raw_txid UUID        REFERENCES public.redpay_raw_transactions(id) ON DELETE SET NULL,  -- 매칭 시에만 채움
  matched_at       TIMESTAMPTZ,                                                   -- 'matched' 전이 시각(nullable)
  created_by       TEXT,                                                          -- 선점 등록 staff
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. 인덱스 — open 중복선점 방지(부분유니크) + 매칭 조회 ────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS pending_payment_open_uq
  ON public.pending_payment (clinic_id, customer_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS pending_payment_match_idx
  ON public.pending_payment (clinic_id, expected_amount) WHERE status = 'open';

-- ── 3. updated_at 트리거 (기존 public.set_updated_at() 재사용) ───────────────
DROP TRIGGER IF EXISTS pending_payment_updated_at ON public.pending_payment;
CREATE TRIGGER pending_payment_updated_at
  BEFORE UPDATE ON public.pending_payment
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. RLS — canonical 헬퍼 사용(인라인 서브쿼리 금지). service_role 은 RLS 바이패스(워커) ──
ALTER TABLE public.pending_payment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_payment_rw_own_clinic ON public.pending_payment;
CREATE POLICY pending_payment_rw_own_clinic ON public.pending_payment
  FOR ALL TO authenticated
  USING      (clinic_id = public.current_user_clinic_id() AND public.is_approved_user())
  WITH CHECK (clinic_id = public.current_user_clinic_id() AND public.is_approved_user());

COMMENT ON TABLE public.pending_payment IS
  'T-20260723-foot-REDPAY-PLANB-DDL-BUILD 선점표: 결제 전 예상금액(expected_amount) 을 open 으로 선점 → 웹훅/폴러 raw 도착 시 매칭(status=matched, matched_raw_txid/matched_at set). '
  '매출 grain 아님(선점=예정) — 실 매출은 기존 payments 파이프 계승, pending_payment 은 payments write 안 함. '
  'DA-20260723-FOOT-REDPAY-PLANB-DDL (ADDITIVE). 워커 write=service_role(RLS 바이패스).';
COMMENT ON COLUMN public.pending_payment.expected_amount IS '★ 선점 매칭 키(예상금액, 원 단위 정수). raw amount 와 대조.';
COMMENT ON COLUMN public.pending_payment.status IS 'open=선점 대기 / matched=raw 매칭 완료 / expired=TTL 만료(후속 배치) / cancelled=수동 취소.';
COMMENT ON COLUMN public.pending_payment.matched_raw_txid IS 'redpay_raw_transactions(id) FK. 매칭 시에만 채움. raw 삭제 시 SET NULL(선점행 보존).';

COMMIT;

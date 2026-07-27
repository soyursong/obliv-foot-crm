-- ════════════════════════════════════════════════════════════════════════════
-- T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY
--   (consolidates split-sibling T-20260727-foot-PKG-REFUND-CREATEDBY-CAPTURE)
-- package_payments.created_by 환불 처리자 귀속 컬럼 + refund_package_payment auto-capture — ADDITIVE
--
-- 근거: DA CONSULT-REPLY(재판정) DA-20260727-foot-PKG-REFUND-CREATEDBY-CAPTURE
--   (MSG-20260727-163332-xb8v, 2026-07-27 16:33 KST) → 판정 GO(ADDITIVE).
--   payments.created_by(DA-20260717 envelope, 20260717140000 마이그) 와 동형 canonical
--   audit-column 패턴을 형제 테이블 package_payments 에 복제. nullable·default 없음·
--   기존행 무변경·데이터유실 0·함수 시그니처 무변경 → 순수 additive.
--   autonomy §3.1: ADDITIVE+파괴0+cross-product 충돌0 → 대표 게이트 불요, supervisor DDL-diff만.
--
-- cross-product(DA Q1): package_payments 는 foot-LOCAL. S3 Bronze→Silver fct_revenue_daily
--   매출집계 export 접점 있으나 소비 컬럼=금액·환불·grain 이지 audit(created_by) 아님 →
--   집계 계약·매출 split·ROAS 분모 무영향. SELECT* export 엔 순수 additive.
--
-- 스코프: 일마감(Closing.tsx) 패키지 환불 이력 "처리자" 표시 근거.
--   · 패키지 환불 행: refund_package_payment RPC INSERT 에 created_by=auth.uid() auto-capture 추가.
--   · 단건 환불은 payments.created_by(20260717140000)로 이미 캡처·표시 중(PROCESSOR-DISPLAY Part1).
--
-- INSERT target(DA PIN): package_payments 유지 확정. payments 전환 = 누적환불 회계 파괴 → 기각.
-- 처리 시각(AC): package_payments.created_at(TIMESTAMPTZ DEFAULT now(), prod 실재) 재사용 — DDL 불요.
-- 백필(DA Q3): forward-only. 과거 패키지 환불행 created_by=NULL → FE '—'. 백필 미의무.
--
-- FK 기본명: package_payments_created_by_fkey (Postgres auto-name)
--   → FE JOIN alias processor:user_profiles!package_payments_created_by_fkey(name) 와 정합.
--
-- 선례: payments.created_by (20260717140000_foot_payments_created_by_processor) 동형.
-- 하위호환: package_payments read 경로(매출집계/마감/원장) 무영향 — 신규 nullable 컬럼만.
-- Rollback = 20260727210000_foot_package_payments_created_by.rollback.sql (컬럼 drop + 직전 RPC 복원).
-- author: dev-foot / 2026-07-27
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. package_payments.created_by 컬럼 + partial index (ADDITIVE, 멱등)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.package_payments
  ADD COLUMN IF NOT EXISTS created_by UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.package_payments.created_by IS
  '패키지 결제/환불 처리 직원(user_profiles.id). 환불=refund_package_payment auth.uid() auto-capture. 기존행 NULL=미기록(FE ''—''). audit actor 귀속(권고). created_by(처리자) ≠ parent_payment_id(환불 link) ≠ consultant(판매 귀속) — 3축 직교.';

CREATE INDEX IF NOT EXISTS idx_package_payments_created_by
  ON public.package_payments(created_by) WHERE created_by IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 2. refund_package_payment RPC — INSERT 에 created_by=auth.uid() 추가
--    시그니처 무변경(내부 auto-capture only). 20260714200000 본문 + created_by 1컬럼만 추가.
--    money-path 불변식(서버 재조회 amount·누적환불 상한·clinic 격리·cascade 재정의) 전부 보존.
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refund_package_payment(
  p_payment_id UUID,   -- 원결제 package_payments.id (환불 대상 결제행)
  p_method     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig       package_payments%ROWTYPE;
  v_pkg        packages%ROWTYPE;
  v_prior      INTEGER;
  v_refund     INTEGER;
  v_new_id     UUID;
  v_net_paid   INTEGER;
  v_caller_clinic UUID;
BEGIN
  -- ── 1. 권한: 승인된 사용자만 (clinic 격리 = is_approved_user + clinic scope, DA PIN §1) ──
  IF NOT is_approved_user() THEN
    RETURN jsonb_build_object('error', '환불 권한이 없습니다.');
  END IF;

  -- ── 2. 원결제행 조회 + LOCK (① 서버 재조회 = money-path 위변조 봉인) ──
  SELECT * INTO v_orig
  FROM package_payments
  WHERE id = p_payment_id
    AND payment_type = 'payment'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '원결제 내역을 찾을 수 없습니다.');
  END IF;

  -- ── 3. clinic 격리: 원결제행 clinic ↔ 호출자 clinic 서버 강제 (FE 전달값 미신뢰) ──
  v_caller_clinic := current_user_clinic_id();
  IF v_caller_clinic IS NULL OR v_orig.clinic_id IS NULL OR v_orig.clinic_id <> v_caller_clinic THEN
    RETURN jsonb_build_object('error', '해당 결제에 대한 환불 권한이 없습니다.');
  END IF;

  -- 패키지 행 LOCK (status 파생 전이 시 정합 보장)
  SELECT * INTO v_pkg FROM packages WHERE id = v_orig.package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다.');
  END IF;

  -- ── 4. 처리금액 = 원결제행 amount (① 서버 재조회분, FE amount 무시) ──
  v_refund := v_orig.amount;
  IF v_refund <= 0 THEN
    RETURN jsonb_build_object('error', '환불할 결제 금액이 없습니다.');
  END IF;

  -- ── 5. 누적환불 상한 ② : Σ(이 원결제행에 linked 기존 환불) + 신규 ≤ row.amount ──
  SELECT COALESCE(SUM(amount), 0) INTO v_prior
  FROM package_payments
  WHERE parent_payment_id = p_payment_id
    AND payment_type = 'refund';

  IF v_prior + v_refund > v_orig.amount THEN
    RETURN jsonb_build_object(
      'error',
      format('환불 가능 잔여금액(%s원)을 초과합니다. (원결제 %s원 / 기환불 %s원)',
             GREATEST(v_orig.amount - v_prior, 0), v_orig.amount, v_prior)
    );
  END IF;

  -- ── 6. 환불 행 INSERT ③ : amount=net 실환불(양수), refund, parent_payment_id 링크, fee_kind 승계 ──
  --      created_by=auth.uid() 처리자 auto-capture (T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY).
  --      auth.uid()=JWT sub(CALLER uid) → SECURITY DEFINER 무관, 실제 환불 처리 스태프 귀속.
  --      JWT 없는 컨텍스트(service_role/cron)면 NULL → FE '—'(graceful).
  INSERT INTO package_payments (
    clinic_id, package_id, customer_id, amount, method, payment_type, parent_payment_id, fee_kind, created_by
  )
  VALUES (
    v_orig.clinic_id, v_orig.package_id, v_orig.customer_id,
    v_refund, p_method, 'refund', p_payment_id, v_orig.fee_kind, auth.uid()
  )
  RETURNING id INTO v_new_id;

  -- ── 7. cascade 재정의 (분리): status='refunded' 는 net_paid 전액이 덮일 때만 파생 전이 ──
  --      net_paid = Σ(payment) − Σ(refund) across the whole package
  SELECT COALESCE(
           SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE -amount END), 0)
    INTO v_net_paid
  FROM package_payments
  WHERE package_id = v_orig.package_id;

  IF v_net_paid <= 0 AND v_pkg.status = 'active' THEN
    UPDATE packages SET status = 'refunded' WHERE id = v_orig.package_id;
  END IF;
  -- session cascade OFF (DA PIN §3): package_sessions 원장 무접점 — used 회차 자동 'refunded' 금지.

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', v_new_id,
    'refund_amount', v_refund,
    'package_refunded', (v_net_paid <= 0 AND v_pkg.status = 'active')
  );
END;
$$;

COMMENT ON FUNCTION refund_package_payment(UUID, TEXT)
  IS '패키지 결제행 단위 환불(선택 row amount 서버 재조회·과다환불 상한·session cascade OFF·처리자 created_by auto-capture). T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH + T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY / DA-ADDITIVE-GO';

-- 인증된 사용자 실행 권한 (서버 내부에서 is_approved_user + clinic 격리 강제)
GRANT EXECUTE ON FUNCTION refund_package_payment(UUID, TEXT) TO authenticated;

COMMIT;

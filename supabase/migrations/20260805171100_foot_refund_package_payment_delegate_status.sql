-- ════════════════════════════════════════════════════════════════════════════
-- T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX §3
--   refund_package_payment 단방향 status 가드(v_pkg.status='active' → 'refunded') 제거
--   → status 파생을 §2 writer-agnostic cross-ledger 트리거에 위임(중복 파생 제거).
--
-- SSOT: DA-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX / HARD census C4 (commit 07941264).
--
-- ── 왜 제거인가 ──────────────────────────────────────────────────────────────
--   기존 §7 cascade 는 `net_paid(원장① package_payments only) ≤ 0 AND status='active'`
--   일 때만 refunded 로 단방향 전이했다. 이는 (a) 원장②(payments) 재결제에 blind,
--   (b) refunded→active 역전이 불가. §2 트리거가 payments·package_payments 양원장에서
--   발화하며 cross-ledger net_paid 로 active↔refunded 를 결정적 양방향 파생하므로,
--   RPC 내부 단방향 UPDATE 는 이제 중복(double-authority) → 제거하고 트리거에 위임.
--   · 환불 행 INSERT(아래 §6) → package_payments AFTER INSERT 트리거 발화 → status 재계산.
--     RPC 는 status 를 더 이상 직접 쓰지 않는다(single status-authority = 트리거, VG4).
--
-- ── 무변경 불변식 (money-path 전부 보존) ─────────────────────────────────────
--   · 권한(is_approved_user) · clinic 격리(current_user_clinic_id) · 서버 재조회 amount
--   · 누적환불 상한(Σlinked refund + 신규 ≤ row.amount) · created_by=auth.uid() auto-capture
--   · session cascade OFF(package_sessions 무접점) · 반환 payload 형태 유지.
--   시그니처 무변경(refund_package_payment(UUID, TEXT)). 유일 diff = §7 status UPDATE 제거.
--
-- change-class: CREATE OR REPLACE FUNCTION(기존 함수 본문 1블록 제거) → function-diff / C19 게이트.
--   money-path 산식·INSERT target(package_payments) 불변 → 매출/회계 무영향.
--
-- Rollback = 20260805171100_foot_refund_package_payment_delegate_status.rollback.sql
--   (20260727210000 버전 = 단방향 가드 복원). ⚠ §2 트리거 롤백과 함께 수행.
-- author: dev-foot / 2026-08-05
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION refund_package_payment(
  p_payment_id UUID,   -- 원결제 package_payments.id (환불 대상 결제행)
  p_method     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- REVTRANSITION-FWDFIX-DELEGATE: status 파생을 §2 cross-ledger 트리거에 위임(단방향 UPDATE 제거).
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

  -- 패키지 행 LOCK (트리거 재계산과의 정합 · 반환 payload 판정 근거 확보)
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
  --      ★이 INSERT 가 package_payments AFTER INSERT 트리거(§2)를 발화 → status 재계산(위임).
  INSERT INTO package_payments (
    clinic_id, package_id, customer_id, amount, method, payment_type, parent_payment_id, fee_kind, created_by
  )
  VALUES (
    v_orig.clinic_id, v_orig.package_id, v_orig.customer_id,
    v_refund, p_method, 'refund', p_payment_id, v_orig.fee_kind, auth.uid()
  )
  RETURNING id INTO v_new_id;

  -- ── 7. status 파생 = §2 트리거에 위임 (단방향 UPDATE 제거) ─────────────────────
  --      트리거가 위 INSERT 발화로 이미 cross-ledger net_paid 기준 active↔refunded 파생 완료.
  --      RPC 는 status 를 직접 쓰지 않는다(single status-authority=트리거, double-authority 제거).
  --      아래 net_paid 재조회는 반환 payload(package_refunded 힌트) 판정용 read-only.
  --      session cascade OFF (DA PIN §3): package_sessions 무접점 — used 회차 자동 refunded 금지.
  SELECT COALESCE(
           SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE -amount END), 0)
    INTO v_net_paid
  FROM package_payments
  WHERE package_id = v_orig.package_id;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', v_new_id,
    'refund_amount', v_refund,
    -- package_refunded = 이 환불로 패키지가 refunded 로 귀결되는지 힌트(트리거가 실제 전이 수행).
    'package_refunded', (v_net_paid <= 0 AND v_pkg.status = 'active')
  );
END;
$$;

COMMENT ON FUNCTION refund_package_payment(UUID, TEXT)
  IS '패키지 결제행 단위 환불(선택 row amount 서버 재조회·과다환불 상한·session cascade OFF·처리자 created_by auto-capture). status 파생=§2 cross-ledger 트리거 위임(단방향 가드 제거·single status-authority). T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH + T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY + T-20260805-foot-REPAY-PKGLINK-REVTRANSITION-FWDFIX / DA-GO';

GRANT EXECUTE ON FUNCTION refund_package_payment(UUID, TEXT) TO authenticated;

COMMIT;

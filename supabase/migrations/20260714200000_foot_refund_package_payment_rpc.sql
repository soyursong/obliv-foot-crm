-- T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH
-- 패키지 환불 금액 결함 정식 fix — 신규 함수 refund_package_payment (ADDITIVE)
--
-- 근본원인 (F-4696 실증): 기존 refund_package_atomic(4-arg) 은 calc_refund_amount
--   (정가 packages.total_amount ÷ total_sessions × 잔여회차) 견적으로 환불행을 INSERT
--   → 실수납액과 무관하게 과다환불. 실납 380,000 / 라이브 견적 4,676,659 ≈ 430만 손실 위험.
--
-- 최종 스펙 (김주연 총괄 2026-07-14 MSG-f2xa): "결제내역에서 개별 결제행 선택 →
--   그 row 의 amount 만 바인딩·표시·처리, pro-rata 사용회차 차감 없음" (A/B/C 산식축 폐기).
--
-- DA 결정 (da_decision_foot_pkg_refund_amount_mismatch_20260714.md, reply_id=
--   DA-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH): ADDITIVE 확정(GO). 제안 B(서버 재조회) 채택.
--   기존 4-arg refund_package_atomic 은 legacy 무변경 존치(무회귀). 신규 함수만 추가.
--
-- change-class = 신규 함수 추가만 (기존 함수/enum/제약/타입 무변경). 회귀 0.
-- Rollback = DROP FUNCTION (20260714200000_foot_refund_package_payment_rpc.rollback.sql).
--
-- ────────────────────────────────────────────────────────────────────────────
-- money-path 불변식 (DA PIN §2, 서버측 FOR UPDATE 강제):
--   ① 환불액 = 선택 원결제행 package_payments.amount (서버 재조회분). FE 전달 amount 무시.
--   ② 누적환불 상한: (해당 원결제행 기환불 Σ + 신규) ≤ row.amount. 초과 시 RAISE(거부).
--      링크 컬럼 = 기존 package_payments.parent_payment_id('환불 원거래 FK', sales_common_db)
--      재사용(ZERO-TABLE-DDL). refund_single_payment 의 linked_payment_id 잔여차감 패턴
--      (T-20260713 AC-3)과 동형이나, 패키지 환불은 parent_payment_id 를 link 키로 사용.
--   ③ refund 행 amount = net 실환불액(양수), payment_type='refund', parent_payment_id=원결제행.
--      (fct_revenue_daily.refund_total = sum(amount) WHERE refund → net 저장이라야 매출 정합)
--
-- cascade 재정의 (DA PIN §3, 분리):
--   · packages.status='refunded' 전이 = 누적환불이 패키지 net_paid 전액을 덮을 때(잔여=0)에만 파생.
--     분할결제 다행 중 1건만 환불 시 status 보류(active 유지).
--   · session cascade 分離 — 돈 환불이 package_sessions 원장(used 회차)을 재작성하지 않는다.
--     신규 함수는 옛 cascade(used→refunded)를 수행하지 않음.
--
-- clinic 격리 (DA PIN §1 B 시그니처): FE 는 p_payment_id(+p_method)만 전달. clinic_id/customer_id
--   는 서버가 원결제행에서 파생하고, 호출자 clinic(current_user_clinic_id) 과 일치 검증 후 강제.
--
-- author: dev-foot / 2026-07-14

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
  INSERT INTO package_payments (
    clinic_id, package_id, customer_id, amount, method, payment_type, parent_payment_id, fee_kind
  )
  VALUES (
    v_orig.clinic_id, v_orig.package_id, v_orig.customer_id,
    v_refund, p_method, 'refund', p_payment_id, v_orig.fee_kind
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
  IS '패키지 결제행 단위 환불(선택 row amount 서버 재조회·과다환불 상한·session cascade OFF). T-20260714-foot-PKG-REFUND-AMOUNT-MISMATCH / DA-ADDITIVE-GO';

-- 인증된 사용자 실행 권한 (서버 내부에서 is_approved_user + clinic 격리 강제)
GRANT EXECUTE ON FUNCTION refund_package_payment(UUID, TEXT) TO authenticated;

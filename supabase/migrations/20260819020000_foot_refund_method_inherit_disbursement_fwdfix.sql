-- T-20260819-foot-REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX  (Phase B — forward-fix leg)
-- da_consult_ref: DA-20260819-foot-REFUND-CROSSMETHOD-METHOD-INHERIT · verdict=CONDITIONAL-GO
-- SSOT: agents/docs/da_replies/da_decision_foot_refund_crossmethod_method_inherit_fwdfix_20260819.md
--
-- ── 근본 프레이밍 (DA dispositive) ─────────────────────────────────────────────
--   환불행 `method` 필드가 2개 직교축을 겹쳐 쓰고 있었다:
--     · Axis-A (attribution/귀속) = 어느 결제수단 버킷을 되돌리나 = 결제수단별 집계·PG/은행 대사 축
--                                 = canonical 원결제 method.  ← `method` 는 언제나 이 축.
--     · Axis-B (disbursement/실지급) = 돈이 물리적으로 어느 채널로 환급됐나 = 호출자 p_method 의 진짜 의미.
--   버그 = caller p_method(Axis-B 의도)를 method(Axis-A 슬롯)에 write → 결제수단별 집계·대사 desync.
--   census 확증: 총왜곡 2.76M(net 불변·수단간 재배치). split-dialect = 표준 REJECT 클래스.
--
-- ── 이 마이그가 하는 일 (code-gate 오라클 1~6) ──────────────────────────────────
--   (1) 3 RPC refund INSERT 의 method source = LOCKed 원결제(v_orig/v_original) method 강제 승계
--       (NOT p_method).  method 슬롯 overload 절대 금지.
--   (2) ADDITIVE `refund_disbursement_method`(nullable) 컬럼 — p_method(Axis-B 실지급 채널)을
--       사실 유실 없이 별 슬롯에 보존.  method 는 여전히 원결제 승계.  (DA DEFAULT LEAN = 포함:
--       additive 거의 무료 << go-forward genuine 사실유실 비가역 harm = asymmetric.)
--   (3) refund_package_atomic 다-수단 패키지 → per-method-leg 분할 INSERT (수단별 sum-parity).
--       단일-수단 패키지 → 1-row(=승계) 정상.  단일-대표 method 0.
--   (4) refund_single_payment: parent_payment_id persist + method 승계.
--   (5) §13.1.C 준수 = facet-add(method source-swap + disbursement 슬롯) — 재작성 아님.
--       (atomic 다-수단 BRANCH만 per-leg 로 확장 = DA 명시 요건.)
--   (6) net 불변 — 금액 총합 무변경, 귀속(method)만 정정.
--
-- ── GATE (본 파일은 APPLY 아님) ────────────────────────────────────────────────
--   money-path RPC(method 귀속·결제수단별 대사) → supervisor DDL-diff + MIG-GATE(RPC body)
--   + C19(F4717-family 계약자산 body-drift) + code-gate + 물리 GO-token 선행 REQUIRED.
--   apply_before_go 금지 · apply-gate=supervisor(NOT DA) · CF git-integrated hold(GO-token 前 main push 금지).
--   change-class = ADDITIVE 컬럼 2개 + RPC 3종 facet-add.  db_change=true(구현 leg).
--
-- ── 별 leg (본 turn 아님) ──────────────────────────────────────────────────────
--   기존 교차수단 환불행 backfill = Data-Correction Backfill SOP(forward-seal 선행·per-row 결정론).
--   실측 census 정정: 대상 = 4행 (package_payments 3 + payments 1[linked_payment_id 정정, 아래 주석]).
--   AC-6 census 의 "payments 118 NULL parent blind-spot" 은 wrong-column 아티팩트였다:
--   payments 원장은 parent_payment_id(0건) 가 아니라 linked_payment_id(112/118=94.9%) 로 링크한다.
--   올바른 컬럼 재대조 시 payments 교차수단 = 1행(07-28 8,800 cash→card, 박민석) — AC-6 가
--   false-positive 로 기각했던 "4번째"가 실재.  ∴ 소급 대상 = 3행 아님, 4행.  (backfill leg 재범위.)
--
-- author: dev-foot / 2026-08-19

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1. ADDITIVE 컬럼 — refund_disbursement_method (Axis-B 실지급 채널 보존)
--   nullable · default NULL · 기존 행 무변경 · overload 0.  method(Axis-A) 와 물리 분리.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.package_payments
  ADD COLUMN IF NOT EXISTS refund_disbursement_method TEXT;
COMMENT ON COLUMN public.package_payments.refund_disbursement_method
  IS 'Axis-B 실지급 채널(환불이 물리적으로 어느 수단으로 환급됐나). refund 행에서만 의미. method(Axis-A=원결제 귀속) 와 분리. T-20260819-foot-REFUND-CROSSMETHOD.';

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_disbursement_method TEXT;
COMMENT ON COLUMN public.payments.refund_disbursement_method
  IS 'Axis-B 실지급 채널(환불이 물리적으로 어느 수단으로 환급됐나). refund 행에서만 의미. method(Axis-A=원결제 귀속) 와 분리. T-20260819-foot-REFUND-CROSSMETHOD.';

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2. refund_single_payment — method 승계 + parent persist + disbursement 보존
--   (signature 무변경: 5-arg. GRANT 유지.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION refund_single_payment(
  p_payment_id  UUID,
  p_clinic_id   UUID,
  p_amount      INTEGER,
  p_method      TEXT,
  p_memo        TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original  payments%ROWTYPE;
  v_role      TEXT;
  v_new_id    UUID;
BEGIN
  -- 1. 권한 확인 (admin/manager)
  SELECT up.role INTO v_role
  FROM user_profiles up
  WHERE up.id = auth.uid() AND up.active = true;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager') THEN
    RETURN json_build_object('error', '환불 권한이 없습니다. (admin/manager 전용)');
  END IF;

  -- 2. 원결제 조회 (LOCK — write-time 원결제 보유 = method 승계 source)
  SELECT * INTO v_original
  FROM payments
  WHERE id = p_payment_id
    AND clinic_id = p_clinic_id
    AND payment_type = 'payment'
    AND COALESCE(status, 'active') != 'deleted'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', '원결제 내역을 찾을 수 없습니다.');
  END IF;

  -- 3. 금액 검증
  IF p_amount <= 0 THEN
    RETURN json_build_object('error', '환불금액은 0보다 커야 합니다.');
  END IF;
  IF p_amount > v_original.amount THEN
    RETURN json_build_object('error',
      format('환불금액이 원결제 금액(%s원)을 초과할 수 없습니다.', v_original.amount));
  END IF;

  -- 4. 사유 검증
  IF p_memo IS NULL OR trim(p_memo) = '' THEN
    RETURN json_build_object('error', '환불 사유를 입력해 주세요.');
  END IF;

  -- 5. 환불 행 INSERT
  --    · method = v_original.method (Axis-A 귀속 = 원결제 강제 승계, p_method 아님)
  --    · refund_disbursement_method = p_method (Axis-B 실지급 채널 보존)
  --    · parent_payment_id = p_payment_id (parent persist, 교차수단 audit 키 통일)
  --      + linked_payment_id 도 유지(기존 잔여차감 로직 호환).
  INSERT INTO payments (
    clinic_id, check_in_id, customer_id, amount,
    method, refund_disbursement_method,
    payment_type, installment, memo,
    linked_payment_id, parent_payment_id, status
  )
  VALUES (
    p_clinic_id, v_original.check_in_id, v_original.customer_id, p_amount,
    v_original.method, p_method,
    'refund', 0, p_memo,
    p_payment_id, p_payment_id, 'active'
  )
  RETURNING id INTO v_new_id;

  RETURN json_build_object('ok', true, 'refund_id', v_new_id);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3. refund_package_payment — method 승계 + disbursement 보존
--   (signature 무변경: 2-arg. GRANT 유지. parent_payment_id 는 이미 persist.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION refund_package_payment(
  p_payment_id UUID,
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
  IF NOT is_approved_user() THEN
    RETURN jsonb_build_object('error', '환불 권한이 없습니다.');
  END IF;

  -- 원결제행 조회 + LOCK (money-path 봉인 + method 승계 source)
  SELECT * INTO v_orig
  FROM package_payments
  WHERE id = p_payment_id AND payment_type = 'payment'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '원결제 내역을 찾을 수 없습니다.');
  END IF;

  v_caller_clinic := current_user_clinic_id();
  IF v_caller_clinic IS NULL OR v_orig.clinic_id IS NULL OR v_orig.clinic_id <> v_caller_clinic THEN
    RETURN jsonb_build_object('error', '해당 결제에 대한 환불 권한이 없습니다.');
  END IF;

  SELECT * INTO v_pkg FROM packages WHERE id = v_orig.package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다.');
  END IF;

  v_refund := v_orig.amount;
  IF v_refund <= 0 THEN
    RETURN jsonb_build_object('error', '환불할 결제 금액이 없습니다.');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_prior
  FROM package_payments
  WHERE parent_payment_id = p_payment_id AND payment_type = 'refund';

  IF v_prior + v_refund > v_orig.amount THEN
    RETURN jsonb_build_object('error',
      format('환불 가능 잔여금액(%s원)을 초과합니다. (원결제 %s원 / 기환불 %s원)',
             GREATEST(v_orig.amount - v_prior, 0), v_orig.amount, v_prior));
  END IF;

  -- 환불 행 INSERT
  --   · method = v_orig.method (Axis-A 귀속 = 원결제 강제 승계, p_method 아님)
  --   · refund_disbursement_method = p_method (Axis-B 실지급 채널 보존)
  INSERT INTO package_payments (
    clinic_id, package_id, customer_id, amount,
    method, refund_disbursement_method,
    payment_type, parent_payment_id, fee_kind
  )
  VALUES (
    v_orig.clinic_id, v_orig.package_id, v_orig.customer_id, v_refund,
    v_orig.method, p_method,
    'refund', p_payment_id, v_orig.fee_kind
  )
  RETURNING id INTO v_new_id;

  SELECT COALESCE(
           SUM(CASE WHEN payment_type = 'payment' THEN amount ELSE -amount END), 0)
    INTO v_net_paid
  FROM package_payments
  WHERE package_id = v_orig.package_id;

  IF v_net_paid <= 0 AND v_pkg.status = 'active' THEN
    UPDATE packages SET status = 'refunded' WHERE id = v_orig.package_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', v_new_id,
    'refund_amount', v_refund,
    'package_refunded', (v_net_paid <= 0 AND v_pkg.status = 'active')
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 4. refund_package_atomic — 다-수단 per-method-leg 분할 + method 승계
--   (signature 무변경: 4-arg. GRANT 유지.)
--   · 단일-수단 패키지 → 1-leg (method=원결제 수단, 승계).  단일-대표 method 0.
--   · 다-수단 패키지 → 수단별 leg (method=각 수단, refund_amount 를 수단별 net 비례배분).
--     전액환불이면 leg 합 == 수단별 charge 합 (N-axis parity).  부분환불이면 proportional.
--   · 각 leg refund_disbursement_method = p_method (Axis-B).
--   · leg 합 == v_refund_amount (calc_refund_amount 견적) — net 불변.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION refund_package_atomic(
  p_package_id UUID,
  p_clinic_id UUID,
  p_customer_id UUID,
  p_method TEXT
) RETURNS JSONB AS $$
DECLARE
  v_pkg RECORD;
  v_quote JSONB;
  v_refund_amount INTEGER;
  v_total_net INTEGER;
  v_alloc_sum INTEGER := 0;
  v_leg INTEGER;
  v_first BOOLEAN := true;
  v_legs JSONB := '[]'::jsonb;
  r RECORD;
BEGIN
  SELECT * INTO v_pkg FROM packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다');
  END IF;
  IF v_pkg.status = 'refunded' THEN
    RETURN jsonb_build_object('error', '이미 환불된 패키지입니다');
  END IF;
  IF v_pkg.status <> 'active' THEN
    RETURN jsonb_build_object('error', '활성 상태의 패키지만 환불 가능합니다');
  END IF;

  -- 견적 (used 회차 기준) — package_sessions cascade 보다 반드시 먼저.
  v_quote := calc_refund_amount(p_package_id);
  v_refund_amount := COALESCE((v_quote->>'refund_amount')::INTEGER, 0);

  -- 수단별 net 결제액 (payment − refund), net>0 인 수단만.
  SELECT COALESCE(SUM(net), 0) INTO v_total_net FROM (
    SELECT SUM(CASE WHEN payment_type='payment' THEN amount ELSE -amount END) AS net
    FROM package_payments WHERE package_id = p_package_id GROUP BY method
  ) s WHERE s.net > 0;

  IF v_refund_amount <= 0 OR v_total_net <= 0 THEN
    -- 견적 0 또는 잔여 net 없음 → 환불행 미생성(기존 동작과 동형: 0원 refund).
    UPDATE packages SET status = 'refunded' WHERE id = p_package_id;
    UPDATE package_sessions SET status = 'refunded'
      WHERE package_id = p_package_id AND status = 'used';
    RETURN jsonb_build_object('ok', true, 'refund_amount', 0, 'legs', v_legs);
  END IF;

  -- 수단별 비례배분 leg INSERT (net DESC — 반올림 잔차는 최대 수단에 흡수).
  --   단일 수단이면 1행(base = v_refund_amount, 잔차 0) = 원결제 수단 승계.
  FOR r IN
    SELECT method,
           SUM(CASE WHEN payment_type='payment' THEN amount ELSE -amount END) AS net
    FROM package_payments
    WHERE package_id = p_package_id
    GROUP BY method
    HAVING SUM(CASE WHEN payment_type='payment' THEN amount ELSE -amount END) > 0
    ORDER BY 2 DESC
  LOOP
    IF v_first THEN
      -- 최대 수단: 전체에서 이후 배분분을 뺀 잔여(잔차 흡수) — 사후 보정으로 대체.
      v_leg := FLOOR(v_refund_amount::numeric * r.net / v_total_net)::INTEGER;
      v_first := false;
    ELSE
      v_leg := FLOOR(v_refund_amount::numeric * r.net / v_total_net)::INTEGER;
    END IF;

    INSERT INTO package_payments (
      clinic_id, package_id, customer_id, amount,
      method, refund_disbursement_method, payment_type
    )
    VALUES (
      p_clinic_id, p_package_id, p_customer_id, v_leg,
      r.method, p_method, 'refund'
    );
    v_alloc_sum := v_alloc_sum + v_leg;
    v_legs := v_legs || jsonb_build_object('method', r.method, 'amount', v_leg);
  END LOOP;

  -- 반올림 잔차 보정: leg 합이 견적과 정확히 일치하도록 최대(첫) 수단 leg 에 잔차 가산.
  IF v_alloc_sum <> v_refund_amount THEN
    UPDATE package_payments
       SET amount = amount + (v_refund_amount - v_alloc_sum)
     WHERE id = (
       SELECT id FROM package_payments
       WHERE package_id = p_package_id AND payment_type='refund'
         AND refund_disbursement_method = p_method
       ORDER BY created_at DESC, amount DESC
       LIMIT 1
     );
  END IF;

  UPDATE packages SET status = 'refunded' WHERE id = p_package_id;

  -- package_sessions cascade (used → refunded, soft).
  UPDATE package_sessions
     SET status = 'refunded'
   WHERE package_id = p_package_id AND status = 'used';

  RETURN jsonb_build_object('ok', true, 'refund_amount', v_refund_amount, 'legs', v_legs);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION refund_package_atomic(UUID, UUID, UUID, TEXT)
  IS '패키지 원자 환불 — 다-수단 per-method-leg 분할(method=원결제 수단 승계·수단별 sum-parity·disbursement 별 슬롯) + session cascade. T-20260819-foot-REFUND-CROSSMETHOD / DA CONDITIONAL-GO';

COMMIT;

-- ── ROLLBACK: 20260819020000_..._fwdfix.rollback.sql 참조 ──

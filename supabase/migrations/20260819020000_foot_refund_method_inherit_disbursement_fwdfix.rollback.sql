-- ROLLBACK — T-20260819-foot-REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX
-- ★★ C19 rebase (FIX-REQUEST MSG-20260819-105120): 3 RPC 를 **현행 prod 정의**(SELECT pg_get_functiondef,
--    ref rxlomoozakkjesdqjtvd, 2026-08-19 read-only introspection)로 대칭 복원 + ADDITIVE 컬럼 2개 DROP.
--    이전 rollback 은 스테일 pre-F4717 ancestor(method=p_method·status UPDATE 재도입·created_by 누락·
--    role 축소)로 복원 → 실제 prod 와 비대칭(롤백해도 현행 미복원). 본 rollback 은 apply 직전 prod 실측
--    정의 그대로를 복원하므로 up.sql 적용분만 정확히 원복한다(actor-history·status-delegation 보존).
-- ⚠ 롤백 시 method 귀속 승계 facet + disbursement 슬롯이 제거되어 교차수단 desync 버그 표면이
--    재현될 수 있으나(의도적 원복), created_by 캡처·§7 status 위임·확장 role 은 prod 그대로 유지된다.
--    disbursement 컬럼의 기존 forward 데이터는 유실(컬럼 DROP). 롤백 전 supervisor 확인 필수.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 4 복원: refund_package_atomic (현행 prod = 단일 lump row·method=p_method·status UPDATE·session cascade)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.refund_package_atomic(p_package_id uuid, p_clinic_id uuid, p_customer_id uuid, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_pkg RECORD;
  v_quote JSONB;
  v_refund_amount INTEGER;
BEGIN
  -- Lock the package row
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

  -- Calculate refund (★ package_sessions cascade 보다 반드시 먼저 — 견적은 used 회차 기준)
  --   calc_refund_amount 는 jsonb 스칼라를 반환한다.
  v_quote := calc_refund_amount(p_package_id);
  v_refund_amount := COALESCE((v_quote->>'refund_amount')::INTEGER, 0);

  INSERT INTO package_payments (clinic_id, package_id, customer_id, amount, method, payment_type)
  VALUES (p_clinic_id, p_package_id, p_customer_id, v_refund_amount, p_method, 'refund');

  UPDATE packages SET status = 'refunded' WHERE id = p_package_id;

  -- ★ T-20260602-foot-REFUND-SESSION-CLEANUP AC-1: 환불된 패키지의 잔존 'used' 세션을 'refunded'로
  --   전이(soft, audit row 보존). status='used' 필터를 쓰는 모든 집계에서 자동 제외된다.
  UPDATE package_sessions
     SET status = 'refunded'
   WHERE package_id = p_package_id
     AND status = 'used';

  RETURN jsonb_build_object('ok', true, 'refund_amount', v_refund_amount);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3 복원: refund_package_payment (현행 prod = method=p_method·§7 status 트리거 위임·created_by 캡처)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.refund_package_payment(p_payment_id uuid, p_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2 복원: refund_single_payment (현행 prod = method=p_method·linked only·확장 role 5종·created_by 캡처)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.refund_single_payment(p_payment_id uuid, p_clinic_id uuid, p_amount integer, p_method text, p_memo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_original  payments%ROWTYPE;
  v_role      TEXT;
  v_new_id    UUID;
BEGIN
  -- 1. 권한 확인 (admin/manager + consultant/coordinator/therapist)
  SELECT up.role INTO v_role
  FROM user_profiles up
  WHERE up.id = auth.uid()
    AND up.active = true;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager', 'consultant', 'coordinator', 'therapist') THEN
    RETURN json_build_object('error', '환불 권한이 없습니다.');
  END IF;

  -- 2. 원결제 조회
  SELECT * INTO v_original
  FROM payments
  WHERE id          = p_payment_id
    AND clinic_id   = p_clinic_id
    AND payment_type = 'payment'
    AND COALESCE(status, 'active') != 'deleted';

  IF NOT FOUND THEN
    RETURN json_build_object('error', '원결제 내역을 찾을 수 없습니다.');
  END IF;

  -- 3. 환불 금액 검증
  IF p_amount <= 0 THEN
    RETURN json_build_object('error', '환불금액은 0보다 커야 합니다.');
  END IF;
  IF p_amount > v_original.amount THEN
    RETURN json_build_object(
      'error',
      format('환불금액이 원결제 금액(%s원)을 초과할 수 없습니다.', v_original.amount)
    );
  END IF;

  -- 4. 사유 검증
  IF p_memo IS NULL OR trim(p_memo) = '' THEN
    RETURN json_build_object('error', '환불 사유를 입력해 주세요.');
  END IF;

  -- 5. 환불 행 삽입 (created_by=auth.uid() 처리자 auto-capture)
  INSERT INTO payments (
    clinic_id,
    check_in_id,
    customer_id,
    amount,
    method,
    payment_type,
    installment,
    memo,
    linked_payment_id,
    status,
    created_by
  )
  VALUES (
    p_clinic_id,
    v_original.check_in_id,
    v_original.customer_id,
    p_amount,
    p_method,
    'refund',
    0,
    p_memo,
    p_payment_id,
    'active',
    auth.uid()
  )
  RETURNING id INTO v_new_id;

  RETURN json_build_object('ok', true, 'refund_id', v_new_id);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1 복원: ADDITIVE 컬럼 DROP
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.package_payments DROP COLUMN IF EXISTS refund_disbursement_method;
ALTER TABLE public.payments DROP COLUMN IF EXISTS refund_disbursement_method;

COMMIT;

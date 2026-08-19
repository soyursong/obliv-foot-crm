-- T-20260819-foot-REFUND-CROSSMETHOD-METHOD-INHERIT-FWDFIX  (Phase B — forward-fix leg)
-- da_consult_ref: DA-20260819-foot-REFUND-CROSSMETHOD-METHOD-INHERIT · verdict=CONDITIONAL-GO
-- SSOT: agents/docs/da_replies/da_decision_foot_refund_crossmethod_method_inherit_fwdfix_20260819.md
--
-- ★★ C19 body-drift REBASE (FIX-REQUEST MSG-20260819-105120, supervisor) ─────────
--   REV: 이전 331e8114 는 3 RPC 를 스테일 pre-F4717 ancestor 위에서 재작성 → prod 라이브
--        정의를 superset-merge 하지 않고 F4717-family/actor-history 변경을 무단 revert(§13.1.C 위반).
--   본 rebase = 현행 prod 정의(SELECT pg_get_functiondef, ref rxlomoozakkjesdqjtvd, 2026-08-19)를
--   BASE 로 pull → 그 위에 method-승계(Axis-A) + refund_disbursement_method(Axis-B) + atomic per-leg
--   facet 만 ADDITIVE 하게 얹는다.  prod BASE 대비 보존한 것(회귀 제거):
--     · refund_package_payment: created_by=auth.uid() 캡처 유지(actor-history) + §7 status UPDATE 재도입 금지
--       (status 파생 = §2 cross-ledger 트리거 위임 = single status-authority 보존).
--     · refund_single_payment: created_by=auth.uid() 캡처 유지 + 확장 role list(admin/manager/consultant/
--       coordinator/therapist) 보존 + FOR UPDATE 미추가(prod 무락 형태 보존) + parent_payment_id persist(신규 facet).
--     · refund_package_atomic: prod 정합(created_by 0 · UPDATE status='refunded' · session cascade 有) 그대로 두고
--       per-method-leg 분할 facet 만 add.
--   prod prosrc 실측: refund_package_payment(has_setstatus=0·has_created_by=1) /
--                     refund_single_payment(has_created_by=1·role 5종) /
--                     refund_package_atomic(has_setstatus=1·has_created_by=0·session cascade 有).
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
--   실측 census 정정: 대상 = 4행 (package_payments 3 + payments 1[linked_payment_id 정정]).
--
-- author: dev-foot / 2026-08-19 (rebase r2)

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
-- STEP 2. refund_single_payment — [prod BASE + facet] method 승계 + parent persist + disbursement 보존
--   prod 보존: 확장 role list(5종) · FOR UPDATE 미추가 · created_by=auth.uid() 캡처.
--   facet add: method=v_original.method 승계 · refund_disbursement_method=p_method · parent_payment_id 링크.
--   (signature 무변경: 5-arg. GRANT 유지.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.refund_single_payment(
  p_payment_id  UUID,
  p_clinic_id   UUID,
  p_amount      INTEGER,
  p_method      TEXT,
  p_memo        TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_original  payments%ROWTYPE;
  v_role      TEXT;
  v_new_id    UUID;
BEGIN
  -- 1. 권한 확인 (admin/manager + consultant/coordinator/therapist) — prod BASE 유지
  SELECT up.role INTO v_role
  FROM user_profiles up
  WHERE up.id = auth.uid()
    AND up.active = true;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager', 'consultant', 'coordinator', 'therapist') THEN
    RETURN json_build_object('error', '환불 권한이 없습니다.');
  END IF;

  -- 2. 원결제 조회 (method 승계 source) — prod BASE 유지(FOR UPDATE 미추가)
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

  -- 5. 환불 행 삽입
  --    · method = v_original.method (Axis-A 귀속 = 원결제 강제 승계, p_method 아님) [facet]
  --    · refund_disbursement_method = p_method (Axis-B 실지급 채널 보존) [facet]
  --    · parent_payment_id = p_payment_id (parent persist, 교차수단 audit 키 통일) [facet]
  --      + linked_payment_id 도 유지(prod BASE·기존 잔여차감 로직 호환).
  --    · created_by = auth.uid() (처리자 auto-capture) — prod BASE 유지.
  INSERT INTO payments (
    clinic_id,
    check_in_id,
    customer_id,
    amount,
    method,
    refund_disbursement_method,
    payment_type,
    installment,
    memo,
    linked_payment_id,
    parent_payment_id,
    status,
    created_by
  )
  VALUES (
    p_clinic_id,
    v_original.check_in_id,
    v_original.customer_id,
    p_amount,
    v_original.method,
    p_method,
    'refund',
    0,
    p_memo,
    p_payment_id,
    p_payment_id,
    'active',
    auth.uid()
  )
  RETURNING id INTO v_new_id;

  RETURN json_build_object('ok', true, 'refund_id', v_new_id);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3. refund_package_payment — [prod BASE + facet] method 승계 + disbursement 보존
--   prod 보존: §7 status 파생 = §2 트리거 위임(단방향 UPDATE 재도입 금지 · single status-authority) ·
--             created_by=auth.uid() 캡처 · session cascade OFF(DA PIN §3) · clinic 격리.
--   facet add: method=v_orig.method 승계 · refund_disbursement_method=p_method.
--   (signature 무변경: 2-arg. GRANT 유지. parent_payment_id 는 이미 persist.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.refund_package_payment(
  p_payment_id UUID,
  p_method     TEXT
)
RETURNS JSONB
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

  -- ── 2. 원결제행 조회 + LOCK (① 서버 재조회 = money-path 위변조 봉인 + method 승계 source) ──
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
  --      · method = v_orig.method (Axis-A 귀속 = 원결제 강제 승계, p_method 아님) [facet]
  --      · refund_disbursement_method = p_method (Axis-B 실지급 채널 보존) [facet]
  --      · created_by=auth.uid() 처리자 auto-capture (T-20260727-CLOSING-REFUND-ACTOR-HISTORY) — prod BASE 유지.
  --      ★이 INSERT 가 package_payments AFTER INSERT 트리거(§2)를 발화 → status 재계산(위임).
  INSERT INTO package_payments (
    clinic_id, package_id, customer_id, amount, method, refund_disbursement_method,
    payment_type, parent_payment_id, fee_kind, created_by
  )
  VALUES (
    v_orig.clinic_id, v_orig.package_id, v_orig.customer_id,
    v_refund, v_orig.method, p_method, 'refund', p_payment_id, v_orig.fee_kind, auth.uid()
  )
  RETURNING id INTO v_new_id;

  -- ── 7. status 파생 = §2 트리거에 위임 (단방향 UPDATE 재도입 금지) ─────────────
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
-- STEP 4. refund_package_atomic — [prod BASE + facet] 다-수단 per-method-leg 분할 + method 승계
--   prod 보존: created_by 0(atomic 무캡처) · UPDATE packages SET status='refunded' · session cascade
--             (used→refunded, T-20260602 AC-1) — atomic 은 트리거 위임이 아니라 명시 UPDATE 이 prod-정합.
--   facet add: 다-수단 패키지 → 수단별 leg(method=각 원결제 수단 승계·refund_amount 를 수단별 net 비례배분).
--             단일-수단 패키지 → 1-leg(승계).  각 leg refund_disbursement_method=p_method.
--             leg 합 == v_refund_amount (calc_refund_amount 견적) — net 불변(N-axis sum-parity).
--   (signature 무변경: 4-arg. GRANT 유지.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.refund_package_atomic(
  p_package_id UUID,
  p_clinic_id UUID,
  p_customer_id UUID,
  p_method TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_pkg RECORD;
  v_quote JSONB;
  v_refund_amount INTEGER;
  v_total_net INTEGER;
  v_alloc_sum INTEGER := 0;
  v_leg INTEGER;
  v_legs JSONB := '[]'::jsonb;
  r RECORD;
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

  -- 견적 (used 회차 기준) — package_sessions cascade 보다 반드시 먼저.
  --   calc_refund_amount 는 jsonb 스칼라를 반환한다.
  v_quote := calc_refund_amount(p_package_id);
  v_refund_amount := COALESCE((v_quote->>'refund_amount')::INTEGER, 0);

  -- 수단별 net 결제액 (payment − refund), net>0 인 수단만.
  SELECT COALESCE(SUM(net), 0) INTO v_total_net FROM (
    SELECT SUM(CASE WHEN payment_type='payment' THEN amount ELSE -amount END) AS net
    FROM package_payments WHERE package_id = p_package_id GROUP BY method
  ) s WHERE s.net > 0;

  IF v_refund_amount <= 0 OR v_total_net <= 0 THEN
    -- 견적 0 또는 잔여 net 없음 → 환불 leg 미생성(prod 0원 refund 와 동형).
    -- prod BASE 정합: status='refunded' 명시 UPDATE + session cascade.
    UPDATE packages SET status = 'refunded' WHERE id = p_package_id;
    UPDATE package_sessions SET status = 'refunded'
      WHERE package_id = p_package_id AND status = 'used';
    RETURN jsonb_build_object('ok', true, 'refund_amount', 0, 'legs', v_legs);
  END IF;

  -- 수단별 비례배분 leg INSERT (net DESC — 반올림 잔차는 최대 수단에 흡수).
  --   단일 수단이면 1행(base = v_refund_amount, 잔차 0) = 원결제 수단 승계.
  --   · method = r.method (Axis-A 귀속 = 원결제 각 수단 승계) [facet]
  --   · refund_disbursement_method = p_method (Axis-B 실지급 채널) [facet]
  FOR r IN
    SELECT method,
           SUM(CASE WHEN payment_type='payment' THEN amount ELSE -amount END) AS net
    FROM package_payments
    WHERE package_id = p_package_id
    GROUP BY method
    HAVING SUM(CASE WHEN payment_type='payment' THEN amount ELSE -amount END) > 0
    ORDER BY 2 DESC
  LOOP
    v_leg := FLOOR(v_refund_amount::numeric * r.net / v_total_net)::INTEGER;

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

  -- prod BASE 정합: status='refunded' 명시 UPDATE (atomic 은 트리거 위임 아님).
  UPDATE packages SET status = 'refunded' WHERE id = p_package_id;

  -- ★ T-20260602-foot-REFUND-SESSION-CLEANUP AC-1 (prod BASE): 환불된 패키지의 잔존 'used' 세션을
  --   'refunded'로 전이(soft, audit row 보존). status='used' 필터 집계에서 자동 제외.
  UPDATE package_sessions
     SET status = 'refunded'
   WHERE package_id = p_package_id
     AND status = 'used';

  RETURN jsonb_build_object('ok', true, 'refund_amount', v_refund_amount, 'legs', v_legs);
END;
$function$;

COMMENT ON FUNCTION refund_package_atomic(UUID, UUID, UUID, TEXT)
  IS '패키지 원자 환불 — 다-수단 per-method-leg 분할(method=원결제 수단 승계·수단별 sum-parity·disbursement 별 슬롯) + status UPDATE + session cascade(prod BASE). T-20260819-foot-REFUND-CROSSMETHOD / DA CONDITIONAL-GO';

COMMIT;

-- ── ROLLBACK: 20260819020000_..._fwdfix.rollback.sql 참조 (현행 prod 정의로 대칭 복원) ──

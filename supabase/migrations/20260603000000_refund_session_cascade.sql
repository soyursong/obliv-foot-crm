-- T-20260602-foot-REFUND-SESSION-CLEANUP  AC-1 / AC-2
-- 환불(refund_package_atomic) 시 package_sessions 정리 누락 → 유령 세션이 회차·통계('used')에 잔류.
--
-- 설계 결정 (planner 스펙 cancelled_at 컬럼 → 실제 스키마 status enum 재사용):
--   planner 1차 진단은 soft-delete용 cancelled_at 컬럼을 가정했으나, package_sessions 에는
--   이미 status CHECK enum('used','cancelled','refunded') 가 존재하고, 모든 집계
--   (get_package_remaining / calc_refund_amount / foot_stats_by_category) 가 status='used' 만
--   카운트한다. 따라서 신규 컬럼 추가(과잉 추상화) 대신 기존 status='refunded' 로 전이하는 것이
--   audit 보존(soft-delete 의도) + 집계 자동 제외를 동시에 만족한다.
--   → AC-2(모든 view/집계 필터 일관)는 기존 status='used' 필터로 이미 충족. 추가 변경 불필요.
--
-- 변경 범위: refund_package_atomic 함수 1개. DB 스키마/컬럼 변경 0. 테이블 변경 0.
--
-- ★ 추가 수정 (2026-06-03, QA에서 발견된 잠재 버그):
--   calc_refund_amount(p_package_id) 는 RETURNS jsonb (스칼라) 다. 기존 본문은
--   `SELECT * INTO v_quote(RECORD) FROM calc_refund_amount(...)` 후 v_quote.refund_amount
--   를 참조 → 런타임에 `record "v_quote" has no field "refund_amount"` 로 실패한다.
--   (원본 race_condition_fixes 정의·cascade 1차 버전 모두 동일 결함 → 환불 RPC가 실제로
--    동작하지 않았음.) FE(Closing/Packages)가 호출하는 라이브 경로이므로 함께 교정한다.
--   → v_quote 를 JSONB 로 받고 (v_quote->>'refund_amount')::int 로 추출.
--
-- package_sessions cascade(used→refunded) UPDATE 1줄도 함께 외과적으로 추가.
--
-- Rollback: 20260603000000_refund_session_cascade.rollback.sql
-- author: dev-foot / 2026-06-03

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION refund_package_atomic(UUID, UUID, UUID, TEXT)
  IS '패키지 원자 환불 + package_sessions cascade(used→refunded). T-20260602-foot-REFUND-SESSION-CLEANUP';

-- ════════════════════════════════════════════════════════════════════════════
-- T-20260717-foot-SALESPATIENT-REFUND-PROCESSOR-COLUMN
-- payments.created_by 처리 직원 귀속 컬럼 — ADDITIVE
--
-- 근거: DA CONSULT (MSG-20260717-134958-7xgq, DB ADDITIVE 1차 게이트).
--   판정: ADDITIVE 확정 — payments 파괴적 변경 없음(신규 nullable 컬럼 + partial index).
--         기존행 created_by=NULL → FE '—' 표시(data loss 0). autonomy §3.1 대표게이트 면제,
--         supervisor DDL-diff만.
--
-- 스코프: 매출관리 > 환자별 탭(SalesPatientTab) "처리 직원명" 컬럼 표시 근거.
--   · 일반 결제 행: PaymentDialog.tsx 가 이미 created_by:profile?.id INSERT 중 (DB 컬럼만 부재였음).
--   · 환불 행: refund_single_payment RPC INSERT 에 created_by=auth.uid() auto-capture 추가.
--
-- 선례: payment_items.created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL
--       (20260708000000_foot_payment_items_additive) 동형 귀속 패턴.
--
-- FK 기본명: payments_created_by_fkey (Postgres auto-name)
--   → FE JOIN alias processor:user_profiles!payments_created_by_fkey(name) 와 정합.
--
-- 하위호환: payments read 경로(매출집계/미수금/EDI/마감) 무영향 — 신규 nullable 컬럼만.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. payments.created_by 컬럼 + partial index (ADDITIVE, 멱등)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS created_by UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.payments.created_by IS
  '결제/환불 처리 직원(user_profiles.id). 일반결제=PaymentDialog profile.id, 환불=refund_single_payment auth.uid(). 기존행 NULL=미기록(FE ''—''). audit actor 귀속(권고).';

CREATE INDEX IF NOT EXISTS idx_payments_created_by
  ON public.payments(created_by) WHERE created_by IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 2. refund_single_payment RPC — INSERT 에 created_by=auth.uid() 추가
--    시그니처 무변경(내부 auto-capture only). 역할 목록은 20260525050000 기준 유지.
-- ──────────────────────────────────────────────────────────────
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
$$;

GRANT EXECUTE ON FUNCTION refund_single_payment(UUID, UUID, INTEGER, TEXT, TEXT) TO authenticated;

COMMIT;

-- ──────────────────────────────────────────────────────────────
-- 롤백 SQL: 20260717140000_foot_payments_created_by_processor.rollback.sql 참조
-- ──────────────────────────────────────────────────────────────

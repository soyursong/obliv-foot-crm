-- DRY-RUN (No-Persistence): T-20260717-foot-SALESPATIENT-REFUND-PROCESSOR-COLUMN
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 은 BEGIN..COMMIT(txn-control) 포함 = sentinel-bypass hazard.
--     → 본 dryrun 은 COMMIT 제거하고 BEGIN..(assert)..ROLLBACK 로 무영속 검증.
--   · txn 내부 assertion(DO $chk$): 컬럼/인덱스/FK/함수 시그니처 실검증, 실패 시 RAISE 'DRYRUN-FAIL' → abort.
--   · 사후 무영속(post-probe)은 runner 의 별 트랜잭션(독립 API 콜)에서 컬럼/인덱스 부재 재확인.

BEGIN;

-- ── up.sql DDL (COMMIT 제거본) ──
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS created_by UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_created_by
  ON public.payments(created_by) WHERE created_by IS NOT NULL;

CREATE OR REPLACE FUNCTION refund_single_payment(
  p_payment_id UUID, p_clinic_id UUID, p_amount INTEGER, p_method TEXT, p_memo TEXT
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_original payments%ROWTYPE; v_role TEXT; v_new_id UUID;
BEGIN
  SELECT up.role INTO v_role FROM user_profiles up WHERE up.id = auth.uid() AND up.active = true;
  IF v_role IS NULL OR v_role NOT IN ('admin','manager','consultant','coordinator','therapist') THEN
    RETURN json_build_object('error','환불 권한이 없습니다.'); END IF;
  SELECT * INTO v_original FROM payments
    WHERE id=p_payment_id AND clinic_id=p_clinic_id AND payment_type='payment'
      AND COALESCE(status,'active')!='deleted';
  IF NOT FOUND THEN RETURN json_build_object('error','원결제 내역을 찾을 수 없습니다.'); END IF;
  IF p_amount <= 0 THEN RETURN json_build_object('error','환불금액은 0보다 커야 합니다.'); END IF;
  IF p_amount > v_original.amount THEN
    RETURN json_build_object('error', format('환불금액이 원결제 금액(%s원)을 초과할 수 없습니다.', v_original.amount)); END IF;
  IF p_memo IS NULL OR trim(p_memo)='' THEN RETURN json_build_object('error','환불 사유를 입력해 주세요.'); END IF;
  INSERT INTO payments (clinic_id,check_in_id,customer_id,amount,method,payment_type,installment,memo,linked_payment_id,status,created_by)
  VALUES (p_clinic_id,v_original.check_in_id,v_original.customer_id,p_amount,p_method,'refund',0,p_memo,p_payment_id,'active',auth.uid())
  RETURNING id INTO v_new_id;
  RETURN json_build_object('ok', true, 'refund_id', v_new_id);
END; $$;

-- ── 무영속 assertion ──
DO $chk$
DECLARE
  v_col_type   text;
  v_fk_name    text;
  v_idx        int;
  v_has_cb_arg int;
BEGIN
  -- 1. created_by 컬럼 존재 + UUID
  SELECT data_type INTO v_col_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='payments' AND column_name='created_by';
  IF v_col_type IS NULL THEN RAISE EXCEPTION 'DRYRUN-FAIL: payments.created_by 컬럼 미생성'; END IF;
  IF v_col_type <> 'uuid' THEN RAISE EXCEPTION 'DRYRUN-FAIL: created_by 타입=% (uuid 기대)', v_col_type; END IF;

  -- 2. FK 기본명 payments_created_by_fkey → user_profiles (FE alias 정합)
  SELECT tc.constraint_name INTO v_fk_name
   FROM information_schema.table_constraints tc
   JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
   WHERE tc.table_name='payments' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='created_by';
  IF v_fk_name IS DISTINCT FROM 'payments_created_by_fkey' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: FK명=% (payments_created_by_fkey 기대 — FE JOIN alias 불일치)', v_fk_name; END IF;

  -- 3. partial index 존재
  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname='public' AND tablename='payments' AND indexname='idx_payments_created_by';
  IF v_idx <> 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: idx_payments_created_by 미생성'; END IF;

  -- 4. RPC 본문에 created_by=auth.uid() 반영
  SELECT count(*) INTO v_has_cb_arg FROM pg_proc
   WHERE proname='refund_single_payment' AND prosrc LIKE '%created_by%' AND prosrc LIKE '%auth.uid()%';
  IF v_has_cb_arg < 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: refund_single_payment 에 created_by auto-capture 미반영'; END IF;

  RAISE NOTICE 'DRYRUN-OK: payments.created_by + FK + index + RPC created_by 모두 검증 통과';
END $chk$;

ROLLBACK;

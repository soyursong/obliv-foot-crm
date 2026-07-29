-- DRY-RUN (No-Persistence): T-20260727-foot-CLOSING-REFUND-ACTOR-HISTORY
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 은 BEGIN..COMMIT(txn-control) 포함 = sentinel-bypass hazard.
--     → 본 dryrun 은 COMMIT 제거하고 BEGIN..(assert)..ROLLBACK 로 무영속 검증.
--   · txn 내부 assertion(DO $chk$): 컬럼/인덱스/FK/함수 시그니처 실검증, 실패 시 RAISE 'DRYRUN-FAIL' → abort.
--   · 사후 무영속(post-probe)은 runner(.dryrun.mjs)의 별 트랜잭션(독립 API 콜)에서 컬럼/인덱스 부재 재확인.

BEGIN;

-- ── up.sql DDL (COMMIT 제거본) ──
ALTER TABLE public.package_payments
  ADD COLUMN IF NOT EXISTS created_by UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_package_payments_created_by
  ON public.package_payments(created_by) WHERE created_by IS NOT NULL;

CREATE OR REPLACE FUNCTION refund_package_payment(
  p_payment_id UUID, p_method TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_orig package_payments%ROWTYPE; v_pkg packages%ROWTYPE;
  v_prior INTEGER; v_refund INTEGER; v_new_id UUID; v_net_paid INTEGER; v_caller_clinic UUID;
BEGIN
  IF NOT is_approved_user() THEN RETURN jsonb_build_object('error','환불 권한이 없습니다.'); END IF;
  SELECT * INTO v_orig FROM package_payments WHERE id=p_payment_id AND payment_type='payment' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','원결제 내역을 찾을 수 없습니다.'); END IF;
  v_caller_clinic := current_user_clinic_id();
  IF v_caller_clinic IS NULL OR v_orig.clinic_id IS NULL OR v_orig.clinic_id <> v_caller_clinic THEN
    RETURN jsonb_build_object('error','해당 결제에 대한 환불 권한이 없습니다.'); END IF;
  SELECT * INTO v_pkg FROM packages WHERE id=v_orig.package_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','패키지를 찾을 수 없습니다.'); END IF;
  v_refund := v_orig.amount;
  IF v_refund <= 0 THEN RETURN jsonb_build_object('error','환불할 결제 금액이 없습니다.'); END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_prior FROM package_payments
    WHERE parent_payment_id=p_payment_id AND payment_type='refund';
  IF v_prior + v_refund > v_orig.amount THEN
    RETURN jsonb_build_object('error', format('환불 가능 잔여금액(%s원)을 초과합니다. (원결제 %s원 / 기환불 %s원)',
      GREATEST(v_orig.amount - v_prior,0), v_orig.amount, v_prior)); END IF;
  INSERT INTO package_payments (clinic_id,package_id,customer_id,amount,method,payment_type,parent_payment_id,fee_kind,created_by)
  VALUES (v_orig.clinic_id,v_orig.package_id,v_orig.customer_id,v_refund,p_method,'refund',p_payment_id,v_orig.fee_kind,auth.uid())
  RETURNING id INTO v_new_id;
  SELECT COALESCE(SUM(CASE WHEN payment_type='payment' THEN amount ELSE -amount END),0)
    INTO v_net_paid FROM package_payments WHERE package_id=v_orig.package_id;
  IF v_net_paid <= 0 AND v_pkg.status='active' THEN UPDATE packages SET status='refunded' WHERE id=v_orig.package_id; END IF;
  RETURN jsonb_build_object('ok',true,'refund_id',v_new_id,'refund_amount',v_refund,
    'package_refunded',(v_net_paid <= 0 AND v_pkg.status='active'));
END; $$;

-- ── 무영속 assertion ──
DO $chk$
DECLARE
  v_col_type   text;
  v_fk_name    text;
  v_fk_del     text;
  v_idx        int;
  v_has_cb     int;
BEGIN
  -- 1. created_by 컬럼 존재 + UUID
  SELECT data_type INTO v_col_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='package_payments' AND column_name='created_by';
  IF v_col_type IS NULL THEN RAISE EXCEPTION 'DRYRUN-FAIL: package_payments.created_by 컬럼 미생성'; END IF;
  IF v_col_type <> 'uuid' THEN RAISE EXCEPTION 'DRYRUN-FAIL: created_by 타입=% (uuid 기대)', v_col_type; END IF;

  -- 2. FK 기본명 package_payments_created_by_fkey → user_profiles + ON DELETE SET NULL (FE alias/무결성 정합)
  SELECT tc.constraint_name, rc.delete_rule INTO v_fk_name, v_fk_del
   FROM information_schema.table_constraints tc
   JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
   JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name
   WHERE tc.table_name='package_payments' AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='created_by';
  IF v_fk_name IS DISTINCT FROM 'package_payments_created_by_fkey' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: FK명=% (package_payments_created_by_fkey 기대 — FE JOIN alias 불일치)', v_fk_name; END IF;
  IF v_fk_del IS DISTINCT FROM 'SET NULL' THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: FK delete_rule=% (SET NULL 기대)', v_fk_del; END IF;

  -- 3. partial index 존재
  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname='public' AND tablename='package_payments' AND indexname='idx_package_payments_created_by';
  IF v_idx <> 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: idx_package_payments_created_by 미생성'; END IF;

  -- 4. RPC 본문에 created_by=auth.uid() 반영 + INSERT target=package_payments 유지
  SELECT count(*) INTO v_has_cb FROM pg_proc
   WHERE proname='refund_package_payment' AND prosrc LIKE '%created_by%' AND prosrc LIKE '%auth.uid()%'
     AND prosrc LIKE '%INSERT INTO package_payments%';
  IF v_has_cb < 1 THEN RAISE EXCEPTION 'DRYRUN-FAIL: refund_package_payment 에 created_by auto-capture(INSERT INTO package_payments) 미반영'; END IF;

  RAISE NOTICE 'DRYRUN-OK: package_payments.created_by + FK(SET NULL) + index + RPC created_by(INSERT INTO package_payments) 모두 검증 통과';
END $chk$;

ROLLBACK;

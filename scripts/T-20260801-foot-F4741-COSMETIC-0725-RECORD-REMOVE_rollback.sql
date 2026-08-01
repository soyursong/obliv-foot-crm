-- T-20260801-foot-F4741-COSMETIC-0725-RECORD-REMOVE — ROLLBACK
-- archive-first 제거를 원복. archive 테이블 2종에서 payment 본행 + SET NULL 링크원본 복원.
-- 실행: DA/supervisor 승인 하에. 단일 트랜잭션.
BEGIN;

-- 1) payment 본행 복원 (archive 컬럼 audit 2개 제외)
INSERT INTO public.payments
SELECT a.* FROM (
  SELECT (p).* FROM (
    SELECT to_jsonb(ap) - 'archived_at' - 'archived_ticket' AS j,
           NULL::public.payments AS p
    FROM public._archive_f4741_cosmetic_0725_payment_20260801 ap
  ) s, LATERAL jsonb_populate_record(NULL::public.payments, s.j) AS p
) a
WHERE NOT EXISTS (SELECT 1 FROM public.payments x WHERE x.id='30a9ac47-b90d-4ee7-b4f2-7b1861264afc');

-- 2) SET NULL 링크 원본 복원 (redpay / recon_log)
UPDATE public.redpay_raw_transactions r
   SET matched_payment_id = l.orig_payment_id
  FROM public._archive_f4741_cosmetic_0725_links_20260801 l
 WHERE l.child_table='redpay_raw_transactions' AND l.child_id=r.id AND r.matched_payment_id IS NULL;

UPDATE public.payment_reconciliation_log g
   SET payment_id = l.orig_payment_id
  FROM public._archive_f4741_cosmetic_0725_links_20260801 l
 WHERE l.child_table='payment_reconciliation_log' AND l.child_id=g.id AND g.payment_id IS NULL;

-- 3) 검증: payment 복원 1행 + 링크 재연결 2건
DO $$
DECLARE v_pay int; v_r int; v_g int;
BEGIN
  SELECT count(*) INTO v_pay FROM public.payments WHERE id='30a9ac47-b90d-4ee7-b4f2-7b1861264afc';
  SELECT count(*) INTO v_r FROM public.redpay_raw_transactions WHERE matched_payment_id='30a9ac47-b90d-4ee7-b4f2-7b1861264afc';
  SELECT count(*) INTO v_g FROM public.payment_reconciliation_log WHERE payment_id='30a9ac47-b90d-4ee7-b4f2-7b1861264afc';
  IF v_pay <> 1 OR v_r <> 1 OR v_g <> 1 THEN
    RAISE EXCEPTION 'ROLLBACK 검증 실패: payment=% redpay=% recon=% (기대 1/1/1)', v_pay, v_r, v_g;
  END IF;
  RAISE NOTICE 'ROLLBACK OK: payment=% redpay_link=% recon_link=%', v_pay, v_r, v_g;
END $$;

COMMIT;

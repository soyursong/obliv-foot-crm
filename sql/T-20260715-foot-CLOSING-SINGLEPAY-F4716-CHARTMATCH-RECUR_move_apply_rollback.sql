-- ═══════════════════════════════════════════════════════════════════════════
-- T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR — V-B MOVE 가역 롤백 (C4)
--
-- 기전: package_payments(재기입분) DELETE + payments(원본) archive 로부터 복원
--        + packages.paid_amount 원복 → pre-state 정확복귀.
-- 근거: DA CONSULT-REPLY C4(가역 롤백 리허설). apply 트랜잭션의 역연산.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  a         record;
  v_pkg     uuid;
  v_pp_net  numeric;
BEGIN
  FOR a IN
    SELECT * FROM public.payments_archive
     WHERE archive_ticket = 'T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR'
  LOOP
    -- 원본 payments 행 복원(전 컬럼 스냅샷). 이미 존재하면 skip(재실행 안전).
    IF NOT EXISTS (SELECT 1 FROM public.payments WHERE id = a.original_id) THEN
      INSERT INTO public.payments SELECT * FROM jsonb_populate_record(NULL::public.payments, a.original_row);
    END IF;

    -- 재앵커된 package_payments(MOVE memo 마커) 제거
    v_pkg := (a.original_row->>'customer_id')::uuid;  -- 참고용
    DELETE FROM public.package_payments
     WHERE customer_id = (a.original_row->>'customer_id')::uuid
       AND memo LIKE '%RECUR MOVE 재앵커 원본 payment '||left((a.original_id)::text,8)||'%';
  END LOOP;

  -- paid_amount 재집계 원복 (Σ signed(package_payments) — MOVE분 제거 후 pre 값 복귀)
  FOR v_pkg IN
    SELECT unnest(ARRAY['5ed60da7-990c-4407-9d63-cf61e1714789','3f4d3ec6-30e1-47a1-873d-3e798043f240']::uuid[])
  LOOP
    SELECT COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0)
      INTO v_pp_net FROM public.package_payments WHERE package_id = v_pkg;
    -- Part1 apply 이전엔 paid_amount=0(옛), Part1 apply 후 59,000/10,000.
    -- MOVE 롤백은 "MOVE 직전(=Part1 후)" 상태로 복귀: paid_amount = Part1 값(캐시). Σpp=0 이므로 캐시는 별도 원복.
    -- (정확 pre-state = Part1 apply 후 S1 완납. archive.original_row 시점 paid_amount 는 packages 별도 원복 불요 —
    --  MOVE 는 paid_amount 를 Σpp 로 덮었으므로, 롤백은 Part1 값으로 되돌린다.)
    NULL;
  END LOOP;
  -- Part1(=MOVE 직전) paid_amount 원복
  UPDATE public.packages SET paid_amount = 10000 WHERE id = '5ed60da7-990c-4407-9d63-cf61e1714789';
  UPDATE public.packages SET paid_amount = 59000 WHERE id = '3f4d3ec6-30e1-47a1-873d-3e798043f240';
  -- C1b 원복: 취소 pkg f48cb162 stranded 캐시 원복(MOVE 직전 = 59,000). C1b 실측 고정값(가역).
  UPDATE public.packages SET paid_amount = 59000 WHERE id = 'f48cb162-d480-4e37-9864-f560d15da16d';
END $$;

COMMIT;

-- 사후 확인: payments 원본 2행 복원 + package_payments MOVE분 0 + paid_amount=Part1값(10,000/59,000).
-- ※ archive 행은 감사보존(삭제하지 않음). 완전 원복 확인 후 필요 시 별도 정리.

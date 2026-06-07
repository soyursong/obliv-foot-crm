-- ============================================================================
-- T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE  ·  ROLLBACK (역연산)
-- ----------------------------------------------------------------------------
-- 전제: merge_proposal.sql STEP 0 백업이 선행되어 있어야 함.
--   · public._merge_bk_T20260607_cmaster_customers : DELETE 된 ERR customers 원본
--   · public._merge_bk_T20260607_cmaster_moves      : 재귀속(이동) 자식행 대장
-- 동작(순서 불변):
--   (1) ERR customers 행 재INSERT(자식 FK 가 유효하도록 부모 먼저 복원)
--   (2) 이동대장 기준으로 자식행 customer 참조를 KEEP → ERR(원래 값)로 원복
-- *** GATE — supervisor 게이트 하에서만 실행. dev-foot 자동 실행 금지. ***
-- ============================================================================
BEGIN;

-- (1) ERR customers 부모행 복원 (이미 존재하면 skip)
INSERT INTO public.customers
SELECT * FROM public._merge_bk_T20260607_cmaster_customers
ON CONFLICT (id) DO NOTHING;

-- (2) 이동대장 역재귀속: KEEP 으로 옮겼던 자식행을 원래 ERR 로 되돌림.
--     현재 값이 KEEP(new_customer_id)일 때만 원복(병합 이후 타개입 행 보호).
DO $$
DECLARE m record;
BEGIN
  FOR m IN
    SELECT ref_table, ref_column, row_id, old_customer_id, new_customer_id
      FROM public._merge_bk_T20260607_cmaster_moves
     ORDER BY ref_table, ref_column
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = %L::uuid WHERE id = %L::uuid AND %I = %L::uuid',
      m.ref_table, m.ref_column, m.old_customer_id, m.row_id, m.ref_column, m.new_customer_id
    );
  END LOOP;
END $$;

-- 검증(참고 SELECT) — 원복 후 ERR 2행 재존재 + 동명 실명 다시 2행:
--   SELECT id, name, phone FROM public.customers
--    WHERE id IN ('7cef3be8-211f-4685-8c80-5141240328cf','53661ce0-5d3a-4da6-8459-121c36860d45');
--   기대: 2 rows.

COMMIT;

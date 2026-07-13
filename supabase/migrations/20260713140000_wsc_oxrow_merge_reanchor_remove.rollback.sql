-- ROLLBACK — T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK (WS-C) merge/re-anchor + remove
--
-- 복원 원천 = apply 러너가 파괴 前 off-git _backup 네임스페이스에 선적재한 archive:
--   _backup.wsc_20260713_dup_customers  (삭제된 dup master 전체 행)
--   _backup.wsc_20260713_child_relink   (재앵커된 자식: child_table·child_id·old_customer_id·new_customer_id)
-- 두 archive 테이블이 없으면(=apply 미실행) 롤백 no-op(안전).
--
-- 순서: ① dup master 재삽입(자식 FK 복원 선행조건) → ② 자식 old_customer_id 로 재앵커.
-- author: dev-foot / 2026-07-13

BEGIN;

DO $$
DECLARE
  r RECORD;
  v_has_cust BOOLEAN;
  v_has_link BOOLEAN;
BEGIN
  SELECT to_regclass('_backup.wsc_20260713_dup_customers') IS NOT NULL INTO v_has_cust;
  SELECT to_regclass('_backup.wsc_20260713_child_relink')  IS NOT NULL INTO v_has_link;

  IF NOT v_has_cust OR NOT v_has_link THEN
    RAISE NOTICE 'WS-C rollback no-op: _backup archive 부재(apply 미실행 추정)';
    RETURN;
  END IF;

  -- ① dup master 재삽입 (이미 있으면 skip)
  INSERT INTO public.customers
  SELECT * FROM _backup.wsc_20260713_dup_customers
  ON CONFLICT (id) DO NOTHING;

  -- ② 자식을 old_customer_id(dup) 로 재앵커 복원
  FOR r IN SELECT DISTINCT child_table AS t, child_column AS c FROM _backup.wsc_20260713_child_relink
  LOOP
    EXECUTE format(
      'UPDATE public.%I ch SET %I = bl.old_customer_id
         FROM _backup.wsc_20260713_child_relink bl
        WHERE bl.child_table = %L AND bl.child_column = %L
          AND ch.id = bl.child_id',
      r.t, r.c, r.t, r.c
    );
  END LOOP;

  RAISE NOTICE 'WS-C rollback 완료: dup master 재삽입 + 자식 old_customer_id 재앵커 복원';
END $$;

COMMIT;

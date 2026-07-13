-- ============================================================================
-- ROLLBACK — foot customers 마스킹오염 백필
-- Ticket : T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL
-- 전제   : forward 마이그(20260714020000)가 COMMIT되어 _backfill_mask_contam_* 3표 존재.
-- 방식   : movelog 정밀 역주행 (archive-first SSOT).
--   (1) _bak → customers 재INSERT (FK 타깃 복원)
--   (2) _fkmoves 역주행: 이동된 자식 행만 child PK(id) 기준 phantom으로 복귀
--       (raw 고유 자식은 건드리지 않음 — from_phantom 기록분만)
--   (3) _denorm 복원: check_ins customer_name/phone → old 값(마스킹)
-- 멱등: 재실행 시 이미 복원된 건은 no-op (WHERE 조건).
-- 주의: 전 FK 자식 테이블은 모두 'id' PK 보유(기계열거 32개 검증). 예외 발생 시 수동 검토.
-- ============================================================================

BEGIN;

-- (1) phantom customers 재INSERT (customers 컬럼만 동적 선택 — _bak 의 부가 2열 제외)
DO $rb1$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ',')
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'customers';
  EXECUTE format(
    'INSERT INTO customers (%s) SELECT %s FROM _backfill_mask_contam_customers_bak b
        WHERE b.backfill_ticket = %L ON CONFLICT (id) DO NOTHING',
    cols, cols, 'T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL');
END $rb1$;

-- (2) FK 자식 역주행 (child.id 기준, 기록된 raw→phantom 복귀)
DO $rb$
DECLARE m record;
BEGIN
  FOR m IN
    SELECT child_table, child_col, from_phantom, (child_row->>'id') AS child_id
      FROM _backfill_mask_contam_fkmoves
     WHERE backfill_ticket = 'T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL'
       AND child_row ? 'id'
     ORDER BY id
  LOOP
    EXECUTE format('UPDATE %I SET %I = %L::uuid WHERE id = %L::uuid',
      m.child_table, m.child_col, m.from_phantom, m.child_id);
  END LOOP;
END $rb$;

-- (3) denorm 복원 (masked old 값)
UPDATE check_ins ci
   SET customer_name  = d.old_name,
       customer_phone = d.old_phone
  FROM _backfill_mask_contam_denorm d
 WHERE ci.id = d.checkin_id;

COMMIT;

-- 정리(선택): 검증 완료 후 백필 아티팩트 제거
-- DROP TABLE IF EXISTS _backfill_mask_contam_customers_bak, _backfill_mask_contam_fkmoves, _backfill_mask_contam_denorm;

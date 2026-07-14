-- ============================================================================
-- ROLLBACK — foot row1(0356b229) self-checkin 중복행 정정 mutation
-- Ticket : T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION
-- 전제   : forward 마이그(20260715140000)가 COMMIT되어 _cleanup_row1_* 4표 존재.
-- 방식   : archive-first SSOT 정밀 역주행 (역순: remove→relink→rrn→denorm 되돌림).
--   (1) ROW1 customers 재INSERT (_bak → customers, FK 타깃 복원)  ── 삭제 되돌림
--   (2) _fkmoves 역주행: 이동된 자식 행만 child PK(id) 기준 RAW→ROW1 복귀  ── relink 되돌림
--   (3) RAW rrn 컬럼 원복 (_rrn_bak old 값 = NULL 기대)  ── RRN 이관 되돌림
--   (4) _denorm 복원: check_ins customer_name/phone → old 값(마스킹)  ── denorm 되돌림
-- 멱등: 재실행 시 이미 복원된 건은 no-op (ON CONFLICT / WHERE 조건).
-- 주의: 전 FK 자식 테이블은 'id' PK 보유 가정(기계열거). 예외 시 수동 검토.
-- ⛔ 본 rollback 은 forward 가 적용된 경우에만 유효. forward 미적용 시 no-op.
-- ============================================================================

BEGIN;

-- (1) ROW1 customers 재INSERT (customers 컬럼만 동적 선택 — _bak 부가 2열 제외)
DO $rb1$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ',')
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'customers';
  EXECUTE format(
    'INSERT INTO customers (%s) SELECT %s FROM _cleanup_row1_customers_bak b
        WHERE b.cleanup_ticket = %L ON CONFLICT (id) DO NOTHING',
    cols, cols, 'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION');
END $rb1$;

-- (2) FK 자식 역주행 (child.id 기준, RAW→ROW1 복귀. 기록된 이동분만)
DO $rb2$
DECLARE m record;
BEGIN
  FOR m IN
    SELECT child_table, child_col, from_row1, (child_row->>'id') AS child_id
      FROM _cleanup_row1_fkmoves
     WHERE cleanup_ticket = 'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION'
       AND child_row ? 'id'
     ORDER BY id
  LOOP
    EXECUTE format('UPDATE %I SET %I = %L::uuid WHERE id = %L::uuid',
      m.child_table, m.child_col, m.from_row1, m.child_id);
  END LOOP;
END $rb2$;

-- (3) RAW rrn 컬럼 원복 (이관 전 값 = NULL 기대)
UPDATE customers r
   SET rrn_enc                = b.old_rrn_enc,
       rrn_vault_id           = b.old_rrn_vault_id,
       rrn_encryption_version = b.old_rrn_encryption_version,
       rrn_re_encrypted_at    = b.old_rrn_re_encrypted_at
  FROM _cleanup_row1_rrn_bak b
 WHERE r.id = b.raw_id
   AND b.cleanup_ticket = 'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION';

-- (4) denorm 복원 (masked old 값)
UPDATE check_ins ci
   SET customer_name  = d.old_name,
       customer_phone = d.old_phone
  FROM _cleanup_row1_denorm d
 WHERE ci.id = d.checkin_id;

COMMIT;

-- 정리(선택): 검증 완료 후 cleanup 아티팩트 제거
-- DROP TABLE IF EXISTS _cleanup_row1_customers_bak, _cleanup_row1_fkmoves, _cleanup_row1_rrn_bak, _cleanup_row1_denorm;

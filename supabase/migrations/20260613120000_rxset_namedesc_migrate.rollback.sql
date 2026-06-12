-- ROLLBACK: T-20260610-foot-RXSET-NAMEDESC-MODEL Q3 A-1 자동이관 되돌리기.
-- 백업 테이블(prescription_sets_namedesc_backup_20260613)의 원본 items 로 복원.
-- 마이그 이후 정상 사용으로 items 가 추가 변경된 세트는 복원하지 않음(현장 입력 보호) —
--   backed_up 당시 items 와 현재 items 가 다르면(=이관 후 사람이 수정) SKIP.

BEGIN;

UPDATE prescription_sets ps
SET items = b.items
FROM prescription_sets_namedesc_backup_20260613 b
WHERE ps.id = b.id
  -- 이관 직후 상태(items[0].name = set.name)와 일치할 때만 되돌림.
  -- 사용자가 마이그 후 직접 수정했다면(items[0].name != set.name 더 이상 아님) 보호 위해 SKIP.
  AND (ps.items->0->>'name') = ps.name;

-- 백업 테이블은 보존(수동 DROP). 검증 후 안전 확인되면:
--   DROP TABLE prescription_sets_namedesc_backup_20260613;

COMMIT;

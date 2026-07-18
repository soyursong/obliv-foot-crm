-- DRY-RUN (무영속) — T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE
-- supervisor DML 게이트에서 apply 전 실행. 마지막 ROLLBACK 으로 무영속.
-- COMMIT 없음 = prod 무변경. up.sql(_remove.sql)의 COMMIT 과 분리 → dry-run sentinel-bypass hazard 회피
--   (Migration Dry-Run No-Persistence Protocol 준수: 본 파일엔 txn 확정문 없음).
-- 목적: freeze셋(=1) 재확인 + DELETE 영향 COUNT(=1 master + 1 folder)이 freeze 스냅샷과 일치함을 증명.

BEGIN;

-- (1) freeze셋 재확인 — 반드시 1행이어야
SELECT 'freeze_master' AS check, count(*) AS cnt, '기대=1' AS expect
FROM prescription_codes
WHERE id = '676ceca0-23f0-4d33-a362-1af04770b564'
  AND name_ko LIKE '대웅푸루나졸%' AND code_source = 'custom';

SELECT 'prefix_total' AS check, count(*) AS cnt, '기대=1(초과대상 0)' AS expect
FROM prescription_codes WHERE name_ko LIKE '대웅푸루나졸%';

-- (2) 무결성 참조 재확인 — 전부 0이어야 hard-DELETE 안전
SELECT 'ref_medical_charts' AS check, count(*) AS cnt, '기대=0' AS expect
FROM medical_charts
WHERE prescription_items @> jsonb_build_array(jsonb_build_object('prescription_code_id','676ceca0-23f0-4d33-a362-1af04770b564'));
SELECT 'ref_prescription_sets' AS check, count(*) AS cnt, '기대=0' AS expect
FROM prescription_sets
WHERE items @> jsonb_build_array(jsonb_build_object('prescription_code_id','676ceca0-23f0-4d33-a362-1af04770b564'));
SELECT 'ref_contraindications' AS check, count(*) AS cnt, '기대=0' AS expect
FROM prescription_contraindications WHERE prescription_code_id = '676ceca0-23f0-4d33-a362-1af04770b564';

-- (3) 삭제 영향 COUNT (folder = 목록 노출 surface)
SELECT 'del_folders' AS check, count(*) AS cnt, '기대=1' AS expect
FROM prescription_code_folders WHERE prescription_code_id = '676ceca0-23f0-4d33-a362-1af04770b564';

-- (4) 실제 DELETE 시뮬레이션 → 삭제 rowcount 확인 후 ROLLBACK (무영속)
DELETE FROM prescription_code_folders WHERE prescription_code_id = '676ceca0-23f0-4d33-a362-1af04770b564';
DELETE FROM prescription_codes        WHERE id = '676ceca0-23f0-4d33-a362-1af04770b564';

SELECT 'post_master' AS check, count(*) AS cnt, '기대=0' AS expect
FROM prescription_codes WHERE id = '676ceca0-23f0-4d33-a362-1af04770b564';

ROLLBACK;  -- 무영속: prod 무변경. 위 COUNT 이 freeze 스냅샷과 일치하면 apply 승인.

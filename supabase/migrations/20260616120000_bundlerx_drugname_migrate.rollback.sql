-- ROLLBACK: T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB
--   forward 마이그(20260616120000_bundlerx_drugname_migrate.sql) 역적용.
--
-- 식별 원칙
--   · 신규 생성 약 = prescription_codes.claim_code LIKE 'RXMIG-%' (결정적 prefix).
--   · 이관 폴더    = prescription_folders.name = '이관약'.
--   · prescription_code_folders 는 양쪽 FK ON DELETE CASCADE → 코드/폴더 삭제 시 매핑 자동 정리.
--
-- 절차
--   1. '이관약' 폴더에 매핑된 (기존 약 포함) prescription_code_folders 행 삭제 → 폴더배정 환원(약 보존).
--   2. RXMIG-* 신규 prescription_codes 삭제 (CASCADE 로 잔여 매핑도 정리).
--   3. '이관약' 폴더 삭제.
--   ※ posology 미이관·prescription_sets 무변경이므로 묶음처방 측 복원 불요.
--
-- ⚠️ 백업본 전체복원이 필요하면 *_bundlerx_backup_20260616 테이블 3종으로 truncate+insert (수동).

BEGIN;

-- 1. '이관약' 폴더 매핑 제거 (기존 약은 미분류로 환원, 약 자체 보존)
DELETE FROM prescription_code_folders
WHERE folder_id IN (SELECT id FROM prescription_folders WHERE name = '이관약');

-- 2. 신규 생성 약 삭제 (RXMIG prefix). 잔여 매핑 CASCADE 정리.
DELETE FROM prescription_codes
WHERE claim_code LIKE 'RXMIG-%';

-- 3. '이관약' 폴더 삭제
DELETE FROM prescription_folders
WHERE name = '이관약';

COMMIT;

-- (선택) 백업 스냅샷 정리:
-- DROP TABLE IF EXISTS prescription_codes_bundlerx_backup_20260616;
-- DROP TABLE IF EXISTS prescription_folders_bundlerx_backup_20260616;
-- DROP TABLE IF EXISTS prescription_code_folders_bundlerx_backup_20260616;

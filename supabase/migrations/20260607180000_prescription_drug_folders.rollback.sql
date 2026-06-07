-- Rollback: T-20260606-foot-RX-SET-REDESIGN AC-R1 약품 폴더 트리
-- 매핑 → 폴더 순으로 drop(FK 의존성 역순). prescription_codes 는 애초에 무변경이라 복원 불요.

DROP POLICY IF EXISTS "prescription_code_folders_write_auth" ON prescription_code_folders;
DROP POLICY IF EXISTS "prescription_code_folders_read_all"  ON prescription_code_folders;
DROP TABLE IF EXISTS prescription_code_folders;

DROP POLICY IF EXISTS "prescription_folders_write_auth" ON prescription_folders;
DROP POLICY IF EXISTS "prescription_folders_read_all"  ON prescription_folders;
DROP TABLE IF EXISTS prescription_folders;

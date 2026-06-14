-- ROLLBACK — T-20260614-foot-RXSET-BUNDLE-MERGE 옵션A (folder='약' 백필 되돌리기)
-- 백업 테이블(prescription_sets_bundle_folder_backup_20260614)의 변경 전 folder 값으로 복원.
-- 옵션A는 folder 컬럼만 변경했으므로 folder 만 복구하면 완전 가역.
-- (items·posology·set id 는 애초에 무변경이라 복원 불필요.)

BEGIN;

UPDATE prescription_sets ps
SET folder = b.folder,            -- 변경 전 값(NULL 포함) 복원
    updated_at = now()
FROM prescription_sets_bundle_folder_backup_20260614 b
WHERE ps.id = b.id;

-- 검증: 백업 대상이 모두 원복됐는지 (불일치=0 기대)
DO $$
DECLARE
  mism int;
BEGIN
  SELECT count(*) INTO mism
  FROM prescription_sets ps
  JOIN prescription_sets_bundle_folder_backup_20260614 b ON b.id = ps.id
  WHERE ps.folder IS DISTINCT FROM b.folder;
  IF mism > 0 THEN
    RAISE EXCEPTION 'RXSET-BUNDLE rollback verify FAILED: % set(s) not restored', mism;
  END IF;
  RAISE NOTICE 'RXSET-BUNDLE rollback OK: % set(s) restored',
    (SELECT count(*) FROM prescription_sets_bundle_folder_backup_20260614);
END $$;

-- 백업 테이블 정리는 수동(롤백 검증 후): DROP TABLE prescription_sets_bundle_folder_backup_20260614;
COMMIT;

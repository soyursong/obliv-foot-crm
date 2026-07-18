-- ROLLBACK — T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE
--   (20260718150000_daewoong_pluranazole_remove.sql 역연산 — 삭제된 대웅푸루나졸 custom row + 폴더 멤버십 원복)
--
-- 복원 원천 = apply 러너가 파괴 前 off-git _backup 네임스페이스에 선적재한 archive(archive-first 1단, 2종):
--   _backup.daewoong_pluranazole_20260718_removed          (삭제된 대웅푸루나졸 prescription_codes 행 전체 컬럼)
--   _backup.daewoong_pluranazole_folders_20260718_removed  (CASCADE 로 함께 삭제된 prescription_code_folders 멤버십 행)
-- archive 테이블이 없으면(=apply 미실행/스냅샷 부재) 각각 no-op(안전).
--
-- ⚠ 복원 순서 중요: prescription_code_folders.prescription_code_id 는 prescription_codes(id) 를 FK 참조하므로
--   반드시 prescription_codes 먼저 재삽입 후 폴더 멤버십을 재삽입한다(부모→자식).
--
-- ⚠ 적용 직후 원복 전제. 원복 후 프로덕션 상태 = 적용 전(서비스관리 약품 목록에 대웅푸루나졸 custom '자체' 복귀,
--   '처방세트 이관' 폴더 멤버십도 복귀). 순소실 0 — 삭제 대상은 custom 카탈로그 행 1건 + 폴더 배지 1건뿐.
-- author: dev-foot / 2026-07-18 (rev 2026-07-19: 폴더 멤버십 원복 추가, FIX-REQUEST 옵션①)

BEGIN;

-- ── (1) prescription_codes 대상 행 원복 (부모 먼저) ──
DO $$
DECLARE
  v_has_backup boolean;
  v_restored   int := 0;
BEGIN
  SELECT to_regclass('_backup.daewoong_pluranazole_20260718_removed') IS NOT NULL INTO v_has_backup;
  IF NOT v_has_backup THEN
    RAISE NOTICE 'DAEWOONG-REMOVE rollback (1) no-op: _backup 약품 archive 부재(apply 미실행 추정)';
    RETURN;
  END IF;

  -- archive 전체 컬럼 재삽입 (이미 있으면 skip — 멱등)
  INSERT INTO public.prescription_codes
  SELECT * FROM _backup.daewoong_pluranazole_20260718_removed
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  RAISE NOTICE 'DAEWOONG-REMOVE rollback (1) OK: 대웅푸루나졸 custom row % 건 재삽입 원복', v_restored;
END $$;

-- ── (2) prescription_code_folders 폴더 멤버십 원복 (자식 나중) ──
DO $$
DECLARE
  v_has_fbackup boolean;
  v_frestored   int := 0;
BEGIN
  SELECT to_regclass('_backup.daewoong_pluranazole_folders_20260718_removed') IS NOT NULL INTO v_has_fbackup;
  IF NOT v_has_fbackup THEN
    RAISE NOTICE 'DAEWOONG-REMOVE rollback (2) no-op: _backup 폴더 archive 부재(폴더 멤버십 원복 생략)';
    RETURN;
  END IF;
  IF to_regclass('public.prescription_code_folders') IS NULL THEN
    RAISE NOTICE 'DAEWOONG-REMOVE rollback (2) no-op: prescription_code_folders 테이블 부재';
    RETURN;
  END IF;

  -- 폴더 멤버십 재삽입 (부모 약품 행이 복귀되어 있어야 FK 충족 — 위 (1) 선행 전제). 멱등.
  INSERT INTO public.prescription_code_folders
  SELECT * FROM _backup.daewoong_pluranazole_folders_20260718_removed
  ON CONFLICT (prescription_code_id) DO NOTHING;
  GET DIAGNOSTICS v_frestored = ROW_COUNT;

  RAISE NOTICE 'DAEWOONG-REMOVE rollback (2) OK: 폴더 멤버십 % 건 재삽입 원복(''처방세트 이관'')', v_frestored;
END $$;

COMMIT;

-- 검증: SELECT id, name_ko, code_source, claim_code FROM public.prescription_codes WHERE name_ko LIKE '대웅푸루나졸%';
--        → 1건 복귀(대웅푸루나졸정150mg(플루코나졸) / custom / LEGACY-12d7730e32e8)
--       SELECT pcf.prescription_code_id, pcf.folder_id FROM public.prescription_code_folders pcf
--         JOIN public.prescription_codes pc ON pc.id=pcf.prescription_code_id WHERE pc.name_ko LIKE '대웅푸루나졸%';
--        → 1건 복귀(folder_id ed3ae609… '처방세트 이관')

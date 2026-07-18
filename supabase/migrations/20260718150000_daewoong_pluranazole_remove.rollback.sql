-- ROLLBACK — T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE
--   (20260718150000_daewoong_pluranazole_remove.sql 역연산 — 삭제된 대웅푸루나졸 custom row 원복)
--
-- 복원 원천 = apply 러너가 파괴 前 off-git _backup 네임스페이스에 선적재한 archive(archive-first 1단):
--   _backup.daewoong_pluranazole_20260718_removed  (삭제된 대웅푸루나졸 행 전체 컬럼)
-- archive 테이블이 없으면(=apply 미실행/스냅샷 부재) 롤백 no-op(안전).
--
-- ⚠ 적용 직후 원복 전제. 원복 후 프로덕션 상태 = 적용 전(서비스관리 약품 목록에 대웅푸루나졸 custom '자체' 복귀).
--   순소실 0 — 삭제 대상은 custom 카탈로그 행 1건뿐이며 참조 0 확증(FK CASCADE 자식 소실 없음).
-- author: dev-foot / 2026-07-18

BEGIN;

DO $$
DECLARE
  v_has_backup boolean;
  v_restored   int := 0;
BEGIN
  SELECT to_regclass('_backup.daewoong_pluranazole_20260718_removed') IS NOT NULL INTO v_has_backup;
  IF NOT v_has_backup THEN
    RAISE NOTICE 'DAEWOONG-REMOVE rollback no-op: _backup archive 부재(apply 미실행 추정)';
    RETURN;
  END IF;

  -- archive 전체 컬럼 재삽입 (이미 있으면 skip — 멱등)
  INSERT INTO public.prescription_codes
  SELECT * FROM _backup.daewoong_pluranazole_20260718_removed
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  RAISE NOTICE 'DAEWOONG-REMOVE rollback OK: 대웅푸루나졸 custom row % 건 재삽입 원복', v_restored;
END $$;

COMMIT;

-- 검증: SELECT id, name_ko, code_source, claim_code FROM public.prescription_codes WHERE name_ko LIKE '대웅푸루나졸%';
--        → 1건 복귀(대웅푸루나졸정150mg(플루코나졸) / custom / LEGACY-12d7730e32e8)

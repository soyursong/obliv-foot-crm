-- ROLLBACK — T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE (20260718150000_daewoong_pluranazole_remove.sql)
-- 삭제된 '대웅푸루나졸정150mg(플루코나졸)' 마스터 row + 폴더배정을 archive 스냅샷에서 원복.
-- ⚠ 전제: archive 테이블(_archive_daewoong_pluranazole_20260718 / _folders_20260718)이 존재해야 함(apply 가 생성).
--   원복 후 상태 = 적용 전(서비스관리 목록에 대웅푸루나졸 복귀).

BEGIN;

DO $$
DECLARE v_has_master int; v_has_folder int;
BEGIN
  SELECT count(*) INTO v_has_master FROM information_schema.tables
    WHERE table_schema='public' AND table_name='_archive_daewoong_pluranazole_20260718';
  IF v_has_master = 0 THEN
    RAISE EXCEPTION 'DAEWOONG-REMOVE rollback ABORT: archive 마스터 테이블 부재 — 원복 원천 없음';
  END IF;
END $$;

-- 1) 마스터 row 원복 (id PK 충돌 시 skip = 이미 존재하면 no-op)
INSERT INTO prescription_codes
  SELECT * FROM _archive_daewoong_pluranazole_20260718
  ON CONFLICT (id) DO NOTHING;

-- 2) 폴더배정 원복 (prescription_code_id = PK, 충돌 시 skip)
INSERT INTO prescription_code_folders
  SELECT * FROM _archive_daewoong_pluranazole_folders_20260718
  ON CONFLICT (prescription_code_id) DO NOTHING;

-- 3) 사후검증
DO $$
DECLARE v_pc int; v_f int;
BEGIN
  SELECT count(*) INTO v_pc FROM prescription_codes WHERE id = '676ceca0-23f0-4d33-a362-1af04770b564';
  SELECT count(*) INTO v_f  FROM prescription_code_folders WHERE prescription_code_id = '676ceca0-23f0-4d33-a362-1af04770b564';
  IF v_pc <> 1 THEN RAISE EXCEPTION 'DAEWOONG-REMOVE rollback FAILED: master=% (기대 1)', v_pc; END IF;
  RAISE NOTICE 'DAEWOONG-REMOVE rollback OK: 마스터 % / 폴더배정 % 복원', v_pc, v_f;
END $$;

-- archive 테이블 정리는 원복 안정화 후 수동 DROP (원천 보존 위해 자동 DROP 안 함):
--   DROP TABLE IF EXISTS _archive_daewoong_pluranazole_20260718;
--   DROP TABLE IF EXISTS _archive_daewoong_pluranazole_folders_20260718;

COMMIT;

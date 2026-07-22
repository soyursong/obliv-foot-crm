-- ═══════════════════════════════════════════════════════════════════════
-- T-20260722-foot-HIRA-SCORE-GONGDAN-4SVC-LOAD — Part A ROLLBACK
-- BEFORE 상태 복원: 4행 hira_score → NULL (freeze 시점 실측값).
-- 필요 시에만 실행. 4행 한정.
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_rows int;
BEGIN
  UPDATE services
     SET hira_score = NULL
   WHERE id IN (
       'de611ed5-154a-475d-9eb3-19d6d3bad881',  -- AA154
       '117befad-e8f8-48c6-b496-89c37a68a441',  -- AA254
       '1a82c70a-07fe-4321-be44-8a206e3d1aa0',  -- AA222
       '8e401f7f-6746-4807-9366-4e1d9cfb1e7d'   -- D620300HZ
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 4 THEN
    RAISE EXCEPTION 'ROLLBACK rows-affected=% (expected 4)', v_rows;
  END IF;
  RAISE NOTICE 'ROLLBACK OK rows-affected=%', v_rows;
END $$;

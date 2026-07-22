-- ═══════════════════════════════════════════════════════════════════════
-- T-20260722-foot-HIRA-SCORE-GONGDAN-4SVC-LOAD  — Part A APPLY
-- 급여 hira_score 적재 4건 (services.hira_score UPDATE / RPC·DDL 무변경)
-- 대표 직접 지시 · data-correction SOP 준거
--
-- ▓ SOURCE (source 주석 병기, 요구사항): 건강보험 행위 급여·비급여 목록표
--   및 급여 상대가치점수 = 보건복지부 고시 제2025-186호 · 2026년 적용분.
--   점당단가(clinic.hira_unit_value) = 95.60원 (2026 의원 환산지수).
--
-- ▓ 대상 = active=true 4행 한정 (service_code 기준). 비활성/시드/중복 미접촉.
--   de611ed5  AA154      초진진찰료-의원                  → 197.07
--   117befad  AA254      재진진찰료-의원                  → 139.85
--   1a82c70a  AA222      재진-물리치료,주사 등 시술받은경우 → 49.09
--   8e401f7f  D620300HZ  일반진균검사-KOH도말-조갑조직     → 110.20
--
-- ▓ BEFORE 스냅샷 (freeze, 2026-07-22): 위 4행 hira_score = NULL (전부).
-- ▓ 미접촉 보증(DO NOT TOUCH):
--   ed424017 (service_code=AA154, active=false, hira_score=NULL)
--   b98f6831 (hira_code=AA154,   active=false, hira_score=153.36)  ← 시드/중복
-- ▓ ROLLBACK: _rollback.sql (4행 hira_score → NULL 복원).
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_rows int;
BEGIN
  UPDATE services
     SET hira_score = CASE service_code
                        WHEN 'AA154'     THEN 197.07
                        WHEN 'AA254'     THEN 139.85
                        WHEN 'AA222'     THEN 49.09
                        WHEN 'D620300HZ' THEN 110.20
                      END
   WHERE active = true
     AND service_code IN ('AA154','AA254','AA222','D620300HZ')
     AND id IN (
       'de611ed5-154a-475d-9eb3-19d6d3bad881',  -- AA154
       '117befad-e8f8-48c6-b496-89c37a68a441',  -- AA254
       '1a82c70a-07fe-4321-be44-8a206e3d1aa0',  -- AA222
       '8e401f7f-6746-4807-9366-4e1d9cfb1e7d'   -- D620300HZ
     );

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Cross-CRM Write Rows-Affected 표준: rows-affected ≠ 4 → 전체 롤백(RAISE).
  IF v_rows <> 4 THEN
    RAISE EXCEPTION 'ABORT rows-affected=% (expected 4) → 전체 롤백', v_rows;
  END IF;

  RAISE NOTICE 'OK rows-affected=% (=4)', v_rows;
END $$;

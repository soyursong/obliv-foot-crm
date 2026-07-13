-- T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE — 이슈1 (1/2): 점당단가 governed화 seed
--
-- SSOT: revenue_insurance_split_spec.md v1.10 §2-2-0 (환산지수 governed data)
-- DA CONSULT-REPLY: MSG-20260713-234807-dz3j (조건부 GO) + MSG-20260714-012349-0p72
-- 종별 확정: 의원급 (김주연 총괄 ts=1783974337 "의원급/진행해" + 이정환 경영BO "우리 의원이지")
--
-- 배경:
--   clinics.hira_unit_value = 89.4(2024년) 하드코딩 stale. 2026년 의원급 점당단가 = 95.6.
--   현행 급여 수가가 약 6.9% 낮게 계산 중 (89.4 vs 95.6).
--
-- 조치 (★순서 하드제약: seed 먼저 → 20260714120000 RPC fallback 제거 다음):
--   ① seed: 대상 clinics(foot 의원급 2곳) hira_unit_value=95.6 / hira_unit_value_year=2026.
--      멱등: 이미 95.6/2026 이면 0행. (재실행 안전)
--   ② governed 강제: hira_unit_value / hira_unit_value_year 컬럼 DEFAULT(89.4 / 2024) DROP.
--      → 하드코딩 89.4 상수가 stale drift 의 구조적 원인(매년 재발). 컬럼 default 로 신규 clinic
--        이 자동으로 stale 89.4 를 상속하면 NULL→BLOCK governance 가 무력화됨.
--      → default 제거 후 신규 clinic 은 NULL → RPC(v1.3) 가 data_incomplete=true BLOCK →
--        governed seed(연도 고시번호 대조) 강제. (연도 갱신 거버넌스 Q2)
--      기존 2행 데이터는 불변(ADDITIVE·비파괴).
--
-- 연도 갱신 거버넌스(Q2, DA SSOT): owner=DA / trigger=매년 보건복지부 고시(연말~연초) /
--   verification=고시번호+종별 대조 + sample 1행 재계산 / applier=dev(planner 티켓) /
--   산출=clinics seed 갱신 + hira_unit_value_year 기록. 코드 숫자 리터럴 재삽입 금지.
--
-- 소급 = 범위 밖(forward-only). 기존 service_charges/payments 행 UPDATE 절대 금지.
-- rollback: 20260714110000_clinics_hira_unit_value_2026_governed.rollback.sql

BEGIN;

-- ── ① seed: foot 의원급 clinics 2026 점당단가 (멱등) ──────────────────────────
UPDATE clinics
SET hira_unit_value      = 95.6,
    hira_unit_value_year = 2026
WHERE slug IN ('jongno-foot', 'songdo-foot')
  AND (hira_unit_value      IS DISTINCT FROM 95.6
       OR hira_unit_value_year IS DISTINCT FROM 2026);

-- cutover 게이트: 대상 clinics hira_unit_value NULL 0건 확인 (있으면 abort)
DO $$
DECLARE
  v_null_cnt INT;
BEGIN
  SELECT count(*) INTO v_null_cnt
  FROM clinics
  WHERE slug IN ('jongno-foot', 'songdo-foot')
    AND hira_unit_value IS NULL;
  IF v_null_cnt > 0 THEN
    RAISE EXCEPTION 'cutover abort: 대상 clinics hira_unit_value NULL % 건 (fallback 제거 전 seed 필수)', v_null_cnt;
  END IF;
END $$;

-- ── ② governed 강제: 하드코딩 89.4/2024 컬럼 default 제거 ──────────────────────
ALTER TABLE clinics ALTER COLUMN hira_unit_value      DROP DEFAULT;
ALTER TABLE clinics ALTER COLUMN hira_unit_value_year DROP DEFAULT;

COMMENT ON COLUMN clinics.hira_unit_value IS
  '건보 점당단가(환산지수, 원). governed data — 하드코딩 default 없음(NULL→calc_copayment data_incomplete BLOCK). 연도별 갱신=DA SSOT+planner 티켓. (T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE)';
COMMENT ON COLUMN clinics.hira_unit_value_year IS
  '점당단가 적용 연도(어느 건이 어느 단가로 계산됐나 결정적 식별키=소급 추적성). default 없음. (T-20260713-foot-HIRA-UNIT-VALUE-2026-UPDATE)';

COMMIT;

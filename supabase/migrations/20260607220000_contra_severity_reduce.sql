-- T-20260607-foot-CONTRAINDICATION-MGMT AC-3: 심각도 enum 축소(주의/금기)
--
-- ⚠️ GATED: supervisor dry-run GO 전 prod apply 금지 (planner MSG-211523-vwhi §3).
--    dev(rxlomoozakkjesdqjtvd) 분포 실측 2026-06-07: severity '주의' 1건 / 2값 外 0건 → dev no-op.
--    prod 적용 전 반드시 distribution.sql 재실행 + 2값 外 행 백업.
--
-- prescription_contraindications.severity 는 자유 TEXT(nullable). 기존 CHECK 없음.
-- 본 마이그: (1) 2값 外 레거시 값 리매핑, (2) CHECK 제약으로 enum 고정.

BEGIN;

-- STEP 1: 2값 外(레거시 '경고' 등) 리매핑.
--   제안 매핑: 비표준 severity → '금기' (3→2 축소 시 경고는 안전측=over-warn 으로 흡수).
--   NULL(미지정)은 보존. ⚠️ 매핑 규칙은 supervisor/현장 확정 대상 — prod 분포로 재확인 후 apply.
--   주의: 리매핑은 원본 손실(롤백 비복원). 적용 전 distribution.sql 의 백업 COPY 로 캡처 권고.
UPDATE prescription_contraindications
   SET severity = '금기'
 WHERE severity IS NOT NULL
   AND severity NOT IN ('주의', '금기');

-- STEP 2: enum 고정 CHECK (NULL 허용 = 미지정 보존, FE 토글 해제 케이스).
ALTER TABLE prescription_contraindications
  DROP CONSTRAINT IF EXISTS chk_contra_severity_2val;
ALTER TABLE prescription_contraindications
  ADD CONSTRAINT chk_contra_severity_2val
  CHECK (severity IS NULL OR severity IN ('주의', '금기'));

COMMIT;

-- read-only — T-20260607-foot-CONTRAINDICATION-MGMT AC-3 적용 전 분포 확인
-- supervisor dry-run 게이트 근거: 2값(주의/금기) 外 severity 존재 여부 + 백업.

-- 1) 심각도 값 분포 (2값 外 = 리매핑 대상)
SELECT COALESCE(severity, '(null/미지정)') AS severity, count(*) AS n
FROM prescription_contraindications
GROUP BY severity
ORDER BY n DESC;

-- 2) 2값 外 행 수 (리매핑 영향 규모)
SELECT count(*) AS out_of_enum_rows
FROM prescription_contraindications
WHERE severity IS NOT NULL
  AND severity NOT IN ('주의', '금기');

-- 3) (적용 직전, 2값 外 존재 시) 백업 캡처 — psql \copy 또는 COPY 로 CSV 저장 후 STEP 1 실행.
-- \copy (SELECT id, prescription_code_id, severity, contraindication_text, created_at
--        FROM prescription_contraindications
--        WHERE severity IS NOT NULL AND severity NOT IN ('주의','금기'))
--   TO 'contra_severity_backup_PREAPPLY.csv' WITH CSV HEADER;

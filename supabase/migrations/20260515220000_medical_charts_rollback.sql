-- T-20260515-foot-MEDICAL-CHART-V1: 롤백 SQL
-- 실행 전 반드시 supervisor 확인
-- 1. chart_doctor_memos (FK 의존, 먼저 제거)
DROP TABLE IF EXISTS chart_doctor_memos CASCADE;
-- 2. medical_charts
DROP TABLE IF EXISTS medical_charts CASCADE;

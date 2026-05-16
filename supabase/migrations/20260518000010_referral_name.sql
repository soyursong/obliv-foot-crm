-- T-20260515-foot-REFERRAL-NAME
-- 소개자 성함 컬럼 추가 (customers 테이블)
-- GO_WARN: ALTER TABLE — nullable, 기존 데이터 영향 없음

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referral_name text;

COMMENT ON COLUMN customers.referral_name IS '방문경로 지인소개 시 소개자 성함';

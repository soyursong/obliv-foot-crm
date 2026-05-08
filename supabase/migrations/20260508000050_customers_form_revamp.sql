-- T-20260508-foot-CUST-FORM-REVAMP: 고객정보 입력폼 전면 수정 — Phase A
-- 8개 컬럼 추가: customer_grade, customer_email, passport_number, postal_code,
--               assigned_staff_role, privacy_consent, sms_reject, marketing_reject
--
-- 롤백: supabase/migrations/20260508000050_customers_form_revamp.down.sql

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_grade TEXT DEFAULT '일반'
    CHECK (customer_grade IN ('일반', '1단계', '2단계', '3단계')),
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS passport_number TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS assigned_staff_role TEXT DEFAULT '데스크'
    CHECK (assigned_staff_role IN ('데스크', '상담실장')),
  ADD COLUMN IF NOT EXISTS privacy_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sms_reject BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_reject BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN customers.customer_grade        IS '고객등급: 일반/1단계/2단계/3단계 (진상 등급)';
COMMENT ON COLUMN customers.customer_email        IS '고객 이메일';
COMMENT ON COLUMN customers.passport_number       IS '여권번호 (외국인 고객)';
COMMENT ON COLUMN customers.postal_code           IS '우편번호 (5자리)';
COMMENT ON COLUMN customers.assigned_staff_role   IS '담당자 구분: 데스크 / 상담실장';
COMMENT ON COLUMN customers.privacy_consent       IS '개인정보 수집·이용 동의';
COMMENT ON COLUMN customers.sms_reject            IS '문자수신거부 여부';
COMMENT ON COLUMN customers.marketing_reject      IS '광고성 문자 수신 미동의';

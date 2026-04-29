-- T-20260430-foot-REFERRER: customers 테이블 추천인 필드 추가
-- referrer_id: 기존 고객 참조 (optional FK)
-- referrer_name: 자유 텍스트 fallback

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referrer_id  uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referrer_name text;

COMMENT ON COLUMN customers.referrer_id   IS '추천인 고객 ID (기존 고객 참조, optional)';
COMMENT ON COLUMN customers.referrer_name IS '추천인 이름 텍스트 (기존 고객이 아닌 경우 fallback)';

-- rollback:
-- ALTER TABLE customers DROP COLUMN IF EXISTS referrer_id;
-- ALTER TABLE customers DROP COLUMN IF EXISTS referrer_name;

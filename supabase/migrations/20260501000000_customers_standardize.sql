-- T-20260430-foot-CUSTOMERS-STANDARDIZE
-- customers 테이블 풀퍼널 표준화 (풋단독)
-- 큐카드 정책 v1.0 + 도파민 표준 정렬
-- 2026-05-01

-- 풀퍼널 통합 ID
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS unified_customer_id UUID;

-- 광고 매핑 (큐카드 정책 v1.0 §2-2)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS campaign_id    TEXT,
  ADD COLUMN IF NOT EXISTS adset_id       TEXT,
  ADD COLUMN IF NOT EXISTS ad_id          TEXT,
  ADD COLUMN IF NOT EXISTS campaign_ref   TEXT;

-- 매체 메타 (자피어 하드코딩, NULL=불명)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS hospital       TEXT,
  ADD COLUMN IF NOT EXISTS clinic         TEXT,
  ADD COLUMN IF NOT EXISTS medium         TEXT,
  ADD COLUMN IF NOT EXISTS product        TEXT;

-- 캠페인 라벨
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS campaign_name  TEXT,
  ADD COLUMN IF NOT EXISTS adset_name     TEXT,
  ADD COLUMN IF NOT EXISTS adsubject_name TEXT;

-- 인구통계 (도파민 표준)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS gender         TEXT
    CHECK (gender IS NULL OR gender IN ('M','F'));

-- 유입
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS inflow_channel TEXT,
  ADD COLUMN IF NOT EXISTS inflow_source  TEXT;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_customers_unified_id     ON customers(unified_customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_campaign_ref   ON customers(campaign_ref);
CREATE INDEX IF NOT EXISTS idx_customers_inflow_channel ON customers(inflow_channel);

-- 코멘트
COMMENT ON COLUMN customers.unified_customer_id IS '풋센터 풀퍼널 통합 ID (큐카드 정책 v1.0)';
COMMENT ON COLUMN customers.campaign_id    IS '메타 캠페인 ID (큐카드 v1.0 §2-2)';
COMMENT ON COLUMN customers.adset_id       IS '메타 광고세트 ID';
COMMENT ON COLUMN customers.ad_id          IS '메타 광고 ID';
COMMENT ON COLUMN customers.campaign_ref   IS '{campaign_id}::{adset_id}::{ad_id} 합성 (§2-1)';
COMMENT ON COLUMN customers.hospital       IS '병원명 (자피어 하드코딩, NULL=불명)';
COMMENT ON COLUMN customers.clinic         IS '클리닉명 (자피어 하드코딩, NULL=불명)';
COMMENT ON COLUMN customers.medium         IS '매체명 (자피어 하드코딩, NULL=불명)';
COMMENT ON COLUMN customers.product        IS '상품명 (자피어 하드코딩, NULL=불명)';
COMMENT ON COLUMN customers.campaign_name  IS '캠페인 라벨 (사람 가독)';
COMMENT ON COLUMN customers.adset_name     IS '광고세트 라벨';
COMMENT ON COLUMN customers.adsubject_name IS '광고소재 라벨';
COMMENT ON COLUMN customers.gender         IS 'M/F (도파민 표준)';
COMMENT ON COLUMN customers.inflow_channel IS 'meta_ads/naver_talk/kakao/direct (§2)';
COMMENT ON COLUMN customers.inflow_source  IS '매체세부명 (instant/landing/talktalk)';

-- 기존 데이터 backfill
UPDATE customers
SET unified_customer_id = id
WHERE unified_customer_id IS NULL;

-- RPC 함수
CREATE OR REPLACE FUNCTION get_or_create_unified_customer_id(p_phone TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT unified_customer_id INTO v_id
  FROM customers
  WHERE phone = p_phone AND unified_customer_id IS NOT NULL
  LIMIT 1;
  IF v_id IS NULL THEN v_id := gen_random_uuid(); END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION get_or_create_unified_customer_id(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_unified_customer_id(TEXT) TO authenticated;

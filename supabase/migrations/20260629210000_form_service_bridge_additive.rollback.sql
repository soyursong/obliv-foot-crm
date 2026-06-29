-- ROLLBACK: T-20260617-foot-DOCFORM-POPUP-OVERHAUL — 서류 가격 SSOT 구조 DDL 슬라이스
-- 무손실 원상복귀 — ADD 한 것만 DROP. 기존 데이터/컬럼/제약/RLS/트리거 무영향.
--   · DROP VIEW v_foot_form_master
--   · DROP INDEX idx_form_templates_service_id
--   · DROP COLUMN form_templates.service_id (백필된 link 값 함께 소멸 — 양식 행·services 행 전부 보존, 유실 0)
--   · DROP COLUMN services.pricing_tiers (계단단가 JSONB 함께 소멸 — flat price 필드 무영향)
-- ⚠ Migration B(행 등재/백필)를 이미 적용한 상태에서 롤백하면 service_id link·pricing_tiers 값이 사라짐.
--   원본 양식·services SKU 행은 그대로 → 기능 회귀 없음(가격은 services.price 로 여전히 조회 가능).

BEGIN;

DROP VIEW IF EXISTS v_foot_form_master;

DROP INDEX IF EXISTS idx_form_templates_service_id;

ALTER TABLE form_templates
  DROP COLUMN IF EXISTS service_id;

ALTER TABLE services
  DROP COLUMN IF EXISTS pricing_tiers;

COMMIT;

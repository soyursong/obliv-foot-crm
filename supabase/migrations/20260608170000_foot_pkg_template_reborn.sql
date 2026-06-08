-- T-20260608-foot-PKG-REBORN-TEMPLATE-MGMT
-- package_templates 테이블에 'Re:Born' 신규 패키지 항목 회차·단가 컬럼 추가
-- (ITEM 티켓 20260608120000 은 packages 테이블에만 reborn 컬럼을 추가했고,
--  템플릿 관리 화면(Packages.tsx)이 저장하는 별도 테이블 package_templates 에는 누락 → 본 마이그로 보충)
-- additive · backward-compatible (DEFAULT 0 → 기존 템플릿 row·정렬·집계 무영향)
--
-- Rollback SQL: 20260608170000_foot_pkg_template_reborn.rollback.sql 참조
--   ALTER TABLE package_templates DROP COLUMN IF EXISTS reborn_sessions;
--   ALTER TABLE package_templates DROP COLUMN IF EXISTS reborn_unit_price;

ALTER TABLE package_templates ADD COLUMN IF NOT EXISTS reborn_sessions   INTEGER DEFAULT 0;
ALTER TABLE package_templates ADD COLUMN IF NOT EXISTS reborn_unit_price INTEGER DEFAULT 0;

COMMENT ON COLUMN package_templates.reborn_sessions   IS 'Re:Born 회차 (T-20260608-foot-PKG-REBORN-TEMPLATE-MGMT)';
COMMENT ON COLUMN package_templates.reborn_unit_price IS 'Re:Born 회당 수가 (T-20260608-foot-PKG-REBORN-TEMPLATE-MGMT)';

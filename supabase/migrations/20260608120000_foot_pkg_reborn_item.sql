-- T-20260608-foot-PKG-REBORN-ITEM
-- packages 테이블에 'Re:Born' 신규 패키지 항목 회차·단가 컬럼 추가
-- additive · backward-compatible (DEFAULT 0 → 기존 row·정렬·집계 무영향)
--
-- Rollback SQL: 20260608120000_foot_pkg_reborn_item.rollback.sql 참조
--   ALTER TABLE packages DROP COLUMN IF EXISTS reborn_sessions;
--   ALTER TABLE packages DROP COLUMN IF EXISTS reborn_unit_price;

ALTER TABLE packages ADD COLUMN IF NOT EXISTS reborn_sessions   INTEGER DEFAULT 0;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS reborn_unit_price INTEGER DEFAULT 0;

COMMENT ON COLUMN packages.reborn_sessions   IS 'Re:Born 회차 (T-20260608-foot-PKG-REBORN-ITEM)';
COMMENT ON COLUMN packages.reborn_unit_price IS 'Re:Born 회당 수가 (T-20260608-foot-PKG-REBORN-ITEM)';

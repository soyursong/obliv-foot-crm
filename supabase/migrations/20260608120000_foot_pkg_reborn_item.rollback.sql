-- T-20260608-foot-PKG-REBORN-ITEM rollback
-- packages 테이블의 Re:Born 회차·단가 컬럼 제거

ALTER TABLE packages DROP COLUMN IF EXISTS reborn_sessions;
ALTER TABLE packages DROP COLUMN IF EXISTS reborn_unit_price;

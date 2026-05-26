-- T-20260526-foot-PMW-SIDE-MENU-FEAT AC-6 — ROLLBACK
-- service_menu_order 테이블 제거

DROP INDEX  IF EXISTS idx_smo_clinic_cat_order;
DROP TABLE  IF EXISTS service_menu_order;

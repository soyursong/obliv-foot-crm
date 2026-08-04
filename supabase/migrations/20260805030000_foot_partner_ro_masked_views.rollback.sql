-- ROLLBACK: T-20260720-foot-SUPABASE-TOKEN-DISCLOSURE-REQUEST partner_ro 마스킹 뷰
-- 전량 가역·ADDITIVE 역연산. 스키마 CASCADE = 7뷰 + 5헬퍼함수 동시 DROP.
-- ⚠ base public 테이블/RLS/데이터 무접점 (뷰·함수·스키마만 생성했으므로 손실 0).
-- 롤 프로비저닝(Step 9)을 gate_c에서 별도 실행했다면 롤도 별도 DROP ROLE 필요:
--   -- REASSIGN OWNED BY partner_eunsang TO postgres;  DROP OWNED BY partner_eunsang;  DROP ROLE IF EXISTS partner_eunsang;
-- ⚠ top-level BEGIN/COMMIT 없음 (dry-run harness 호환)

DROP SCHEMA IF EXISTS partner_ro CASCADE;

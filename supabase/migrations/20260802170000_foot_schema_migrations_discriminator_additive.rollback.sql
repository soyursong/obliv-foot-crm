-- ROLLBACK — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP3 (되돌림)
--   20260802170000_foot_schema_migrations_discriminator_additive.sql 원복.
--   author: dev-foot / 2026-08-02
--
-- ⚠ ADDITIVE(컬럼 추가 + record-step) 이므로 통상 롤백 불요(forward-only, 하류 무영향).
--   긴급 원복 시에만: discriminator 컬럼 제거 + self-record 원장행 삭제.
--   ★ STEP5(fail-closed 트리거·NOT NULL)가 이미 apply 됐다면 content_checksum 에 의존하므로 본 롤백 금지
--     (선 STEP5 롤백 필요). 본 STEP3 단독 롤백은 STEP4/5 미apply 상태에서만 안전.
-- =========================================================================

BEGIN;

-- (1) self-record 원장행 제거(멱등) — content_checksum 컬럼 참조 전에 삭제.
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260802170000'
  AND name = 'foot_schema_migrations_discriminator_additive';

-- (2) discriminator 컬럼 제거(멱등). record-step 이 채운 값도 함께 소멸(ADDITIVE 원복).
ALTER TABLE supabase_migrations.schema_migrations
  DROP COLUMN IF EXISTS content_checksum;

COMMIT;

-- 검증: content_checksum 컬럼 부재 + version 20260802170000 행 부재.

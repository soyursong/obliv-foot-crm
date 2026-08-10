-- ROLLBACK — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP8 (apply-path belt 되돌림)
--   20260810130000_..._createdby_applypath_belt_step8.sql 원복 — belt 트리거/함수 제거 + self-record 삭제.
--   author: dev-foot / 2026-08-10
--
-- ⚠ ADDITIVE guard(BEFORE INSERT stamp) 이므로 통상 롤백 불요(forward-only, 기존 행 무영향).
--   긴급 원복 시에만 사용.
--   ★★ 위험: STEP5(created_by NOT NULL)가 이미 apply 됐다면 belt 제거 시, 이후 정상 CLI 마이그(미지정 INSERT)가
--      not_null_violation 으로 거부 = self-inflicted apply outage. ∴ belt 롤백은 STEP5(NOT NULL) 롤백을
--      선행하거나, NOT NULL 미적용 상태에서만 안전. (STEP5 rollback = 20260802170003_..._failclosed.rollback.sql)
--   ★ belt 가 이미 stamp 한 cli-apply:* 행은 되돌리지 않음(진실 보존, 파괴 금지). 트리거/함수만 제거.
-- =========================================================================

BEGIN;

-- (1) self-record 원장행 제거(멱등).
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260810130000'
  AND name = 'foot_schema_migrations_createdby_applypath_belt_step8';

-- (2) belt 트리거 제거(멱등).
DROP TRIGGER IF EXISTS trg_foot_schema_migrations_createdby_belt
  ON supabase_migrations.schema_migrations;

-- (3) belt 함수 제거(멱등).
DROP FUNCTION IF EXISTS public.foot_schema_migrations_createdby_belt();

COMMIT;

-- 검증: 트리거 trg_foot_schema_migrations_createdby_belt 부재 + 함수 부재 + version 20260810130000 행 부재.
--   ★ 재확인: STEP5(NOT NULL) 활성 중 본 롤백 실행 = 이후 CLI apply outage 위험(위 경고 참조).

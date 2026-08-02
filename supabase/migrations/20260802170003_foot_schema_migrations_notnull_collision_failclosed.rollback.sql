-- ROLLBACK — T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT STEP 5 (B1+B5 되돌림)
--   20260802170003_..._notnull_collision_failclosed.sql 원복 — NOT NULL 해제 + 트리거/함수 제거 + self-record 삭제.
--   author: dev-foot / 2026-08-02
--
-- ⚠ forward-only 원칙상 통상 롤백 불요. 긴급 원복 시에만 사용.
--   ★ 순서: 본 롤백(B1 NOT NULL 해제)을 §5.5(170002) 롤백보다 먼저 실행해야 함 — NOT NULL 이 살아있으면
--     170002 롤백(phantom→NULL)이 제약 위반으로 실패.
--   전량 멱등(IF EXISTS / is_nullable 가드).
-- =========================================================================

BEGIN;

-- ── B1: created_by NOT NULL 해제(멱등) ──
DO $$
DECLARE v_nullable text;
BEGIN
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
  WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND column_name='created_by';
  IF v_nullable = 'NO' THEN
    ALTER TABLE supabase_migrations.schema_migrations ALTER COLUMN created_by DROP NOT NULL;
    RAISE NOTICE 'ROLLBACK B1: created_by DROP NOT NULL.';
  ELSE
    RAISE NOTICE 'ROLLBACK B1 no-op: created_by 이미 nullable.';
  END IF;
END $$;

-- ── B5: 트리거·함수 제거(멱등) ──
DROP TRIGGER IF EXISTS trg_foot_schema_migrations_collision_guard
  ON supabase_migrations.schema_migrations;
DROP FUNCTION IF EXISTS public.foot_schema_migrations_collision_guard();

-- ── self-record 삭제(멱등) — 원장에서 본 마이그 기록 제거 ──
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260802170003';

COMMIT;

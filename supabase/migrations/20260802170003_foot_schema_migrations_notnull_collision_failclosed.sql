-- T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT  ── STEP 5 (B1 NOT NULL + B5 fail-closed 번들)
--   풋CRM 원장(supabase_migrations.schema_migrations)에:
--     B1) created_by NOT NULL 제약 = actor-less INSERT 물리거부(V2 벡터 차단).
--     B5) version-collision fail-closed 트리거 = 동일 version+상이 identity(name,content_checksum)=REJECT /
--         동일 identity=멱등 replay(ON CONFLICT DO NOTHING 존치). V4 벡터(silent skip) 차단.
--   ★ B1+B5 마이그 번들 병합(2회 ALTER 회피, DA 권고). 1 트랜잭션 원자.
--   author: dev-foot / 2026-08-02
--   parent: T-20260802-meta-APPLYPATH-OOB-GUARD-HARDEN (umbrella B1↔V2 / B5↔V4)
--   게이트: DA nxyx(B1=GO/DESTRUCTIVE, B5=GO/ADDITIVE guard) + supervisor 70t0(enforcement lane ACK) + supervisor DB-gate.
--   ⚠ BLOCKED-UNTIL 해제 근거: §5.5 phantom reconcile(20260802170002, Option A 정직마커) 선행 필수 —
--     그래야 created_by NULL 잔여 0 → NOT NULL apply 통과. 본 마이그는 그 사실을 pre-check 로 재확인(fail-closed).
--   ⚠ supervisor DB-gate 하에서만 prod apply. 자작 러너 raw-exec 금지(본 pilot 이 차단하려는 바로 그 벡터).
--
-- ── ★ NOT NULL ≠ authenticity (설계 경계) ────────────────────────────────────────
--   NOT NULL 제약은 actor-less(created_by 미지정) INSERT 를 물리 거부할 뿐, provenance 진위 보증이 아니다.
--   진위 stamp 는 apply 경로(하드닝 러너)의 책임. 본 제약은 "미승인 raw-exec 우회의 물리 차단막".
--   ★ 운영 결과(중요): 본 제약 이후 원장 기록은 created_by 를 stamp 하는 경로로만 가능.
--     선재 pending 마이그의 원장 기록 = 하드닝 러너(created_by stamp)를 통해야 함(무회귀 전제).
--
-- ── B5 identity·무회귀 (AC5) ─────────────────────────────────────────────────────
--   identity = (name, content_checksum). content_checksum = md5(coalesce(statements::text,'')) (STEP3 record-step).
--   트리거는 NEW.content_checksum 이 NULL(CLI 미산출)이면 md5(coalesce(NEW.statements::text,'')) 로 자체 산출 →
--   기존 record-step 값과 동일 산식 → 멱등 매치. 선재 255 pending 은 신규 version(원장 미존재) → 트리거 통과(무회귀).
-- =========================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- B5) version-collision fail-closed 트리거 (content-aware, silent skip 금지)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.foot_schema_migrations_collision_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_exist_name     text;
  v_exist_checksum text;
  v_found          boolean := false;
  v_new_checksum   text;
BEGIN
  -- 동일 version 선재 행 조회(같은 txn 내 선행 INSERT 포함).
  SELECT name, content_checksum
    INTO v_exist_name, v_exist_checksum
  FROM supabase_migrations.schema_migrations
  WHERE version = NEW.version
  LIMIT 1;
  v_found := FOUND;

  -- 신규 version(원장 미존재) → 통과. ★선재 255 pending 무회귀 경로.
  IF NOT v_found THEN
    RETURN NEW;
  END IF;

  -- 동일 version 존재 → identity(name, content_checksum) 대조.
  --   NEW.content_checksum NULL(CLI 미산출) → statements 로 자체 산출(record-step 과 동일 산식).
  v_new_checksum := coalesce(NEW.content_checksum, md5(coalesce(NEW.statements::text, '')));

  IF (v_exist_name IS DISTINCT FROM NEW.name)
     OR (v_exist_checksum IS DISTINCT FROM v_new_checksum) THEN
    -- genuine collision(동일 version + 상이 identity) → fail-closed REJECT(silent skip 금지).
    RAISE EXCEPTION
      'OOB-GUARD(B5) fail-closed REJECT: version % genuine collision — 원장 identity(name=%, checksum=%) ≠ 신규(name=%, checksum=%). ON CONFLICT DO NOTHING 로 silent skip 금지(V4 벡터).',
      NEW.version, v_exist_name, v_exist_checksum, NEW.name, v_new_checksum
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 동일 version + 동일 identity = 멱등 replay → 통과(후속 ON CONFLICT DO NOTHING 이 실제 skip 처리, 존치).
  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION public.foot_schema_migrations_collision_guard() IS
  'T-20260802 B5(umbrella APPLYPATH-OOB-GUARD-HARDEN, 재발벡터 V4): schema_migrations BEFORE INSERT — 동일 version+상이 identity(name,content_checksum)=fail-closed REJECT / 동일 identity=멱등 replay 통과. 신규 version=통과(pending 무회귀).';

DROP TRIGGER IF EXISTS trg_foot_schema_migrations_collision_guard
  ON supabase_migrations.schema_migrations;

CREATE TRIGGER trg_foot_schema_migrations_collision_guard
  BEFORE INSERT ON supabase_migrations.schema_migrations
  FOR EACH ROW
  EXECUTE FUNCTION public.foot_schema_migrations_collision_guard();

-- ══════════════════════════════════════════════════════════════════════════
-- B1) created_by NOT NULL (actor-less INSERT 물리거부) — NULL 잔여 0 pre-check 후 fail-closed
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_null     int;
  v_nullable text;
  c_phantom  constant text := '20260724200000';
  v_phantom_marked int;
BEGIN
  -- ── pre-check: created_by NULL 잔여 0 (아니면 5.5 reconcile/backfill 미선행 → abort) ──
  SELECT count(*) INTO v_null
  FROM supabase_migrations.schema_migrations
  WHERE created_by IS NULL;

  IF v_null <> 0 THEN
    RAISE EXCEPTION 'ABORT(B1): created_by NULL 잔여 % 행 — NOT NULL 제약 apply 불가. STEP2~4(class-a 178 backfill) + §5.5(phantom % oob-unreconciled marker, 20260802170002) 선행 필수. 전체 롤백.',
      v_null, c_phantom;
  END IF;

  -- ── belt: phantom 이 정직마커로 reconcile 됐는지 재확인(§5.5 선행 증거) ──
  SELECT count(*) INTO v_phantom_marked
  FROM supabase_migrations.schema_migrations
  WHERE version = c_phantom AND created_by = 'oob-unreconciled';
  IF v_phantom_marked <> 1 THEN
    RAISE EXCEPTION 'ABORT(B1): phantom % 가 oob-unreconciled 로 reconcile 되지 않음(=%). §5.5(20260802170002) 선행 필수. 전체 롤백.',
      c_phantom, v_phantom_marked;
  END IF;

  -- ── NOT NULL 적용(멱등: 이미 NOT NULL 이면 no-op) ──
  SELECT is_nullable INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'supabase_migrations'
    AND table_name   = 'schema_migrations'
    AND column_name  = 'created_by';

  IF v_nullable = 'YES' THEN
    ALTER TABLE supabase_migrations.schema_migrations
      ALTER COLUMN created_by SET NOT NULL;
    RAISE NOTICE 'B1 OK: created_by SET NOT NULL(NULL 잔여 0·phantom oob-unreconciled 확인 후). actor-less INSERT 물리거부 활성.';
  ELSE
    RAISE NOTICE 'B1 no-op(멱등): created_by 이미 NOT NULL.';
  END IF;
END $$;

-- ── 원장 self-record (created_by 명시 stamp — V2 준수). 트리거는 신규 version 170003 통과. ──
INSERT INTO supabase_migrations.schema_migrations (version, name, created_by, content_checksum)
VALUES (
  '20260802170003',
  'foot_schema_migrations_notnull_collision_failclosed',
  'dev-foot:T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT',
  md5('')
)
ON CONFLICT (version) DO UPDATE
  SET created_by      = EXCLUDED.created_by,
      content_checksum = coalesce(supabase_migrations.schema_migrations.content_checksum, EXCLUDED.content_checksum)
  WHERE supabase_migrations.schema_migrations.created_by IS NULL;

COMMIT;

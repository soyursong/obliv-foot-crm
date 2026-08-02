-- T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT  ── STEP 3 (B5 discriminator, ADDITIVE record-step)
--   풋CRM 마이그레이션 원장(supabase_migrations.schema_migrations)에 version-collision 판별용
--   discriminator 컬럼 `content_checksum` 을 ADDITIVE 로 추가하고, 기존 전 row 를 record-step 으로 채운다.
--   author: dev-foot / 2026-08-02
--   parent: T-20260802-meta-APPLYPATH-OOB-GUARD-HARDEN (umbrella B5 ↔ 재발벡터 V4)
--   게이트: DA CONSULT-REPLY nxyx(B5=GO/ADDITIVE guard) + supervisor CONSULT-REPLY 70t0(enforcement lane ACK).
--   ⚠ supervisor DB-gate 하에서만 prod apply. 자작 러너 raw-exec 금지(본 pilot 이 차단하려는 벡터).
--
-- ── 왜 name+content-checksum 인가 (센서스 STEP1 근거) ──────────────────────────
--   원장 = supabase_migrations.schema_migrations (public 아님). created_by/idempotency_key 컬럼은
--   이미 존재(text, nullable). 단 idempotency_key 는 1행만 채워짐/242 NULL → discriminator 재사용 불가.
--   ∴ B5 identity = (name, content_checksum) 신규 산출. version 은 PK(충돌 축), name+checksum 은 진위 축.
--     · 동일 version + 동일 (name, content_checksum) = 멱등 replay → 후속 step5 에서 DO NOTHING 존치.
--     · 동일 version + 상이 (name, content_checksum) = genuine collision → 후속 step5 에서 fail-closed REJECT.
--   본 STEP3 은 컬럼 추가 + record-step 만. NOT NULL·트리거·fail-closed 는 STEP5(별건, phantom reconcile 선행 BLOCKED).
--
-- ── content_checksum 산식(타입 안전) ─────────────────────────────────────────
--   md5(coalesce(statements::text, ''))
--     · statements 는 supabase 표준상 text[] 이나, ::text 캐스팅으로 text[]/text 무관하게 결정적 문자열화.
--     · statements NULL(초기 CLI 미기록 154행) → md5('') = 안정 상수. record-step 은 "현재 실재"를 정직 기록.
--       (미래 동일 마이그 replay 시 동일 name+NULL statements → 동일 checksum → 멱등 매치. 정합.)
--   ★ identity 는 (name, content_checksum) 튜플. name 은 기존 컬럼이므로 신규 컬럼은 content_checksum 하나만.
--
-- ── ADDITIVE·멱등·비파괴 ─────────────────────────────────────────────────────
--   ADD COLUMN IF NOT EXISTS + record-step 은 content_checksum IS NULL 행만 채움(재실행 no-op).
--   기존 데이터(version·name·created_by·statements) 무접촉. blanket 치환 없음.
-- =========================================================================

BEGIN;

-- ── (A) discriminator 컬럼 ADDITIVE 추가 (멱등) ──
ALTER TABLE supabase_migrations.schema_migrations
  ADD COLUMN IF NOT EXISTS content_checksum text;

COMMENT ON COLUMN supabase_migrations.schema_migrations.content_checksum IS
  'T-20260802 B5 discriminator: md5(coalesce(statements::text,'''')). identity=(name, content_checksum). 동일 version+상이 identity=genuine collision(STEP5 fail-closed REJECT 대상) / 동일 identity=멱등 replay(DO NOTHING 존치). forward-only.';

-- ── (B) record-step: 기존 전 row content_checksum 채움(비어있는 행만 = 멱등) ──
DO $$
DECLARE
  v_total   int;
  v_filled  int;
  v_remain  int;
BEGIN
  SELECT count(*) INTO v_total FROM supabase_migrations.schema_migrations;

  UPDATE supabase_migrations.schema_migrations
  SET content_checksum = md5(coalesce(statements::text, ''))
  WHERE content_checksum IS NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;

  SELECT count(*) INTO v_remain
  FROM supabase_migrations.schema_migrations
  WHERE content_checksum IS NULL;

  -- record-step 후 잔여 NULL 은 0 이어야 함(모든 행이 산식 적용 대상).
  IF v_remain <> 0 THEN
    RAISE EXCEPTION 'ABORT: content_checksum record-step 후 NULL 잔여 % 행 — 예상 0(전 row 산식 적용). 롤백.', v_remain;
  END IF;

  RAISE NOTICE 'OK: schema_migrations content_checksum record-step — 총 % 행 중 % 행 채움(잔여 NULL=0). ADDITIVE·비파괴.', v_total, v_filled;
END $$;

-- ── (C) 원장 self-record (created_by 명시 stamp — V2 벡터 준수: actor-less INSERT 금지) ──
--     본 마이그가 스스로 원장에 남을 때 created_by 를 명시 → 새로운 phantom 이 되지 않도록.
--     ★ ON CONFLICT DO UPDATE(created_by NULL 일 때만): supabase CLI 가 이 행을 먼저 created_by NULL 로
--       INSERT 했더라도 stamp 로 승격(DO NOTHING 이면 NULL 잔존 = 새 phantom 화 → 방지). content_checksum 도 동기.
INSERT INTO supabase_migrations.schema_migrations (version, name, created_by, content_checksum)
VALUES (
  '20260802170000',
  'foot_schema_migrations_discriminator_additive',
  'dev-foot:T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT',
  md5('')   -- statements 미기록(수동 SQL apply) → md5('') 정합
)
ON CONFLICT (version) DO UPDATE
  SET created_by      = EXCLUDED.created_by,
      content_checksum = coalesce(supabase_migrations.schema_migrations.content_checksum, EXCLUDED.content_checksum)
  WHERE supabase_migrations.schema_migrations.created_by IS NULL;

COMMIT;

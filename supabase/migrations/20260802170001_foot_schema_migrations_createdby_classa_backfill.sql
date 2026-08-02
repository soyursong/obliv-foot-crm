-- T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT  ── STEP 2(freeze) + STEP 4(class-a backfill)
--   풋CRM 원장(supabase_migrations.schema_migrations)의 created_by NULL 중 class-a(legacy-unattributed,
--   커밋대조 성공 178행)에 센티넬 `legacy-unattributed` 를 backfill. phantom 20260724200000(class-b)은 제외.
--   author: dev-foot / 2026-08-02
--   parent: T-20260802-meta-APPLYPATH-OOB-GUARD-HARDEN (umbrella B1 ↔ 재발벡터 V2 actor-less INSERT)
--   게이트: DA nxyx(B1=GO/DESTRUCTIVE는 NOT NULL제약; 본 backfill 자체는 값 채움=비파괴 선행) + supervisor DB-gate.
--   표준: Cross-CRM Data-Correction Backfill SOP(freeze·지문교집합·rows-affected·순소실0·폴백).
--   ⚠ supervisor DB-gate 하에서만 prod apply. 자작 러너 raw-exec 금지.
--
-- ── 센서스 STEP1 근거(planner ACCEPTED 12:42) ────────────────────────────────
--   총 243행 / created_by NULL 179 · NON-NULL 64.
--   class(a) legacy-unattributed = 커밋대조 성공 = 178행  → 본 backfill 대상(freeze).
--   class(b) OOB-stomp phantom     = 커밋 미대조 = 1행 '20260724200000' → ★제외(§5.5 별도 reconcile, STEP5 前).
--   ∴ freeze셋 = 179(NULL) − 1(phantom) = 178.
--
-- ── ★ 왜 phantom 을 legacy-unattributed 로 안 찍나 ────────────────────────────
--   phantom 은 자작러너 raw-exec stomp 시그니처(전 git history 대응파일 無)의 현물.
--   여기에 legacy-unattributed(정상 legacy 마이그 센티넬)를 찍으면 provenance 위조 = OOB-stomp 를
--   정상행으로 세탁. ∴ blanket 금지. phantom 은 별도 정직 마커(oob-unreconciled 등)로 STEP5 前 개별 처리.
--
-- ── freeze 술어(지문 교집합, 단일 count blanket UPDATE 금지) ──────────────────
--   created_by IS NULL                       ← 미귀속 행만
--   AND version <> '20260724200000'          ← phantom 제외(class-b)
--   AND version < '20260802170000'           ← 센서스(12:39) 이후 신규 마이그(본 pilot STEP3/4 및 이후) 배제
--                                              (STEP3 170000·본 STEP4 170001 은 created_by 명시 stamp → 애초 대상 아님,
--                                               belt-and-suspenders 로 version 상한도 건다)
--   기대 freeze = 178. 불일치 시 target-set drift → 전체 abort(재-센서스 필요).
-- =========================================================================

BEGIN;

-- 판정근거/롤백원천 스냅샷 (_backup, idempotent) — SOP §4: tracked CREATE 금지 → _backup 허용.
CREATE SCHEMA IF NOT EXISTS _backup;

CREATE TABLE IF NOT EXISTS _backup.foot_schema_mig_createdby_classa_backfill_20260802 (
  version           text        NOT NULL,
  name              text,
  prior_created_by  text,        -- 사전 상태(= NULL)
  new_created_by    text        NOT NULL,   -- 센티넬(= legacy-unattributed)
  snapshotted_at    timestamptz  NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_freeze_cnt   int;
  v_updated      int;
  v_phantom_null int;
  c_expected     constant int := 178;   -- 센서스 STEP1 확정 class-a 카운트
BEGIN
  -- ── STEP2: 대상셋(class-a) freeze — 판정시점 스냅샷 고정 ──
  CREATE TEMP TABLE _classa_target ON COMMIT DROP AS
  SELECT version, name, created_by
  FROM supabase_migrations.schema_migrations
  WHERE created_by IS NULL
    AND version <> '20260724200000'          -- phantom 제외
    AND version <  '20260802170000';         -- 센서스 이후 신규 마이그 배제

  SELECT count(*) INTO v_freeze_cnt FROM _classa_target;

  -- freeze셋 재검증(SOP): 178 불일치 = target drift → 전체 abort.
  --   · dev DB(원장 상이) 에서는 178 과 불일치 정상 → 본 마이그는 prod(supervisor DB-gate)에서만 유의미.
  --   · prod 에서 불일치 시 = 센서스 이후 NULL 행 유입/변동 → 재-센서스 후 재판정 필요.
  IF v_freeze_cnt <> c_expected THEN
    RAISE EXCEPTION 'ABORT: freeze-set class-a = % ≠ 기대 % — target-set drift(센서스 이후 원장 변동 or dev DB). 재-센서스 후 재판정 필요. 전체 롤백.', v_freeze_cnt, c_expected;
  END IF;
  RAISE NOTICE 'STEP2 freeze OK: class-a = % 행(= 기대 %). phantom 20260724200000 제외 확인.', v_freeze_cnt, c_expected;

  -- ── 판정근거 스냅샷 적재(롤백원천) ──
  INSERT INTO _backup.foot_schema_mig_createdby_classa_backfill_20260802
    (version, name, prior_created_by, new_created_by)
  SELECT version, name, created_by, 'legacy-unattributed' FROM _classa_target;

  -- ── STEP4: 센티넬 backfill(freeze셋 한정, created_by NULL 인 행만 = 멱등/사후정당보호) ──
  UPDATE supabase_migrations.schema_migrations m
  SET created_by = 'legacy-unattributed'
  FROM _classa_target t
  WHERE m.version = t.version
    AND m.created_by IS NULL;   -- 사이에 귀속된 행은 건드리지 않음(사후 정당 입력 보호)
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- ── rows-affected 검증(silent write-failure 금지, cross_crm_write_rowcheck_standard) ──
  IF v_updated <> v_freeze_cnt THEN
    RAISE EXCEPTION 'ABORT: UPDATE % ≠ freeze % — target-set drift/사후 귀속 혼입(전체 롤백)', v_updated, v_freeze_cnt;
  END IF;

  -- ── phantom 무접촉 사후 검증: 20260724200000 은 여전히 created_by NULL 이어야 함(§5.5 대상 보존) ──
  SELECT count(*) INTO v_phantom_null
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260724200000' AND created_by IS NULL;
  IF v_phantom_null <> 1 THEN
    RAISE EXCEPTION 'ABORT: phantom 20260724200000 상태 이상 — created_by NULL 기대 1행, 실제 % (backfill 이 phantom 을 오염시켰거나 phantom 부재). 전체 롤백.', v_phantom_null;
  END IF;

  RAISE NOTICE 'STEP4 backfill OK: class-a % 행 created_by=legacy-unattributed. phantom 20260724200000 NULL 보존(§5.5 STEP5前 개별 reconcile 대상). 순소실 0.', v_updated;
END $$;

-- ── 원장 self-record (created_by 명시 stamp — V2 준수). STEP3 이후 실행이므로 content_checksum 컬럼 존재. ──
INSERT INTO supabase_migrations.schema_migrations (version, name, created_by, content_checksum)
VALUES (
  '20260802170001',
  'foot_schema_migrations_createdby_classa_backfill',
  'dev-foot:T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT',
  md5('')
)
ON CONFLICT (version) DO UPDATE
  SET created_by      = EXCLUDED.created_by,
      content_checksum = coalesce(supabase_migrations.schema_migrations.content_checksum, EXCLUDED.content_checksum)
  WHERE supabase_migrations.schema_migrations.created_by IS NULL;

COMMIT;

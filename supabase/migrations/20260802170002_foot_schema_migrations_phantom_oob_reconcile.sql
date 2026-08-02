-- T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT  ── STEP 5.5 (Option A: 정직마커 reconcile)
--   풋CRM 원장(supabase_migrations.schema_migrations)의 class-b OOB-stomp phantom 1행
--   `20260724200000` 의 created_by NULL → 정직 마커 `oob-unreconciled` 로 ADDITIVE 채움.
--   author: dev-foot / 2026-08-02
--   parent: T-20260802-meta-APPLYPATH-OOB-GUARD-HARDEN (umbrella B1 ↔ 재발벡터 V2 actor-less INSERT)
--   confirm: planner CONFIRM 2026-08-02 12:58(MSG-125645-e2xb) + supervisor CONCUR(§5.5 병행) = Option A+B GO / Option C(DELETE) REJECT.
--   표준: Migration Ledger Reconciliation — "정직마커" 분기(종이선언·위조 금지, 정본=prod 실재 기준 정직 수렴).
--   ⚠ supervisor DB-gate 하에서만 prod apply. 자작 러너 raw-exec 금지(본 pilot 이 차단하려는 바로 그 벡터).
--
-- ── 왜 legacy-unattributed 가 아니라 oob-unreconciled 인가 (§5.5-RB (a)) ─────────────
--   phantom `20260724200000` = naked phantom: 워킹트리·전 git 브랜치 history 어디에도 대응 up.sql 無.
--   정상 named 07-24 마이그 사이에 낀 자작러너 raw-exec stomp 시그니처 = V2 벡터(actor-less)의 현물.
--   · `legacy-unattributed`(정상 legacy 센티넬) 재사용 = OOB-stomp 를 정상행으로 세탁 = provenance 위조 → ❌금지.
--   · `oob-unreconciled` = 별도 정직 마커: NOT NULL 을 만족시키되 "이 행 = OOB phantom, provenance 규명 불가"
--     진실을 원장에 보존. ADDITIVE·non-destructive(원장행 삭제·statements 변조 없음).
--
-- ── ADDITIVE·멱등·비파괴 ─────────────────────────────────────────────────────
--   created_by 를 NULL→'oob-unreconciled' 로만 채움. 재실행 시(이미 마킹) = no-op(멱등).
--   version/name/statements 무접촉. blanket 치환 없음(정확히 phantom 1행만).
--   phantom 은 freeze셋(178, class-a backfill)에서 제외 유지 → class-a 와 무접점(§5.5-RB-DECISION 경계).
-- =========================================================================

BEGIN;

-- 판정근거/롤백원천 스냅샷 (_backup, idempotent) — SOP §4: tracked CREATE 금지 → _backup 허용.
CREATE SCHEMA IF NOT EXISTS _backup;

CREATE TABLE IF NOT EXISTS _backup.foot_schema_mig_phantom_oob_reconcile_20260802 (
  version           text        NOT NULL,
  name              text,
  prior_created_by  text,        -- 사전 상태(= NULL)
  new_created_by    text        NOT NULL,   -- 정직마커(= oob-unreconciled)
  snapshotted_at    timestamptz  NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_null_phantom int;
  v_marked       int;
  v_updated      int;
  c_phantom      constant text := '20260724200000';
BEGIN
  SELECT count(*) INTO v_null_phantom
  FROM supabase_migrations.schema_migrations
  WHERE version = c_phantom AND created_by IS NULL;

  SELECT count(*) INTO v_marked
  FROM supabase_migrations.schema_migrations
  WHERE version = c_phantom AND created_by = 'oob-unreconciled';

  -- ── 멱등 분기: 이미 reconcile 됐으면 no-op ──
  IF v_marked = 1 AND v_null_phantom = 0 THEN
    RAISE NOTICE 'no-op(멱등): phantom % 이미 oob-unreconciled 마킹됨. 재실행 무영향.', c_phantom;

  -- ── happy path: NULL phantom 1행 → 정직마커 ──
  ELSIF v_null_phantom = 1 THEN
    INSERT INTO _backup.foot_schema_mig_phantom_oob_reconcile_20260802
      (version, name, prior_created_by, new_created_by)
    SELECT version, name, created_by, 'oob-unreconciled'
    FROM supabase_migrations.schema_migrations
    WHERE version = c_phantom AND created_by IS NULL;

    UPDATE supabase_migrations.schema_migrations
    SET created_by = 'oob-unreconciled'
    WHERE version = c_phantom AND created_by IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    -- rows-affected 검증(silent write-failure 금지, cross_crm_write_rowcheck_standard) — 정확히 1행.
    IF v_updated <> 1 THEN
      RAISE EXCEPTION 'ABORT: phantom marker UPDATE % ≠ 1 — target drift(phantom 상태 변동). 전체 롤백.', v_updated;
    END IF;

    RAISE NOTICE 'OK: phantom % created_by=oob-unreconciled(정직마커, ADDITIVE·non-destructive). NOT NULL(STEP5) 만족 준비. provenance 진실 보존.', c_phantom;

  -- ── 이상 상태: phantom 부재 or 예상외 값 → abort(위조 방지) ──
  ELSE
    RAISE EXCEPTION 'ABORT: phantom % 상태 이상 — created_by NULL=% / oob-unreconciled=% (기대: NULL 1행 or 이미마킹 1행). 재-센서스 필요. 전체 롤백.',
      c_phantom, v_null_phantom, v_marked;
  END IF;
END $$;

-- ── 원장 self-record (created_by 명시 stamp — V2 준수: actor-less INSERT 금지). STEP3 이후 실행이므로 content_checksum 존재. ──
INSERT INTO supabase_migrations.schema_migrations (version, name, created_by, content_checksum)
VALUES (
  '20260802170002',
  'foot_schema_migrations_phantom_oob_reconcile',
  'dev-foot:T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT',
  md5('')
)
ON CONFLICT (version) DO UPDATE
  SET created_by      = EXCLUDED.created_by,
      content_checksum = coalesce(supabase_migrations.schema_migrations.content_checksum, EXCLUDED.content_checksum)
  WHERE supabase_migrations.schema_migrations.created_by IS NULL;

COMMIT;

-- T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT  ── STEP 7 (class-a 재backfill, ADDITIVE)
--   풋CRM 원장(supabase_migrations.schema_migrations)의 created_by NULL 잔여 18행(STEP6 재센서스 전량 class-a)에
--   센티넬 `legacy-unattributed` 를 재-backfill. STEP2~4(20260802170001) 봉투 재사용 = 신규 CONSULT/CEO 게이트 불요.
--   author: dev-foot / 2026-08-10
--   parent: T-20260802-meta-APPLYPATH-OOB-GUARD-HARDEN (umbrella B1 ↔ 재발벡터 V2 actor-less INSERT / belt 미착지)
--   게이트: planner INFO MSG-20260810-105458-r7ti(STEP6 재센서스 ACCEPTED → STEP7 authoring GO) +
--           DA CONSULT-REPLY 92d3(재-scoped 시퀀스) 봉투(=STEP2~4 재사용, ADDITIVE) + supervisor DB-GATE.
--   표준: Cross-CRM Data-Correction Backfill SOP(freeze·지문교집합·rows-affected·순소실0·판정근거 스냅샷·폴백).
--   ⚠ supervisor DB-GATE GO-token 발행 후에만 prod apply. 자작 러너 raw-exec 금지(본 pilot 이 차단하려는 벡터).
--     census 우회·강제 apply 금지(apply_before_go 클래스).
--
-- ── 왜 재backfill 인가 (STEP6 재센서스 근거 · out.txt) ────────────────────────
--   08-02 STEP4(170001)가 class-a 178행을 legacy-unattributed 로 채웠으나, 이후 정상 apply 재-record 로
--   6월행 20260606160000(정상 커밋 마이그·파일 대응 存)이 재-NULL 화(회귀). + STEP5.5 이후(version>170003)
--   belt 미착지로 신규 41행 中 17행이 created_by NULL 로 착지 → 도합 18행 NULL 잔존.
--   STEP6(08-10 fresh prod, READ-ONLY) 재센서스: 총 388행 / NULL 18 / 전량 class-a(named·14자리·파일 or CLI-미기록
--   legacy 대응 存) · class-b(naked phantom) = 0건 → 개별 reconcile 필요행 0 → 전 18행 = class-a 재backfill 대상.
--
-- ── 왜 STEP4 와 달리 version 상한을 안 거나 ──────────────────────────────────
--   STEP4 는 "센서스(12:39) 이후 신규 마이그" 를 배제하려 version < 20260802170000 상한을 걸었다.
--   STEP7 은 정반대: belt 미착지로 version>170003 에 착지한 17행이 바로 재backfill 의 표적이다.
--   ∴ 상한 없음. 단 (a)phantom 20260724200000 은 명시 제외(이미 STEP5.5 에서 oob-unreconciled 로 reconcile 됨 →
--   NULL 아님이라 predicate 로도 자동 제외되나 belt-and-suspenders), (b)STEP7 자기행(20260810120000)은
--   created_by 명시 stamp 로 self-record → 애초 NULL 대상 아님.
--
-- ── freeze 술어(지문 교집합, 단일 count blanket UPDATE 금지) ──────────────────
--   created_by IS NULL                       ← 미귀속 행만
--   AND version <> '20260724200000'          ← class-b phantom 명시 제외(provenance 위조 방지·belt)
--   기대 freeze = 18(STEP6 재센서스 확정 class-a). 불일치 시 target-set drift(센서스 이후 신규 NULL 유입 or
--   신규 naked phantom 출현 or dev DB) → 전체 abort(재-센서스 필요). blanket 세탁 금지.
--
-- ── STEP6 census 확정 18행 표적(판정시점 명세, out.txt) ────────────────────────
--   20260606160000(6월 회귀), 20260803090000, 20260803160000, 20260803230000, 20260803230500,
--   20260803234500, 20260804020000, 20260804100000, 20260805110000, 20260805190000, 20260806090000,
--   20260807100000, 20260807150000, 20260807180000, 20260808090000, 20260809080000, 20260809100000,
--   20260809150000
--
-- ── ADDITIVE·멱등·비파괴 ─────────────────────────────────────────────────────
--   created_by NULL→legacy-unattributed 로만 채움(값 채움=비파괴 선행). 재실행 시(이미 마킹) no-op(멱등).
--   version/name/statements/content_checksum 무접촉. phantom(oob-unreconciled) 무접촉. 순소실 0.
-- =========================================================================

BEGIN;

-- 판정근거/롤백원천 스냅샷 (_backup, idempotent) — SOP §4: tracked CREATE 금지 → _backup 허용.
CREATE SCHEMA IF NOT EXISTS _backup;

CREATE TABLE IF NOT EXISTS _backup.foot_schema_mig_createdby_classa_rebackfill_step7_20260810 (
  version           text        NOT NULL,
  name              text,
  prior_created_by  text,        -- 사전 상태(= NULL)
  new_created_by    text        NOT NULL,   -- 센티넬(= legacy-unattributed)
  snapshotted_at    timestamptz  NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_freeze_cnt    int;
  v_updated       int;
  v_phantom_null  int;
  v_phantom_mark  int;
  c_expected      constant int  := 18;                 -- STEP6 재센서스 확정 class-a 카운트
  c_phantom       constant text := '20260724200000';   -- class-b OOB phantom(STEP5.5 reconcile 완료)
BEGIN
  -- ── STEP7-freeze: 대상셋(class-a) freeze — 판정시점 스냅샷 고정 ──
  CREATE TEMP TABLE _classa_target_step7 ON COMMIT DROP AS
  SELECT version, name, created_by
  FROM supabase_migrations.schema_migrations
  WHERE created_by IS NULL
    AND version <> c_phantom;                 -- class-b phantom 명시 제외

  SELECT count(*) INTO v_freeze_cnt FROM _classa_target_step7;

  -- freeze셋 재검증(SOP): 18 불일치 = target drift → 전체 abort.
  --   · dev DB(원장 상이)에서는 18 과 불일치 정상 → 본 마이그는 prod(supervisor DB-GATE)에서만 유의미.
  --   · prod 에서 불일치 시 = 센서스 이후 NULL 행 유입/변동(신규 마이그 착지) or 신규 naked phantom 출현
  --     → 재-센서스 후 재판정 필요(강제 진행 금지).
  IF v_freeze_cnt <> c_expected THEN
    RAISE EXCEPTION 'ABORT: freeze-set class-a = % ≠ 기대 % — target-set drift(STEP6 재센서스 08-10 이후 원장 변동/신규 NULL 유입/신규 phantom, or dev DB). 재-센서스 후 재판정 필요. 전체 롤백.', v_freeze_cnt, c_expected;
  END IF;
  RAISE NOTICE 'STEP7 freeze OK: class-a = % 행(= 기대 %). phantom % 제외 확인.', v_freeze_cnt, c_expected, c_phantom;

  -- ── 판정근거 스냅샷 적재(롤백원천) ──
  INSERT INTO _backup.foot_schema_mig_createdby_classa_rebackfill_step7_20260810
    (version, name, prior_created_by, new_created_by)
  SELECT version, name, created_by, 'legacy-unattributed' FROM _classa_target_step7;

  -- ── STEP7-backfill: 센티넬 재backfill(freeze셋 한정, created_by NULL 인 행만 = 멱등/사후정당보호) ──
  UPDATE supabase_migrations.schema_migrations m
  SET created_by = 'legacy-unattributed'
  FROM _classa_target_step7 t
  WHERE m.version = t.version
    AND m.created_by IS NULL;   -- 사이에 귀속된 행은 건드리지 않음(사후 정당 입력 보호)
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- ── rows-affected 검증(silent write-failure 금지, cross_crm_write_rowcheck_standard) ──
  IF v_updated <> v_freeze_cnt THEN
    RAISE EXCEPTION 'ABORT: UPDATE % ≠ freeze % — target-set drift/사후 귀속 혼입(전체 롤백)', v_updated, v_freeze_cnt;
  END IF;

  -- ── phantom 무접촉 사후 검증: 20260724200000 은 STEP5.5 reconcile 상태(oob-unreconciled, NOT NULL) 보존 ──
  --   (STEP4 는 phantom=NULL 기대였으나 STEP5.5 apply 이후이므로 STEP7 은 non-NULL·마킹 보존을 기대한다)
  SELECT count(*) INTO v_phantom_null
  FROM supabase_migrations.schema_migrations
  WHERE version = c_phantom AND created_by IS NULL;
  IF v_phantom_null <> 0 THEN
    RAISE EXCEPTION 'ABORT: phantom % 상태 이상 — created_by NULL 기대 0행(STEP5.5 reconcile 완료), 실제 % (phantom 재-NULL 화 회귀 or 미reconcile). 재-센서스 필요. 전체 롤백.', c_phantom, v_phantom_null;
  END IF;

  SELECT count(*) INTO v_phantom_mark
  FROM supabase_migrations.schema_migrations
  WHERE version = c_phantom AND created_by = 'oob-unreconciled';
  IF v_phantom_mark <> 1 THEN
    RAISE EXCEPTION 'ABORT: phantom % oob-unreconciled 마킹 기대 1행, 실제 % (STEP5.5 미적용 or 마커 변조). 재-센서스 필요. 전체 롤백.', c_phantom, v_phantom_mark;
  END IF;

  RAISE NOTICE 'STEP7 re-backfill OK: class-a % 행 created_by=legacy-unattributed. phantom % oob-unreconciled 보존(무접촉). 순소실 0. ADDITIVE·비파괴.', v_updated, c_phantom;
END $$;

-- ── 원장 self-record (created_by 명시 stamp — V2 준수: actor-less INSERT 금지). content_checksum 컬럼 존재(STEP3). ──
INSERT INTO supabase_migrations.schema_migrations (version, name, created_by, content_checksum)
VALUES (
  '20260810120000',
  'foot_schema_migrations_createdby_classa_rebackfill_step7',
  'dev-foot:T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT',
  md5('')   -- statements 미기록(수동 SQL apply) → md5('') 정합
)
ON CONFLICT (version) DO UPDATE
  SET created_by      = EXCLUDED.created_by,
      content_checksum = coalesce(supabase_migrations.schema_migrations.content_checksum, EXCLUDED.content_checksum)
  WHERE supabase_migrations.schema_migrations.created_by IS NULL;

COMMIT;

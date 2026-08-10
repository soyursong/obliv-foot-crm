-- T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT  ── STEP 8 (apply-path belt, umbrella B1)
--   풋CRM 원장(supabase_migrations.schema_migrations)의 "정상 apply 경로가 created_by 를 stamp 하지 않는"
--   회귀 원천을 차단하는 apply-path belt. 정상 CLI/raw apply 로 원장에 착지하는 신규 행의 created_by 가
--   NULL 이면 BEFORE INSERT 트리거가 stamp 한다(→ NULL 재생성 자체를 원천 봉쇄).
--   author: dev-foot / 2026-08-10
--   parent: T-20260802-meta-APPLYPATH-OOB-GUARD-HARDEN (umbrella B1 ↔ 재발벡터 V2 actor-less INSERT / belt 미착지)
--   게이트: planner INFO MSG-20260810-111157-4wjh(STEP7 ACCEPTED → STEP8 착수 GO, supervisor CODE-GATE) +
--           DA CONSULT-REPLY 92d3(재-scoped 시퀀스 STEP6→7→8→5, belt=회귀 근본fix·supervisor code-gate).
--   ⚠ 이 belt 는 dev work → supervisor CODE-GATE(DB-gate 아님). 단 물리 prod apply 는
--     물리 apply 배치[STEP7 backfill → STEP8 belt → STEP5 NOT NULL] 전량 supervisor DB-GATE GO-token 후에만.
--     자작 러너 raw-exec 금지(본 pilot 이 차단하려는 벡터). census 우회·강제 apply 금지(apply_before_go 클래스).
--
-- ── 왜 belt 인가 (근본원인, DA 92d3) ─────────────────────────────────────────────
--   STEP4/STEP7 backfill 은 "역사행" 만 정정한다(1회성). foot 정상 apply 경로(Supabase CLI, mgmtapi 러너)는
--   schema_migrations 에 (version,name,statements) 만 INSERT 하고 created_by 를 채우지 않는다 →
--   신규 마이그마다 created_by NULL 재생성. ★belt 부재 = 회귀 상시 재발(STEP6 실측: version>170003 신규
--   41행 中 17행 NULL). belt 가 apply 경로 자체에서 stamp 를 강제해야 회귀 원천이 닫힌다.
--
-- ── 왜 STEP5(NOT NULL)의 필수 선행인가 ────────────────────────────────────────────
--   belt 없이 STEP5 SET NOT NULL 을 강제하면, 이후 정상 CLI 마이그(created_by 미지정 INSERT)가 전량
--   not_null_violation 으로 거부 = self-inflicted apply outage(금지). belt 가 먼저 착지해 "미지정→stamp"
--   를 보장해야, NOT NULL 이 정상 apply 를 깨지 않고 actor-less 우회만 물리 차단한다.
--   물리 apply 순서 = STEP7 backfill → STEP8 belt → STEP5 NOT NULL (순서 엄수·supervisor DB-GATE GO-token).
--
-- ── 설계 경계 (★ NOT NULL·belt ≠ authenticity) ─────────────────────────────────────
--   belt 는 "미지정을 non-NULL 로 만드는 안전망" 이지 provenance 진위 보증이 아니다.
--   진위 stamp 는 apply 경로(하드닝 러너)의 책임. belt 는 그 러너가 진위를 주입할 통로(GUC app.apply_actor)를
--   제공하고, 미주입 시엔 "정상 apply 경로·미귀속" 을 정직하게 드러내는 센티넬(cli-apply:<db_user>)로 채운다.
--   stamp 우선순위: (1) INSERT 가 명시한 created_by(존치·최우선) > (2) GUC app.apply_actor(러너 진위 주입) >
--                   (3) 센티넬 cli-apply:<current_user>(정상 apply 경로·미귀속 정직마커).
--
-- ── 센티넬 어휘 경계(위조 금지) ────────────────────────────────────────────────────
--   cli-apply:<user> ≠ legacy-unattributed(역사행 backfill) ≠ oob-unreconciled(OOB phantom) ≠
--   dev-foot:T-...(명시 self-record). belt 가 채우는 신규 정상-apply 행은 cli-apply:* 로만 표기 →
--   "정상 apply 경로로 착지했으나 명시 actor 미주입" 이라는 진실 보존(역사행/ OOB 로 세탁 금지).
--
-- ── B5(collision guard)와의 공존 ──────────────────────────────────────────────────
--   둘 다 BEFORE INSERT FOR EACH ROW 이나 상호 독립(belt=created_by stamp / collision=version·identity 대조).
--   본 belt(STEP8)는 물리 순서상 STEP5(collision guard) 前 착지하나, 두 트리거가 함께 활성인 상태에서도
--   무충돌(negtest AC8-5). 트리거명 알파벳순(belt < collision) → belt 가 먼저 stamp 후 collision 대조.
--
-- ── ADDITIVE·멱등·비파괴 ─────────────────────────────────────────────────────────
--   CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER = 재실행 no-op(멱등).
--   기존 원장 행 무접촉(BEFORE INSERT 만 → 기존 행 재기록 없음). 신규 apply 행의 created_by 만 채움.
--   ADDITIVE guard(autonomy §3.1: 비-PHI·비-보안·governance 강화) — supervisor code-gate.
-- =========================================================================

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- belt) created_by apply-path stamp (BEFORE INSERT) — 미지정 시 stamp, 명시값 존치
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.foot_schema_migrations_createdby_belt()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_actor text;
BEGIN
  -- (1) INSERT 가 명시한 created_by 존치(최우선) — 명시 self-record/하드닝 러너 stamp 는 belt 가 덮어쓰지 않음.
  IF NEW.created_by IS NOT NULL AND btrim(NEW.created_by) <> '' THEN
    RETURN NEW;
  END IF;

  -- (2) 러너가 GUC(app.apply_actor)로 진위 주입했으면 그 값 = provenance stamp.
  v_actor := nullif(btrim(current_setting('app.apply_actor', true)), '');

  -- (3) 미주입(정상 CLI/raw apply 경로) → 정직 센티넬(정상 apply 경로·미귀속). NOT NULL 만족 + 회귀 봉쇄.
  IF v_actor IS NULL THEN
    v_actor := 'cli-apply:' || current_user;
  END IF;

  NEW.created_by := v_actor;
  RETURN NEW;
END $fn$;

COMMENT ON FUNCTION public.foot_schema_migrations_createdby_belt() IS
  'T-20260802 STEP8 belt(umbrella APPLYPATH-OOB-GUARD-HARDEN, 재발벡터 V2): schema_migrations BEFORE INSERT — created_by 미지정 시 apply-path 에서 stamp(회귀 원천 차단). 우선순위 명시값>GUC app.apply_actor>cli-apply:<user> 센티넬. NOT NULL(STEP5)의 필수 선행(belt 부재 시 정상 CLI apply = not_null outage). belt ≠ authenticity(진위 stamp 는 러너 책임).';

DROP TRIGGER IF EXISTS trg_foot_schema_migrations_createdby_belt
  ON supabase_migrations.schema_migrations;

CREATE TRIGGER trg_foot_schema_migrations_createdby_belt
  BEFORE INSERT ON supabase_migrations.schema_migrations
  FOR EACH ROW
  EXECUTE FUNCTION public.foot_schema_migrations_createdby_belt();

-- ── belt 착지 사후 자기검증(fail-closed) ──
DO $$
DECLARE
  v_trg int;
BEGIN
  SELECT count(*) INTO v_trg
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'supabase_migrations'
    AND c.relname = 'schema_migrations'
    AND t.tgname  = 'trg_foot_schema_migrations_createdby_belt'
    AND NOT t.tgisinternal;
  IF v_trg <> 1 THEN
    RAISE EXCEPTION 'ABORT(STEP8): belt 트리거 착지 실패(count=%). 전체 롤백.', v_trg;
  END IF;
  RAISE NOTICE 'STEP8 belt OK: trg_foot_schema_migrations_createdby_belt 활성. 정상 apply 경로 created_by stamp 강제(회귀 원천 차단). NOT NULL(STEP5) 선행 belt 착지 완료.';
END $$;

-- ── 원장 self-record (created_by 명시 stamp — V2 준수). belt 는 명시값 존치(무접촉). content_checksum 컬럼 존재(STEP3). ──
INSERT INTO supabase_migrations.schema_migrations (version, name, created_by, content_checksum)
VALUES (
  '20260810130000',
  'foot_schema_migrations_createdby_applypath_belt_step8',
  'dev-foot:T-20260802-foot-CREATEDBY-NOTNULL-DISCRIMINATOR-PILOT',
  md5('')   -- statements 미기록(수동 SQL apply) → md5('') 정합
)
ON CONFLICT (version) DO UPDATE
  SET created_by      = EXCLUDED.created_by,
      content_checksum = coalesce(supabase_migrations.schema_migrations.content_checksum, EXCLUDED.content_checksum)
  WHERE supabase_migrations.schema_migrations.created_by IS NULL;

COMMIT;

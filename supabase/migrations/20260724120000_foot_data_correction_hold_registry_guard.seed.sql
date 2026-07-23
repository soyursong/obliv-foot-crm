-- SEED (ROW1-CONCRETE, gated): T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY
--   freeze-window ROW1 등록 — 부모 T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION 파괴 apply 선행의존 해소.
--   planner NEW-TASK MSG-20260724-073838-7z2g: "ROW1(0356b229) active-hold seed row 확정 —
--     customer_id·clinic·hold 사유=ROW1 DUP-CLEANUP freeze, keep=RAW 맥락. PK/식별 앵커는
--     재baseline freeze 상수(PK-VALUES 고정)와 정합."
--
-- ⚠ 본 파일은 여전히 **주입식 템플릿**이다(포렌식 PHI 위생). 커밋된 마이그(20260724120000_..._guard.sql)는
--   순수 ADDITIVE(테이블+트리거)이며, 특정 PHI 행(ROW1)의 실 UUID **전문**을 git 에 하드코딩하지 않는다.
--   git-safe 한 것은 PK8 prefix 뿐 — 아래 FREEZE 상수(0356b229·74967aea·c51dd5e0)는 이미 git 에 공개된
--   freeze_evidence.md/forensics 러너와 동일 SSOT 이므로 **식별 앵커 assertion 용 상수**로만 박는다.
--   ROW1 의 실 UUID 전문은 apply 시점에 supervisor/GUC 하에서 :row1_id 로 주입되고, 아래 §A 가
--   그 주입값이 FREEZE 상수(PK8=0356b229·clinic PK8=74967aea)와 정합하는지 fail-closed 로 검증한다.
--
-- ── ROW1 재baseline FREEZE 상수 (PK-VALUES 고정 · git-safe PK8) ─────────────────
--   SSOT: db-gate/T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL_freeze_evidence.md
--         + scripts/T-20260715-foot-ROW1-DUP-CLEANUP_recharacterize_forensics6_ver1recovery.mjs
--   · ROW1 (hold 대상 = freeze target)      : id PK8 = 0356b229 , clinic PK8 = 74967aea , ver=1 tail = 9089
--   · RAW  (keep = 정정 후 존치 정본)         : id PK8 = c51dd5e0 , clinic PK8 = 74967aea , live tail = 9089
--   · keep=RAW 맥락: DUP-CLEANUP 결착에서 정본으로 **존치(keep)** 되는 행은 RAW(c51dd5e0, live 9089 보유).
--     ROW1(0356b229)은 07-18 OOB dummy-normalize 로 drift(현재 phone=DUMMY-…) → DUP-CLEANUP 이 ver=1(9089)
--     복구 후 freeze. 본 hold 는 그 복구·결착 창(window) 동안 ROW1 이 재차 phone→DUMMY 로 정규화되는 것을
--     fail-closed 차단한다. (트리거는 OLD.phone NOT LIKE 'DUMMY-%' ∩ NEW LIKE 'DUMMY-%' 전이에만 발화하므로,
--      복구로 ROW1 이 실번호를 얻은 뒤부터 실효 보호가 걸린다.)
--
-- ── 실행(예시) ────────────────────────────────────────────────────────────────
--   psql "$PROD" -v row1_id='<ROW1 UUID 전문>' -v clinic_id='<clinic UUID 전문(74967aea…)>' \
--        -f 20260724120000_foot_data_correction_hold_registry_guard.seed.sql
--   또는 Management API 로 :row1_id/:clinic_id 치환 후 실행(supervisor DB-GATE 창).
--
-- ── 안전 (ADDITIVE) ──
--   · partial-unique(uq_hold_active) 로 동일 target 중복 active hold 차단 → 재실행 멱등(ON CONFLICT DO NOTHING).
--   · 값 mutation 아님(신규 거버넌스 테이블에 hold row 1개 INSERT, ROW1 실데이터 unmutated) = ADDITIVE.
--   · 등록 즉시 트리거가 해당 행의 phone→DUMMY normalize 를 fail-closed 차단 → freeze-window 무결.
--   · placeholder 미치환 / FREEZE 상수 불일치 시 실패(§A 가드) — false-freeze·오대상 등록 방지.
BEGIN;

DO $seed$
DECLARE
  v_row1        text := :'row1_id';
  v_clinic      uuid := :'clinic_id';
  -- FREEZE 상수(PK8, git-safe): 주입값 정합 앵커
  c_row1_pk8    constant text := '0356b229';
  c_clinic_pk8  constant text := '74967aea';
  v_exists      boolean;
  v_raw_sibling int;
BEGIN
  -- ── §A 식별 앵커 정합 (재baseline freeze 상수 PK-VALUES 고정) ──────────────────
  -- A0. 주입 placeholder 미치환 방어(false-freeze 금지)
  IF v_row1 IS NULL OR v_row1 = '' OR v_row1 LIKE '%<%>%' OR v_row1 = 'PLACEHOLDER' THEN
    RAISE EXCEPTION 'SEED 실패: :row1_id 미주입/placeholder. ROW1 실 UUID 를 supervisor/GUC 하에 주입할 것.';
  END IF;
  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'SEED 실패: :clinic_id 미주입.';
  END IF;

  -- A1. 주입된 ROW1 UUID 가 FREEZE 상수 PK8(0356b229)과 정합? (오대상 등록 차단)
  IF left(v_row1, 8) <> c_row1_pk8 THEN
    RAISE EXCEPTION 'SEED 실패: 주입 :row1_id PK8=% 가 ROW1 FREEZE 상수 PK8=% 와 불일치. 오대상 등록 차단(PK-VALUES 정합 위반).',
      left(v_row1, 8), c_row1_pk8;
  END IF;

  -- A2. 주입된 clinic 이 FREEZE 상수 clinic PK8(74967aea)과 정합?
  IF left(v_clinic::text, 8) <> c_clinic_pk8 THEN
    RAISE EXCEPTION 'SEED 실패: 주입 :clinic_id PK8=% 가 ROW1 clinic FREEZE 상수 PK8=% 와 불일치.',
      left(v_clinic::text, 8), c_clinic_pk8;
  END IF;

  -- A3. 주입 row 가 prod 에 실재 + 해당 clinic 소속? (dangling target 등록 차단)
  SELECT EXISTS (
    SELECT 1 FROM public.customers c
     WHERE c.id = v_row1::uuid AND c.clinic_id = v_clinic
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'SEED 실패: ROW1(%) 이 clinic(%) 에 실재하지 않음 — dangling target hold 차단.', v_row1, v_clinic;
  END IF;

  -- A4. keep=RAW 앵커 정합: 동일 clinic 에 tail 9089 정본 sibling(RAW) 실재 재확인(DUP 쌍 앵커).
  --     (soft — 부재면 경고만. RAW 존치 전제가 흔들리면 supervisor 재판정 신호.)
  SELECT count(*) INTO v_raw_sibling
    FROM public.customers c
   WHERE c.clinic_id = v_clinic
     AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'), 4) = '9089'
     AND (c.phone NOT LIKE 'DUMMY-%');
  IF v_raw_sibling = 0 THEN
    RAISE WARNING 'SEED 주의: clinic(%) 에 tail 9089 정본(keep=RAW) sibling 0건 — DUP 쌍 앵커 재확인 요망(등록은 계속).', v_clinic;
  END IF;

  -- ── §B ROW1 active-hold 등록 (ADDITIVE, 멱등) ─────────────────────────────────
  INSERT INTO public.data_correction_hold_registry
    (clinic_id, target_table, target_pk, guard_scope, hold_ticket, reason, created_by)
  VALUES
    (v_clinic, 'customers', v_row1, 'phone_dummy_normalize',
     'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION',
     'cleanup',                    -- DUP-CLEANUP freeze (vocabulary: cleanup|forensics|legal-hold)
     current_user)
  ON CONFLICT (clinic_id, target_table, target_pk, guard_scope) WHERE released_at IS NULL
  DO NOTHING;

  RAISE NOTICE 'SEED: ROW1(PK8=%) active hold 등록(guard_scope=phone_dummy_normalize, reason=cleanup, hold_ticket=T-20260715-…, keep=RAW sibling %건). freeze-window 보호 활성.',
    left(v_row1, 8), v_raw_sibling;
END $seed$;

COMMIT;

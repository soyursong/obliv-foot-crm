-- SEED (TEMPLATE, gated): T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY
--   freeze-window ROW1 등록 — 부모 T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION 파괴 apply 선행의존 해소.
--
-- ⚠ 본 파일은 **템플릿**이다. 커밋된 마이그(20260724120000_..._guard.sql)는 순수 ADDITIVE(테이블+트리거)이며,
--   특정 PHI 행(ROW1)의 실 id 를 git 에 하드코딩하지 않는다(포렌식 PHI 위생 = PK8 prefix 만 git-safe).
--   ROW1 의 실 id 는 apply 시점에 supervisor/GUC 하에서 :row1_id 로 주입한다.
--
-- ── 실행(예시) ────────────────────────────────────────────────────────────────
--   psql "$PROD" -v row1_id='<UUID>' -v clinic_id='<UUID>' \
--        -f 20260724120000_foot_data_correction_hold_registry_guard.seed.sql
--   또는 Management API 로 :row1_id 치환 후 실행(supervisor DB-GATE 창).
--
-- ── 안전 ──
--   · partial-unique(uq_hold_active) 로 동일 target 중복 active hold 차단 → 재실행 멱등(ON CONFLICT DO NOTHING).
--   · 값 mutation 아님(신규 거버넌스 테이블에 hold row 1개 INSERT) = ADDITIVE.
--   · 등록 즉시 트리거가 해당 행의 phone→DUMMY normalize 를 fail-closed 차단 → freeze-window 무결.
--   · placeholder 미치환 시 실패(가드 DO 블록) — false-freeze 방지.
BEGIN;

DO $seed$
DECLARE
  v_row1   text := :'row1_id';
  v_clinic uuid := :'clinic_id';
BEGIN
  IF v_row1 IS NULL OR v_row1 = '' OR v_row1 LIKE '%<UUID>%' OR v_row1 = 'PLACEHOLDER' THEN
    RAISE EXCEPTION 'SEED 실패: :row1_id 미주입/placeholder. ROW1 실 id 를 supervisor/GUC 하에 주입할 것.';
  END IF;
  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'SEED 실패: :clinic_id 미주입.';
  END IF;

  INSERT INTO public.data_correction_hold_registry
    (clinic_id, target_table, target_pk, guard_scope, hold_ticket, reason, created_by)
  VALUES
    (v_clinic, 'customers', v_row1, 'phone_dummy_normalize',
     'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION',
     'forensics', current_user)
  ON CONFLICT (clinic_id, target_table, target_pk, guard_scope) WHERE released_at IS NULL
  DO NOTHING;

  RAISE NOTICE 'SEED: ROW1(%%) active hold 등록(guard_scope=phone_dummy_normalize, hold_ticket=T-20260715-...). freeze-window 보호 활성.', v_row1;
END $seed$;

COMMIT;

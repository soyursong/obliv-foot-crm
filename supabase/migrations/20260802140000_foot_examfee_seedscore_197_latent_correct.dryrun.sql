-- DRY-RUN (No-Persistence) — T-20260725-foot-EXAMFEE-SEEDSCORE-197-LATENT-CONTAM-CORRECT
--   20260802140000_foot_examfee_seedscore_197_latent_correct.sql 의 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   freeze count·would-UPDATE ROW_COUNT·rows-affected assert 를 실제로 통과시키되 영속시키지 않는다.
--   migration_dryrun_no_persistence 준수(TEMP·_backup 적재·UPDATE 전부 ROLLBACK 으로 무영속, 데이터 무변).
--
--   ⚠ dev DB 에는 prod LIVE 197.07 행이 없으므로 freeze=0(→ 설계된 abort) 가 정상 —
--     본 dry-run 은 prod(supervisor DB-gate)에서 실행해야 유의미. dev 실행 시 'freeze 0건 abort' = 대상 부재 확인.
--   ⚠ 본 dry-run 은 abort 경로를 exception-handler 로 흡수해 무영속 introspection 까지 통과시킨다.
-- =========================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS _backup;

DO $$
DECLARE
  v_freeze_cnt int;
  v_updated    int;
BEGIN
  CREATE TEMP TABLE _seedscore_target_dry ON COMMIT DROP AS
  SELECT s.id, s.clinic_id, s.name, s.hira_code, s.hira_score
  FROM public.services s
  WHERE s.hira_code IS NULL
    AND s.hira_score = 197.07
    AND s.active = true
    AND s.hira_category = 'consultation'
    AND s.name LIKE '%초진진찰료%';

  SELECT count(*) INTO v_freeze_cnt FROM _seedscore_target_dry;
  RAISE NOTICE '[DRY-RUN] freeze-set(AA154 초진 정식명 행) 카운트=% (prod 기대≈1; dev=0 정상=대상 부재)', v_freeze_cnt;

  IF v_freeze_cnt = 0 THEN
    RAISE NOTICE '[DRY-RUN] freeze 0건 → 실행 마이그에서 ABORT 경로(대상 부재/이미 정정). dev DB=benign.';
  ELSE
    -- 실제 UPDATE 를 실행해 ROW_COUNT 계측(트랜잭션은 최종 ROLLBACK 으로 무영속).
    UPDATE public.services s
    SET hira_score = 197.12
    FROM _seedscore_target_dry t
    WHERE s.id = t.id
      AND s.hira_score = 197.07;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated <> v_freeze_cnt THEN
      RAISE EXCEPTION '[DRY-RUN] ABORT: would-UPDATE % ≠ freeze % — target-set drift', v_updated, v_freeze_cnt;
    END IF;
    RAISE NOTICE '[DRY-RUN] would-UPDATE=% (=freeze). rows-affected assert PASS. ROLLBACK 으로 무영속.', v_updated;
  END IF;
END $$;

ROLLBACK;

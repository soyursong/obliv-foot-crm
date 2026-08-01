-- ROLLBACK — T-20260725-foot-EXAMFEE-SEEDSCORE-197-LATENT-CONTAM-CORRECT (되돌림)
--   20260802140000_foot_examfee_seedscore_197_latent_correct.sql 원복.
--   author: dev-foot / 2026-08-02
--
-- ⚠ forward-only 원칙상 통상 롤백 불필요(값 정정, 금액영향 0, 하류 무영향). 긴급 원복 시에만 사용.
--   원복 = 정정이 바꾼 정확한 집합(_backup 스냅샷)에 대해서만 hira_score 를 사전 상태(197.07)로 재설정.
--   ★_backup.new_hira_score(197.12)와 현재 값이 일치하는 행만 재-197.07(그 사이 스태프가 다른 값을
--     넣었으면 건드리지 않음 — 사후 정당 입력 보호).
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_reverted int;
  v_snap_cnt int;
BEGIN
  IF to_regclass('_backup.foot_examfee_seedscore_197_correct_20260802') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK ABORT: _backup 스냅샷 테이블 부재 — 원복 원천 없음(정정 미실행 or 스냅샷 유실)';
  END IF;

  SELECT count(*) INTO v_snap_cnt FROM _backup.foot_examfee_seedscore_197_correct_20260802;

  -- 정정이 넣은 값(197.12)과 현재 값이 동일한 행만 사전 상태(197.07)로 재설정.
  UPDATE public.services s
  SET hira_score = b.prior_hira_score           -- = 197.07
  FROM _backup.foot_examfee_seedscore_197_correct_20260802 b
  WHERE s.id = b.service_id
    AND s.hira_score IS NOT DISTINCT FROM b.new_hira_score;   -- = 197.12
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  RAISE NOTICE 'ROLLBACK OK: % / % 행 재-197.07(스냅샷 대비). 차이=사후 수기입력 값(보호, 미변경).',
    v_reverted, v_snap_cnt;
END $$;

COMMIT;

-- (선택) 스냅샷 정리 — 원복 검증 후 수동:
--   DROP TABLE IF EXISTS _backup.foot_examfee_seedscore_197_correct_20260802;

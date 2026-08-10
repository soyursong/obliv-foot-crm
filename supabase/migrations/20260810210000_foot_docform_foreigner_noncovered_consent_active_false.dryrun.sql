-- DRY-RUN (No-Persistence) — T-20260810-foot-FOREIGNER-NONCOVERED-CONSENT-PENCHART-REPLACE
--   20260810210000_..._active_false.sql 의 UPDATE 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   would-UPDATE ROW_COUNT 를 실제로 계측·검증하되 영속시키지 않는다(migration_dryrun_no_persistence 준수).
--   본 마이그는 up.sql 내부에 txn 제어문(COMMIT 등)이 없음 → sentinel bypass hazard 무해(strip 불요).
--
--   비파괴 UPDATE(active 플래그). DDL/DELETE 없음. 멱등(WHERE active=true) 검증만 수행.
--   기대: 서류발행 배치가 살아있던 환경(active=true) 최초 실행 시 would-UPDATE=1,
--         이미 비활성/미seed 환경에서는 would-UPDATE=0(멱등 no-op).
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_updated int;
  v_before  boolean;
BEGIN
  SELECT active FROM form_templates
    WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
      AND form_key = 'foreigner_noncovered_consent'
    INTO v_before;

  RAISE NOTICE '[DRY-RUN] pre-existing foreigner_noncovered_consent active=% (NULL=row 미존재)', v_before;

  UPDATE form_templates
  SET active = false
  WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
    AND form_key = 'foreigner_noncovered_consent'
    AND active = true;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '[DRY-RUN] would-UPDATE ROW_COUNT=% (active=true→최초=1, 멱등/미존재 no-op=0)', v_updated;

  IF v_updated > 1 THEN
    RAISE EXCEPTION '[DRY-RUN] 예상외 다중 UPDATE(%). 단일행 위반 — abort.', v_updated;
  END IF;
END $$;

-- 무영속: 실제 배포는 .sql 이 담당. dry-run 은 검증만.
ROLLBACK;

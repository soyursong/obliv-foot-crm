-- DRY-RUN (No-Persistence) — T-20260808-foot-FOREIGNER-NONCOVERED-CONSENT-FORM
--   20260809090000_..._seed.sql 의 INSERT 로직을 그대로 실행하되 COMMIT 대신 ROLLBACK.
--   would-INSERT ROW_COUNT 를 실제로 계측·검증하되 영속시키지 않는다(migration_dryrun_no_persistence 준수).
--
--   ADDITIVE seed 이므로 파괴/UPDATE/DELETE 없음. 멱등(WHERE NOT EXISTS) 검증만 수행.
--   기대: dev/prod 최초 실행 시 would-INSERT=1, 이미 seed 된 환경에서는 would-INSERT=0(멱등 no-op).
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_inserted int;
  v_exists   boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM form_templates
    WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
      AND form_key = 'foreigner_noncovered_consent'
  ) INTO v_exists;

  RAISE NOTICE '[DRY-RUN] pre-existing foreigner_noncovered_consent row: %', v_exists;

  INSERT INTO form_templates
    (clinic_id, category, form_key, name_ko, template_path, template_format,
     field_map, requires_signature, required_role, active, sort_order)
  SELECT
    '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid,
    'foot-service',
    'foreigner_noncovered_consent',
    '외국인 비급여 진료 동의서',
    '',
    'html',
    '[
      {"key":"patient_name","label":"성명","type":"text","x":0,"y":0},
      {"key":"issue_date","label":"발행일","type":"date","x":0,"y":0}
    ]'::jsonb,
    false,
    'admin|manager|coordinator|therapist',
    true,
    120
  WHERE NOT EXISTS (
    SELECT 1 FROM form_templates
    WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'::uuid
      AND form_key = 'foreigner_noncovered_consent'
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '[DRY-RUN] would-INSERT ROW_COUNT=% (최초=1, 멱등 no-op=0)', v_inserted;

  IF v_inserted > 1 THEN
    RAISE EXCEPTION '[DRY-RUN] 예상외 다중 INSERT(%). ADDITIVE 단일행 위반 — abort.', v_inserted;
  END IF;
END $$;

-- 무영속: 실제 배포는 .sql 이 담당. dry-run 은 검증만.
ROLLBACK;

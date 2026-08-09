-- ROLLBACK: T-20260809-foot-CONSENT-SELFCHECKIN-CONTENT-ADD-LAYOUT
-- consent_forms.form_type CHECK 를 확장 이전(4값)으로 되돌림.
-- 주의(forward-only): 이미 form_type='unique_id' 행이 존재하면 4값 CHECK ADD 가 실패함(정상).
--   그 경우 롤백 전 해당 행 정리/보존 판단 선행 필요(파괴 금지).
-- 2026-08-09 dev-foot

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT con.conname INTO v_conname
    FROM pg_constraint con
    JOIN pg_class rel      ON rel.oid = con.conrelid
    JOIN pg_namespace nsp  ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'public'
     AND rel.relname = 'consent_forms'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%form_type%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.consent_forms DROP CONSTRAINT %I', v_conname);
  END IF;

  ALTER TABLE public.consent_forms
    ADD CONSTRAINT consent_forms_form_type_check
    CHECK (form_type IN ('refund','non_covered','treatment','privacy'));
END $$;

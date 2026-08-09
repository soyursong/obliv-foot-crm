-- T-20260809-foot-CONSENT-SELFCHECKIN-CONTENT-ADD-LAYOUT
-- consent_forms.form_type CHECK IN-list 확장: 'unique_id' 추가 (개보법 §24 고유식별정보 수집·이용 동의서)
-- da_consult_ref: DA-20260809-foot-CONSENT-UNIQUEID-FORMTYPE (Option A / ADDITIVE / forward-only)
--   Q3 준수: prod 실제 제약명 재확인(auto-name drift 방지) → 단일 txn DROP+ADD.
--   dormant 'hira_consent' 는 이번 확장에 끼워넣지 않음(활성 수요·문안 부재, DA 지시 = 별건 carry).
-- change-class: ADDITIVE (prod 실재 5값 무변경, 신규 1값만 추가) — 기존 행 위반 0.
-- prod introspection 실측(rxlomoozakkjesdqjtvd, FIX-REQUEST T-...CONTENT-ADD-LAYOUT):
--   consent_forms_form_type_check = CHECK (form_type IN
--     ('refund','non_covered','treatment','privacy','nhis_lookup'))  -- prod 실재 5값
--   ※ nhis_lookup 은 repo migration/src 참조 0건(OOB drift) 이나 prod 에 실재 → 보존(파괴 금지).
--     retire 는 별건(파괴적 도메인 축소 = 별도 DA CONSULT + Ledger Reconciliation) — 이번 범위 보존.
-- 2026-08-09 dev-foot (FIX: repo-lineage base(4값) → prod-real base(5값) 보존, nhis_lookup DROP 회귀 제거)

DO $$
DECLARE
  v_conname text;
BEGIN
  -- prod 실제 form_type CHECK 제약명 탐색 (inline CHECK auto-name = consent_forms_form_type_check 이나
  --   드리프트 대비 정의(pg_get_constraintdef) 기준으로 동적 확인 → 잘못된 이름 no-op 새는 것 방지)
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
    CHECK (form_type IN ('refund','non_covered','treatment','privacy','nhis_lookup','unique_id'));
END $$;

-- DRY-RUN (무영속): T-20260809-foot-CONSENT-SELFCHECKIN-CONTENT-ADD-LAYOUT
--   Migration Dry-Run No-Persistence Protocol 준수.
--   foot = Management API PAT 보유 → 무영속 검증 = plpgsql DO 블록 안에서 forward(DROP+ADD CONSTRAINT)
--     실행 후 RAISE EXCEPTION 으로 전체 롤백(DO 블록 트랜잭션 abort) → 영속 0.
--     in-txn 관측값(신규 제약 정의·기존행 위반수)은 예외 메시지로 회수.
--   (INV-1 txn-control strip: top-level BEGIN;/COMMIT; 미사용, DO 블록 단일-statement → 조기 COMMIT sentinel-bypass 부재.)
--   그 후 post-probe 로 prod 제약이 여전히 prod-real 5값(nhis_lookup 포함, 비영속)임을 fresh 쿼리로 실측(INV-3).
--   (FIX: repo-lineage 4값 base → prod introspection 실측 5값 base(nhis_lookup 보존), 신규 target = 6값)
--   실 러너: db-gate/T-20260809-foot-CONSENT-UNIQUE-ID-FORMTYPE_dryrun.mjs (supervisor DB-GATE 실행)
--
-- 검증 시나리오:
--   A. 적용 중(in-txn): consent_forms form_type CHECK 정의에 'unique_id' 포함(true).
--   B. RAISE EXCEPTION 롤백 후(post-probe): 제약 정의에 'unique_id' 부재 = 4값 유지(비영속 실증).
--   C. 기존 행 중 신규 6값 CHECK 위반 0 (ADDITIVE 무회귀 — prod-real 5값은 모두 부분집합).
--   D. schema_migrations 원장에 20260809150000 부재(미적용 상태 유지).
--
-- ▼ 무영속 재현 SQL(단일 DO statement, RAISE EXCEPTION 자동 롤백). 실 PASS 판정은 러너가 수행.

DO $$
DECLARE
  v_conname   text;
  v_has_uid   boolean;
  v_violators int;
BEGIN
  -- prod 실제 제약명 탐색
  SELECT con.conname INTO v_conname
    FROM pg_constraint con
    JOIN pg_class rel      ON rel.oid = con.conrelid
    JOIN pg_namespace nsp  ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'public'
     AND rel.relname = 'consent_forms'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%form_type%';

  -- (TEST C) 기존 행 중 신규 6값 CHECK 위반 확인(ADDITIVE 이므로 0 이어야 함)
  --   prod-real 5값(nhis_lookup 포함) + unique_id = 6값 target set
  SELECT count(*) INTO v_violators
    FROM public.consent_forms
   WHERE form_type NOT IN ('refund','non_covered','treatment','privacy','nhis_lookup','unique_id');

  -- forward 적용(in-txn)
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.consent_forms DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE public.consent_forms
    ADD CONSTRAINT consent_forms_form_type_check
    CHECK (form_type IN ('refund','non_covered','treatment','privacy','nhis_lookup','unique_id'));

  -- (TEST A) in-txn 신규 제약 정의에 'unique_id' 포함 확인
  SELECT pg_get_constraintdef(con.oid) ILIKE '%unique_id%' INTO v_has_uid
    FROM pg_constraint con
    JOIN pg_class rel      ON rel.oid = con.conrelid
    JOIN pg_namespace nsp  ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'public'
     AND rel.relname = 'consent_forms'
     AND con.conname = 'consent_forms_form_type_check';

  -- 강제 롤백 → 무영속 보장. in-txn 관측값 예외 메시지로 회수.
  RAISE EXCEPTION 'DRYRUN_NOPERSIST orig_conname=% has_unique_id=% (expect t) violators=% (expect 0)',
    v_conname, v_has_uid, v_violators;
END $$;

-- (TEST B) 위 예외로 DROP+ADD 롤백됨. 아래 fresh 쿼리로 제약 정의에 'unique_id' 부재
--          + prod-real 5값(nhis_lookup 포함) 유지 실측(러너 post-probe).
-- SELECT pg_get_constraintdef(con.oid)
--   FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
--   JOIN pg_namespace nsp ON nsp.oid=rel.relnamespace
--   WHERE nsp.nspname='public' AND rel.relname='consent_forms' AND con.contype='c'
--     AND pg_get_constraintdef(con.oid) ILIKE '%form_type%';   -- expect: prod-real 5값(nhis_lookup 포함, unique_id 부재)
--
-- (TEST D) SELECT ... FROM supabase_migrations.schema_migrations WHERE version='20260809150000' → 0행(미적용).

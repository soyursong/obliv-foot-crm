-- ============================================================================
-- FORWARD-DOC MIGRATION (file-set parity 재현 / NOT for re-execution)
-- version : 20260717120000
-- ledger  : foot_selfcheckin_upsert_created_by_canon
-- ticket  : T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP (Case C3-a, F-track)
-- 근거    : da_decision_foot_visitroute_gonghom_silver_ledger_reconcile_20260718.md §Item2
--           migration_ledger_reconciliation.md §Case C3-a
--
-- ▸ 본 마이그레이션은 foot 비표준 direct-query runner(Case L-3/C3)로 prod 에 이미 실적용(라이브)
--   되었으나 마이그 파일만 유실되었다(genuine file-less OOB). 본 파일은 repo↔remote 파일셋 정합
--   (db push unblock) 목적의 forward-doc 이며, prod 실재 정의와 content-parity 재현이다.
-- ▸ 수기 재실행 금지. DDL 은 CREATE OR REPLACE(멱등)로 prod 실재 def 와 byte/정의-일치 재현하되,
--   prod 원장(schema_migrations)에 이미 applied 이므로 db push 대상 아님(재실행 없음).
-- ▸ 원장(schema_migrations) 단일행 write 는 supervisor exec lane 전속(§1.5/L-2). dev=repo 파일만.
-- ▸ 이 파일이 selfcheckin upsert 함수군(base/v2/v3)의 현행 prod 실재 정의를 보유한다.
--   created_by='self_checkin' origin provenance stamp(신규 write only) + UPDATE 시 created_by 미덮어쓰기
--   보존이 본 버전의 기여. phone-normalize(20260716230000, provenance marker)·mask-reject guard
--   (20260714120000, repo)·resolve_v3 consent(20260629160000, repo) 를 누적 포함한 현행 def 이다.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer(p_clinic_id uuid, p_name text, p_phone text, p_visit_type text, p_sms_opt_in boolean DEFAULT NULL::boolean, p_birth_date text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_address_detail text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id UUID;
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
  -- canonical national digits (phoneCanonDigits 미러, v2/v3 와 동일 규칙). dedup 비교키 전용.
  v_canon  TEXT := CASE
    WHEN length(regexp_replace(COALESCE(p_phone,''),'\D','','g')) < 8 THEN NULL
    WHEN regexp_replace(COALESCE(p_phone,''),'\D','','g') LIKE '0%'
      THEN '82' || substring(regexp_replace(COALESCE(p_phone,''),'\D','','g') FROM 2)
    WHEN regexp_replace(COALESCE(p_phone,''),'\D','','g') LIKE '82%'
      THEN regexp_replace(COALESCE(p_phone,''),'\D','','g')
    ELSE regexp_replace(COALESCE(p_phone,''),'\D','','g')
  END;
BEGIN
  -- ── 마스킹-reject 가드 (DA-20260714, fail-closed) — 탐지=helper / raise=여기 ──
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  IF p_clinic_id IS NULL OR length(v_digits) < 9 THEN
    RAISE EXCEPTION 'invalid input';
  END IF;
  -- dedup: canonical(82…) 양측 비교 — raw 저장행/정규화 저장행 모두 매칭(정규화 write 회귀 방지).
  SELECT c.id INTO v_id FROM customers c
   WHERE c.clinic_id=p_clinic_id
     AND ( CASE
             WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
               THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
             ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
           END ) = v_canon
   ORDER BY c.created_at DESC NULLS LAST LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- ⚠ UPDATE(linked): created_by 덮어쓰기 안 함(new-write-only, 부모 Q4). 기존 귀속 보존.
    UPDATE customers SET
      sms_opt_in    = COALESCE(p_sms_opt_in, sms_opt_in),
      sms_opt_in_at = CASE WHEN p_sms_opt_in IS TRUE THEN now()
                           WHEN p_sms_opt_in IS FALSE THEN NULL ELSE sms_opt_in_at END,
      address        = COALESCE(NULLIF(btrim(p_address),''), address),
      postal_code    = COALESCE(NULLIF(btrim(p_postal_code),''), postal_code),
      address_detail = COALESCE(NULLIF(btrim(p_address_detail),''), address_detail)
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- INSERT: phone 을 write 前 E.164 정규화(SSOT normalize_phone). NULLIF 로 현행 NULL 동치 보존.
  --   created_by='self_checkin' — self-checkin origin provenance stamp(self_checkin_create 미러, 신규 write only).
  INSERT INTO customers(clinic_id, name, phone, visit_type, sms_opt_in, sms_opt_in_at,
                        birth_date, address, postal_code, address_detail, created_by)
  VALUES (p_clinic_id, btrim(p_name), public.normalize_phone(NULLIF(p_phone,'')),
          CASE WHEN p_visit_type='new' THEN 'new' ELSE 'returning' END,
          p_sms_opt_in, CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
          NULLIF(btrim(p_birth_date),''), NULLIF(btrim(p_address),''),
          NULLIF(btrim(p_postal_code),''), NULLIF(btrim(p_address_detail),''),
          'self_checkin')
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  SELECT c.id INTO v_id FROM customers c
   WHERE c.clinic_id=p_clinic_id
     AND ( CASE
             WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
               THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
             ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
           END ) = v_canon
   ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v2(p_clinic_id uuid, p_name text, p_phone text, p_visit_type text, p_sms_opt_in boolean DEFAULT NULL::boolean, p_birth_date text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_address_detail text DEFAULT NULL::text, p_customer_email text DEFAULT NULL::text, p_privacy_consent boolean DEFAULT NULL::boolean, p_hira_consent boolean DEFAULT NULL::boolean)
 RETURNS TABLE(customer_id uuid, link_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name   TEXT := NULLIF(btrim(p_name), '');
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
  v_canon  TEXT;
  v_count  INT;
  v_id     UUID;
BEGIN
  -- ── 마스킹-reject 가드 (DA-20260714, fail-closed) — 탐지=helper / raise=여기 ──
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  IF p_clinic_id IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'invalid input';
  END IF;

  -- canonical national digits (phoneCanonDigits 미러): 0…→82…, 82… 유지. 8자리 미만은 비교근거 제외(NULL).
  v_canon := CASE
    WHEN length(v_digits) < 8 THEN NULL
    WHEN v_digits LIKE '0%'  THEN '82' || substring(v_digits FROM 2)
    WHEN v_digits LIKE '82%' THEN v_digits
    ELSE v_digits
  END;

  -- ── 복합키 [성함 AND 연락처 canonical] 매칭 (연락처 가용 시에만; 외국인 email-only 는 매칭 skip) ──
  IF v_canon IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon;

    IF v_count >= 2 THEN
      -- 2건+ = 성함+연락처 동시중복 → 어느 차트가 본인인지 단정 불가. 자동연결·신규생성 모두 보류.
      RETURN QUERY SELECT NULL::uuid, 'ambiguous'::text;
      RETURN;

    ELSIF v_count = 1 THEN
      SELECT c.id INTO v_id
        FROM customers c
       WHERE c.clinic_id = p_clinic_id
         AND c.name = v_name
         AND ( CASE
                 WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                   THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
                 ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
               END ) = v_canon
       LIMIT 1;

      -- 전달된 값만 멱등 persist(COALESCE 보존). NULL=미변경 / true→값+_at=now() / false→값+_at=NULL.
      -- ⚠ Q4(DA-20260716): phone 재저장 추가 안 함 — 본 픽스=new-write-only. UPDATE SET phone 부재 유지.
      -- ⚠ created_by 덮어쓰기 안 함(new-write-only) — 기존 귀속 보존.
      UPDATE customers SET
        sms_opt_in         = COALESCE(p_sms_opt_in, sms_opt_in),
        sms_opt_in_at      = CASE WHEN p_sms_opt_in IS TRUE THEN now()
                                  WHEN p_sms_opt_in IS FALSE THEN NULL ELSE sms_opt_in_at END,
        customer_email     = COALESCE(NULLIF(btrim(p_customer_email),''), customer_email),
        birth_date         = COALESCE(NULLIF(btrim(p_birth_date),''), birth_date),
        address            = COALESCE(NULLIF(btrim(p_address),''), address),
        postal_code        = COALESCE(NULLIF(btrim(p_postal_code),''), postal_code),
        address_detail     = COALESCE(NULLIF(btrim(p_address_detail),''), address_detail),
        privacy_consent    = COALESCE(p_privacy_consent, privacy_consent),
        privacy_consent_at = CASE WHEN p_privacy_consent IS TRUE THEN now()
                                  WHEN p_privacy_consent IS FALSE THEN NULL ELSE privacy_consent_at END,
        hira_consent       = COALESCE(p_hira_consent, hira_consent),
        hira_consent_at    = CASE WHEN p_hira_consent IS TRUE THEN now()
                                  WHEN p_hira_consent IS FALSE THEN NULL ELSE hira_consent_at END
       WHERE id = v_id;

      RETURN QUERY SELECT v_id, 'linked'::text;
      RETURN;
    END IF;
    -- v_count = 0 → INSERT 분기로 폴스루
  END IF;

  -- ── 0건(또는 연락처 미가용) → 신규 INSERT. NOT NULL 컬럼(privacy/hira/sms)은 COALESCE 기본값 보정. ──
  --   phone 을 write 前 E.164 정규화(SSOT normalize_phone). NULLIF 로 현행 NULL 동치 보존(빈/email-only).
  --   created_by='self_checkin' — self-checkin origin provenance stamp(신규 write only).
  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at,
    created_by
  ) VALUES (
    p_clinic_id, v_name, public.normalize_phone(NULLIF(p_phone,'')),
    CASE WHEN p_visit_type = 'new' THEN 'new' ELSE 'returning' END,
    COALESCE(p_sms_opt_in, true),
    CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
    NULLIF(btrim(p_customer_email),''),
    NULLIF(btrim(p_birth_date),''),
    NULLIF(btrim(p_address),''),
    NULLIF(btrim(p_postal_code),''),
    NULLIF(btrim(p_address_detail),''),
    COALESCE(p_privacy_consent, false),
    CASE WHEN p_privacy_consent IS TRUE THEN now() ELSE NULL END,
    COALESCE(p_hira_consent, false),
    CASE WHEN p_hira_consent IS TRUE THEN now() ELSE NULL END,
    'self_checkin'
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'created'::text;
  RETURN;

EXCEPTION WHEN unique_violation THEN
  -- 동시 INSERT 경합 → 복합키 재조회. 못 찾으면 raise(데이터 무결성 위반 표면화).
  IF v_canon IS NOT NULL THEN
    SELECT c.id INTO v_id
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RAISE; END IF;
  RETURN QUERY SELECT v_id, 'linked'::text;
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v3(p_clinic_id uuid, p_name text, p_phone text, p_visit_type text, p_sms_opt_in boolean DEFAULT NULL::boolean, p_birth_date text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_address_detail text DEFAULT NULL::text, p_customer_email text DEFAULT NULL::text, p_privacy_consent boolean DEFAULT NULL::boolean, p_hira_consent boolean DEFAULT NULL::boolean, p_consent_sensitive boolean DEFAULT NULL::boolean, p_consent_agreed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_consent_version text DEFAULT NULL::text)
 RETURNS TABLE(customer_id uuid, link_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name   TEXT := NULLIF(btrim(p_name), '');
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
  v_canon  TEXT;
  v_count  INT;
  v_id     UUID;
BEGIN
  -- ── 마스킹-reject 가드 (DA-20260714, fail-closed) — 탐지=helper / raise=여기 ──
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  IF p_clinic_id IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'invalid input';
  END IF;

  -- canonical national digits (phoneCanonDigits 미러): 0…→82…, 82… 유지. 8자리 미만은 비교근거 제외(NULL).
  v_canon := CASE
    WHEN length(v_digits) < 8 THEN NULL
    WHEN v_digits LIKE '0%'  THEN '82' || substring(v_digits FROM 2)
    WHEN v_digits LIKE '82%' THEN v_digits
    ELSE v_digits
  END;

  -- ── 복합키 [성함 AND 연락처 canonical] 매칭 (연락처 가용 시에만; 외국인 email-only 는 매칭 skip) ──
  IF v_canon IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon;

    IF v_count >= 2 THEN
      -- 2건+ = 성함+연락처 동시중복 → 어느 차트가 본인인지 단정 불가. 자동연결·신규생성 모두 보류.
      RETURN QUERY SELECT NULL::uuid, 'ambiguous'::text;
      RETURN;

    ELSIF v_count = 1 THEN
      SELECT c.id INTO v_id
        FROM customers c
       WHERE c.clinic_id = p_clinic_id
         AND c.name = v_name
         AND ( CASE
                 WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                   THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
                 ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
               END ) = v_canon
       LIMIT 1;

      -- 전달된 값만 멱등 persist(COALESCE 보존). NULL=미변경 / true→값+_at=now() / false→값+_at=NULL.
      -- ⚠ Q4(DA-20260716): phone 재저장 추가 안 함 — 본 픽스=new-write-only. UPDATE SET phone 부재 유지.
      -- ⚠ created_by 덮어쓰기 안 함(new-write-only) — 기존 귀속 보존.
      UPDATE customers SET
        sms_opt_in         = COALESCE(p_sms_opt_in, sms_opt_in),
        sms_opt_in_at      = CASE WHEN p_sms_opt_in IS TRUE THEN now()
                                  WHEN p_sms_opt_in IS FALSE THEN NULL ELSE sms_opt_in_at END,
        customer_email     = COALESCE(NULLIF(btrim(p_customer_email),''), customer_email),
        birth_date         = COALESCE(NULLIF(btrim(p_birth_date),''), birth_date),
        address            = COALESCE(NULLIF(btrim(p_address),''), address),
        postal_code        = COALESCE(NULLIF(btrim(p_postal_code),''), postal_code),
        address_detail     = COALESCE(NULLIF(btrim(p_address_detail),''), address_detail),
        privacy_consent    = COALESCE(p_privacy_consent, privacy_consent),
        privacy_consent_at = CASE WHEN p_privacy_consent IS TRUE THEN now()
                                  WHEN p_privacy_consent IS FALSE THEN NULL ELSE privacy_consent_at END,
        hira_consent       = COALESCE(p_hira_consent, hira_consent),
        hira_consent_at    = CASE WHEN p_hira_consent IS TRUE THEN now()
                                  WHEN p_hira_consent IS FALSE THEN NULL ELSE hira_consent_at END,
        -- ── resolve_v3 민감정보 동의 (개보법 §23) — no-downgrade + 최초기록 보존(main 미러) ──
        consent_sensitive  = CASE WHEN p_consent_sensitive IS TRUE THEN true
                                  ELSE consent_sensitive END,
        consent_agreed_at  = CASE WHEN p_consent_sensitive IS TRUE
                                    THEN COALESCE(consent_agreed_at, p_consent_agreed_at, now())
                                  ELSE consent_agreed_at END,
        consent_version    = CASE WHEN p_consent_sensitive IS TRUE
                                    THEN COALESCE(consent_version, p_consent_version, 'foot-2026-06')
                                  ELSE consent_version END
       WHERE id = v_id;

      RETURN QUERY SELECT v_id, 'linked'::text;
      RETURN;
    END IF;
    -- v_count = 0 → INSERT 분기로 폴스루
  END IF;

  -- ── 0건(또는 연락처 미가용) → 신규 INSERT. NOT NULL 컬럼(privacy/hira/sms)은 COALESCE 기본값 보정. ──
  --   phone 을 write 前 E.164 정규화(SSOT normalize_phone). NULLIF 로 현행 NULL 동치 보존(빈/email-only).
  --   created_by='self_checkin' — self-checkin origin provenance stamp(신규 write only).
  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at,
    consent_sensitive, consent_agreed_at, consent_version,
    created_by
  ) VALUES (
    p_clinic_id, v_name, public.normalize_phone(NULLIF(p_phone,'')),
    CASE WHEN p_visit_type = 'new' THEN 'new' ELSE 'returning' END,
    COALESCE(p_sms_opt_in, true),
    CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
    NULLIF(btrim(p_customer_email),''),
    NULLIF(btrim(p_birth_date),''),
    NULLIF(btrim(p_address),''),
    NULLIF(btrim(p_postal_code),''),
    NULLIF(btrim(p_address_detail),''),
    COALESCE(p_privacy_consent, false),
    CASE WHEN p_privacy_consent IS TRUE THEN now() ELSE NULL END,
    COALESCE(p_hira_consent, false),
    CASE WHEN p_hira_consent IS TRUE THEN now() ELSE NULL END,
    -- resolve_v3: sensitive=true 시에만 동의셋 기록(DB DEFAULT FALSE 고수 — 미동의 허위기록 방지).
    COALESCE(p_consent_sensitive, false),
    CASE WHEN p_consent_sensitive IS TRUE THEN COALESCE(p_consent_agreed_at, now()) ELSE NULL END,
    CASE WHEN p_consent_sensitive IS TRUE THEN COALESCE(p_consent_version, 'foot-2026-06') ELSE NULL END,
    'self_checkin'
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'created'::text;
  RETURN;

EXCEPTION WHEN unique_violation THEN
  -- 동시 INSERT 경합 → 복합키 재조회. 못 찾으면 raise(데이터 무결성 위반 표면화).
  IF v_canon IS NOT NULL THEN
    SELECT c.id INTO v_id
      FROM customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.name = v_name
       AND ( CASE
               WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
                 THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
               ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
             END ) = v_canon
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RAISE; END IF;
  RETURN QUERY SELECT v_id, 'linked'::text;
  RETURN;
END;
$function$;


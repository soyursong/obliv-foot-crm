-- ROLLBACK: T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON
-- ════════════════════════════════════════════════════════════════════════════
-- 본 migration(20260717120000_..._created_by_canon.sql) 직전 상태 복원 =
--   20260716230000_..._phone_normalize.sql 의 3함수 정의 verbatim(created_by INSERT 제거).
--   · base / v2 / v3 : INSERT INTO customers(...) 컬럼목록에서 created_by 제거 + VALUES 'self_checkin' 제거.
--   · normalize_phone write / dedup / 매칭 / UPDATE / consent / EXCEPTION 는 불변(phone-normalize SSOT 보존).
-- 멱등: CREATE OR REPLACE 재실행 수렴. self_checkin_create(phone-only 경로)는 본 티켓 범위 외 → 롤백 미포함.
-- 주의: created_by 는 nullable no-default TEXT → 롤백 후 신규 write 는 다시 created_by=NULL(부모 Q5 원상태).
--   이미 stamp 된 기존 행의 created_by='self_checkin' 값은 롤백으로 되돌리지 않음(파괴 없음, 데이터 무손실).
-- author: dev-foot / 2026-07-17
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) fn_selfcheckin_upsert_customer (base) — phone-normalize verbatim (created_by 제거)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer(
  p_clinic_id      UUID,
  p_name           TEXT,
  p_phone          TEXT,
  p_visit_type     TEXT,
  p_sms_opt_in     BOOLEAN DEFAULT NULL,
  p_birth_date     TEXT    DEFAULT NULL,
  p_address        TEXT    DEFAULT NULL,
  p_postal_code    TEXT    DEFAULT NULL,
  p_address_detail TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id UUID;
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
  v_canon  TEXT := CASE
    WHEN length(regexp_replace(COALESCE(p_phone,''),'\D','','g')) < 8 THEN NULL
    WHEN regexp_replace(COALESCE(p_phone,''),'\D','','g') LIKE '0%'
      THEN '82' || substring(regexp_replace(COALESCE(p_phone,''),'\D','','g') FROM 2)
    WHEN regexp_replace(COALESCE(p_phone,''),'\D','','g') LIKE '82%'
      THEN regexp_replace(COALESCE(p_phone,''),'\D','','g')
    ELSE regexp_replace(COALESCE(p_phone,''),'\D','','g')
  END;
BEGIN
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  IF p_clinic_id IS NULL OR length(v_digits) < 9 THEN
    RAISE EXCEPTION 'invalid input';
  END IF;
  SELECT c.id INTO v_id FROM customers c
   WHERE c.clinic_id=p_clinic_id
     AND ( CASE
             WHEN regexp_replace(COALESCE(c.phone,''),'\D','','g') LIKE '0%'
               THEN '82' || substring(regexp_replace(COALESCE(c.phone,''),'\D','','g') FROM 2)
             ELSE regexp_replace(COALESCE(c.phone,''),'\D','','g')
           END ) = v_canon
   ORDER BY c.created_at DESC NULLS LAST LIMIT 1;

  IF v_id IS NOT NULL THEN
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

  INSERT INTO customers(clinic_id, name, phone, visit_type, sms_opt_in, sms_opt_in_at,
                        birth_date, address, postal_code, address_detail)
  VALUES (p_clinic_id, btrim(p_name), public.normalize_phone(NULLIF(p_phone,'')),
          CASE WHEN p_visit_type='new' THEN 'new' ELSE 'returning' END,
          p_sms_opt_in, CASE WHEN p_sms_opt_in IS TRUE THEN now() ELSE NULL END,
          NULLIF(btrim(p_birth_date),''), NULLIF(btrim(p_address),''),
          NULLIF(btrim(p_postal_code),''), NULLIF(btrim(p_address_detail),''))
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
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) fn_selfcheckin_upsert_customer_resolve_v2 — phone-normalize verbatim (created_by 제거)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v2(
  p_clinic_id       UUID,
  p_name            TEXT,
  p_phone           TEXT,
  p_visit_type      TEXT,
  p_sms_opt_in      BOOLEAN DEFAULT NULL,
  p_birth_date      TEXT    DEFAULT NULL,
  p_address         TEXT    DEFAULT NULL,
  p_postal_code     TEXT    DEFAULT NULL,
  p_address_detail  TEXT    DEFAULT NULL,
  p_customer_email  TEXT    DEFAULT NULL,
  p_privacy_consent BOOLEAN DEFAULT NULL,
  p_hira_consent    BOOLEAN DEFAULT NULL
)
RETURNS TABLE(customer_id UUID, link_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name   TEXT := NULLIF(btrim(p_name), '');
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
  v_canon  TEXT;
  v_count  INT;
  v_id     UUID;
BEGIN
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  IF p_clinic_id IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'invalid input';
  END IF;

  v_canon := CASE
    WHEN length(v_digits) < 8 THEN NULL
    WHEN v_digits LIKE '0%'  THEN '82' || substring(v_digits FROM 2)
    WHEN v_digits LIKE '82%' THEN v_digits
    ELSE v_digits
  END;

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
  END IF;

  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at
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
    CASE WHEN p_hira_consent IS TRUE THEN now() ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'created'::text;
  RETURN;

EXCEPTION WHEN unique_violation THEN
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
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) fn_selfcheckin_upsert_customer_resolve_v3 — phone-normalize verbatim (created_by 제거)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_selfcheckin_upsert_customer_resolve_v3(
  p_clinic_id        UUID,
  p_name             TEXT,
  p_phone            TEXT,
  p_visit_type       TEXT,
  p_sms_opt_in       BOOLEAN     DEFAULT NULL,
  p_birth_date       TEXT        DEFAULT NULL,
  p_address          TEXT        DEFAULT NULL,
  p_postal_code      TEXT        DEFAULT NULL,
  p_address_detail   TEXT        DEFAULT NULL,
  p_customer_email   TEXT        DEFAULT NULL,
  p_privacy_consent  BOOLEAN     DEFAULT NULL,
  p_hira_consent     BOOLEAN     DEFAULT NULL,
  p_consent_sensitive BOOLEAN     DEFAULT NULL,
  p_consent_agreed_at TIMESTAMPTZ DEFAULT NULL,
  p_consent_version   TEXT        DEFAULT NULL
)
RETURNS TABLE(customer_id UUID, link_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name   TEXT := NULLIF(btrim(p_name), '');
  v_digits TEXT := regexp_replace(COALESCE(p_phone,''),'\D','','g');
  v_canon  TEXT;
  v_count  INT;
  v_id     UUID;
BEGIN
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  IF p_clinic_id IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'invalid input';
  END IF;

  v_canon := CASE
    WHEN length(v_digits) < 8 THEN NULL
    WHEN v_digits LIKE '0%'  THEN '82' || substring(v_digits FROM 2)
    WHEN v_digits LIKE '82%' THEN v_digits
    ELSE v_digits
  END;

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
  END IF;

  INSERT INTO customers(
    clinic_id, name, phone, visit_type,
    sms_opt_in, sms_opt_in_at, customer_email,
    birth_date, address, postal_code, address_detail,
    privacy_consent, privacy_consent_at, hira_consent, hira_consent_at,
    consent_sensitive, consent_agreed_at, consent_version
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
    COALESCE(p_consent_sensitive, false),
    CASE WHEN p_consent_sensitive IS TRUE THEN COALESCE(p_consent_agreed_at, now()) ELSE NULL END,
    CASE WHEN p_consent_sensitive IS TRUE THEN COALESCE(p_consent_version, 'foot-2026-06') ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'created'::text;
  RETURN;

EXCEPTION WHEN unique_violation THEN
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
$$;

COMMIT;

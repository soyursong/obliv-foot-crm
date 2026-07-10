-- ROLLBACK: T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK version-aware 복호
-- 20260620120100(rrn_decrypt A2+audit) + 20260613120000(fn_customer_birthdates) 원복.
-- ⚠️ 원복 시 v2(47명) 복호 다시 실패(발급/등록 차단 재발). 회귀 확인용.

BEGIN;

-- ① rrn_decrypt → 20260620120100 원복 (단일키: app.rrn_key→구키 fallback)
CREATE OR REPLACE FUNCTION public.rrn_decrypt(customer_uuid uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_enc          BYTEA;
  v_key          TEXT;
  v_plain        TEXT;
  v_cust_clinic  UUID;
BEGIN
  IF NOT (public.is_admin_or_manager()
          OR current_user_role() = ANY (ARRAY['consultant','coordinator','therapist'])) THEN
    RETURN NULL;
  END IF;

  SELECT clinic_id, rrn_enc INTO v_cust_clinic, v_enc
    FROM public.customers
   WHERE id = customer_uuid;

  IF v_cust_clinic IS DISTINCT FROM public.current_user_clinic_id() THEN
    RETURN NULL;
  END IF;

  IF v_enc IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'obliv_foot_rrn_key_2026';
  END IF;

  v_plain := extensions.pgp_sym_decrypt(v_enc, v_key);

  BEGIN
    INSERT INTO public.phi_access_log (access_type, accessed_role, customer_id, clinic_id)
    VALUES ('rrn_decrypt', current_user_role(), customer_uuid, v_cust_clinic);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_plain;
END;
$function$;

-- ② fn_customer_birthdates → 20260613120000 원복 (단일키)
CREATE OR REPLACE FUNCTION public.fn_customer_birthdates(
  p_clinic_id uuid,
  p_ids       uuid[]
) RETURNS TABLE (customer_id uuid, birth_date_display text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key  text;
  r      record;
  v_rrn  text;
  v_d    text;
  v_yy int; v_mm int; v_dd int; v_g int;
  v_year int;
  v_bd   text;
BEGIN
  BEGIN
    v_key := current_setting('app.rrn_key');
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := 'obliv_foot_rrn_key_2026';
  END IF;

  FOR r IN
    SELECT c.id, c.birth_date, c.rrn_enc
      FROM public.customers c
     WHERE c.clinic_id = p_clinic_id
       AND c.id = ANY(p_ids)
  LOOP
    v_year := NULL; v_mm := NULL; v_dd := NULL; v_bd := NULL;
    v_d := regexp_replace(coalesce(r.birth_date, ''), '[^0-9]', '', 'g');
    IF length(v_d) >= 6 THEN
      v_yy := substr(v_d, 1, 2)::int;
      v_mm := substr(v_d, 3, 2)::int;
      v_dd := substr(v_d, 5, 2)::int;
      IF v_yy <= (extract(year from now())::int % 100) THEN
        v_year := 2000 + v_yy;
      ELSE
        v_year := 1900 + v_yy;
      END IF;
    ELSE
      v_rrn := NULL;
      IF r.rrn_enc IS NOT NULL THEN
        BEGIN
          v_rrn := extensions.pgp_sym_decrypt(r.rrn_enc, v_key);
        EXCEPTION WHEN OTHERS THEN
          v_rrn := NULL;
        END;
      END IF;
      v_d := regexp_replace(coalesce(v_rrn, ''), '[^0-9]', '', 'g');
      IF length(v_d) = 13 THEN
        v_yy := substr(v_d, 1, 2)::int;
        v_mm := substr(v_d, 3, 2)::int;
        v_dd := substr(v_d, 5, 2)::int;
        v_g  := substr(v_d, 7, 1)::int;
        v_year := CASE
          WHEN v_g IN (1, 2, 5, 6) THEN 1900 + v_yy
          WHEN v_g IN (3, 4, 7, 8) THEN 2000 + v_yy
          WHEN v_g IN (9, 0)       THEN 1800 + v_yy
          ELSE NULL
        END;
      END IF;
    END IF;

    IF v_year IS NOT NULL AND v_mm BETWEEN 1 AND 12 AND v_dd BETWEEN 1 AND 31 THEN
      BEGIN
        v_bd := to_char(make_date(v_year, v_mm, v_dd), 'YYYY-MM-DD');
      EXCEPTION WHEN OTHERS THEN
        v_bd := NULL;
      END;
    END IF;

    customer_id := r.id;
    birth_date_display := v_bd;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) FROM public;
REVOKE ALL ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_customer_birthdates(uuid, uuid[]) TO authenticated;

COMMIT;

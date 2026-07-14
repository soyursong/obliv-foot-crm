-- ROLLBACK T-20260715-foot-MASKREJECT-WRITEPATH-RESCOPE
-- ════════════════════════════════════════════════════════════════════════════
-- 두 함수를 가드-前 prod 정의(pg_get_functiondef 2026-07-15 verbatim)로 복원.
-- helper public._fn_is_masked_pii 는 20260714120000 소관 → 여기서 DROP 하지 않음(공유 자산).
-- 스키마/GRANT 무변경(CREATE OR REPLACE ACL 보존).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) fn_dashboard_reissue_health_q_token — 가드 IF 제거(원복)
CREATE OR REPLACE FUNCTION public.fn_dashboard_reissue_health_q_token(
  p_customer_phone text,
  p_clinic_slug    text,
  p_customer_name  text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clinic_id   UUID;
  v_customer_id UUID;
  v_cust_name   TEXT;
  v_token       TEXT;
  v_tok_id      UUID;
  v_phone_alt   TEXT;
BEGIN
  SELECT id INTO v_clinic_id
  FROM   clinics
  WHERE  slug = p_clinic_slug
  LIMIT  1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'clinic_not_found');
  END IF;

  IF p_customer_phone LIKE '+82%' THEN
    v_phone_alt := '0' || substring(p_customer_phone FROM 4);
  ELSIF p_customer_phone LIKE '010%' OR p_customer_phone LIKE '011%' OR p_customer_phone LIKE '016%' THEN
    v_phone_alt := '+82' || substring(p_customer_phone FROM 2);
  ELSE
    v_phone_alt := NULL;
  END IF;

  SELECT id, name INTO v_customer_id, v_cust_name
  FROM   customers
  WHERE  clinic_id = v_clinic_id
    AND  phone IN (p_customer_phone, v_phone_alt)
  ORDER BY created_at ASC
  LIMIT  1;

  IF NOT FOUND THEN
    v_cust_name := COALESCE(NULLIF(TRIM(p_customer_name), ''), '미등록');
    INSERT INTO customers (clinic_id, name, phone)
    VALUES (v_clinic_id, v_cust_name, p_customer_phone)
    RETURNING id, name INTO v_customer_id, v_cust_name;
  ELSE
    IF p_customer_name IS NOT NULL AND TRIM(p_customer_name) <> '' AND v_cust_name = '미등록' THEN
      UPDATE customers SET name = TRIM(p_customer_name) WHERE id = v_customer_id;
      v_cust_name := TRIM(p_customer_name);
    END IF;
  END IF;

  UPDATE health_q_tokens
  SET    expires_at = now() - INTERVAL '1 second'
  WHERE  customer_id = v_customer_id
    AND  clinic_id   = v_clinic_id
    AND  form_type   = 'general'
    AND  used_at     IS NULL
    AND  expires_at  > now();

  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

  INSERT INTO health_q_tokens (token, customer_id, clinic_id, form_type, expires_at, created_by)
  VALUES (v_token, v_customer_id, v_clinic_id, 'general', now() + INTERVAL '24 hours', NULL)
  RETURNING id INTO v_tok_id;

  RETURN jsonb_build_object(
    'success',       true,
    'token',         v_token,
    'id',            v_tok_id,
    'customer_name', v_cust_name
  );
END;
$function$;

-- 2) upsert_reservation_from_source — 가드 IF 제거(원복)
CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source(
  p_source_system      text,
  p_external_id        text,
  p_clinic_slug        text,
  p_customer_phone     text,
  p_customer_name      text,
  p_reservation_date   date,
  p_reservation_time   time without time zone,
  p_memo               text    DEFAULT NULL::text,
  p_status             text    DEFAULT 'confirmed'::text,
  p_visit_type         text    DEFAULT 'new'::text,
  p_created_via        text    DEFAULT NULL::text,
  p_service_id         uuid    DEFAULT NULL::uuid,
  p_registrar_id       uuid    DEFAULT NULL::uuid,
  p_registrar_name     text    DEFAULT NULL::text,
  p_customer_real_name text    DEFAULT NULL::text,
  p_customer_real_phone text   DEFAULT NULL::text,
  p_is_companion       boolean DEFAULT false,
  p_brief_note         text    DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic_id      UUID;
  v_customer_id    UUID;
  v_reservation_id UUID;
  v_norm_phone     TEXT;
  v_real_name      TEXT;
  v_created_via    TEXT;
  v_visit_type     TEXT;
  v_cur_status     TEXT;
  v_memo_clean     TEXT;
  c_created_via_enum CONSTANT TEXT[] := ARRAY['manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin'];
  c_visit_type_enum  CONSTANT TEXT[] := ARRAY['new','returning','experience'];
  c_inflight_terminal CONSTANT TEXT[] := ARRAY['checked_in','done','no_show'];
BEGIN
  IF p_source_system IS NULL OR p_external_id IS NULL THEN
    RAISE EXCEPTION 'source_system and external_id are required' USING ERRCODE = '22023';
  END IF;

  IF lower(btrim(COALESCE(p_status, ''))) = 'cancelled' THEN
    SELECT r.id, r.status INTO v_reservation_id, v_cur_status
      FROM public.reservations r
     WHERE r.source_system IS NOT NULL
       AND r.source_system = p_source_system
       AND r.external_id   = p_external_id
     LIMIT 1;

    IF v_reservation_id IS NULL THEN
      RETURN NULL;
    END IF;

    IF v_cur_status = 'cancelled' THEN
      RETURN v_reservation_id;
    END IF;

    IF v_cur_status = ANY (c_inflight_terminal) THEN
      RAISE EXCEPTION 'lifecycle-invalid cancel: reservation % is "%" (in-flight/terminal) — TM cancel rejected (foot physical-flow owns lifecycle)',
        v_reservation_id, v_cur_status
        USING ERRCODE = 'P0001', HINT = 'LIFECYCLE_INVALID';
    END IF;

    UPDATE public.reservations r
       SET status     = 'cancelled',
           updated_at = now()
     WHERE r.id = v_reservation_id;

    RETURN v_reservation_id;
  END IF;

  SELECT r.status INTO v_cur_status
    FROM public.reservations r
   WHERE r.source_system IS NOT NULL
     AND r.source_system = p_source_system
     AND r.external_id   = p_external_id
   LIMIT 1;

  IF v_cur_status = ANY (c_inflight_terminal) OR v_cur_status = 'cancelled' THEN
    RAISE EXCEPTION 'lifecycle-invalid edit: reservation (%/%) is "%" — TM stale edit rejected (foot physical-flow owns lifecycle)',
      p_source_system, p_external_id, v_cur_status
      USING ERRCODE = 'P0001', HINT = 'LIFECYCLE_INVALID';
  END IF;

  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'clinic_slug is required' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_clinic_id FROM public.clinics WHERE slug = p_clinic_slug;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_slug USING ERRCODE = '23503';
  END IF;

  v_real_name := COALESCE(
    NULLIF(btrim(p_customer_real_name), ''),
    NULLIF(btrim(p_customer_name), '')
  );

  v_created_via := CASE WHEN p_created_via = ANY (c_created_via_enum) THEN p_created_via ELSE NULL END;
  v_visit_type  := CASE WHEN COALESCE(p_visit_type,'new') = ANY (c_visit_type_enum)
                        THEN COALESCE(p_visit_type,'new') ELSE 'new' END;

  IF p_is_companion THEN
    v_customer_id := NULL;
    v_norm_phone  := NULL;
  ELSE
    v_norm_phone := public.normalize_phone(p_customer_phone);
    INSERT INTO public.customers (clinic_id, name, phone, visit_type)
    VALUES (v_clinic_id, p_customer_name, v_norm_phone, 'new')
    ON CONFLICT (clinic_id, phone) DO UPDATE SET
      name = COALESCE(NULLIF(btrim(customers.name), ''), NULLIF(btrim(EXCLUDED.name), ''), customers.name),
      updated_at = now()
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.reservations (
    clinic_id, customer_id, customer_name, customer_phone,
    reservation_date, reservation_time,
    visit_type, status,
    source_system, external_id,
    created_via, service_id, registrar_id, registrar_name,
    customer_real_name, brief_note
  ) VALUES (
    v_clinic_id, v_customer_id, p_customer_name, v_norm_phone,
    p_reservation_date, p_reservation_time,
    v_visit_type, COALESCE(p_status,'confirmed'),
    p_source_system, p_external_id,
    v_created_via, p_service_id, p_registrar_id, NULLIF(btrim(p_registrar_name),''),
    v_real_name, NULLIF(btrim(p_brief_note),'')
  )
  ON CONFLICT (source_system, external_id)
    WHERE source_system IS NOT NULL AND external_id IS NOT NULL
  DO UPDATE SET
    customer_id        = EXCLUDED.customer_id,
    customer_name      = EXCLUDED.customer_name,
    customer_phone     = EXCLUDED.customer_phone,
    reservation_date   = EXCLUDED.reservation_date,
    reservation_time   = EXCLUDED.reservation_time,
    visit_type         = EXCLUDED.visit_type,
    status             = EXCLUDED.status,
    created_via        = COALESCE(EXCLUDED.created_via, reservations.created_via),
    service_id         = COALESCE(EXCLUDED.service_id, reservations.service_id),
    registrar_id       = COALESCE(EXCLUDED.registrar_id, reservations.registrar_id),
    registrar_name     = COALESCE(EXCLUDED.registrar_name, reservations.registrar_name),
    customer_real_name = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_name),''), reservations.customer_real_name),
    brief_note         = COALESCE(NULLIF(btrim(p_brief_note),''), reservations.brief_note),
    updated_at         = now()
  RETURNING id INTO v_reservation_id;

  v_memo_clean := NULLIF(btrim(p_memo), '');
  IF v_memo_clean IS NOT NULL THEN
    INSERT INTO public.reservation_memo_history
      (reservation_id, clinic_id, content, created_by, created_by_name, source_system)
    VALUES
      (v_reservation_id, v_clinic_id, v_memo_clean, NULL, '도파민TM', p_source_system)
    ON CONFLICT (reservation_id, source_system) WHERE source_system IS NOT NULL
    DO UPDATE SET
      content    = EXCLUDED.content,
      created_at = now();
  END IF;

  RETURN v_reservation_id;
END;
$function$;

COMMIT;

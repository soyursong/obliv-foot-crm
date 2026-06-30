-- ROLLBACK: T-20260630-dopamine-FOOTRESV-MEMO-PUSH-DROP timeline 재타겟 + provenance 되돌리기.
-- 효과:
--   1) upsert_reservation_from_source 를 20260630193000(lifecycle 가드#5, reservations.memo 매핑 보유) body 로 복원
--      → 예약메모 timeline INSERT 제거 + reservations.memo COALESCE 매핑 복귀.
--   2) uq_rmh_resv_source partial unique index DROP.
--   3) reservation_memo_history.source_system 컬럼 DROP.
-- 주의: 본 rollback 적용 시 도파민 push 메모가 다시 풋 예약상세 timeline 에 미표시(AC-1 회귀).
--   기존 도파민 sync 메모행은 source_system 컬럼 소실 → 사람 행과 구분 불가(멱등키 상실). 운영 unwind 필요시만.

BEGIN;

-- ── 3 역순: RPC body 를 193000(timeline 가드 이전) 으로 복원 ──────────────────
CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source(
  p_source_system       TEXT,
  p_external_id         TEXT,
  p_clinic_slug         TEXT,
  p_customer_phone      TEXT,
  p_customer_name       TEXT,
  p_reservation_date    DATE,
  p_reservation_time    TIME,
  p_memo                TEXT    DEFAULT NULL,
  p_status              TEXT    DEFAULT 'confirmed',
  p_visit_type          TEXT    DEFAULT 'new',
  p_created_via         TEXT    DEFAULT NULL,
  p_service_id          UUID    DEFAULT NULL,
  p_registrar_id        UUID    DEFAULT NULL,
  p_registrar_name      TEXT    DEFAULT NULL,
  p_customer_real_name  TEXT    DEFAULT NULL,
  p_customer_real_phone TEXT    DEFAULT NULL,
  p_is_companion        BOOLEAN DEFAULT false
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id      UUID;
  v_customer_id    UUID;
  v_reservation_id UUID;
  v_norm_phone     TEXT;
  v_real_name      TEXT;
  v_created_via    TEXT;
  v_visit_type     TEXT;
  v_cur_status     TEXT;
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
           memo       = COALESCE(NULLIF(btrim(p_memo), ''), r.memo),
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
      name = CASE
        WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name <> '' THEN EXCLUDED.name
        ELSE customers.name
      END,
      updated_at = now()
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.reservations (
    clinic_id, customer_id, customer_name, customer_phone,
    reservation_date, reservation_time,
    visit_type, status, memo,
    source_system, external_id,
    created_via, service_id, registrar_id, registrar_name,
    customer_real_name
  ) VALUES (
    v_clinic_id, v_customer_id, p_customer_name, v_norm_phone,
    p_reservation_date, p_reservation_time,
    v_visit_type, COALESCE(p_status,'confirmed'), p_memo,
    p_source_system, p_external_id,
    v_created_via, p_service_id, p_registrar_id, NULLIF(btrim(p_registrar_name),''),
    v_real_name
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
    memo               = COALESCE(EXCLUDED.memo, reservations.memo),
    created_via        = COALESCE(EXCLUDED.created_via, reservations.created_via),
    service_id         = COALESCE(EXCLUDED.service_id, reservations.service_id),
    registrar_id       = COALESCE(EXCLUDED.registrar_id, reservations.registrar_id),
    registrar_name     = COALESCE(EXCLUDED.registrar_name, reservations.registrar_name),
    customer_real_name = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_name),''), reservations.customer_real_name),
    updated_at         = now()
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM authenticated;

-- ── 2 역순: partial unique index DROP ───────────────────────────────────────
DROP INDEX IF EXISTS public.uq_rmh_resv_source;

-- ── 1 역순: source_system 컬럼 DROP ─────────────────────────────────────────
ALTER TABLE public.reservation_memo_history
  DROP COLUMN IF EXISTS source_system;

COMMIT;

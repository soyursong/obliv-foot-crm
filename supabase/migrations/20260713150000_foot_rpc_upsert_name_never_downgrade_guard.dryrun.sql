-- DRY-RUN (No-Persistence Protocol): T-20260713-foot-RPC-UPSERT-NAME-OVERWRITE-GUARD
-- ============================================================================
-- 목적: never-downgrade 교체본을 prod(rxlomoozakkjesdqjtvd)에 무영속으로 적용→기능 검증→롤백.
-- 프로토콜 준수(sentinel-bypass 차단):
--   ① txn-control strip: 실행 body 에 BEGIN/COMMIT 없음(up.sql 의 COMMIT 를 dry-run 에 포함하지 않음).
--   ② plpgsql exception-handler 실행: 전 작업을 단일 DO 블록 트랜잭션에서 수행, 末尾 SENTINEL RAISE 로
--      강제 abort → CREATE OR REPLACE(DDL) 포함 全 효과 롤백(무영속).
--   ③ post-probe: 아래 §POST 쿼리로 prod 함수 body 가 여전히 舊 CASE(override) 임을 재확인(비영속 실증).
-- 판정: DO 블록이 'DRYRUN_SENTINEL_OK'(P0001) 로 끝나면 = 모든 AC PASS + 무영속 롤백.
--        'AC-x FAIL ...' 로 끝나면 = 기능 회귀. 그 외 = DDL/seed 오류.
-- 실행: scripts/T-20260713-foot-RPC-UPSERT-NAME-OVERWRITE-GUARD_dryrun.mjs (Supabase Mgmt API)
-- ============================================================================

-- §DO — 무영속 적용 + 기능 AC 검증 (sentinel RAISE 로 롤백)
DO $dry$
DECLARE
  v_slug  TEXT := 'zzz-dryrun-nd-clinic-t20260713';
  v_phone TEXT := '01099990001';
  v_ph2   TEXT := '01099990002';
  v_name  TEXT;
  v_real  TEXT;
BEGIN
  -- (1) never-downgrade 교체본 무영속 적용 (txn-control 없는 순수 DDL, DO 트랜잭션 내부)
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source(
      p_source_system TEXT, p_external_id TEXT, p_clinic_slug TEXT, p_customer_phone TEXT,
      p_customer_name TEXT, p_reservation_date DATE, p_reservation_time TIME,
      p_memo TEXT DEFAULT NULL, p_status TEXT DEFAULT 'confirmed', p_visit_type TEXT DEFAULT 'new',
      p_created_via TEXT DEFAULT NULL, p_service_id UUID DEFAULT NULL, p_registrar_id UUID DEFAULT NULL,
      p_registrar_name TEXT DEFAULT NULL, p_customer_real_name TEXT DEFAULT NULL,
      p_customer_real_phone TEXT DEFAULT NULL, p_is_companion BOOLEAN DEFAULT false,
      p_brief_note TEXT DEFAULT NULL
    ) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_clinic_id UUID; v_customer_id UUID; v_reservation_id UUID; v_norm_phone TEXT;
      v_real_name TEXT; v_created_via TEXT; v_visit_type TEXT; v_cur_status TEXT; v_memo_clean TEXT;
      c_created_via_enum CONSTANT TEXT[] := ARRAY['manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin'];
      c_visit_type_enum CONSTANT TEXT[] := ARRAY['new','returning','experience'];
      c_inflight_terminal CONSTANT TEXT[] := ARRAY['checked_in','done','no_show'];
    BEGIN
      IF p_source_system IS NULL OR p_external_id IS NULL THEN
        RAISE EXCEPTION 'source_system and external_id are required' USING ERRCODE='22023'; END IF;
      IF lower(btrim(COALESCE(p_status,''))) = 'cancelled' THEN
        SELECT r.id, r.status INTO v_reservation_id, v_cur_status FROM public.reservations r
          WHERE r.source_system IS NOT NULL AND r.source_system=p_source_system AND r.external_id=p_external_id LIMIT 1;
        IF v_reservation_id IS NULL THEN RETURN NULL; END IF;
        IF v_cur_status='cancelled' THEN RETURN v_reservation_id; END IF;
        IF v_cur_status = ANY(c_inflight_terminal) THEN
          RAISE EXCEPTION 'lifecycle-invalid cancel' USING ERRCODE='P0001', HINT='LIFECYCLE_INVALID'; END IF;
        UPDATE public.reservations r SET status='cancelled', updated_at=now() WHERE r.id=v_reservation_id;
        RETURN v_reservation_id;
      END IF;
      SELECT r.status INTO v_cur_status FROM public.reservations r
        WHERE r.source_system IS NOT NULL AND r.source_system=p_source_system AND r.external_id=p_external_id LIMIT 1;
      IF v_cur_status = ANY(c_inflight_terminal) OR v_cur_status='cancelled' THEN
        RAISE EXCEPTION 'lifecycle-invalid edit' USING ERRCODE='P0001', HINT='LIFECYCLE_INVALID'; END IF;
      IF p_clinic_slug IS NULL THEN RAISE EXCEPTION 'clinic_slug is required' USING ERRCODE='22023'; END IF;
      SELECT id INTO v_clinic_id FROM public.clinics WHERE slug=p_clinic_slug;
      IF v_clinic_id IS NULL THEN RAISE EXCEPTION 'clinic not found: %', p_clinic_slug USING ERRCODE='23503'; END IF;
      v_real_name := COALESCE(NULLIF(btrim(p_customer_real_name),''), NULLIF(btrim(p_customer_name),''));
      v_created_via := CASE WHEN p_created_via = ANY(c_created_via_enum) THEN p_created_via ELSE NULL END;
      v_visit_type := CASE WHEN COALESCE(p_visit_type,'new') = ANY(c_visit_type_enum) THEN COALESCE(p_visit_type,'new') ELSE 'new' END;
      IF p_is_companion THEN v_customer_id := NULL; v_norm_phone := NULL;
      ELSE
        v_norm_phone := public.normalize_phone(p_customer_phone);
        INSERT INTO public.customers (clinic_id, name, phone, visit_type)
        VALUES (v_clinic_id, p_customer_name, v_norm_phone, 'new')
        ON CONFLICT (clinic_id, phone) DO UPDATE SET
          name = COALESCE(NULLIF(btrim(customers.name),''), NULLIF(btrim(EXCLUDED.name),''), customers.name),
          updated_at = now()
        RETURNING id INTO v_customer_id;
      END IF;
      INSERT INTO public.reservations (
        clinic_id, customer_id, customer_name, customer_phone, reservation_date, reservation_time,
        visit_type, status, source_system, external_id, created_via, service_id, registrar_id,
        registrar_name, customer_real_name, brief_note
      ) VALUES (
        v_clinic_id, v_customer_id, p_customer_name, v_norm_phone, p_reservation_date, p_reservation_time,
        v_visit_type, COALESCE(p_status,'confirmed'), p_source_system, p_external_id, v_created_via,
        p_service_id, p_registrar_id, NULLIF(btrim(p_registrar_name),''), v_real_name, NULLIF(btrim(p_brief_note),'')
      )
      ON CONFLICT (source_system, external_id) WHERE source_system IS NOT NULL AND external_id IS NOT NULL
      DO UPDATE SET
        customer_id=EXCLUDED.customer_id, customer_name=EXCLUDED.customer_name, customer_phone=EXCLUDED.customer_phone,
        reservation_date=EXCLUDED.reservation_date, reservation_time=EXCLUDED.reservation_time,
        visit_type=EXCLUDED.visit_type, status=EXCLUDED.status,
        created_via=COALESCE(EXCLUDED.created_via, reservations.created_via),
        service_id=COALESCE(EXCLUDED.service_id, reservations.service_id),
        registrar_id=COALESCE(EXCLUDED.registrar_id, reservations.registrar_id),
        registrar_name=COALESCE(EXCLUDED.registrar_name, reservations.registrar_name),
        customer_real_name=COALESCE(NULLIF(btrim(EXCLUDED.customer_real_name),''), reservations.customer_real_name),
        brief_note=COALESCE(NULLIF(btrim(p_brief_note),''), reservations.brief_note),
        updated_at=now()
      RETURNING id INTO v_reservation_id;
      v_memo_clean := NULLIF(btrim(p_memo),'');
      IF v_memo_clean IS NOT NULL THEN
        INSERT INTO public.reservation_memo_history (reservation_id, clinic_id, content, created_by, created_by_name, source_system)
        VALUES (v_reservation_id, v_clinic_id, v_memo_clean, NULL, '도파민TM', p_source_system)
        ON CONFLICT (reservation_id, source_system) WHERE source_system IS NOT NULL
        DO UPDATE SET content=EXCLUDED.content, created_at=now();
      END IF;
      RETURN v_reservation_id;
    END; $fn$;
  $ddl$;

  -- (2) 합성 클리닉 seed (롤백 대상 — 실 clinics 무영향)
  INSERT INTO public.clinics (name, slug) VALUES ('DRYRUN-ND', v_slug)
  ON CONFLICT (slug) DO NOTHING;

  -- (3) AC-2 create-only: 신규 고객 → push 명이 customers.name 초기값
  PERFORM public.upsert_reservation_from_source(
    p_source_system => 'dryrun-nd', p_external_id => 'E1', p_clinic_slug => v_slug,
    p_customer_phone => v_phone, p_customer_name => '홍길동본명',
    p_reservation_date => DATE '2026-07-21', p_reservation_time => TIME '10:00');
  SELECT name INTO v_name FROM public.customers WHERE clinic_id=(SELECT id FROM clinics WHERE slug=v_slug)
    AND phone=public.normalize_phone(v_phone);
  IF v_name IS DISTINCT FROM '홍길동본명' THEN RAISE EXCEPTION 'AC-2 FAIL create-only: name=%', v_name; END IF;
  RAISE NOTICE 'AC-2 PASS create-only: customers.name=%', v_name;

  -- (4) AC-1 never-downgrade: 동일 phone 재예약/edit push(별칭 'ok') → 기존 본명 보존
  PERFORM public.upsert_reservation_from_source(
    p_source_system => 'dryrun-nd', p_external_id => 'E2', p_clinic_slug => v_slug,
    p_customer_phone => v_phone, p_customer_name => 'ok',
    p_reservation_date => DATE '2026-07-22', p_reservation_time => TIME '11:00');
  SELECT name INTO v_name FROM public.customers WHERE clinic_id=(SELECT id FROM clinics WHERE slug=v_slug)
    AND phone=public.normalize_phone(v_phone);
  IF v_name IS DISTINCT FROM '홍길동본명' THEN RAISE EXCEPTION 'AC-1 FAIL never-downgrade: customers.name overwritten to %', v_name; END IF;
  RAISE NOTICE 'AC-1 PASS never-downgrade: customers.name 보존=%', v_name;
  -- scope §3: push 명은 reservations.customer_real_name 스냅샷으로 착지
  SELECT customer_real_name INTO v_real FROM public.reservations
    WHERE source_system='dryrun-nd' AND external_id='E2';
  IF v_real IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'AC-scope3 FAIL: real_name snapshot=%', v_real; END IF;
  RAISE NOTICE 'AC-scope3 PASS push명 착지: reservations.customer_real_name=%', v_real;

  -- (5) AC-3 preserve-on-NULL: 빈/공백 push → 기존명 불변
  PERFORM public.upsert_reservation_from_source(
    p_source_system => 'dryrun-nd', p_external_id => 'E3', p_clinic_slug => v_slug,
    p_customer_phone => v_phone, p_customer_name => '   ',
    p_reservation_date => DATE '2026-07-23', p_reservation_time => TIME '12:00');
  SELECT name INTO v_name FROM public.customers WHERE clinic_id=(SELECT id FROM clinics WHERE slug=v_slug)
    AND phone=public.normalize_phone(v_phone);
  IF v_name IS DISTINCT FROM '홍길동본명' THEN RAISE EXCEPTION 'AC-3 FAIL preserve-on-NULL: name=%', v_name; END IF;
  RAISE NOTICE 'AC-3 PASS preserve-on-NULL: customers.name=%', v_name;

  -- (6) preserve-on-NULL fill branch: 기존 공란일 때만 push명으로 채움
  PERFORM public.upsert_reservation_from_source(
    p_source_system => 'dryrun-nd', p_external_id => 'E4', p_clinic_slug => v_slug,
    p_customer_phone => v_ph2, p_customer_name => '',
    p_reservation_date => DATE '2026-07-21', p_reservation_time => TIME '10:00');
  PERFORM public.upsert_reservation_from_source(
    p_source_system => 'dryrun-nd', p_external_id => 'E5', p_clinic_slug => v_slug,
    p_customer_phone => v_ph2, p_customer_name => '새로채운이름',
    p_reservation_date => DATE '2026-07-22', p_reservation_time => TIME '11:00');
  SELECT name INTO v_name FROM public.customers WHERE clinic_id=(SELECT id FROM clinics WHERE slug=v_slug)
    AND phone=public.normalize_phone(v_ph2);
  IF v_name IS DISTINCT FROM '새로채운이름' THEN RAISE EXCEPTION 'AC-fill FAIL: empty→fill name=%', v_name; END IF;
  RAISE NOTICE 'AC-fill PASS preserve-on-NULL fill: customers.name=%', v_name;

  -- (7) 全 AC PASS → sentinel RAISE 로 강제 롤백 (무영속)
  RAISE EXCEPTION 'DRYRUN_SENTINEL_OK all-ac-pass' USING ERRCODE = 'P0001';
END
$dry$;

-- §POST — post-probe: DO 롤백 후 prod 함수 body 가 여전히 舊 CASE(override) = 무영속 실증.
--   (dry-run 이 prod 에 아무것도 남기지 않았음을 별도 오토커밋 쿼리로 재확인)
SELECT
  (pg_get_functiondef('public.upsert_reservation_from_source(text,text,text,text,text,date,time,text,text,text,text,uuid,uuid,text,text,text,boolean,text)'::regprocedure)
     ILIKE '%WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name <>%') AS old_case_still_present_expected_true,
  (pg_get_functiondef('public.upsert_reservation_from_source(text,text,text,text,text,date,time,text,text,text,text,uuid,uuid,text,text,text,boolean,text)'::regprocedure)
     ILIKE '%COALESCE(NULLIF(btrim(customers.name)%') AS new_clause_present_expected_false;

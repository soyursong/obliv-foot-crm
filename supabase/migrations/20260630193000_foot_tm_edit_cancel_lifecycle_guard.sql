-- T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL — lifecycle 상태가드 #5 ADDITIVE 보강
-- ============================================================================
-- ★ 선행 합본 20260630190000_foot_tm_edit_cancel_superset_rpc.sql 의 함수 body 위에
--   DA 결정(foot_resv_edit_cancel_da_decision_20260630.md) Q2 가드#5 = 물리동선 상태가드를
--   추가한다. 컬럼/인덱스 DDL 0 (190000 이 이미 external_id TEXT·customer_real_name·UNIQUE 보유).
--   본 migration = 동일 17-arg signature CREATE OR REPLACE (함수 body-only) → 완전 가역.
--
-- ★ 왜 별도 migration: 190000 은 prod 적용 완료(applied) → 동일 파일 재편집은 재실행 안 됨.
--   신규 CREATE OR REPLACE 가 같은 RPC 의 **새 최종 권위 body**(190000 ⊊ 본건, strict superset).
--   ⇒ 배포 순서: 본 migration 이 upsert_reservation_from_source 의 최종 body. 이후 190000/rpc17
--      단독 재적용 금지(clobber).
--
-- ★ 가드#5 (DA Q2-5, dev-foot lane): terminal/in-flight 상태 행은 도파민 stale edit/cancel clobber 금지.
--   물리동선(check_in='checked_in' / 'done' / 'no_show')으로 풋이 이미 진행시킨 예약을 도파민이 되돌리지 못한다.
--     - CANCEL: 대상이 checked_in/done/no_show → reject(예외). 이미 cancelled → 멱등 성공 no-op. 부재 → NULL no-op.
--     - active 재푸시: 대상이 checked_in/done/no_show/cancelled → reject(stale edit). confirmed/reserved → 정상 mutable UPDATE.
--   reject = RAISE(SQLSTATE P0001 → PostgREST 400) → 도파민 reject UX(무음 덮어쓰기 금지, 가드#4 와 동형).
--   status 도메인: reservations_status_check = confirmed/reserved/checked_in/cancelled/done/no_show
--     (20260629150000 canonical). 실데이터 4종(confirmed/checked_in/cancelled/no_show).
--
-- ★ self-mint scope(가드#3) 불변: 선조회 WHERE(source_system=p_source_system AND NOT NULL) →
--   foot-native(source NULL)/타출처 행은 미스코프(미발견) → 가드 발화 전 NULL no-op. split-brain 차단 유지.
--
-- ★ 게이트 = 대표게이트 면제(autonomy §3.1 ADDITIVE+DA GO, 컬럼 신규0). supervisor = DDL-diff(함수 body diff).
--   rollback: 20260630193000_foot_tm_edit_cancel_lifecycle_guard.rollback.sql (190000 body 복원).
-- ============================================================================

BEGIN;

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
  v_cur_status     TEXT;   -- 가드#5: 멱등키 행의 현재 lifecycle 상태(선조회)
  c_created_via_enum CONSTANT TEXT[] := ARRAY['manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin'];
  c_visit_type_enum  CONSTANT TEXT[] := ARRAY['new','returning','experience'];
  -- 가드#5: 풋이 물리동선으로 이미 진행시킨(되돌리기 금지) 상태 집합.
  c_inflight_terminal CONSTANT TEXT[] := ARRAY['checked_in','done','no_show'];
BEGIN
  -- 1. 입력 검증 (멱등키)
  IF p_source_system IS NULL OR p_external_id IS NULL THEN
    RAISE EXCEPTION 'source_system and external_id are required' USING ERRCODE = '22023';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- (a)② 취소 fast-path (ADDITIVE) — p_status='cancelled' → 멱등키 행 cancelled 전이 + 슬롯 release.
  --   ★ self-mint scope(가드#3): source_system=p_source_system AND NOT NULL 인 행만 주소지정
  --     → dopamine 호출은 dopamine 행만. foot-native/NULL source 미스코프 → 미발견 → NULL no-op.
  --   ★ 멱등(가드#2): 이미 cancelled → 성공 no-op(기존 id 회신).
  --   ★ lifecycle 가드(#5): checked_in/done/no_show → reject(원내입실/완료/노쇼 예약 stale cancel clobber 금지).
  -- ────────────────────────────────────────────────────────────────
  IF lower(btrim(COALESCE(p_status, ''))) = 'cancelled' THEN
    -- self-mint scope 로 현재 행/상태 선조회
    SELECT r.id, r.status INTO v_reservation_id, v_cur_status
      FROM public.reservations r
     WHERE r.source_system IS NOT NULL
       AND r.source_system = p_source_system
       AND r.external_id   = p_external_id
     LIMIT 1;

    -- 대상행 부재(또는 스코프 밖=foot-native) → no-op(NULL, tombstone 미생성)
    IF v_reservation_id IS NULL THEN
      RETURN NULL;
    END IF;

    -- 이미 cancelled → 멱등 성공 no-op(기존 id 회신, 예외 없음)
    IF v_cur_status = 'cancelled' THEN
      RETURN v_reservation_id;
    END IF;

    -- ★ 가드#5: 물리동선 진행(원내입실/완료/노쇼) 행 → stale cancel reject(무음 clobber 금지)
    IF v_cur_status = ANY (c_inflight_terminal) THEN
      RAISE EXCEPTION 'lifecycle-invalid cancel: reservation % is "%" (in-flight/terminal) — TM cancel rejected (foot physical-flow owns lifecycle)',
        v_reservation_id, v_cur_status
        USING ERRCODE = 'P0001', HINT = 'LIFECYCLE_INVALID';
    END IF;

    -- confirmed/reserved → cancelled 전이 + 슬롯 release(status NOT IN ('cancelled') 뷰/카운터 자동 제외)
    UPDATE public.reservations r
       SET status     = 'cancelled',
           memo       = COALESCE(NULLIF(btrim(p_memo), ''), r.memo),
           updated_at = now()
     WHERE r.id = v_reservation_id;

    RETURN v_reservation_id;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- ★ 가드#5 (active 재푸시): self-mint 행이 이미 물리동선 진행/취소 상태면 stale edit clobber 금지 → reject.
  --   (확인/예약 상태만 mutable UPDATE 허용. 신규행 INSERT 는 v_cur_status NULL → 통과.)
  -- ────────────────────────────────────────────────────────────────
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

  -- 2. 클리닉 조회 (active/upsert 경로)
  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'clinic_slug is required' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_clinic_id FROM public.clinics WHERE slug = p_clinic_slug;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_slug USING ERRCODE = '23503';
  END IF;

  -- 본명/동행명 스냅샷 (§4-2b): customer_real_name 우선 → 후방호환 customer_name 폴백.
  v_real_name := COALESCE(
    NULLIF(btrim(p_customer_real_name), ''),
    NULLIF(btrim(p_customer_name), '')
  );

  -- created_via / visit_type enum 가드 (비-enum → NULL/기본, CHECK 위반 500 차단)
  v_created_via := CASE WHEN p_created_via = ANY (c_created_via_enum) THEN p_created_via ELSE NULL END;
  v_visit_type  := CASE WHEN COALESCE(p_visit_type,'new') = ANY (c_visit_type_enum)
                        THEN COALESCE(p_visit_type,'new') ELSE 'new' END;

  -- 3~4. customer 산출 (discriminator-gated)
  IF p_is_companion THEN
    -- ★ 동행(§444/§52): write-time phone 역조회·customers 링크 절대 금지 → customer_id NULL 착지.
    v_customer_id := NULL;
    v_norm_phone  := NULL;   -- 동행 무폰 수용(customer_phone 비적재)
  ELSE
    -- 비동행: 기존 경로 불변(0-회귀). phone 정규화 + (clinic_id, phone) customer upsert.
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

  -- 5. 예약 upsert — (source_system, external_id) UNIQUE 멱등.
  --   (a)① 재푸시 = mutable(reservation_date·time·status·memo) idempotent UPDATE(no-op 정황 보정).
  --   (가드#5 통과 = 현재 상태 confirmed/reserved/신규 → clobber 안전.)
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
    memo               = COALESCE(EXCLUDED.memo, reservations.memo),   -- (b) preserve-on-NULL
    created_via        = COALESCE(EXCLUDED.created_via, reservations.created_via),
    service_id         = COALESCE(EXCLUDED.service_id, reservations.service_id),
    registrar_id       = COALESCE(EXCLUDED.registrar_id, reservations.registrar_id),
    registrar_name     = COALESCE(EXCLUDED.registrar_name, reservations.registrar_name),
    -- §4-2b INVARIANT3: 미동봉(NULL) 재동기화 시 기존 본명 보존(덮어쓰기 금지)
    customer_real_name = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_name),''), reservations.customer_real_name),
    updated_at         = now()
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;

-- service_role 키로만 호출 (anon/authenticated 차단) — 17-arg 시그니처 기준 (REPLACE 는 ACL 보존, 멱등 재적용)
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM authenticated;

COMMENT ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) IS
  '도파민/외부 → 풋CRM reservations 표준 멱등 upsert (17-arg superset + lifecycle 가드#5). (source_system, external_id) idempotent. p_status=cancelled → self-mint 행만 cancelled 전이+슬롯 release(이미 cancelled=no-op, checked_in/done/no_show=reject). active 재푸시 = mutable UPDATE(confirmed/reserved 한정, in-flight/terminal=stale-edit reject). p_is_companion=true → customer_id NULL(§444)+customer_real_name 착지. 9~17 trailing DEFAULT → 8-arg 후방호환 100%. (TM-EDIT-CANCEL ⊃ MEMO-PUSH-DROP ⊃ COMPANION-RESV-INSERT-FAIL + 가드#5)';

COMMIT;

-- 사후 검증 (수동):
--   SELECT pg_get_functiondef('public.upsert_reservation_from_source(text,text,text,text,text,date,time,text,text,text,text,uuid,uuid,text,text,text,boolean)'::regprocedure) ILIKE '%lifecycle-invalid%';
--   -- 가드#5 cancel: checked_in 행에 p_status='cancelled' 호출 → ERROR(P0001, HINT=LIFECYCLE_INVALID), 행 불변.
--   -- 가드#5 edit:   checked_in 행에 active 재푸시 → ERROR, reservation_time/status 불변.
--   -- 회귀: confirmed 행 cancel/재푸시 정상(S1/S4), 이미 cancelled 재취소 no-op(S2), 부재 NULL(S5), 타 source 불변(S3).

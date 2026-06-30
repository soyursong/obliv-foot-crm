-- T-20260630-dopamine-FOOTRESV-TM-EDIT-CANCEL — TM 예약 수정/취소 ingest (ADDITIVE superset)
-- ============================================================================
-- ★ 3-티켓 단일 합본 superset (planner ★중대 조율, §447 single-combined):
--   같은 upsert_reservation_from_source 를 CREATE OR REPLACE 하는 3건이 동시 인플라이트 →
--   마지막 REPLACE 가 앞선 것을 덮어쓰는 clobber(STATS-PERIODFILTER deploy-ordering 선례) 방지.
--   본 migration 1회로 세 변경분을 모두 살린 최종 body 를 출하한다:
--     (a) [본건]  ① ON CONFLICT DO UPDATE on mutable(reservation_date·time·memo·status)
--                 ② p_status='cancelled' → 멱등키 행 전이 + 풋 슬롯 release(self-mint scope 가드)
--     (b) MEMO-PUSH-DROP  p_memo(8th) + reservations.memo + COALESCE preserve-on-NULL
--     (c) COMPANION-RESV-INSERT-FAIL  8→17arg + external_id UUID→TEXT + customer_real_name
--
-- ★ 배포 ground-truth (2026-06-30 prod 실측):
--   - prod 함수 = 8-arg (b 반영 = p_memo + memo COALESCE 라이브). external_id = uuid(미전환),
--     customer_real_name 컬럼 부재 → (c) rpc17 미배포. 따라서 본 합본이 (c)+(a) 를 동반 출하.
--   - 본 migration 은 멱등(IF EXISTS/IF NOT EXISTS/ALTER text→text no-op) → rpc17 선적용 여부와 무관히 안전.
--
-- ★ 게이트 = 대표게이트 면제 (autonomy §3.1 ADDITIVE + DA GO). 컬럼 신규0(c 컬럼은 기존 계약 §4-2b
--   drift-convergence, 본건 자체는 컬럼0). supervisor = DDL-diff(RPC body diff) + ① 1행검증.
--   rollback: 20260630190000_foot_tm_edit_cancel_superset_rpc.rollback.sql
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- (c-A) reservations.external_id  UUID → TEXT (lossless-widening) + UNIQUE 인덱스 명시 재빌드
--   동행 composite external_id(`{cue_card}#companion-N`, text) 수용. UUID ⊂ TEXT → 무손실.
--   멱등: 이미 text 면 ALTER 가 동일타입 재캐스팅 no-op.
-- ─────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_reservations_source_external;

ALTER TABLE public.reservations
  ALTER COLUMN external_id TYPE text USING external_id::text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_source_external
  ON public.reservations (source_system, external_id)
  WHERE source_system IS NOT NULL AND external_id IS NOT NULL;

COMMENT ON COLUMN public.reservations.external_id IS
  '외부 시스템 식별자(canonical TEXT). 도파민 cue_card_id, 동행은 composite `{cue_card}#companion-N`(§441). NULL=미연동.';

-- ─────────────────────────────────────────────────────────────────
-- (c-B) reservations.customer_real_name  TEXT NULL  ADD (ADDITIVE, §4-2b 비키)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS customer_real_name text;

COMMENT ON COLUMN public.reservations.customer_real_name IS
  '예약시점 본명/동행명 스냅샷(표시전용 폴백, §4-2b v2.1). 비키 INVARIANT: JOIN/dedup/귀속 키 비사용 · COALESCE(customers.name, customer_real_name) 폴백 · NULL=정상.';

-- ─────────────────────────────────────────────────────────────────
-- 함수 합본 — 8-arg(prod) / 17-arg(rpc17) 어느 쪽이 떠있든 동일 식별자 충돌 제거 후 17-arg CREATE.
--   PG 함수 식별자 = (name, arg types). 8→17 = 인자수 변경 → 기존 8-arg signature 명시 DROP 필수.
-- ─────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT
);

CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source(
  p_source_system       TEXT,
  p_external_id         TEXT,
  p_clinic_slug         TEXT,
  p_customer_phone      TEXT,            -- E.164 정규화 (비동행). 동행=무폰 수용(NULL 허용)
  p_customer_name       TEXT,
  p_reservation_date    DATE,
  p_reservation_time    TIME,
  p_memo                TEXT    DEFAULT NULL,   -- (b) 8th
  p_status              TEXT    DEFAULT 'confirmed',  -- (a)② 생략=현행 active('confirmed'). 'cancelled'=취소전이
  p_visit_type          TEXT    DEFAULT 'new',
  p_created_via         TEXT    DEFAULT NULL,
  p_service_id          UUID    DEFAULT NULL,
  p_registrar_id        UUID    DEFAULT NULL,
  p_registrar_name      TEXT    DEFAULT NULL,
  p_customer_real_name  TEXT    DEFAULT NULL,   -- (c) 15th: 동행명/본명 스냅샷 (§4-2b)
  p_customer_real_phone TEXT    DEFAULT NULL,   -- (c) 16th: §447 positional parity (foot 미착지 — accept-ignore)
  p_is_companion        BOOLEAN DEFAULT false   -- (c) 17th: 명시 discriminator (§444). true → customer_id NULL 강제
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
  c_created_via_enum CONSTANT TEXT[] := ARRAY['manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin'];
  c_visit_type_enum  CONSTANT TEXT[] := ARRAY['new','returning','experience'];
BEGIN
  -- 1. 입력 검증 (멱등키)
  IF p_source_system IS NULL OR p_external_id IS NULL THEN
    RAISE EXCEPTION 'source_system and external_id are required' USING ERRCODE = '22023';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- (a)② 취소 fast-path (ADDITIVE) — p_status='cancelled' → 멱등키 행 cancelled 전이 + 슬롯 release.
  --   ★ 가드(split-brain 차단): 호출 source 가 자기 mint 한 행에만 스코프
  --        (source_system = p_source_system AND source_system IS NOT NULL).
  --     → dopamine 호출은 dopamine 행만 취소. foot-native(다른 source)/NULL source 행은 변경불가.
  --   ★ 슬롯 release: status='cancelled' 전이 = 오버부킹 카운터/캘린더 뷰(status NOT IN ('cancelled'))
  --     에서 자동 제외 → 슬롯 회수. SECURITY DEFINER 로 RLS 무관 전이.
  --   ★ 멱등: 이미 cancelled 거나 대상행 부재 → 성공 no-op(갱신 skip, 존재 시 기존 id 반환).
  --   clinic 해석 불필요(기존 행이 clinic_id 보유) → 클리닉 조회 전 분기.
  -- ────────────────────────────────────────────────────────────────
  IF lower(btrim(COALESCE(p_status, ''))) = 'cancelled' THEN
    UPDATE public.reservations r
       SET status     = 'cancelled',
           memo       = COALESCE(NULLIF(btrim(p_memo), ''), r.memo),
           updated_at = now()
     WHERE r.source_system IS NOT NULL
       AND r.source_system = p_source_system
       AND r.external_id   = p_external_id
       AND r.status <> 'cancelled'
     RETURNING r.id INTO v_reservation_id;

    IF v_reservation_id IS NULL THEN
      -- 대상행 부재 또는 이미 cancelled → 성공 no-op. 존재하면 기존 id 회신.
      SELECT r.id INTO v_reservation_id
        FROM public.reservations r
       WHERE r.source_system IS NOT NULL
         AND r.source_system = p_source_system
         AND r.external_id   = p_external_id
       LIMIT 1;
    END IF;

    RETURN v_reservation_id;  -- 취소 대상 부재 시 NULL(취소할 것 없음 = no-op)
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

-- service_role 키로만 호출 (anon/authenticated 차단) — 17-arg 시그니처 기준
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM authenticated;

COMMENT ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) IS
  '도파민/외부 → 풋CRM reservations 표준 멱등 upsert (17-arg superset). (source_system, external_id) idempotent. p_status=cancelled → self-mint(source_system=p_source_system) 행만 cancelled 전이+슬롯 release(이미 cancelled=no-op). p_is_companion=true → customer_id NULL(§444)+customer_real_name 착지. 9~17 trailing DEFAULT → 8-arg 후방호환 100%. (TM-EDIT-CANCEL ⊃ MEMO-PUSH-DROP ⊃ COMPANION-RESV-INSERT-FAIL 합본)';

COMMIT;

-- 사후 검증 (수동):
--   SELECT pg_get_functiondef('public.upsert_reservation_from_source(text,text,text,text,text,date,time,text,text,text,text,uuid,uuid,text,text,text,boolean)'::regprocedure) ILIKE '%취소 fast-path%';
--   -- ① 1행검증(active 재푸시 mutable UPDATE) — supervisor:
--   --   동일 (source_system, external_id) 2회 호출(시간/메모 변경) → reservation_time·memo 갱신 + 단일행 유지.
--   -- ② cancel: status='cancelled' 호출 → 해당행 status='cancelled' & 슬롯 release. 재호출 = no-op 성공.
--   -- ② guard: 다른 source(foot-native)/NULL source 행은 dopamine 취소 호출에 불변.

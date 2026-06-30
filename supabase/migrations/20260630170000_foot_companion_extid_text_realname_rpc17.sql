-- T-20260630-foot-COMPANION-RESV-INSERT-FAIL — AC-3 동행(companion) 영속 합본 마이그레이션
-- ============================================================================
-- 근거: cross_crm_data_contract §4-1/§4-2/§4-2b/§4-2c/§4-2d + §441~447 + schema_registry.yaml.
--   DA CONSULT-REPLY DA-20260630-FOOT-COMPANION-EXTID-TEXT (4점 전부 CONFIRM = drift-convergence,
--   신규정책 아님). 게이트 = supervisor DDL-diff + 롤백SQL (대표게이트 면제, autonomy §3.1 —
--   lossless-widening + ADDITIVE, 비파괴 확정).
--
-- ★ §447 단일 합본(single combined) — 3 변경을 한 migration 으로:
--   (A) reservations.external_id  UUID → TEXT  (lossless-widening drift-correction, DA [a])
--       foot 마이그 20260520000040 L32 가 §441 동행계약 이전 TEXT→UUID 로 일탈 → composite
--       external_id(`{cue_card}#companion-N`, text) 를 22P02 invalid_uuid 로 거부하던 근인 제거.
--       canonical = TEXT (§4-1 L399 · §4-2 L422 · schema_registry.yaml L445).  UUID ⊂ TEXT →
--       `USING external_id::text` 결정적, 데이터손실0·기존행 귀속불변·PII표면0.
--       (prod 실측: non-null external_id = 1 행(dopamine), customer_id NULL = 126 행 — 전부 무손실.)
--   (B) reservations.customer_real_name  TEXT NULL  ADD  (순수 ADDITIVE, §4-2b v2.1 비키 canonical, DA [b])
--       동행(customer_id=NULL, customers 행 부재) 본명/동행명 스냅샷(표시전용 폴백).
--   (C) upsert_reservation_from_source  8 → 17-arg  (CREATE OR REPLACE, 전부 trailing DEFAULT,
--       후방호환 100% = additive-equivalent, DA [c]).  is_companion=true → customer_id=NULL +
--       customer_real_name 착지(§444 명시 discriminator only — 더미폰 토큰 판정 영구 금지).
--
-- ★ dependency-sweep 3종 (DA 지정, 적용 전 read-only 확인 — clean):
--   ① UNIQUE (source_system, external_id) WHERE NOT NULL = `idx_reservations_source_external` 실재 →
--      본 migration 이 DROP→ALTER→CREATE 로 명시 재빌드.
--   ② external_id 를 UUID FK 로 참조하는 객체 = 부재(0건). external_id ≠ PK → 미참조.
--   ③ external_id::uuid 캐스팅 view/fn/generated-col/CHECK = 부재(0건).
--      `enqueue_dopamine_callback()` 는 external_id 를 이미 TEXT(v_cue_card_id TEXT)로 coercion →
--      TEXT 전환 후 동작 불변. `upsert_reservation_from_source` 는 본 migration 이 교체.
--   (evidence: scripts/T-20260630-foot-COMPANION-RESV-INSERT-FAIL_depsweep.mjs)
--
-- ★ payments 의존 0 (DA [d], §4-2d-2 L475): cue_card 링크 = reservations.external_id 단독.
--   payments.external_id(uuid) 는 별 carry-over 컬럼 — 본 변경과 무관(JOIN/cast 부재, sweep ③ clean).
--
-- ★ 비키(non-key) INVARIANT 5종 (DA [b] 적용 의무, §4-2b):
--   ① JOIN/dedup/귀속 키 비사용  ② COALESCE(customers.name, customer_real_name) 폴백
--   ③ trailing DEFAULT  ④ NULL=정상  ⑤ customers.real_name(캐노니컬)과 구분(예약시점 스냅샷).
--
-- ★ sequencing (§447 502 게이트): 도파민 동행 emit(is_companion + composite external_id)은
--   본 합본 migration prod-LIVE 後 머지(HOLD) — 전이 윈도 22P02 차단. foot 먼저 출하.
--   본 migration 은 후방호환(is_companion 미동봉 → false → 기존 비동행 경로 0-회귀)이라 emit 前 적용 안전.
--
-- 롤백: 20260630170000_foot_companion_extid_text_realname_rpc17.rollback.sql
--   ⚠ external_id TEXT→UUID 역변환은 모든 값이 uuid-castable 일 때만 안전(동행 composite text 적재 後 불가).
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- (A) reservations.external_id  UUID → TEXT (lossless-widening) + UNIQUE 인덱스 명시 재빌드
-- ─────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_reservations_source_external;

ALTER TABLE public.reservations
  ALTER COLUMN external_id TYPE text USING external_id::text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_source_external
  ON public.reservations (source_system, external_id)
  WHERE source_system IS NOT NULL AND external_id IS NOT NULL;

COMMENT ON COLUMN public.reservations.external_id IS
  '외부 시스템 식별자(canonical TEXT). 도파민 cue_card_id, 동행은 composite `{cue_card}#companion-N`(§441). NULL=미연동. (20260520000040 UUID 일탈을 §4-1 canonical TEXT 로 drift-correction)';

-- ─────────────────────────────────────────────────────────────────
-- (B) reservations.customer_real_name  TEXT NULL  ADD (ADDITIVE, §4-2b 비키)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS customer_real_name text;

COMMENT ON COLUMN public.reservations.customer_real_name IS
  '예약시점 본명/동행명 스냅샷(표시전용 폴백, §4-2b v2.1). 동행(customer_id=NULL, customers 행 부재) 이름복원 1순위. 비키 INVARIANT: JOIN/dedup/귀속 키 비사용 · COALESCE(customers.name, customer_real_name) 폴백 · NULL=정상 · customers.real_name(캐노니컬)과 구분.';

-- ─────────────────────────────────────────────────────────────────
-- (C) upsert_reservation_from_source  8 → 17-arg (companion-aware, 후방호환 100%)
--   PG 함수 식별자 = (name, arg types). 8→17 = 인자 수 변경 → 기존 8-arg signature 명시 DROP 후
--   17-arg CREATE 가 유일 안전경로(dangling 8-arg overload 방지). 9~17 전부 trailing DEFAULT →
--   기존 8-positional/named caller 단일 해석 ⇒ caller resolve 불변(0-회귀).
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
  p_memo                TEXT    DEFAULT NULL,
  p_status              TEXT    DEFAULT 'confirmed',
  p_visit_type          TEXT    DEFAULT 'new',
  p_created_via         TEXT    DEFAULT NULL,
  p_service_id          UUID    DEFAULT NULL,
  p_registrar_id        UUID    DEFAULT NULL,
  p_registrar_name      TEXT    DEFAULT NULL,
  p_customer_real_name  TEXT    DEFAULT NULL,   -- 15th: 동행명/본명 스냅샷 (§4-2b)
  p_customer_real_phone TEXT    DEFAULT NULL,   -- 16th: §447 positional parity (foot 미착지 컬럼부재 — accept-ignore)
  p_is_companion        BOOLEAN DEFAULT false   -- 17th: 명시 discriminator (§444). true → customer_id NULL 강제
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
  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'clinic_slug is required' USING ERRCODE = '22023';
  END IF;

  -- 2. 클리닉 조회
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
    --   더미폰 collapse·표시명 회전 원천 차단. 동행명은 customer_real_name SSOT 로 렌더.
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

  -- 5. 예약 upsert — (source_system, external_id) UNIQUE 멱등
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
    -- §4-2b INVARIANT3: 미동봉(NULL) 재동기화 시 기존 본명 보존(덮어쓰기 금지)
    customer_real_name = COALESCE(NULLIF(btrim(EXCLUDED.customer_real_name),''), reservations.customer_real_name),
    updated_at         = now()
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;

-- service_role 키로만 호출 (anon/authenticated 차단) — 신규 17-arg 시그니처 기준
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM authenticated;

COMMENT ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
) IS
  '도파민/외부 → 풋CRM reservations 표준 멱등 upsert (17-arg canonical). (source_system, external_id) idempotent. p_is_companion=true 시 customers 링크 금지(customer_id NULL 강제, §444/§52) + customer_real_name(동행명) 착지. 9~17 trailing DEFAULT → 8-arg 후방호환 100%. (T-20260630-foot-COMPANION-RESV-INSERT-FAIL, drift-convergence)';

COMMIT;

-- 사후 검증 (수동):
--   SELECT pg_get_functiondef('public.upsert_reservation_from_source'::regproc) ILIKE '%p_is_companion%';
--   SELECT data_type FROM information_schema.columns WHERE table_name='reservations' AND column_name='external_id'; -- text
--   SELECT column_name FROM information_schema.columns WHERE table_name='reservations' AND column_name='customer_real_name';
--   -- 동행 smoke (composite external_id text + is_companion):
--   SELECT public.upsert_reservation_from_source(
--     'dopamine','11111111-1111-1111-1111-111111111111#companion-1','jongno-foot',
--     NULL,'동행루루', CURRENT_DATE+1, '10:00', NULL,
--     'confirmed','new','dopamine', NULL, NULL, NULL, '동행루루', NULL, true);
--   -- → customer_id IS NULL AND customer_real_name='동행루루' 확인

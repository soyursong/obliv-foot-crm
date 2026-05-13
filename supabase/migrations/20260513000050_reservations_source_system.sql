-- T-20260512-foot-CONTRACT-ALIGN §C
-- reservations 도파민 push 표준 컬럼 추가 + upsert_reservation_from_source() RPC
-- Cross-CRM 계약 §4 이식 (롱레CRM 20260424 동일 패턴)
-- 롤백: 20260513000050_reservations_source_system.down.sql

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- C-1. reservations 컬럼 추가
--  source_system: 예약 출처 ('dopamine' | 'aicc' | 'naver' | 'meta' | 'manual' | NULL)
--  external_id:   외부 시스템 식별자 (도파민 cue_card_id 등)
--  NULL = CRM 자체 생성
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS source_system TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS external_id   TEXT DEFAULT NULL;

-- C-2. UNIQUE 부분 인덱스 (idempotent push 보장)
--  source_system + external_id 쌍이 NOT NULL일 때만 unique 적용
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_source_external
  ON public.reservations (source_system, external_id)
  WHERE source_system IS NOT NULL AND external_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────
-- C-3. upsert_reservation_from_source() RPC
--  도파민 TM 및 외부 시스템 → 풋CRM 예약 push 표준 진입점
--  SECURITY DEFINER (service_role 키로만 호출 권장)
--  idempotent: 동일 (source_system, external_id) 재호출 시 UPDATE
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source(
  p_source_system    TEXT,
  p_external_id      TEXT,
  p_clinic_slug      TEXT,
  p_customer_phone   TEXT,   -- E.164 정규화 필수 (+82...)
  p_customer_name    TEXT,
  p_reservation_date DATE,
  p_reservation_time TIME,
  p_memo             TEXT    DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id    UUID;
  v_customer_id  UUID;
  v_reservation_id UUID;
  v_norm_phone   TEXT;
BEGIN
  -- 1. 입력 검증
  IF p_source_system IS NULL OR p_external_id IS NULL THEN
    RAISE EXCEPTION 'source_system and external_id are required' USING ERRCODE = '22023';
  END IF;

  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'clinic_slug is required' USING ERRCODE = '22023';
  END IF;

  -- 2. 클리닉 조회
  SELECT id INTO v_clinic_id
  FROM public.clinics
  WHERE slug = p_clinic_slug;

  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_slug USING ERRCODE = '23503';
  END IF;

  -- 3. 전화번호 정규화 (E.164 → normalize_phone 사용)
  v_norm_phone := public.normalize_phone(p_customer_phone);

  -- 4. 고객 upsert — (clinic_id, phone) UNIQUE 기반
  INSERT INTO public.customers (clinic_id, name, phone, visit_type)
  VALUES (v_clinic_id, p_customer_name, v_norm_phone, 'new')
  ON CONFLICT (clinic_id, phone) DO UPDATE SET
    name = CASE
      WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != '' THEN EXCLUDED.name
      ELSE customers.name
    END,
    updated_at = now()
  RETURNING id INTO v_customer_id;

  -- 5. 예약 upsert — (source_system, external_id) UNIQUE 기반
  INSERT INTO public.reservations (
    clinic_id,
    customer_id,
    customer_name,
    customer_phone,
    reservation_date,
    reservation_time,
    visit_type,
    memo,
    source_system,
    external_id,
    status
  ) VALUES (
    v_clinic_id,
    v_customer_id,
    p_customer_name,
    v_norm_phone,
    p_reservation_date,
    p_reservation_time,
    'new',
    p_memo,
    p_source_system,
    p_external_id,
    'confirmed'
  )
  ON CONFLICT (source_system, external_id)
    WHERE source_system IS NOT NULL AND external_id IS NOT NULL
  DO UPDATE SET
    customer_id      = EXCLUDED.customer_id,
    customer_name    = EXCLUDED.customer_name,
    customer_phone   = EXCLUDED.customer_phone,
    reservation_date = EXCLUDED.reservation_date,
    reservation_time = EXCLUDED.reservation_time,
    memo             = COALESCE(EXCLUDED.memo, reservations.memo),
    updated_at       = now()
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;

-- service_role 키로만 호출 (anon/authenticated 차단)
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT
) FROM authenticated;
-- service_role은 SECURITY DEFINER로 직접 실행 가능 (별도 GRANT 불필요)

COMMIT;

-- 사후 검증 쿼리:
-- \d reservations  -- source_system, external_id 컬럼 확인
-- \di idx_reservations_source_external  -- 인덱스 확인
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'upsert_reservation_from_source';
--
-- smoke test (service_role 키 필요):
-- SELECT public.upsert_reservation_from_source(
--   'dopamine', 'test-001', 'jongno-foot',
--   '+821012345678', '테스트환자',
--   CURRENT_DATE + 1, '10:00', '도파민 테스트 예약'
-- );

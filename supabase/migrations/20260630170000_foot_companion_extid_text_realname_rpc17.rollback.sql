-- ROLLBACK: 20260630170000_foot_companion_extid_text_realname_rpc17.sql
-- T-20260630-foot-COMPANION-RESV-INSERT-FAIL — AC-3 동행 영속 합본 마이그 역전
-- ============================================================================
-- 복원 순서: (C) RPC 17→8-arg 환원 → (B) customer_real_name DROP → (A) external_id TEXT→UUID 환원.
--
-- ⚠⚠ (A) external_id TEXT→UUID 역변환 안전 조건 ⚠⚠
--   UUID ⊂ TEXT (widening) 은 일방 무손실. 역방향(narrowing)은 모든 external_id 값이 uuid-castable
--   일 때만 성공. 동행 composite external_id(`{cue_card}#companion-N`, 비-UUID text)가 1건이라도
--   적재된 後에는 역변환 불가(22P02). §447 sequencing(도파민 동행 emit = foot 합본 prod-LIVE 後 HOLD)
--   상 emit 前 롤백이면 composite 부재 → 안전. 본 스크립트는 비-castable 값 발견 시 명시 RAISE 로
--   중단(데이터 파괴 방지). 동행 데이터 적재 後 롤백이 필요하면 (A) 생략하고 (B)(C)만 환원할 것.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- (C) RPC 17 → 8-arg 환원 (원본 20260513000050 시그니처/본문 복원)
-- ─────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.upsert_reservation_from_source(
  TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TIME, TEXT, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.upsert_reservation_from_source(
  p_source_system    TEXT,
  p_external_id      TEXT,
  p_clinic_slug      TEXT,
  p_customer_phone   TEXT,
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
  IF p_source_system IS NULL OR p_external_id IS NULL THEN
    RAISE EXCEPTION 'source_system and external_id are required' USING ERRCODE = '22023';
  END IF;
  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'clinic_slug is required' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_clinic_id FROM public.clinics WHERE slug = p_clinic_slug;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic not found: %', p_clinic_slug USING ERRCODE = '23503';
  END IF;
  v_norm_phone := public.normalize_phone(p_customer_phone);
  INSERT INTO public.customers (clinic_id, name, phone, visit_type)
  VALUES (v_clinic_id, p_customer_name, v_norm_phone, 'new')
  ON CONFLICT (clinic_id, phone) DO UPDATE SET
    name = CASE
      WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != '' THEN EXCLUDED.name
      ELSE customers.name
    END,
    updated_at = now()
  RETURNING id INTO v_customer_id;
  INSERT INTO public.reservations (
    clinic_id, customer_id, customer_name, customer_phone,
    reservation_date, reservation_time, visit_type, memo,
    source_system, external_id, status
  ) VALUES (
    v_clinic_id, v_customer_id, p_customer_name, v_norm_phone,
    p_reservation_date, p_reservation_time, 'new', p_memo,
    p_source_system, p_external_id, 'confirmed'
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

REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TIME,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_reservation_from_source(TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TIME,TEXT) FROM authenticated;

-- ─────────────────────────────────────────────────────────────────
-- (B) customer_real_name DROP (ADDITIVE 역전)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.reservations DROP COLUMN IF EXISTS customer_real_name;

-- ─────────────────────────────────────────────────────────────────
-- (A) external_id TEXT → UUID 환원 (uuid-castable 일 때만 — 비-castable 발견 시 중단)
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.reservations
  WHERE external_id IS NOT NULL
    AND external_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'rollback (A) aborted: % non-UUID external_id row(s) (동행 composite 적재 後 — TEXT→UUID 불가). (B)(C)만 환원하거나 데이터 정리 후 재시도.', v_bad
      USING ERRCODE = '22P02';
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_reservations_source_external;

ALTER TABLE public.reservations
  ALTER COLUMN external_id TYPE uuid USING external_id::uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_source_external
  ON public.reservations (source_system, external_id)
  WHERE source_system IS NOT NULL AND external_id IS NOT NULL;

COMMENT ON COLUMN public.reservations.external_id IS
  '도파민 cue_card.id (UUID) — 큐카드 master=도파민 모델. NULL이면 도파민 미연동 예약';

COMMIT;

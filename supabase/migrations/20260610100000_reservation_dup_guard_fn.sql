-- T-20260610-foot-RESV-DUPGUARD-SAMEDAY (P1)
-- 대시보드 예약 신규 생성 동일고객 당일 중복 가드 — 서버 권위 RPC (1급 가드)
--
-- ─── 배경 ────────────────────────────────────────────────────────────────────
-- Dashboard QuickReservationDialog.handleSave 의 reservations INSERT 가 동일고객+당일
-- 중복을 막지 못함. 기존 가드는 reservation_id 기준(체크인 단계)만 → 신규 생성 무방비.
-- 체크인 완료(status='checked_in') 고객도 또 예약 생성됨 (증거 F0B9CLQ1KRT).
--
-- ─── 선행 정본 ───────────────────────────────────────────────────────────────
-- T-20260602-foot-SELFCHECKIN-DUP-GUARD / fn_selfcheckin_dup_guard 와 동일 형태.
-- 병렬 가드 정의 금지 — check_ins analog 을 reservations 로 일관화.
--
-- ─── 함수 ────────────────────────────────────────────────────────────────────
-- fn_reservation_dup_guard(p_clinic_id, p_customer_id, p_phone, p_date)
--   조회: clinic_id 일치 + (customer_id 또는 phone) 일치 + reservation_date = p_date
--         + status NOT IN ('cancelled')
--   반환: jsonb { duplicate: bool, error_code: 'DUPLICATE_RESERVATION_SAMEDAY'|null }
--   FE 는 duplicate=true 시 reject + "이미 같은 날짜에 예약이 있는 고객…" 표시.
--
-- ─── AC 매핑 ─────────────────────────────────────────────────────────────────
-- AC-1: customer_id 일치 당일 중복 → duplicate=true
-- AC-2: phone 매칭(customer_id 미연결 워크인 예약 포함) — digits 정규화 비교
-- AC-3: status NOT IN ('cancelled') → 취소 후 재예약 정상 동선 유지 (회귀 금지)
-- AC-4: reservation_date 단위 — 타 날짜 예약은 무영향
-- 분기 (a): checked_in 예약 row 도 활성 → 체크인 완료 고객 재예약도 차단(F0B9CLQ1KRT)
--
-- ─── 보안 ────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER + search_path 고정. authenticated(대시보드 스탭) + anon GRANT.
-- clinic_id 스코프 강제. 반환은 boolean 판정만(PII 미반환).
--
-- ─── 리스크 ──────────────────────────────────────────────────────────────────
-- LOW: 조회 전용(데이터 무변경). 거부는 graceful — 핵심경로 파괴 없음.
--      FE 는 본 RPC 미배포 시 fallback SELECT 로 강하 → 양쪽 모두 동작.
--
-- 롤백: 20260610100000_reservation_dup_guard_fn.rollback.sql
-- ticket: T-20260610-foot-RESV-DUPGUARD-SAMEDAY
-- author: dev-foot / 2026-06-10

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_reservation_dup_guard(
  p_clinic_id   UUID,
  p_customer_id UUID,
  p_phone       TEXT,
  p_date        DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone_digits TEXT := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_exists       BOOLEAN;
BEGIN
  -- 식별자(customer_id / 유효 phone) 가 전혀 없으면 가드 불가 → 허용
  IF p_customer_id IS NULL AND (v_phone_digits IS NULL OR length(v_phone_digits) < 10) THEN
    RETURN jsonb_build_object('duplicate', false, 'error_code', NULL);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.reservations r
    WHERE r.clinic_id = p_clinic_id
      AND r.status NOT IN ('cancelled')          -- AC-3: 취소건 제외(재예약 허용)
      AND r.reservation_date = p_date            -- AC-4: 당일 한정
      AND (
        -- customer_id 매칭 (AC-1)
        (p_customer_id IS NOT NULL AND r.customer_id = p_customer_id)
        -- phone 원문 매칭 (AC-2)
        OR (p_phone IS NOT NULL AND r.customer_phone = p_phone)
        -- phone digits 정규화 매칭 (010-xxxx / +8210 / 01012345678 흡수)
        OR (
          v_phone_digits IS NOT NULL
          AND length(v_phone_digits) >= 10
          AND regexp_replace(COALESCE(r.customer_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
        )
      )
  ) INTO v_exists;

  IF v_exists THEN
    RETURN jsonb_build_object('duplicate', true, 'error_code', 'DUPLICATE_RESERVATION_SAMEDAY');
  END IF;

  RETURN jsonb_build_object('duplicate', false, 'error_code', NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reservation_dup_guard(UUID, UUID, TEXT, DATE)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_reservation_dup_guard IS
  'T-20260610-foot-RESV-DUPGUARD-SAMEDAY: 대시보드 예약 신규 생성 당일 동일고객 중복 가드(서버 권위).'
  ' clinic_id + (customer_id|phone) + reservation_date = p_date + status<>cancelled 조회.'
  ' duplicate=true 시 FE reject. 조회 전용(데이터 무변경). SELFCHECKIN-DUP-GUARD 정본 일관.';

COMMIT;

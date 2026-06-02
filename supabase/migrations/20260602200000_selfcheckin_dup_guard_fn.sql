-- T-20260602-foot-SELFCHECKIN-DUP-GUARD (P0)
-- 풋 셀프체크인 동일고객 당일 중복 접수 가드 — 서버 권위 RPC (1급 가드)
--
-- ─── 배경 ────────────────────────────────────────────────────────────────────
-- 같은 고객이 키오스크에서 두 번 접수 가능 → Dashboard 칸반 2장 + 큐번호 2개 발번.
-- Dashboard 중복 가드는 reservation_id 기준만 → 셀프체크인(reservation_id=null) 무방비.
-- check_ins UNIQUE 제약은 reservation_id 한정(unique_reservation_checkin) → 워크인 미커버.
--
-- ─── 함수 ────────────────────────────────────────────────────────────────────
-- fn_selfcheckin_dup_guard(p_clinic_id, p_customer_id, p_phone, p_today)
--   조회: clinic_id 일치 + (customer_id 또는 phone) 일치 + (created_at KST date)=p_today
--         + status NOT IN ('cancelled')
--   반환: jsonb { duplicate: bool, error_code: 'DUPLICATE_CHECKIN_TODAY'|null }
--   FE 는 duplicate=true 시 reject + "오늘 이미 접수되었습니다…" 표시 + 재시도 비활성.
--
-- ─── AC 매핑 ─────────────────────────────────────────────────────────────────
-- AC-1: customer_id 일치 당일 중복 → duplicate=true
-- AC-2: 워크인(phone 매칭) 중복도 동일 가드 — 전화번호 digits 정규화 비교 포함
-- AC-4: (created_at AT TIME ZONE 'Asia/Seoul')::date = p_today → 어제 접수는 제외(재접수 허용)
-- AC-5: status NOT IN ('cancelled') → 취소건은 카운트 제외(재접수 허용)
--
-- ─── 보안 ────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER + search_path 고정. anon 키오스크 호출 전제(GRANT anon).
-- clinic_id 스코프 강제 → cross-clinic 누출 없음. 반환은 boolean 판정만(PII 미반환).
--
-- ─── 견고성 ──────────────────────────────────────────────────────────────────
-- 형제 P0 SELF-LINK RPC 와 통합 가능하나, 본 가드는 독립 RPC 로 신설(단일 책임).
-- FE 는 본 RPC 미배포 시 fallback SELECT 로 강하(graceful degrade) — 양쪽 모두 동작.
--
-- ─── 리스크 ──────────────────────────────────────────────────────────────────
-- LOW: 조회 전용 함수(데이터 변경 없음). 거부는 graceful — 핵심경로 파괴 없음.
--
-- 롤백: 20260602200000_selfcheckin_dup_guard_fn.rollback.sql
-- ticket: T-20260602-foot-SELFCHECKIN-DUP-GUARD
-- author: dev-foot / 2026-06-02

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_selfcheckin_dup_guard(
  p_clinic_id   UUID,
  p_customer_id UUID,
  p_phone       TEXT,
  p_today       DATE
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
  SELECT EXISTS (
    SELECT 1
    FROM public.check_ins ci
    WHERE ci.clinic_id = p_clinic_id
      AND ci.status NOT IN ('cancelled')
      -- AC-4: KST 날짜 경계로 "오늘" 한정 (어제 접수 제외)
      AND (ci.created_at AT TIME ZONE 'Asia/Seoul')::date = p_today
      AND (
        -- customer_id 매칭 (AC-1)
        (p_customer_id IS NOT NULL AND ci.customer_id = p_customer_id)
        -- phone 매칭 (AC-2: 워크인/신규 customer_id 분기 시에도 잡음)
        OR (p_phone IS NOT NULL AND ci.customer_phone = p_phone)
        -- phone digits 정규화 매칭 (포맷 불일치 010-xxxx / +8210 / 01012345678 흡수)
        OR (
          v_phone_digits IS NOT NULL
          AND length(v_phone_digits) >= 10
          AND regexp_replace(COALESCE(ci.customer_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
        )
      )
  ) INTO v_exists;

  IF v_exists THEN
    RETURN jsonb_build_object('duplicate', true, 'error_code', 'DUPLICATE_CHECKIN_TODAY');
  END IF;

  RETURN jsonb_build_object('duplicate', false, 'error_code', NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selfcheckin_dup_guard(UUID, UUID, TEXT, DATE)
  TO anon, authenticated;

COMMENT ON FUNCTION public.fn_selfcheckin_dup_guard IS
  'T-20260602-foot-SELFCHECKIN-DUP-GUARD: 셀프체크인 당일 동일고객 중복 접수 가드(서버 권위).'
  ' clinic_id + (customer_id|phone) + created_at(KST date)=p_today + status<>cancelled 조회.'
  ' duplicate=true 시 FE reject. 조회 전용(데이터 무변경). AC-2 phone digits 정규화 매칭 포함.';

COMMIT;

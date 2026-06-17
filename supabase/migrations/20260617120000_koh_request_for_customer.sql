-- ============================================================
-- T-20260616-foot-KOH-BUTTON-ALL-CH
-- KOH 균검사 토글 = 체크인 내원 전원 노출(이력 무관) + ON 시 검사요청 신규 생성
-- ============================================================
-- reporter 김주연 총괄 확정(②): "피검사처럼 기본 고정값" → KOH 이력 무관 체크인 환자 전원에게
--   KOH 균검사 토글 노출(기본 OFF). 피검사(T-20260615-foot-BLOODTEST-TOGGLE-ADD, deployed 8d30bf64)
--   동형 = 이력무관 항상표시·기본 OFF. 단, KOH 는 균검사지 목록이 service_name ILIKE('%KOH%'|'%진균검사%')
--   행만 읽으므로(KohReportTab SSOT), 이력 없는 환자 ON 시 KOH 검사요청 행을 신규 생성해야 목록에 등장.
--
-- 본 마이그 = RPC 1건 신규(request_koh_for_customer). 테이블/컬럼/enum 무변경 → 파괴요소 0.
--   기존 check_in_services 컬럼만 사용(koh_requested = 20260615190000, ADDITIVE 旣적용).
--   data-architect 신규 CONSULT 불요: 신규 컬럼/테이블/enum 없음. 旣 set_koh_requested 동일 쓰기 패턴 위 확장.
--
-- RPC request_koh_for_customer(p_customer_id uuid, p_value boolean) — 토글 단일 진입점:
--   ① KOH 보유 내원 존재 → 그 환자의 KOH service 보유 '가장 최근 내원'(NOTRENDER fix 동일 타겟)의
--      KOH service 전체 koh_requested 동기화. = 旣 동작 보존(시나리오2 회귀 없음).
--   ② KOH 이력 없음 + ON → 가장 최근 non-cancelled 내원에 KOH 검사요청 행 신규 INSERT(koh_requested=true).
--      service 카탈로그에 KOH 서비스 있으면 service_id 연결, 없으면 정본 명칭(report ILIKE 매칭) 무연결 생성.
--      price=0 = 검사 '요청' 마커(매출·패키지 비귀속, 청구는 별도 결제창). is_package_session=false.
--   ③ KOH 이력 없음 + OFF → no-op(해제할 대상 없음).
--   승인 사용자 게이트(set_koh_requested 동형, 치료사 포함 한 동작만). SECURITY DEFINER → RLS 우회.
--
-- 롤백: 20260617120000_koh_request_for_customer.rollback.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION request_koh_for_customer(p_customer_id uuid, p_value boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_checkin uuid;
  v_clinic         uuid;
  v_svc_id         uuid;
  v_svc_name       text;
BEGIN
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'not authorized: koh request requires approved user'
      USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id required' USING ERRCODE = '22004';
  END IF;

  -- ── ① KOH service 보유 내원 중 가장 최근(NOTRENDER fix 와 동일 타겟팅) ──
  --   같은 내원의 KOH service 만 묶어 동기화(타 내원 KOH 는 섞지 않음 = 旣 단위 보존).
  SELECT cis.check_in_id INTO v_target_checkin
    FROM check_in_services cis
    JOIN check_ins ci ON ci.id = cis.check_in_id
   WHERE ci.customer_id = p_customer_id
     AND ci.status <> 'cancelled'
     AND (cis.service_name ILIKE '%KOH%' OR cis.service_name ILIKE '%진균검사%')
   ORDER BY cis.created_at DESC
   LIMIT 1;

  IF v_target_checkin IS NOT NULL THEN
    UPDATE check_in_services
       SET koh_requested = COALESCE(p_value, false)
     WHERE check_in_id = v_target_checkin
       AND (service_name ILIKE '%KOH%' OR service_name ILIKE '%진균검사%');
    RETURN COALESCE(p_value, false);
  END IF;

  -- ── ② / ③ KOH 이력 없음 ──
  IF NOT COALESCE(p_value, false) THEN
    RETURN false;  -- OFF: 해제할 대상 없음 → no-op
  END IF;

  -- ON: 가장 최근 non-cancelled 내원에 KOH 검사요청 신규 생성(시나리오1)
  SELECT ci.id, ci.clinic_id INTO v_target_checkin, v_clinic
    FROM check_ins ci
   WHERE ci.customer_id = p_customer_id
     AND ci.status <> 'cancelled'
   ORDER BY ci.created_at DESC
   LIMIT 1;

  IF v_target_checkin IS NULL THEN
    RAISE EXCEPTION '내원(체크인) 기록이 없어 KOH 검사를 신청할 수 없습니다'
      USING ERRCODE = 'P0002';
  END IF;

  -- 카탈로그 KOH 서비스 해석(있으면 service_id 연결, 없으면 정본 명칭으로 무연결 생성)
  --   report 매칭 정본명 = '일반진균검사-KOH도말-조갑조직'('진균검사' 포함 → ILIKE 매칭).
  SELECT s.id, s.name INTO v_svc_id, v_svc_name
    FROM services s
   WHERE s.clinic_id = v_clinic
     AND s.active = true
     AND (s.name ILIKE '%KOH%' OR s.name ILIKE '%진균검사%')
   ORDER BY s.sort_order NULLS LAST, s.created_at
   LIMIT 1;

  IF v_svc_name IS NULL THEN
    v_svc_name := '일반진균검사-KOH도말-조갑조직';
  END IF;

  INSERT INTO check_in_services (
    check_in_id, service_id, service_name, price, original_price,
    is_package_session, koh_requested
  ) VALUES (
    v_target_checkin, v_svc_id, v_svc_name, 0, 0,
    false, true
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION request_koh_for_customer(uuid, boolean) IS
  'KOH 균검사 토글 단일 진입점(승인 사용자 누구나). ① KOH 보유 내원 = 旣 set_koh_requested 동형 동기화(시나리오2 보존). ② 이력없음+ON = 최근 내원에 KOH 검사요청 신규 INSERT(price=0 마커). ③ 이력없음+OFF = no-op. (T-20260616-foot-KOH-BUTTON-ALL-CH)';

REVOKE ALL ON FUNCTION request_koh_for_customer(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_koh_for_customer(uuid, boolean) TO authenticated;

-- ── 검증 ──
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='request_koh_for_customer'
       AND p.prosecdef = true
  ) THEN RAISE EXCEPTION 'request_koh_for_customer RPC(SECURITY DEFINER) 생성 실패'; END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'request_koh_for_customer(uuid, boolean)', 'EXECUTE')
  THEN RAISE EXCEPTION 'authenticated EXECUTE 권한 부여 실패'; END IF;

  RAISE NOTICE 'T-20260616-foot-KOH-BUTTON-ALL-CH: request_koh_for_customer RPC 검증 통과';
END
$verify$;

COMMIT;

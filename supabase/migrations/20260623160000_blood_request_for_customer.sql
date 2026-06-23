-- ============================================================
-- T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION
-- 피검사 토글 = 단독 검사신청 차단 해소(서비스 행 없어도 신청) — KOH 패턴 1:1 미러
-- ============================================================
-- reporter 김주연 총괄 확정: "피검사/KOH 검사 신청 시스템으로 제약 걸지마, 현장 실장이 판단해 신청"
--   → 단독 검사신청 = 정상 업무. 旣 prod 의 request_koh_for_customer(20260617120000) 를 피검사에 1:1 미러.
--   기존 차단점: BloodTestRequestToggle L142 svcs.length===0 게이트 + FE 행별 루프(set_blood_test_requested).
--   해소: 서버 SSOT 단일 RPC(request_blood_test_for_customer) — 이력없음+ON 시 서버가 신규행 자동생성.
--
-- 본 마이그 = RPC 1건 신규(request_blood_test_for_customer). 테이블/컬럼/enum 무변경 → 파괴요소 0.
--   기존 check_in_services.blood_test_requested(20260617000000, ADDITIVE 旣적용)만 사용.
--   신규 컬럼/테이블/enum 없음 → §S2.4 신규-스키마 CONSULT 불요. 旣 승인패턴(request_koh_for_customer) 미러.
--   주의(data-architect CONSULT 게이트): ② 자동생성 행의 청구·통계 이중계상 가능성 → price=0 마커로
--     매출·패키지 비귀속(is_package_session=false). prod 적용은 data-architect CONSULT GO 후.
--
-- RPC request_blood_test_for_customer(p_customer_id uuid, p_value boolean) — 토글 단일 진입점:
--   ① 서비스 행 보유 내원 존재 → 그 환자의 '가장 최근 서비스 보유 내원'의 서비스 행 전체 blood_test_requested 동기화.
--      = 旣 FE 행별 루프 동작 보존(피검사는 service_name 필터 없음 — KohRequestToggle L9~10 규칙: 최근 내원 서비스 행 전체 타겟).
--   ② 서비스 행 없음 + ON → 가장 최근 non-cancelled 내원에 피검사 요청 행 신규 INSERT(blood_test_requested=true).
--      price=0 = 검사 '요청' 마커(매출·패키지 비귀속). is_package_session=false. service_id 무연결(피검사 전용 카탈로그 부재).
--   ③ 서비스 행 없음 + OFF → no-op(해제할 대상 없음).
--   승인 사용자 게이트(set_blood_test_requested 동형, 치료사 포함 한 동작만). SECURITY DEFINER → RLS 우회.
--
-- 롤백: 20260623160000_blood_request_for_customer.rollback.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION request_blood_test_for_customer(p_customer_id uuid, p_value boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_checkin uuid;
BEGIN
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'not authorized: blood test request requires approved user'
      USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id required' USING ERRCODE = '22004';
  END IF;

  -- ── ① 서비스 행 보유 내원 중 가장 최근(피검사는 service_name 필터 없음 — 최근 내원 서비스 행 전체 타겟) ──
  --   같은 내원의 서비스 행 전체를 동기화(타 내원은 섞지 않음 = 旣 FE 동기화 단위 보존).
  SELECT cis.check_in_id INTO v_target_checkin
    FROM check_in_services cis
    JOIN check_ins ci ON ci.id = cis.check_in_id
   WHERE ci.customer_id = p_customer_id
     AND ci.status <> 'cancelled'
   ORDER BY cis.created_at DESC
   LIMIT 1;

  IF v_target_checkin IS NOT NULL THEN
    UPDATE check_in_services
       SET blood_test_requested = COALESCE(p_value, false)
     WHERE check_in_id = v_target_checkin;
    RETURN COALESCE(p_value, false);
  END IF;

  -- ── ② / ③ 서비스 행 없음 ──
  IF NOT COALESCE(p_value, false) THEN
    RETURN false;  -- OFF: 해제할 대상 없음 → no-op
  END IF;

  -- ON: 가장 최근 non-cancelled 내원에 피검사 요청 신규 생성(단독 검사신청)
  SELECT ci.id INTO v_target_checkin
    FROM check_ins ci
   WHERE ci.customer_id = p_customer_id
     AND ci.status <> 'cancelled'
   ORDER BY ci.created_at DESC
   LIMIT 1;

  IF v_target_checkin IS NULL THEN
    RAISE EXCEPTION '내원(체크인) 기록이 없어 피검사를 신청할 수 없습니다'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO check_in_services (
    check_in_id, service_id, service_name, price, original_price,
    is_package_session, blood_test_requested
  ) VALUES (
    v_target_checkin, NULL, '혈액검사(피검사)', 0, 0,
    false, true
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION request_blood_test_for_customer(uuid, boolean) IS
  '피검사 토글 단일 진입점(승인 사용자 누구나). ① 서비스 행 보유 내원 = 최근 내원 서비스 행 전체 동기화(旣 FE 루프 보존). ② 서비스행없음+ON = 최근 내원에 피검사 요청 신규 INSERT(price=0 마커). ③ 서비스행없음+OFF = no-op. request_koh_for_customer 1:1 미러. (T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION)';

REVOKE ALL ON FUNCTION request_blood_test_for_customer(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_blood_test_for_customer(uuid, boolean) TO authenticated;

-- ── 검증 ──
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='request_blood_test_for_customer'
       AND p.prosecdef = true
  ) THEN RAISE EXCEPTION 'request_blood_test_for_customer RPC(SECURITY DEFINER) 생성 실패'; END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'request_blood_test_for_customer(uuid, boolean)', 'EXECUTE')
  THEN RAISE EXCEPTION 'authenticated EXECUTE 권한 부여 실패'; END IF;

  RAISE NOTICE 'T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION: request_blood_test_for_customer RPC 검증 통과';
END
$verify$;

COMMIT;

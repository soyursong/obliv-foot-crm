-- T-20260725-foot-DESIGNPT-THERAPIST-ROLE-WRITEBLOCK — 지정(담당) 치료사 쓰기 백엔드 강제 (컬럼 레벨 write-guard)
--
-- 요청(김주연 총괄, U0ATDB587PV, 2026-07-25): "2번차트 2구역 지정 치료사 지정, 치료사(therapist) 계정은 설정 불가."
--
-- ── 왜 트리거(storage boundary)인가 ──
--   FE 게이트(CustomerChartPage canEditDesignatedTherapist = {consultant,coordinator,admin,manager})는
--   T-20260722-foot-DESIG-THERAPIST-ROLE-GATE 로 이미 therapist 를 disabled 처리. 그러나 이는 화면 숨김/비활성일 뿐
--   API 직접 호출(치료사 세션 토큰 → customers.update({designated_therapist_id}))은 여전히 통과한다.
--     ↳ 구멍 출처: 20260620120000_staff_perm_unlock_6menu_rls_additive.sql 의 customers_therap_update_6menu 정책이
--       therapist 에게 customers 전체 UPDATE(모든 컬럼, clinic-scoped)를 부여 → designated_therapist_id 도 포함.
--   RLS 는 row-level 이라 "특정 컬럼만 차단" 이 어렵다(therapist 의 이름/전화 등 다른 컬럼 write 는 유지해야 함 = 6menu).
--   ∴ 컬럼 레벨 write-guard 트리거(BEFORE UPDATE OF designated_therapist_id)로 designated_therapist_id "값 변경"만
--     허용 role 외에는 구조적으로 거부한다. write-path(FE/REST/RPC/역동기화) 무관하게 강제 → GO_WARN 우회 방지 충족.
--   선례 패턴: user_profiles_self_guard(20260426000000, role/approved/clinic_id 컬럼 변경 트리거 차단),
--             fn_name_nfc_writeguard(20260721150000, 저장 경계 컬럼 가드).
--
-- ── 허용 role (FE canEditDesignatedTherapist 와 1:1 parity) ──
--   allowed = {admin, manager, consultant, coordinator}
--   차단 = {therapist, technician, director, staff, part_lead, tm, 기타}
--     · therapist = 본 요청의 직접 대상.
--     · director/staff/part_lead/tm 도 FE 에서 read-only(T-20260722 spec SC-2 director/therapist disabled 명시) → 백엔드 parity.
--   NULL role(service_role/백엔드/SECURITY DEFINER 컨텍스트, auth.uid() 없음) = 허용 →
--     data-correction 스크립트(T-20260714-REVENUE-THERAPIST-DESIGNPT-RESET 등 service_role)·시스템 write 무저촉.
--     anon 은 customers UPDATE 자체가 RLS 차단(anon 정책 없음) → 트리거 미도달.
--
-- ── 안전 성질 ──
--   · ADDITIVE — 신규 트리거/함수만. 컬럼/테이블/enum 추가 0(data-architect 게이트 N/A). 기존 데이터 미변경.
--   · 값 무변경(IS DISTINCT FROM 가드) 시 no-op → 허용 role 정상 저장 + therapist 의 designated 미포함 customers write 무영향.
--   · BEFORE UPDATE OF designated_therapist_id → 해당 컬럼이 SET 목록에 없으면 트리거 미발화(therapist 6menu 다른 컬럼 write 유지).
--   · RAISE ERRCODE 42501(insufficient_privilege) → PostgREST 403 매핑. FE saveDesignatedTherapist 는 error 토스트로 이미 처리.
--   · 멱등 — CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE.
--
-- Rollback: 20260802120000_customers_designated_therapist_writeguard.rollback.sql
-- cross-CRM 영향: designated_therapist_id 는 foot-로컬 컬럼(cross_crm_data_contract 미등재). 영향 0.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_designated_therapist_writeguard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- designated_therapist_id 값이 실제로 바뀌는 경우에만 권한 검사 (동일값 재저장·미포함 = no-op)
  IF NEW.designated_therapist_id IS DISTINCT FROM OLD.designated_therapist_id THEN
    v_role := current_user_role();
    -- NULL(service_role/시스템 컨텍스트) 은 허용. 알려진 비허용 role 은 차단.
    IF v_role IS NOT NULL
       AND v_role NOT IN ('admin', 'manager', 'consultant', 'coordinator') THEN
      RAISE EXCEPTION '지정 치료사는 관리자/실장/상담실장/코디만 변경할 수 있습니다 (요청 role=%)', v_role
        USING ERRCODE = '42501';  -- insufficient_privilege → PostgREST 403
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_designated_therapist_writeguard() OWNER TO postgres;

COMMENT ON FUNCTION public.fn_designated_therapist_writeguard() IS
  'customers.designated_therapist_id 컬럼 레벨 write-guard. 값 변경은 {admin,manager,consultant,coordinator} 만 허용(FE canEditDesignatedTherapist parity). therapist 등은 42501 거부. NULL role(service_role)은 허용. T-20260725-foot-DESIGNPT-THERAPIST-ROLE-WRITEBLOCK.';

DROP TRIGGER IF EXISTS trg_designated_therapist_writeguard ON public.customers;
CREATE TRIGGER trg_designated_therapist_writeguard
  BEFORE UPDATE OF designated_therapist_id ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_designated_therapist_writeguard();

COMMENT ON TRIGGER trg_designated_therapist_writeguard ON public.customers IS
  'T-20260725-foot-DESIGNPT-THERAPIST-ROLE-WRITEBLOCK: 지정 치료사 쓰기 백엔드 강제(치료사 계정 API 우회 차단). FE 게이트 T-20260722 의 서버 parity.';

COMMIT;

-- ============================================================
-- 침투테스트 (apply 후 supervisor 수동 확인용, 실행하지 않음)
-- ============================================================
-- ① therapist 세션 토큰 → UPDATE customers SET designated_therapist_id = '<staff>' WHERE id = '<cust>';
--    기대: ERROR 42501 (거부). row 0 변경.
-- ② consultant/coordinator/admin/manager 세션 → 동일 UPDATE → 성공, 값 반영.
-- ③ therapist 세션 → UPDATE customers SET phone='...' (designated 미포함) → 성공(6menu 유지, 트리거 미발화).
-- ④ therapist 세션 → UPDATE customers SET designated_therapist_id = <기존과 동일값> → 성공(no-op, IS DISTINCT FROM=false).
-- ⑤ service_role → UPDATE designated_therapist_id → 성공(data-correction 무저촉).

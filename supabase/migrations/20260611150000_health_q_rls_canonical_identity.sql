-- T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE
-- 발건강질문지 제출 내역이 직원(coordinator 등) 계정에서 "제출된 질문지가 없습니다"(0건)로
-- 표시되는 버그 수정. (관리자 정상, 직원 0건)
--
-- ── 확정 RC (진단 read-only, scripts/..._diag.mjs / _diag2.mjs) ──
--   health_q_results / health_q_tokens 의 SELECT RLS 정책만 유일하게 "비정규" 신원 소스
--   (staff.user_id = auth.uid()) 를 사용. 나머지 환자데이터 테이블(customers/check_ins 등)은
--   정규 신원 소스(user_profiles 기반 is_approved_user() / current_user_clinic_id())를 사용.
--   로그인 신원은 user_profiles 기준인데 staff.user_id 는 희소(coordinator 6명 중 다수 미연결).
--   → coordinator 는 user_profiles row 가 있어 차트(customers/check_ins)는 보이지만,
--     health_q_results/tokens 는 staff.user_id 미매칭으로 SELECT 0건 → "없음" 표시.
--   ★ 티켓 본문의 1차 RC 가설("정책이 admin role 만 허용")은 실제 정책에 role 필터가
--     아예 없으므로 반증됨. 실제 RC = 비정규 신원 소스(staff.user_id) outlier. ★
--
-- ── 수정 ──
--   두 테이블의 SELECT 정책을 정규 패턴으로 전환:
--     is_approved_user()            → user_profiles 기반(approved+active 전 role, admin·coordinator·therapist 포함)
--     AND clinic_id = current_user_clinic_id()  → clinic 스코프 명시 유지(PHI 비확장)
--
-- ── AC 매핑 ──
--   AC-1: coordinator(및 직원 role) → 동일 clinic health_q_results SELECT 정상 반환
--   AC-2: 김상곤 차트 발건강질문지 제출내역(2026-06-10, 12항목) 관리자와 동일 표시
--   AC-3: SELECT 정책만 변경. INSERT/UPDATE/DELETE 미접촉(쓰기 권한 불변, READ-only).
--   AC-4: clinic_id = current_user_clinic_id() 로 단일 clinic 스코프 유지 → 타 clinic row 차단(PHI 비확장).
--         (기존 IN(staff subquery) 대비 오히려 더 엄격하게 단일 clinic 고정)
--   AC-5: customers/check_ins 등 기존 정책 미접촉, 동일 헬퍼 재사용 → 회귀 없음.
--
-- 멱등(idempotent): DROP POLICY IF EXISTS 후 재생성.
-- Rollback: 20260611150000_health_q_rls_canonical_identity.rollback.sql
-- 운영 적용: ★supervisor DB 게이트★ (PHI 노출범위 관련 RLS 변경)

BEGIN;

-- ─── health_q_results SELECT: 비정규(staff.user_id) → 정규(user_profiles + clinic 스코프) ───
DROP POLICY IF EXISTS hq_results_staff_select ON health_q_results;
CREATE POLICY hq_results_staff_select ON health_q_results
  FOR SELECT
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

COMMENT ON POLICY hq_results_staff_select ON health_q_results IS
  'T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE: 정규 신원 소스(user_profiles) 전환.
   approved+active 직원이 본인 clinic 의 제출 결과 SELECT. READ-only. clinic 스코프 유지.';

-- ─── health_q_tokens SELECT: 동일 outlier 수정 (HealthQResultsPanel reopen 토큰 조회) ───
-- 동일 RC·동일 패널(loadReopenToken)이라 coordinator 의 reopen 토큰 조회도 동일하게 깨짐 → 함께 정규화.
DROP POLICY IF EXISTS hq_tokens_staff_select ON health_q_tokens;
CREATE POLICY hq_tokens_staff_select ON health_q_tokens
  FOR SELECT
  USING (
    is_approved_user()
    AND clinic_id = current_user_clinic_id()
  );

COMMENT ON POLICY hq_tokens_staff_select ON health_q_tokens IS
  'T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE: 정규 신원 소스(user_profiles) 전환.
   approved+active 직원이 본인 clinic 토큰 SELECT. READ-only. clinic 스코프 유지.';

-- 주의: health_q_tokens INSERT 정책(hq_tokens_staff_insert)은 미접촉(쓰기 권한 불변, AC-3).
--       health_q_results INSERT 은 fn_health_q_submit(SECURITY DEFINER, anon RPC) 경유라 RLS 무관.

COMMIT;

-- ─── 검증 쿼리 (apply 후 supervisor 수동 확인용) ───
-- 1) 정책 정의 확인:
--    SELECT policyname, cmd, qual FROM pg_policies
--      WHERE schemaname='public' AND tablename IN ('health_q_results','health_q_tokens') AND cmd='SELECT';
--    → USING 에 is_approved_user() AND (clinic_id = current_user_clinic_id()) 확인.
-- 2) INSERT/UPDATE/DELETE 정책 불변 확인:
--    SELECT policyname, cmd FROM pg_policies
--      WHERE schemaname='public' AND tablename IN ('health_q_results','health_q_tokens') ORDER BY cmd;
--    → hq_tokens_staff_insert(INSERT) 그대로 존재, results 에 신규 쓰기 정책 없음 확인.

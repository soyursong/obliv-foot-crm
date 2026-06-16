-- ============================================================
-- T-20260615-foot-BLOODTEST-TOGGLE-ADD
-- 피검사(혈액검사) ON/OFF 토글 — 단순 신청 플래그(🅑 스코프)
-- ============================================================
-- data-architect CONSULT ADDITIVE-GO (MSG-20260616-204655-neg5 canonical ⟸ MSG-20260616-131713-3fyk).
--   KOH 플래그(set_koh_requested, 20260615190000) 1:1 미러. 대표 게이트 면제(autonomy §3.1) — supervisor DDL-diff만.
--
-- 본 마이그 = ADDITIVE only. 파괴요소(DROP·타입변경·기존 enum 제거) 0.
--   1. check_in_services.blood_test_requested boolean (AC-2) — koh_requested 동형·동일 테이블·동일 grain.
--      NOT NULL DEFAULT false → 기존 행 즉시 백필(전부 미신청), 회귀 0, backfill 불요.
--   2. set_blood_test_requested RPC (AC-2) — set_koh_requested 1:1 동형(승인사용자·한 필드, is_approved_user 게이트).
--
-- 결과지/목록탭/발행 RPC 없음(🅑 스코프, AC-4). 단일 boolean만 — 상태 컬럼 별도 신설 금지(KOH 2-플래그 drift 선례 기각).
-- cross_crm 영향 0: check_in_services.*_requested 는 foot-internal 운영 플래그(cross-CRM 조인/집계 키 아님).
--
-- da_refactor_trigger(frontmatter): 검사종류 boolean 2개째(koh+blood). 3번째 플래그 요청 시
--   별개 boolean 누적 중단 → 정규화(child table / requested_tests text[]) 전환 검토. schema_registry 등재=DA 소관.
--
-- 롤백: 20260617000000_blood_test_requested.rollback.sql
-- ============================================================

BEGIN;

-- ── 1. AC-2: 피검사 신청 플래그 (check_in_services 호스트, koh_requested 동형 ADDITIVE) ──
--   ADDITIVE: DEFAULT false → 기존 행 즉시 백필(전부 미신청), 신규 쓰기 무영향.
ALTER TABLE check_in_services
  ADD COLUMN IF NOT EXISTS blood_test_requested boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN check_in_services.blood_test_requested IS
  '피검사(혈액검사) 신청 플래그(AC-2). ON=신청/OFF=미신청(행 유지·회색). 단일 boolean으로 표현(별도 상태 컬럼 신설 금지, DA 권고·KOH 2-플래그 drift 선례 기각). 2번차트 패키지탭 KOH 토글 하단 토글로 set_blood_test_requested 통해 쓰기. koh_requested 1:1 미러. (T-20260615-foot-BLOODTEST-TOGGLE-ADD)';

-- ── 2. AC-2: 신청 플래그 쓰기 RPC (set_koh_requested 1:1 동형) ──
--   check_in_services UPDATE RLS(admin/manager/consultant) 우회 — 승인 사용자 누구나(치료사 포함) '한 필드'만.
--   가격/패키지 등 기존 쓰기 격리 무손상(테이블 RLS 확대 금지, role_separation E.11).
CREATE OR REPLACE FUNCTION set_blood_test_requested(p_check_in_service_id uuid, p_value boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new boolean;
BEGIN
  IF NOT is_approved_user() THEN
    RAISE EXCEPTION 'not authorized: blood_test_requested write requires approved user'
      USING ERRCODE = '42501';
  END IF;

  UPDATE check_in_services
     SET blood_test_requested = COALESCE(p_value, false)
   WHERE id = p_check_in_service_id
  RETURNING blood_test_requested INTO v_new;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'check_in_services row not found: %', p_check_in_service_id;
  END IF;

  RETURN v_new;
END;
$$;

COMMENT ON FUNCTION set_blood_test_requested(uuid, boolean) IS
  '피검사 신청 플래그 쓰기(승인 사용자 누구나, 한 필드만). check_in_services UPDATE RLS(consultant+) 우회용 정의자 RPC. set_koh_requested 1:1 동형. (T-20260615-foot-BLOODTEST-TOGGLE-ADD)';

REVOKE ALL ON FUNCTION set_blood_test_requested(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_blood_test_requested(uuid, boolean) TO authenticated;

-- ── 검증 ──
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='check_in_services' AND column_name='blood_test_requested')
  THEN RAISE EXCEPTION 'blood_test_requested 컬럼 생성 실패'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='set_blood_test_requested')
  THEN RAISE EXCEPTION 'set_blood_test_requested RPC 생성 실패'; END IF;

  RAISE NOTICE 'T-20260615-foot-BLOODTEST-TOGGLE-ADD: 스키마 2건 ADDITIVE 검증 통과';
END
$verify$;

COMMIT;

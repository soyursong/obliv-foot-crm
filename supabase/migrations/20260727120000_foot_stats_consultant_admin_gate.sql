-- ============================================================
-- T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK §2 (서버사이드 no-read-up 게이트)
--   실장별 매출·랭킹(민감정보)을 admin/manager/director 전용으로 서버 레벨 잠금.
--   DA-20260726-FOOT-RANKING-ADMINLOCK verdict = GO(Opt A) · ADDITIVE
--   (대표 게이트 면제 / supervisor DDL-diff·DB-gate 의무).
--   SSOT: 1_Projects/201_메디빌더_AI도입/da_decision_foot_ranking_tab_adminlock_server_gate_20260726.md
-- DB   : rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성 : dev-foot / 2026-07-27
-- 롤백 : 20260727120000_foot_stats_consultant_admin_gate.rollback.sql
-- dry  : 20260727120000_foot_stats_consultant_admin_gate.dryrun.mjs (무영속 검증)
-- 표준 : Migration Ledger Reconciliation / Migration Dry-Run No-Persistence Protocol
--
-- ─── DA verdict Opt A 그대로 (구현 매핑) ─────────────────────────────────────────
--   DA reply 는 데이터소스를 'foot_stats_consultant=VIEW(INVOKER)'로 기술했으나 prod 실재는
--   동명 FUNCTION(LANGUAGE sql / SECURITY INVOKER / GRANT authenticated). 실체가 함수라도
--   Opt A 의 두 축(① admin-gated SECDEF RPC 신설 ② 하위 데이터소스 authenticated GRANT 회수)은
--   그대로 성립 — VIEW→FUNCTION 은 표기 정합만, 판정 envelope 불변(re-consult 불요).
--   ⇒ ① 신규 admin-gated SECDEF 래퍼 `foot_stats_consultant_admin` 를 유일 진입점으로 신설,
--      ② 기존 `foot_stats_consultant` 의 `authenticated` EXECUTE 회수(래퍼=owner postgres 로만 호출).
--   기존 함수 본문(복잡한 매출귀속 CTE: pkg_attr/single_direct/single_cust 등)은 SSOT 로 무접촉
--   재사용(재발명 금지 / drift 0) — 래퍼가 RETURN QUERY 로 위임(DA 조건#4 '흡수'=중복 아닌 위임).
--
-- ─── DA 하드닝 5조건 (supervisor DDL-diff 검증 포인트) ───────────────────────────
--   #1 anon/PUBLIC EXECUTE 차단 : 래퍼 REVOKE ALL FROM PUBLIC + GRANT authenticated 만.
--   #2 SECDEF 하이재킹 하드닝    : SET search_path = public, pg_temp.
--   #3 fail-closed 진입 검사     : 함수 최상단·데이터 접근 이전 IF NOT is_admin_or_manager()
--                                  THEN RAISE EXCEPTION ERRCODE='42501' (빈 응답 아닌 명시 거부
--                                  → 시나리오2 데이터 유출 0).
--   #4 sole-consumer 증명       : `foot_stats_consultant` 의 authenticated 소비자 = FE
--                                  fetchConsultantPerf() 단일(src 전수 grep: Stats.tsx 매출탭 +
--                                  Assignments.tsx 랭킹탭, 둘 다 admin/manager/director 게이트,
--                                  EF 호출자 0). 본 마이그와 동반 FE 커밋이 fetchConsultantPerf 를
--                                  래퍼로 reroute → 잔여 authenticated 직접 소비자 0 → 회수 안전.
--   #5 clinic 스코프 불변        : role 판정(is_admin_or_manager)은 clinic row 개방 안 함.
--                                  foot 단일 clinic + 하위 함수 p_clinic_id 스코프 그대로.
--
-- ─── role 판정 = 기존 canonical 재사용 (Q3) ─────────────────────────────────────
--   foot 의 canonical 권위원천 = `is_admin_or_manager()` (SECDEF, current_user_role()→user_profiles
--   테이블 read; JWT app_metadata 스칼라 아님) = {admin,manager,director}. director 커버 확인:
--   prod user_profiles.role enum 에 director 실재(2행, 2026-07-27 introspection). 신규 role
--   enum·JWT 스칼라·임의 RLS 신설 0. DA reply 의 'user_roles + has_role' 는 cross-CRM 총칭 —
--   foot 등가 canonical = is_admin_or_manager()(=admin/manager/director, 권위원천 동일 성질).
--
-- ─── 안전성 (게이트: autonomy §3.1 대표게이트 면제, supervisor DDL-diff 만) ─────────
--   테이블/데이터/enum/컬럼 write 0. 신규 함수 1개 추가(ADDITIVE) + 기존 함수 GRANT 축소(회수)
--   = 노출 축소 방향(파괴적 아님). 반환형/본문/기존 함수 시맨틱 불변(회귀 0).
-- ============================================================

BEGIN;

-- ① admin-gated SECDEF 래퍼 (유일 진입점). 반환형 = foot_stats_consultant 와 byte-동일.
CREATE OR REPLACE FUNCTION public.foot_stats_consultant_admin(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  consultant_id            UUID,
  name                     TEXT,
  ticketing_count          INT,
  package_count            INT,
  avg_amount               BIGINT,
  total_amount             BIGINT,
  consulted_customer_count INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- #3 fail-closed: 데이터 접근 이전 관리자 판정. 비admin(consultant/coordinator/therapist/tm/staff/
  --    part_lead/미승인/anon)은 명시 거부(42501) — 빈 응답 아님(유출 0). canonical=is_admin_or_manager().
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION '실장 랭킹·매출은 관리자(admin/manager/director) 전용입니다.'
      USING ERRCODE = '42501';
  END IF;

  -- 통과분(admin/manager/director)만 하위 SSOT 함수(매출귀속 CTE)를 위임 호출.
  --   래퍼=SECDEF(owner postgres) → authenticated 회수된 하위 함수 EXECUTE 유지.
  --   하위 함수는 SECURITY INVOKER 이나 auth.uid()(요청 JWT sub)는 SECDEF 로 role 전환돼도
  --   불변 → payments RLS(is_approved_user)는 원 admin 기준 통과(정상 소비경로 무회귀).
  RETURN QUERY
    SELECT * FROM public.foot_stats_consultant(p_clinic_id, p_from, p_to);
END;
$$;

-- #1 anon/PUBLIC EXECUTE 차단 + authenticated 만 진입(내부 fail-closed 가 실 admin 판정).
REVOKE ALL     ON FUNCTION public.foot_stats_consultant_admin(UUID, DATE, DATE) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.foot_stats_consultant_admin(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.foot_stats_consultant_admin(UUID, DATE, DATE)
  IS 'foot-stats ADMIN-GATED 진입점(T-20260726-foot-CRM-ASSIGN-RANKING-TAB-ADMINLOCK §2 / DA-20260726-FOOT-RANKING-ADMINLOCK Opt A). 실장별 매출·랭킹(민감)을 admin/manager/director 전용 서버 게이트(fail-closed 42501). SECDEF+search_path pin. 매출귀속 로직은 하위 foot_stats_consultant(SSOT) 를 RETURN QUERY 위임(재발명 금지). 하위 함수는 authenticated EXECUTE 회수됨 → 본 래퍼가 유일 진입.';

-- ② sole-consumer(FE fetchConsultantPerf) reroute 동반 → 하위 함수 authenticated 직접 호출 회수.
--    anon/PUBLIC 은 애초 미부여(회귀 방지 위해 명시 유지). postgres/service_role EXECUTE 는 불변
--    (래퍼 owner 호출 경로 보존). = 비admin 이 supabase.rpc('foot_stats_consultant',...) 직접
--    호출 시 42501/권한오류(no-read-up 서버 완결).
REVOKE EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM authenticated;

COMMIT;

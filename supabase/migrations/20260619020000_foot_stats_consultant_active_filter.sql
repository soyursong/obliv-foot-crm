-- ============================================================
-- T-20260619-foot-STATS-CATEGORY-MANAGER-SOURCE-FIX (파트2)
-- 통계 > 실장별 실적 ↔ 직원관리 명단(SSOT) 연동:
--   foot_stats_consultant 가 staff 명단을 집계할 때 재직 필터를 안 걸어
--   퇴사자(정혜인, staff.active=false)가 노출됨.
--   ⇒ 최종 SELECT WHERE 절에 COALESCE(s.active, true) = true 추가.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-19
-- 롤백: 20260619020000_foot_stats_consultant_active_filter.rollback.sql
--
-- ── canon 정합 ─────────────────────────────────────────────
--   T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX(deployed) 의
--   "staff = 직원관리 명단" 원칙을 통계화면으로 확장.
--   직원관리 명단 SSOT = public.staff, "퇴사 처리" = staff.active=false.
--   (출처: src/pages/Staff.tsx L167 `if (!showInactive && !s.active) continue;`,
--          L192 `update({ active: false })`)
--
-- ── DB 변경 성격 (게이트 판정) ─────────────────────────────
--   테이블 DDL 아님. RPC 함수(CREATE OR REPLACE FUNCTION) WHERE 절에
--   재직 필터 1줄 추가 = ADDITIVE(퇴사자 제외, 신규 컬럼/테이블/enum 0).
--   ⇒ data-architect CONSULT 불요. supervisor DDL-diff(함수 diff)만으로 진행.
--   ⇒ 테이블 스키마/데이터 변경 0, 즉시 역전 가능.
--
-- ── AC3 과거 실적 귀속 (reporter 확인 대상) ────────────────
--   본 마이그는 active=false 실장을 명단에서 "완전 제외"(현장 요청 기본값).
--   과거 기간 조회 시 그 기간에 실적이 있던 퇴사자도 미표시됨.
--   현장 요청("재직자만 표시")에 부합하는 1차안. reporter(김주연 총괄) 확인 게이트.
--
-- ── 함수 본문 동일성 ───────────────────────────────────────
--   20260430110000_foot_stats_consultant_fix.sql 정의와 100% 동일,
--   최종 SELECT WHERE 절에 `AND COALESCE(s.active, true) = true` 1줄만 추가.
--   반환 시그니처 불변 → FE(ConsultantSection/fetchConsultantPerf/ConsultantRow) 변경 0.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION foot_stats_consultant(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  consultant_id   UUID,
  name            TEXT,
  ticketing_count INT,
  package_count   INT,
  avg_amount      BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ticketed AS (
    SELECT DISTINCT
      ci.id AS check_in_id,
      ci.consultant_id
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
      AND st.to_status = 'consultation'
  ),
  -- 패키지당 가장 이른 ticketed check_in 하나에만 패키지 결제 귀속 (이중 카운트 방지)
  pkg_once AS (
    SELECT DISTINCT ON (ci.package_id)
      ci.id          AS check_in_id,
      ci.package_id
    FROM check_ins ci
    JOIN ticketed t ON t.check_in_id = ci.id
    WHERE ci.package_id IS NOT NULL
    ORDER BY ci.package_id, ci.checked_in_at ASC
  ),
  pkg_rev AS (
    SELECT
      po.check_in_id,
      SUM(CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END) AS pkg_rev
    FROM pkg_once po
    JOIN package_payments pp ON pp.package_id = po.package_id
    GROUP BY po.check_in_id
  ),
  rev_per_ci AS (
    -- 단건 결제(payments)는 check_in_id 직접 조인, 패키지는 pkg_rev(1건당 1회)
    SELECT
      t.check_in_id,
      t.consultant_id,
      COALESCE((
        SELECT SUM(CASE WHEN payment_type = 'refund' THEN -amount ELSE amount END)
        FROM payments WHERE check_in_id = t.check_in_id
      ), 0)
      + COALESCE(pr.pkg_rev, 0) AS rev
    FROM ticketed t
    LEFT JOIN pkg_rev pr ON pr.check_in_id = t.check_in_id
  ),
  pkg_flag AS (
    -- 해당 check_in 의 package_id 에 정상 패키지 결제가 있으면 패키지 전환 1
    SELECT DISTINCT ci.id AS check_in_id
    FROM check_ins ci
    JOIN package_payments pp ON pp.package_id = ci.package_id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.package_id IS NOT NULL
      AND pp.payment_type = 'payment'
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
  )
  SELECT
    s.id   AS consultant_id,
    s.name AS name,
    COUNT(DISTINCT t.check_in_id)::int                                               AS ticketing_count,
    COUNT(DISTINCT t.check_in_id) FILTER (WHERE pf.check_in_id IS NOT NULL)::int     AS package_count,
    CASE
      WHEN COUNT(DISTINCT t.check_in_id) > 0
      THEN ROUND(SUM(rpc.rev)::numeric / COUNT(DISTINCT t.check_in_id))::bigint
      ELSE 0
    END AS avg_amount
  FROM staff s
  LEFT JOIN ticketed t     ON t.consultant_id = s.id
  LEFT JOIN rev_per_ci rpc ON rpc.check_in_id = t.check_in_id
  LEFT JOIN pkg_flag pf    ON pf.check_in_id = t.check_in_id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
    AND COALESCE(s.active, true) = true   -- T-20260619: 직원관리 명단 SSOT 정합 — 퇴사자(active=false) 제외
  GROUP BY s.id, s.name
  ORDER BY ticketing_count DESC, avg_amount DESC;
$$;

-- 권한 재부여 (CREATE OR REPLACE 는 기존 GRANT 유지하나 멱등 보강)
REVOKE ALL ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 티켓팅 실적 (이중카운트 수정 + 재직 필터). T-20260619: staff.active=true 한정(직원관리 명단 SSOT 정합, 퇴사자 제외).';

COMMIT;

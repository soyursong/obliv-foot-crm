-- ============================================================
-- T-20260619-foot-STATS-CATEGORY-MANAGER-SOURCE-FIX (파트2 · REWORK)
-- 통계 > 실장별 실적 ↔ 직원관리 명단(SSOT) 연동:
--   foot_stats_consultant 가 staff 전체 명단을 LEFT JOIN 으로 집계해
--   해당 기간 실적이 없는 실장(퇴사자 정혜인 등)까지 0건 행으로 노출됨.
--   ⇒ 집계 기준을 "재직 플래그"가 아닌 "해당 기간 실적(티켓팅) 유무"로 전환.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-19 (REWORK — 기존 active_filter 폐기)
-- 롤백: 20260619020000_foot_stats_consultant_session_presence.rollback.sql
--
-- ── AC3 확정 설계 = 1-B 데이터 유무 기반 제외 ───────────────
--   김주연 총괄 confirm(2026-06-19, MSG-20260619-075306-ptb0):
--     "실적 빠진 시기부터 자동 제외 / 이전 조회 시에는 잔류".
--   ⇒ staff.active=true 완전 제외 방식(1-A) **폐기**.
--   ⇒ 표시 기준 = 조회 기간(p_from~p_to)에 티켓팅 실적이 있는 staff 만.
--   효과:
--     · 퇴사 후 기간(실적 0건) 조회 → 자동 제외.
--     · 퇴사 전(또는 실적 있는 과거) 기간 조회 → 실적 있으면 **잔류 표시**.
--     · staff.active 값과 무관 — active=false 라도 그 기간 실적 있으면 표시.
--
-- ── 구현 변경점 (직전 정의 대비 단 1곳) ────────────────────
--   직전 정의(20260430110000_foot_stats_consultant_fix.sql) 의 최종 SELECT 에서
--     FROM staff s
--     LEFT JOIN ticketed t ON t.consultant_id = s.id   ← 전체 명단 노출(0건 포함)
--   를
--     FROM staff s
--     JOIN ticketed t ON t.consultant_id = s.id         ← 실적(티켓팅) 있는 staff만
--   INNER JOIN 으로 변경. `staff.active` 참조는 도입하지 않음(데이터-유무 기준).
--   ticketed 는 이미 WHERE 에서 (checked_in_at AT Asia/Seoul)::date BETWEEN p_from AND p_to
--   로 기간 필터되므로, INNER JOIN = "해당 기간 실적 있는 staff" 와 동치.
--   반환 시그니처(consultant_id/name/ticketing_count/package_count/avg_amount) 불변
--   → FE(ConsultantSection/fetchConsultantPerf/ConsultantRow) 변경 0.
--
-- ── DB 변경 성격 (게이트 판정) ─────────────────────────────
--   테이블 DDL 아님. RPC 함수(CREATE OR REPLACE FUNCTION) JOIN 종류 변경(LEFT→INNER).
--   신규 컬럼/테이블/enum 0, staff 스키마 무참조. = ADDITIVE/비파괴, 즉시 역전 가능.
--   ⇒ data-architect CONSULT 불요. supervisor DDL-diff(함수 diff)만으로 진행.
--
-- ── 실데이터 dry-run (READ-ONLY, 2026-06-19) ───────────────
--   정혜인(5f141f76…, active=false, role=consultant) 전 기간 티켓팅 실적 = 0건.
--   ⇒ INNER JOIN 적용 시 어느 기간 조회든 미노출(자동 제외) — 현행 데이터 기준
--      1-A(active 완전제외)와 정혜인 한정 동일 결과(누출 0건). 재직 6명(김지윤3/
--      김주연10/엄경은24/정연주15/송지현15/김수린12)은 실적 기간이면 정상 잔류.
--   ⇒ "active=false 이나 실적 있는 과거 기간 잔류" 의 실데이터 인스턴스는 현재 없음
--      (정혜인 perf=0). 본 변경의 잔류 보장은 active 무참조 = SQL 구조로 담보.
--
-- ── 함수 본문 동일성 ───────────────────────────────────────
--   CTE(ticketed/pkg_once/pkg_rev/rev_per_ci/pkg_flag) 100% 동일,
--   최종 SELECT 의 `LEFT JOIN ticketed t` → `JOIN ticketed t` 1곳만 변경.
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
  -- T-20260619 (AC3=1-B 데이터 유무 기준): INNER JOIN = 조회 기간에 티켓팅 실적 있는 staff만.
  -- ticketed 가 기간(p_from~p_to) 필터를 이미 포함 → active 플래그 무참조로 자동 제외 성립.
  -- (LEFT→INNER 전환이 본 마이그의 유일한 동작 변경점)
  JOIN ticketed t          ON t.consultant_id = s.id
  LEFT JOIN rev_per_ci rpc ON rpc.check_in_id = t.check_in_id
  LEFT JOIN pkg_flag pf    ON pf.check_in_id = t.check_in_id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name
  ORDER BY ticketing_count DESC, avg_amount DESC;
$$;

-- 권한 재부여 (CREATE OR REPLACE 는 기존 GRANT 유지하나 멱등 보강)
REVOKE ALL ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_consultant(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 티켓팅 실적 (이중카운트 수정 + 데이터-유무 필터). T-20260619 AC3=1-B: 조회 기간 티켓팅 실적 있는 staff만(INNER JOIN ticketed), active 무관. 퇴사자=실적 0 기간 자동 제외, 실적 있는 과거 기간은 잔류.';

COMMIT;

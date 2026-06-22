-- ============================================================
-- T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE
-- 통계 > 실장별 실적 + 매출통계 탭 일간매출보고 다운로드:
--   foot_stats_consultant 에 total_amount(BIGINT) 반환 컬럼 1개 추가.
--   리포터(김주연 운영총괄) 데이터 모델 = "객단가 = 매출 ÷ 상담건수 파생"
--   ⇒ 매출(total_amount)이 1차값, 객단가(avg_amount)는 그 파생.
--   현 RPC는 avg_amount(ROUND(SUM/count))만 반환 → 매출(SUM) 미노출이라
--   FE에서 avg×count 로 역산 시 ROUND 오차 발생(재무보고 비정합).
--   ∴ 진짜 SUM(rev) 을 total_amount 로 추가 반환해 정합 확보.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-22
-- 롤백: 20260622210000_foot_stats_consultant_total_amount.rollback.sql
--
-- ── DB 변경 성격 (게이트 판정) ─────────────────────────────
--   테이블 DDL 아님. RPC 함수(CREATE OR REPLACE FUNCTION) RETURNS TABLE 에
--   total_amount BIGINT 1개 추가 + SELECT 에 SUM(rpc.rev)::bigint 1줄 추가.
--   신규 테이블 컬럼/enum 0, staff·payments 스키마 무참조. ADDITIVE/비파괴.
--   (선례: 20260619020000_foot_stats_consultant_session_presence.sql —
--    "RPC 함수 변경 = ADDITIVE/비파괴 ⇒ data-architect CONSULT 불요,
--     supervisor DDL-diff(함수 diff)만으로 진행")
--   ⇒ data-architect CONSULT 불요. supervisor DDL-diff(함수 diff) 검수.
--
-- ── 함수 본문 동일성 ───────────────────────────────────────
--   CTE(ticketed/pkg_once/pkg_rev/rev_per_ci/pkg_flag) 100% 동일,
--   기존 INNER JOIN ticketed(데이터-유무 필터) 유지(T-20260619 AC3 보존).
--   변경: (1) RETURNS TABLE 에 total_amount BIGINT 추가,
--         (2) 최종 SELECT 에 COALESCE(SUM(rpc.rev),0)::bigint AS total_amount 추가.
--   avg_amount 정의 불변(ROUND(SUM/count)) → 기존 FE(객단가) 회귀 0.
-- ============================================================

BEGIN;

-- RETURNS TABLE 시그니처(컬럼 추가) 변경은 CREATE OR REPLACE 불가
-- ("cannot change return type of existing function") → DROP 후 재생성.
-- 동일 트랜잭션 내 DROP+CREATE 로 무중단(조회 순간 함수 부재 노출 없음).
DROP FUNCTION IF EXISTS foot_stats_consultant(UUID, DATE, DATE);

CREATE FUNCTION foot_stats_consultant(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  consultant_id   UUID,
  name            TEXT,
  ticketing_count INT,
  package_count   INT,
  avg_amount      BIGINT,
  total_amount    BIGINT
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
    END AS avg_amount,
    -- T-20260622: 실장별 총 매출액(매출 1차값). 객단가는 이 값 ÷ 상담건수 파생.
    COALESCE(SUM(rpc.rev), 0)::bigint                                                AS total_amount
  FROM staff s
  -- T-20260619 (AC3=1-B 데이터 유무 기준): INNER JOIN = 조회 기간에 티켓팅 실적 있는 staff만.
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
  IS 'foot-stats: 상담실장 티켓팅 실적 (이중카운트 수정 + 데이터-유무 필터 + 총매출). T-20260622: total_amount(SUM(rev)) 반환 추가 — 매출통계 탭 일간매출보고 다운로드/실장별 총매출액 컬럼. avg_amount=ROUND(SUM/count) 불변.';

COMMIT;

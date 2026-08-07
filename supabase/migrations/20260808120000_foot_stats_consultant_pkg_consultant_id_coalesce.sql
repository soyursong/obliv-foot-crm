-- ============================================================
-- T-20260718-foot-PKG-CONSULTANT-ID-RPC-CUTOVER (Phase 2)
-- foot_stats_consultant 패키지 귀속을 COALESCE(packages.consultant_id[fact], heuristic) 로 결합.
--   결정문 Q3(canonical, DA-20260718-foot-PKG-CONSULTANT-ID-ATTR / MSG-20260718-233628-umma):
--     heuristic 폴백 영구 유지(제거 반려, one-way door·silent 소실 방지).
--   결정문 Q4: consultant_id = 결정적 사실만(det-link + FE 캡처), 나머지 NULL by-design →
--     read-time 에 heuristic 이 귀속. 결정적 사실이 heuristic 추측을 override = 개선 방향.
--   verdict = GO_ADDITIVE (shape-preserving) → 대표 게이트 면제(autonomy §3.1), supervisor DDL-diff.
-- Base : 20260724130000_foot_stats_consultant_singlepay_customer_attr (현행 live 본문, 7-col).
--        pkg_attr 를 제외한 모든 CTE(ticketed / ticketed_all / pkg_rev / pkg_conv / single_*(WHO 재설계)
--        / tk_count / consulted_cust / consultant_universe / 최종 SELECT / 반환형 7컬럼) = byte-동일 재사용
--        → drift 0. 변경점은 오직 pkg_attr 귀속 소스 1곳.
-- DB   : rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성 : dev-foot / 2026-08-08
-- 롤백 : 20260808120000_foot_stats_consultant_pkg_consultant_id_coalesce.rollback.sql (= 0724 body 복원)
-- dry  : 20260808120000_..._coalesce.dryrun.mjs (무영속: 롤백 후 신규 마커 `p.consultant_id` prod 부재)
-- 증거 : 20260808120000_..._coalesce.evidence.mjs (AC-3/AC-4 before/after prod 재현, READ-ONLY)
-- 표준 : Migration Ledger Reconciliation / Migration Dry-Run No-Persistence Protocol
--
-- ─── 변경점 (pkg_attr 귀속 소스만) ────────────────────────────────────────────────
--   구(0724): pkg_attr = packages ⨝(INNER) ticketed_all → 동일 고객 상담 中 최근접 heuristic 만.
--             (a) 결정적 fact(packages.consultant_id) 미참조 → heuristic 이 fact 를 override(Q4 역행).
--             (b) INNER JOIN → fact 있으나 상담이력 無 패키지 = 조인탈락 → fact 소실.
--   신(본건): pkg_attr = COALESCE(p.consultant_id, ta.consultant_id) + INNER→LEFT JOIN.
--             fact NOT NULL → fact 우선(불변 fact). NULL → heuristic 폴백(구 동작 = 회귀 0).
--             LEFT JOIN → fact 있으나 상담이력 無 패키지도 fact 로 보존(구조적 회수, 현발현 0).
--             둘 다 NULL → NULL(미귀속) → consultant_universe→staff INNER JOIN 에서 자연 제외
--             = 강제귀속 금지(BINDING-3 계승, 구 INNER-drop 과 동일 미귀속 결과).
--
-- ─── 왜 direct-reference 가 아니라 COALESCE 인가 (결정문 §46) ──────────────────────
--   packages.consultant_id 는 1/141 만 fact(140 NULL by-design). direct-reference(heuristic 제거)
--   시 140 패키지 무귀속 → 실장별 통계 붕괴. COALESCE 폴백만이 회귀 0 을 보장.
--
-- ─── ⚠ 권한 posture 보존 (admin-gate 회귀 금지) ───────────────────────────────────
--   현행 live foot_stats_consultant 는 T-20260726-...-RANKING-TAB-ADMINLOCK(20260727120000)이
--   authenticated EXECUTE 를 회수한 상태(래퍼 foot_stats_consultant_admin 이 유일 진입).
--   CREATE OR REPLACE 는 GRANT 를 보존하나, 본 마이그는 방어적으로 authenticated 를 재-회수한다
--   (0724 template 의 `GRANT ... TO authenticated` 를 의도적으로 제거 — 재부여 시 no-read-up 서버
--    게이트 회귀). 반환형 7컬럼 불변 → 래퍼(SELECT * FROM foot_stats_consultant) 무회귀(42P13 없음).
--
-- ─── 안전성 (게이트: autonomy §3.1 대표게이트 면제, supervisor DDL-diff 만) ─────────
--   테이블/데이터/enum/컬럼 write 0 = ADDITIVE/비파괴/read-path. 함수 본문 스왑(반환형 불변).
--   시맨틱-값 변화: 결정적 fact 1건(pkg 9155d158, consultant_id=김주연)이 heuristic(김민경) override
--     → 실장별 통계에서 김민경 −2,960,000 / 김주연 +2,960,000(의도된 정밀화, DA Q4). 그 외 회귀 0.
--   STABLE / SECURITY INVOKER / SET search_path=public (하위 SSOT — 래퍼가 admin 게이트).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_stats_consultant(
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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  -- BINDING-1: 실제 풋 상담(consultant_id NOT NULL + to_status='consultation')만.
  -- 기간 필터 O = ticketing_count(활동, checked_in_at 축) + 객단가 분모(distinct 상담고객)용. (불변)
  ticketed AS (
    SELECT DISTINCT
      ci.id          AS check_in_id,
      ci.consultant_id,
      ci.customer_id
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
      AND st.to_status = 'consultation'
  ),
  -- 동일 정의이나 ★기간 무필터(전기간) — WHO(귀속) 재구성용. 판매상담사는 언제 상담했든 그 사람. (불변)
  ticketed_all AS (
    SELECT DISTINCT
      ci.id AS check_in_id,
      ci.consultant_id,
      ci.customer_id,
      ci.checked_in_at
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = p_clinic_id
      AND ci.consultant_id IS NOT NULL
      AND st.to_status = 'consultation'
  ),
  -- WHO(pkg): ★COALESCE(packages.consultant_id[fact], heuristic) — 결정문 Q3(영구 폴백)/Q4(fact 우선).
  --   fact(p.consultant_id NOT NULL) 우선. NULL → 동일 고객 ticketed 상담 中 created_at 直前 최근접
  --   heuristic(구 동작 = 회귀 0). INNER→LEFT JOIN: fact 있으나 상담이력 無 패키지도 fact 보존
  --   (구 INNER JOIN 은 소실). 둘 다 NULL = NULL(미귀속) → 최종 staff INNER JOIN 에서 자연 제외.
  --   DISTINCT ON(p.id) = 패키지당 1행. ORDER BY 로 heuristic 최근접 tie-break(fact 유무 무관 결정성).
  pkg_attr AS (
    SELECT DISTINCT ON (p.id)
      p.id                                        AS package_id,
      COALESCE(p.consultant_id, ta.consultant_id) AS consultant_id
    FROM packages p
    LEFT JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id = p_clinic_id
    ORDER BY
      p.id,
      (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC,
      ta.check_in_id
  ),
  -- WHEN(pkg): 패키지매출 = package_payments 中 accounting_date ∈ 기간 (net). 귀속 = pkg_attr. (불변)
  --   pa.consultant_id NULL(둘 다 미귀속) 은 GROUP BY NULL → 최종 staff INNER JOIN 에서 탈락(미표시).
  pkg_rev AS (
    SELECT
      pa.consultant_id,
      SUM(CASE WHEN pp.payment_type = 'refund' THEN -pp.amount ELSE pp.amount END)::bigint AS rev
    FROM package_payments pp
    JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = p_clinic_id
      AND pp.accounting_date BETWEEN p_from AND p_to
    GROUP BY pa.consultant_id
  ),
  -- Q4: 전환 = 기간 accounting_date 에 payment 존재 DISTINCT 귀속패키지 수(분납 방지). (불변)
  pkg_conv AS (
    SELECT
      pa.consultant_id,
      COUNT(DISTINCT pp.package_id)::int AS package_count
    FROM package_payments pp
    JOIN pkg_attr pa ON pa.package_id = pp.package_id
    WHERE pp.clinic_id = p_clinic_id
      AND pp.accounting_date BETWEEN p_from AND p_to
      AND pp.payment_type = 'payment'
    GROUP BY pa.consultant_id
  ),
  -- ─── single_rev WHO (T-20260724-...SINGLEPAY-ATTR-FIX, 본건 무접촉·불변) ──────────
  -- payment_base: 기간 accounting_date 윈도우 단건 + 고객해석 + net. (WHEN=accounting_date 불변)
  payment_base AS (
    SELECT
      pay.id                                    AS payment_id,
      pay.check_in_id                           AS check_in_id,
      COALESCE(pay.customer_id, ci.customer_id) AS customer_id,
      pay.created_at                            AS created_at,
      (CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS net
    FROM payments pay
    LEFT JOIN check_ins ci ON ci.id = pay.check_in_id
    WHERE pay.clinic_id = p_clinic_id
      AND pay.accounting_date BETWEEN p_from AND p_to
  ),
  -- (a) 결정적 링크(fact, 회귀 0): check_in_id → ticketed 상담 consultant.
  single_direct AS (
    SELECT DISTINCT ON (pb.payment_id)
      pb.payment_id,
      ta.consultant_id
    FROM payment_base pb
    JOIN ticketed_all ta ON ta.check_in_id = pb.check_in_id
    ORDER BY pb.payment_id, ta.check_in_id
  ),
  -- (b) 고객기반 폴백 = pkg_attr heuristic 동형. 결정적 링크 없는 단건만. 상담이력 無 → 미매칭 제외.
  single_cust AS (
    SELECT DISTINCT ON (pb.payment_id)
      pb.payment_id,
      ta.consultant_id
    FROM payment_base pb
    JOIN ticketed_all ta ON ta.customer_id = pb.customer_id
    WHERE pb.payment_id NOT IN (SELECT payment_id FROM single_direct)
    ORDER BY
      pb.payment_id,
      (ta.checked_in_at <= pb.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (pb.created_at - ta.checked_in_at))) ASC,
      ta.check_in_id
  ),
  single_attr AS (
    SELECT payment_id, consultant_id FROM single_direct
    UNION ALL
    SELECT payment_id, consultant_id FROM single_cust
  ),
  single_rev AS (
    SELECT
      sa.consultant_id,
      SUM(pb.net)::bigint AS rev
    FROM single_attr sa
    JOIN payment_base pb ON pb.payment_id = sa.payment_id
    GROUP BY sa.consultant_id
  ),
  -- ticketing_count: 정의 불변(기간 checked_in_at 축, DISTINCT ticketed check_in).
  tk_count AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.check_in_id)::int AS ticketing_count
    FROM ticketed t
    GROUP BY t.consultant_id
  ),
  -- AC6 객단가 분모: 실장별 distinct 상담(내원)고객 수 (기간 checked_in_at 축). (불변)
  consulted_cust AS (
    SELECT t.consultant_id, COUNT(DISTINCT t.customer_id)::int AS consulted_customer_count
    FROM ticketed t
    GROUP BY t.consultant_id
  ),
  -- 로스터: 기간 티켓팅 상담사 ∪ 기간 매출귀속 상담사 (AC4 대사 불변식 보호). (불변)
  consultant_universe AS (
    SELECT consultant_id FROM tk_count
    UNION
    SELECT consultant_id FROM pkg_rev
    UNION
    SELECT consultant_id FROM single_rev
  )
  SELECT
    s.id   AS consultant_id,
    s.name AS name,
    COALESCE(tk.ticketing_count, 0)                                     AS ticketing_count,
    COALESCE(pc.package_count, 0)                                       AS package_count,
    ROUND(
      (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::numeric
      / NULLIF(COALESCE(cc.consulted_customer_count, 0), 0)
    )::bigint                                                           AS avg_amount,
    (COALESCE(pr.rev, 0) + COALESCE(sr.rev, 0))::bigint                 AS total_amount,
    COALESCE(cc.consulted_customer_count, 0)                           AS consulted_customer_count
  FROM staff s
  JOIN consultant_universe cu ON cu.consultant_id = s.id
  LEFT JOIN tk_count       tk ON tk.consultant_id = s.id
  LEFT JOIN pkg_rev        pr ON pr.consultant_id = s.id
  LEFT JOIN pkg_conv       pc ON pc.consultant_id = s.id
  LEFT JOIN single_rev     sr ON sr.consultant_id = s.id
  LEFT JOIN consulted_cust cc ON cc.consultant_id = s.id
  WHERE s.clinic_id = p_clinic_id
    AND s.role = 'consultant'
  GROUP BY s.id, s.name, tk.ticketing_count, pc.package_count, pr.rev, sr.rev, cc.consulted_customer_count
  ORDER BY ticketing_count DESC, avg_amount DESC NULLS LAST;
$$;

-- ⚠ 권한 posture 보존: admin-gate(20260727120000) 의 authenticated 회수를 방어적 재-집행.
--   0724 template 의 `GRANT ... TO authenticated` 를 의도적으로 제거(재부여=no-read-up 회귀).
--   유일 진입점 = SECDEF 래퍼 foot_stats_consultant_admin (postgres owner). PUBLIC 차단 유지.
REVOKE ALL     ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE) FROM authenticated;

COMMENT ON FUNCTION public.foot_stats_consultant(UUID, DATE, DATE)
  IS 'foot-stats: 상담실장 실적(총매출/객단가/전환/상담고객수). 패키지 귀속 = COALESCE(packages.consultant_id[결정적 fact], heuristic[동일 고객 상담 최근접]) — 결정문 Q3(heuristic 영구 폴백)/Q4(fact 우선). fact 있으나 상담이력 無 패키지는 LEFT JOIN 으로 fact 보존, 둘 다 NULL 은 미귀속(강제귀속 금지). single_rev(단건) WHO=SINGLEPAY-ATTR-FIX 불변. 반환형 7컬럼 불변. authenticated 회수(admin 래퍼 유일 진입, RANKING-TAB-ADMINLOCK 보존). ADDITIVE/read-path/no-DDL-data-mutation. T-20260718-foot-PKG-CONSULTANT-ID-RPC-CUTOVER / DA-20260718-foot-PKG-CONSULTANT-ID-ATTR Q3/Q4.';

COMMIT;

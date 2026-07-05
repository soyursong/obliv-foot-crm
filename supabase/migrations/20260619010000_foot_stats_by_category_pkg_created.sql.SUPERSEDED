-- ============================================================
-- T-20260619-foot-CATSTAT-PKGITEM-SOURCE
-- 통계 > 카테고리별 집계 소스 교체:
--   foot_stats_by_category 의 pkg_used(소진 시 session_type) 브랜치를
--   pkg_created(패키지 생성 시 삽입 품목 기준)로 교체.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-06-19
-- 롤백: 20260619010000_foot_stats_by_category_pkg_created.rollback.sql
--
-- ★★ 게이트 (AC2) — data-architect CONSULT-REPLY 수신 완료 ★★
--   본 마이그는 KPI(카테고리별 매출) "귀속 단위" 의미를 바꾼다.
--   소진(차감) 회차 단위 → 생성(판매) 품목 단위 (performance → booking).
--   ⇒ agent-data-architect CONSULT-REPLY GO: **MSG-20260619-004913-sg37 (2026-06-19 00:49)**
--      판정 = GO_WARN(조건부). 기술 안전(CREATE OR REPLACE 1종·시그니처 불변·가역) 확인.
--      단 KPI 매출인식 정의변경이라 단독 GO 불가 — 해소 게이트 3:
--        (G1) 김주연 총괄 현장 confirm — KPI 귀속단위 판매(생성) 기준 승인.
--             DECISION-REQUEST MSG-20260619-020826-m4cw (responder 경유, human_pending).
--        (G2) 정합성 주석 — 직원별매출(used 소진기준) vs 카테고리별(created 생성기준) 합계 불일치 가능. (아래 ── 명시)
--        (G3) 부분환불 known-limitation 명시. (아래 ── 명시)
--   ⇒ G2/G3 = 본 마이그 주석으로 해소(dev). G1 = 사람(김주연 총괄) confirm 미충족 시 prod 배포 금지.
--   ⇒ 최종: G1 confirm + supervisor DDL-diff + rollback SQL 게이트 경유 후에만 prod 적용.
--
-- ── 집계 소스 비교 ─────────────────────────────────────────
--   [기존 pkg_used]  package_sessions ps JOIN packages p
--                    category = ps.session_type (소진 시점 입력값)
--                    sessions = COUNT(used 회차)
--                    amount   = SUM(ps.unit_price + ps.surcharge)  (소진 시점 수가)
--                    날짜필터 = ps.session_date (소진일)
--
--   [신규 pkg_created] packages p (품목 컬럼을 행으로 unnest)
--                    category = 품목 종류(heated_laser/unheated_laser/podologue/trial/reborn/preconditioning)
--                    sessions = SUM(packages.{item}_sessions)  (생성 시 삽입 회차)
--                    amount   = SUM({item}_sessions * {item}_unit_price)  (생성 시 판매가)
--                    날짜필터 = p.contract_date (생성일/계약일)
--
-- ── AC3 정합성 (20260608160000 결정 보존) ──────────────────
--   iv(수액)는 신규 소스에서도 통계 미포함: item.category <> 'iv' 로 동등 적용.
--
-- ── (G2) KNOWN-LIMITATION: 통계 간 합계 불일치 (DA CONSULT 조건) ──
--   본 카테고리별 매출 = 패키지 "생성(판매)" 기준(packages.contract_date, 생성 시 삽입 품목·판매가).
--   2026-06-05 도입된 직원별(실장별) 매출 통계 = 패키지 회차 "소진(used)" 기준.
--   두 통계는 귀속 시점·단위가 다르므로 동일 기간 매출 합계가 일치하지 않을 수 있다(의도된 차이).
--   "생성=언제 팔렸나(booking)" / "소진=언제 제공됐나(performance)" — 비교·합산 금지.
--
-- ── (G3) KNOWN-LIMITATION: 부분환불 미반영 (DA CONSULT 조건) ──
--   집계는 패키지 생성 시점 판매가 전액을 귀속한다(status NOT IN cancelled/refunded 인 패키지만 포함).
--   패키지 전체 취소/환불(status=cancelled/refunded)은 제외되나,
--   '부분 환불'(일부 회차만 환불·잔여 유지)은 생성 시 판매가 기준이라 환불분이 차감되지 않는다.
--   → 카테고리별 매출은 '판매 총액' 의미이며 순매출(net) 아님. 정밀 순매출은 결제/환불 원장 기준 별도.
--
-- ── AC5 화면 무회귀 ────────────────────────────────────────
--   반환 시그니처(category TEXT, sessions BIGINT, amount BIGINT) 불변.
--   category 코드를 기존 session_type 네이밍과 동일하게 방출하므로
--   FE categoryLabel()·CategoryRow·CategorySection 변경 0.
--
-- ── 품목 → 카테고리 매핑 (packages 컬럼 기준) ───────────────
--   heated_sessions   / heated_unit_price    → 'heated_laser'
--   unheated_sessions / unheated_unit_price  → 'unheated_laser'
--   podologe_sessions / podologe_unit_price  → 'podologue'
--   iv_sessions       / iv_unit_price        → 'iv'   (AC3: 통계 제외)
--   trial_sessions    / trial_unit_price     → 'trial'
--   reborn_sessions   / reborn_unit_price    → 'reborn'
--   preconditioning_sessions ( unit_price 컬럼 없음 → 0 ) → 'preconditioning'
--
-- ⚠️ STATUS: DA CONSULT-REPLY GO_WARN(조건부) 수신(sg37). G2/G3 주석 해소 완료.
--   잔여 게이트 = G1(김주연 총괄 confirm, human_pending: MSG-20260619-020826-m4cw) → 미충족 시 prod 미적용.
--   테이블 스키마/데이터 변경 0 (CREATE OR REPLACE FUNCTION 1종, 즉시 역전 가능).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION foot_stats_by_category(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  category  TEXT,
  sessions  BIGINT,
  amount    BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pkg_created AS (
    -- 패키지 생성 시 삽입 품목: packages 항목 컬럼을 행으로 펼쳐 카테고리별 집계.
    -- T-20260619: 소진(session_type) → 생성 품목 기준으로 집계 소스 교체.
    -- T-20260608 AC3 정합: iv(수액)는 통계 미포함.
    -- 환불/취소 패키지는 매출 귀속에서 제외(status NOT IN cancelled/refunded).
    SELECT
      item.category                                      AS category,
      SUM(item.sessions)::bigint                         AS cnt,
      SUM(item.sessions * item.unit_price)::bigint       AS amt
    FROM packages p
    CROSS JOIN LATERAL (VALUES
      ('heated_laser',    COALESCE(p.heated_sessions, 0),         COALESCE(p.heated_unit_price, 0)),
      ('unheated_laser',  COALESCE(p.unheated_sessions, 0),       COALESCE(p.unheated_unit_price, 0)),
      ('podologue',       COALESCE(p.podologe_sessions, 0),       COALESCE(p.podologe_unit_price, 0)),
      ('iv',              COALESCE(p.iv_sessions, 0),             COALESCE(p.iv_unit_price, 0)),
      ('trial',           COALESCE(p.trial_sessions, 0),          COALESCE(p.trial_unit_price, 0)),
      ('reborn',          COALESCE(p.reborn_sessions, 0),         COALESCE(p.reborn_unit_price, 0)),
      ('preconditioning', COALESCE(p.preconditioning_sessions, 0), 0)
    ) AS item(category, sessions, unit_price)
    WHERE p.clinic_id = p_clinic_id
      AND p.status NOT IN ('cancelled', 'refunded')
      AND p.contract_date BETWEEN p_from AND p_to
      AND item.sessions > 0
      AND item.category <> 'iv'          -- AC3: 수액 통계 제외(생성 소스에서도 동등)
    GROUP BY item.category
  ),
  single_paid AS (
    -- 단건: payments + check_in_services -> services.category  (현행 유지)
    SELECT
      COALESCE(svc.category, 'other') AS category,
      COUNT(DISTINCT cis.id)::bigint  AS cnt,
      SUM(CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS amt
    FROM payments pay
    JOIN check_in_services cis ON cis.check_in_id = pay.check_in_id
    LEFT JOIN services svc      ON svc.id = cis.service_id
    WHERE pay.clinic_id = p_clinic_id
      AND (pay.created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  unioned AS (
    SELECT category, cnt, amt FROM pkg_created
    UNION ALL
    SELECT category, cnt, amt FROM single_paid
  )
  SELECT
    category,
    SUM(cnt)::bigint AS sessions,
    SUM(amt)::bigint AS amount
  FROM unioned
  GROUP BY 1
  HAVING SUM(amt) <> 0 OR SUM(cnt) > 0
  ORDER BY amount DESC NULLS LAST;
$$;

-- 권한 멱등 보강 (CREATE OR REPLACE 는 기존 GRANT 유지)
REVOKE ALL ON FUNCTION foot_stats_by_category(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_by_category(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION foot_stats_by_category(UUID, DATE, DATE)
  IS 'foot-stats: 시술 종류별 매출. T-20260619: 패키지=생성(판매)품목 기준(packages 항목 컬럼·contract_date, booking) + 단건=services.category. iv 제외(T-20260608 AC3). DA GO_WARN(sg37). known-limit: 직원별(소진/used)과 합계 불일치 가능, 부분환불 미차감(판매총액 의미).';

COMMIT;

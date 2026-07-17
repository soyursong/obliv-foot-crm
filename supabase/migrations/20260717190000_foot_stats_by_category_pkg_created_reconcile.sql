-- ============================================================
-- T-20260619-foot-CATSTAT-PKGITEM-SOURCE  (reconcile / FIX batch2 재이식)
-- 통계 > 카테고리별 집계 소스 교체 재이식:
--   foot_stats_by_category 의 pkg_used(소진 시 session_type) 브랜치를
--   pkg_created(패키지 생성 시 삽입 품목 기준)로 교체.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-07-17
-- 롤백: 20260717190000_foot_stats_by_category_pkg_created_reconcile.rollback.sql
-- 표준: Migration Ledger Reconciliation (DA-20260704-body-MIG-LEDGER-RECONCILE) — 정본=prod 실재
--       + Migration Dry-Run No-Persistence Protocol (v1.0)
--
-- ─── 왜 이 마이그가 "재이식(신규 timestamp)" 인가 ────────────────────────────────
--   구 마이그 20260619010000_foot_stats_by_category_pkg_created.sql 은 pkg_created 전환을
--   담았으나, reconcile-R5(20260706120000, commit 91dffd16, T-20260608-foot-TICKET-DEDUCT-
--   SLOT-DATA, 2026-07-06)에서 42P13 stale-migration 해소 과정에 `.SUPERSEDED` 로 격리됐고
--   별도 적용 금지(구 timestamp 부활 금지, R5 db-gate §6). ⇒ pkg_created 재추진은
--   **G1(김주연 confirm) 후 신규 timestamp 마이그**로만 가능(R5 db-gate §6 명시).
--   G1 = 김주연 총괄 2-A confirm 수신 완료(2026-06-19T07:59, MSG-20260619-075306-ptb0):
--        "카테고리별 매출 = 패키지 생성(판매) 기준 집계 OK. 직원별 소진기준과 합계불일치 known-limit 수용."
--
-- ─── ★ 정본 = 현행 prod live prosrc (2026-07-17 실측 = 20260715140000) ──────────
--   FIX-REQUEST 는 base 를 "20260706120000(R5) 이후" 로 지시했다. 실측 결과 prod live 는
--   R5 가 아니라 **그 이후의 20260715140000_foot_stats_revenue_attrib_axis_unify** 상태다:
--     · R5(20260706120000) 은 prod ledger 미등재 + prosrc 에 iv 필터 부재 = **prod 미적용**(parked).
--       (근거: 20260715140000 마이그 헤더 주석이 이 사실을 명시.)
--     · 현행 prod live foot_stats_by_category (2026-07-17 dump, md5=623999a0e12998f2080b976d3c938731):
--         - pkg_used   : package_sessions.session_date 기준, **iv-exclude 없음**(소진 사건일 유지).
--         - single_paid: payments.**accounting_date** 기준(REVENUE-ATTRIB-AXIS-UNIFY 로 created_at→accounting_date 전환됨).
--   ⇒ 본 마이그의 base = 이 현행 prod live 정본. single_paid 의 accounting_date 축은 **그대로 보존**하고,
--      pkg_used → pkg_created 브랜치만 교체한다. (R5 파일의 created_at·pkg_used 를 base 로 삼지 않는다.)
--   ★ foot_stats_therapist_summary / foot_stats_revenue / foot_stats_consultant = 본 마이그 범위 밖 = 무접점(무regress).
--
-- ─── 42P13 재발 금지 (R5 패턴 준용) ────────────────────────────────────────────
--   반환 시그니처(category TEXT, sessions BIGINT, amount BIGINT) 불변 → CREATE OR REPLACE
--   (DROP 불요) → 42P13(cannot change return type) 불가·즉시 역전(rollback) 가능·비파괴.
--
-- ─── AC2 게이트 (data-architect CONSULT-REPLY) ─────────────────────────────────
--   DA CONSULT-REPLY GO_WARN(조건부): **MSG-20260619-004913-sg37 (2026-06-19 00:49)**.
--   기술 안전(CREATE OR REPLACE 1종·시그니처 불변·가역) 확인. KPI 매출인식 정의변경
--   (소진→생성 = performance→booking)이라 단독 GO 불가 — 해소 게이트 3(G1/G2/G3):
--     (G1) 김주연 총괄 confirm — ✅ 해소(2-A, 위 참조).
--     (G2) 정합성 주석 — 아래 ── 명시(직원별 used 소진기준 vs 카테고리별 created 생성기준 합계 불일치 가능).
--     (G3) 부분환불 known-limitation — 아래 ── 명시.
--
-- ─── (point-2) iv-exclude(수액 통계 제외) 정합 재검토 — 소스 전환 시 필터가 어디에 걸리나 ──
--   [현행 prod live pkg_used] iv 제외 **없음**(R5 iv-exclude 미적용) → 현재는 iv 소진회차가 카테고리 통계에 포함.
--   [본 마이그 pkg_created]    iv 제외 지점 = `item.category <> 'iv'` (패키지 생성 시 iv 품목행 자체 배제).
--   ⇒ 소스가 '소진 시 session_type' → '생성 시 삽입 품목' 으로 바뀌면 iv 제외의 "의미 걸림점"은
--      소진 이벤트 session_type → 생성 품목 컬럼(iv_sessions/iv_unit_price)으로 이동한다.
--   ⇒ ★ 순변화 주의: 현행 prod live 는 pkg 브랜치에 iv 필터가 없으므로, 본 마이그는 소스전환과 동시에
--      **패키지 브랜치에 iv-exclude 를 신규 도입**한다(= 원 아티팩트 20260619010000 및 티켓 AC3·DA CONSULT sg37
--      의 iv 제외 요구 보존). 이는 T-20260608 AC1(iv-exclude)이 prod 미적용인 현 상태에서 iv 제외가
--      **패키지 카테고리 통계에 처음 반영**됨을 뜻한다. iv 제외는 '패키지 브랜치에서만' 걸린다.
--   ⇒ single_paid 브랜치: 기존/신규 모두 iv 제외 조건 없음(단건 services.category='iv' 미배제) — 무변경.
--
-- ── 집계 소스 비교 ─────────────────────────────────────────
--   [기존 pkg_used]  package_sessions ps JOIN packages p
--                    category = ps.session_type (소진 시점 입력값)
--                    sessions = COUNT(used 회차) / amount = SUM(unit_price + surcharge) / 날짜 = session_date(소진일)
--   [신규 pkg_created] packages p (품목 컬럼 unnest)
--                    category = 품목 종류 / sessions = SUM({item}_sessions) / amount = SUM(sessions*unit_price)
--                    날짜필터 = p.contract_date (생성/계약일)
--
-- ── (G2) KNOWN-LIMITATION: 통계 간 합계 불일치 (DA CONSULT 조건) ──
--   본 카테고리별 매출 = 패키지 "생성(판매)" 기준(packages.contract_date). 직원별(실장별) 매출 통계 = "소진(used)" 기준.
--   귀속 시점·단위가 달라 동일 기간 합계 불일치 가능(의도된 차이). "생성=booking" / "소진=performance" — 비교·합산 금지.
--
-- ── (G3) KNOWN-LIMITATION: 부분환불 미반영 (DA CONSULT 조건) ──
--   집계는 패키지 생성 시점 판매가 전액 귀속(status NOT IN cancelled/refunded). 전체 취소/환불은 제외되나
--   '부분 환불'(일부 회차만 환불)은 판매가 기준이라 미차감. → '판매 총액' 의미(net 아님).
--
-- ── AC5 화면 무회귀 ────────────────────────────────────────
--   반환 시그니처 불변. category 코드를 기존 session_type 네이밍과 동일 방출 → FE categoryLabel()·CategoryRow·CategorySection 변경 0.
--
-- ── 품목 → 카테고리 매핑 (packages 컬럼 기준) ───────────────
--   heated_sessions/heated_unit_price → 'heated_laser' · unheated_sessions/unheated_unit_price → 'unheated_laser'
--   podologe_sessions/podologe_unit_price → 'podologue' · iv_sessions/iv_unit_price → 'iv'(제외)
--   trial_sessions/trial_unit_price → 'trial' · reborn_sessions/reborn_unit_price → 'reborn'
--   preconditioning_sessions(단가컬럼 없음→0) → 'preconditioning'
--
-- ─── 안전성 ─────────────────────────────────────────────────────────────────────
--   db_change=TRUE(집계 숫자 이동=비즈로직) 이나 테이블 스키마/데이터 변경 0.
--   STABLE / SECURITY INVOKER / SET search_path=public — anon 차단, authenticated 만. CREATE OR REPLACE 1종·멱등·가역.
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
    -- iv 제외 지점: item.category <> 'iv' (생성 시 iv 품목행 자체 배제 — 소스전환과 동시 신규 도입, 티켓 AC3/DA sg37).
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
      AND item.category <> 'iv'          -- 수액 통계 제외(패키지 브랜치 유일 배제 지점)
    GROUP BY item.category
  ),
  single_paid AS (
    -- 단건: payments + check_in_services -> services.category
    -- ★ 귀속축 = accounting_date (현행 prod live 20260715140000 보존, created_at 로 되돌리지 않음).
    SELECT
      COALESCE(svc.category, 'other') AS category,
      COUNT(DISTINCT cis.id)::bigint  AS cnt,
      SUM(CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS amt
    FROM payments pay
    JOIN check_in_services cis ON cis.check_in_id = pay.check_in_id
    LEFT JOIN services svc      ON svc.id = cis.service_id
    WHERE pay.clinic_id = p_clinic_id
      AND pay.accounting_date BETWEEN p_from AND p_to
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
  IS 'foot-stats: 시술 종류별 매출. T-20260619(재이식): 패키지=생성(판매)품목 기준(packages 항목·contract_date, booking) + 단건=services.category(accounting_date축, 20260715140000 보존). iv 제외(패키지 브랜치 item.category<>iv, 소스전환과 동시 신규도입). DA GO_WARN(sg37)+김주연 2-A confirm. 신규 timestamp(구 20260619010000 SUPERSEDED 부활 아님). known-limit: 직원별(소진/used)과 합계 불일치, 부분환불 미차감(판매총액).';

COMMIT;

-- ============================================================
-- T-20260715-foot-BYCAT-IVEXCLUDE-PROD-RECONCILE  (AC2)
-- foot_stats_by_category: iv(수액) 통계제외 predicate 재이식 — post-AXIS body 위 rebase.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm, foot 단일 Supabase)
-- 작성: dev-foot / 2026-07-15
-- 롤백: 20260715150000_foot_stats_by_category_iv_exclude_rebase_post_axis.rollback.sql
-- 게이트: DA-20260715-001 (MSG-20260715-085433-xk12, GO) — ADDITIVE 신규 timestamp 재수렴.
--         대표게이트 면제(autonomy §3.1, ADDITIVE+DA GO) · supervisor DDL-diff.
-- 표준: Migration Ledger Reconciliation (정본=prod 실재) / Migration Dry-Run No-Persistence Protocol.
--
-- ─── 무엇을 바꾸나 (변경의 전부 = 1줄 predicate) ────────────────────────────────
--   foot_stats_by_category.pkg_used WHERE 절에 `AND ps.session_type <> 'iv'` 추가.
--   → 수액 회차 소진을 통계 집계에서만 제외(T-20260608 AC1, 김주연 총괄 2026-06-08 3차 LOCK).
--   ★ AC1 스코프 LOCK: "항목에서 삭제하라고 한 적 없다. 통계에서만 안 가져오면 된다."
--     → 차감 항목 선택 UI 4곳·마스터데이터·차감 이력 절대 무변경. 통계 집계 쿼리 1곳(pkg_used)만.
--
-- ─── 정본 = prod 실재 (post-AXIS body 위 rebase) ────────────────────────────────
--   base = prod live prosrc(md5 623999a0e12998f2080b976d3c938731, Management API introspection,
--          read-only, ref rxlomoozakkjesdqjtvd, 2026-07-15).
--   이 live body = T-20260715-foot-REVENUE-ATTRIB-AXIS-UNIFY(20260715140000, created_by=supervisor,
--   prod ledger 등재 확인) 산출물 = post-AXIS body 이다:
--     · pkg_used     : package_sessions.session_date (소진 사건일, 귀속축 전환 대상 아님)
--     · single_paid  : payments.accounting_date       (AXIS 귀속축 전환분)
--   본 마이그는 이 확정 live body 를 그대로 base 로 두고 pkg_used 에 iv-exclude 1줄만 얹는다.
--   ⚠ 죽은 timestamp 20260706120000_..._sameday_conv.sql 는 재사용/부활 금지(prod 미적용·verify
--     신뢰불가). 해당 파일은 .VOID 로 격리+forward-doc 처리(별도 커밋). 가정된 reconcile-R5 base 미사용.
--
-- ─── last-writer 불변식 (반드시) ────────────────────────────────────────────────
--   최종 CREATE OR REPLACE body = **axis-unify 로직 AND iv-exclude predicate** 둘 다 포함.
--   본 up.sql body 는 axis(single_paid.accounting_date + pkg_used.session_date) 전부를 그대로
--   담고 `AND ps.session_type <> 'iv'` 를 추가한 self-complete 정의다. 따라서 AXIS 파일 착지
--   순서와 무관하게 본 마이그가 마지막 착지하면 불변식 성립(clobber 재발 불가).
--   신규 timestamp 20260715150000 > AXIS 20260715140000 → AXIS 뒤 착지 보장.
--
-- ─── 데이터 영향 (착수시점 실측) ────────────────────────────────────────────────
--   현행 prod: package_sessions status='used' AND session_type='iv' = 0건(금액 0).
--   → 현 데이터에서 출력 무변동(no-op). predicate 는 정책-예방적(향후 iv 소진분 집계 차단).
--   iv 차감이력/UI/마스터데이터는 무접촉(집계 쿼리 1곳만 변경).
--
-- ─── 안전성 ─────────────────────────────────────────────────────────────────────
--   시그니처 불변(category text, sessions bigint, amount bigint) → CREATE OR REPLACE(DROP 불요)
--   → 42P13 불가·즉시 역전(rollback). STABLE / SECURITY INVOKER / SET search_path=public
--   → anon 차단, authenticated 만. 테이블/데이터 변경 0. 멱등(CREATE OR REPLACE + REVOKE/GRANT).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_stats_by_category(
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
  WITH pkg_used AS (
    -- 패키지 회차 소진: session_type 별 그룹 (소진 사건일 = session_date 유지, 귀속축 전환 대상 아님)
    -- T-20260608 AC1: 수액(iv)은 통계 미포함 (차감 이력/UI는 보존, 집계에서만 제외 — 유일 지점)
    SELECT
      ps.session_type AS category,
      COUNT(*)::bigint AS cnt,
      SUM(COALESCE(ps.unit_price, 0) + COALESCE(ps.surcharge, 0))::bigint AS amt
    FROM package_sessions ps
    JOIN packages p ON p.id = ps.package_id
    WHERE p.clinic_id = p_clinic_id
      AND ps.status = 'used'
      AND ps.session_type <> 'iv'          -- AC1: 수액 통계 제외 (post-AXIS body 위 iv-exclude rebase)
      AND ps.session_date BETWEEN p_from AND p_to
    GROUP BY 1
  ),
  single_paid AS (
    -- 단건: payments + check_in_services -> services.category
    SELECT
      COALESCE(svc.category, 'other') AS category,
      COUNT(DISTINCT cis.id)::bigint  AS cnt,
      SUM(CASE WHEN pay.payment_type = 'refund' THEN -pay.amount ELSE pay.amount END)::bigint AS amt
    FROM payments pay
    JOIN check_in_services cis ON cis.check_in_id = pay.check_in_id
    LEFT JOIN services svc      ON svc.id = cis.service_id
    WHERE pay.clinic_id = p_clinic_id
      AND pay.accounting_date BETWEEN p_from AND p_to    -- 귀속축: accounting_date (AXIS-UNIFY 산출물 보존)
    GROUP BY 1
  ),
  unioned AS (
    SELECT category, cnt, amt FROM pkg_used
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
REVOKE ALL ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.foot_stats_by_category(UUID, DATE, DATE)
  IS 'foot-stats: 시술 종류별 매출(회차 소진 pkg_used[session_date, iv 통계제외] + 단건 single_paid[accounting_date]). 결제 귀속축=accounting_date(AXIS-UNIFY) + iv-exclude(T-20260608 AC1). T-20260715-foot-BYCAT-IVEXCLUDE-PROD-RECONCILE';

COMMIT;

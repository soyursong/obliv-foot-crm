-- ════════════════════════════════════════════════════════════════════════════
-- T-20260708-foot-PKGSTATS-DIRECTINPUT-TREATTYPE-REFPRICE
-- 패키지 통계(B안) — 직접입력 할인율·객단가 집계용 시술유형 + 기준정가 + 정찰가 마스터
-- 전량 ADDITIVE
--
-- 근거: DA CONSULT-REPLY MSG-20260708-214747-rosm (DA-20260708-FOOT-PKGSTATS)
--   판정: GO (조건부 1건 = Q4 리본/Re:Born 캐노니컬). ADDITIVE only → autonomy §3.1 대표 게이트
--         면제 + supervisor DDL-diff만. 스키마·enum·grain 아래대로 확정.
--
-- Q1 grain: treatment_type + reference_price 는 packages(패키지 grain)에 둔다.
--   package_payments/payments(결제 grain)에 두지 않음 — 할인율은 패키지 1건당 1값이고
--   foot_stats_consultant(pkg_once CTE: check_ins.package_id→packages)가 packages grain 전제.
--   reference_price = 스냅샷(denormalized copy). 마스터로의 live FK/join 금지 — 생성/템플릿 로드
--   시점의 정가를 복사 저장하고 이후 불변(마스터 정가가 바뀌어도 과거 할인율 소급 변동 없음).
--
-- Q2 enum: pg enum 미사용 관례 정합 → TEXT + CHECK. 5개 개별 값(묶기 금지), '포돌로게' 표기.
--   5번째 저장(canonical) 토큰 = 'Re:Born' (foot repo 배포된 SSOT PREPAID_KEYWORDS + Re:Born 정합).
--   FE 표시 라벨은 현장 요청대로 "리본"으로 렌더(저장값↔표시라벨 분리). 치료사통계·패키지통계 vocab 공유.
--
-- Q3 마스터: system_codes 부재 → 전용 테이블 treatment_standard_prices. UNIQUE(clinic_id, treatment_type).
--   CHECK 값집합 = packages.treatment_type 과 100% 동일(같은 5토큰). clinic_id FK REFERENCES clinics(id).
--   RLS enable + clinic_id 격리. standard_price INTEGER(KRW). 5행(시술유형 5종 각 1행) seed.
--   prefill: 커스텀 생성 시 treatment_type 선택 → (clinic_id, treatment_type)로 standard_price 조회 →
--            packages.reference_price 에 복사(스냅샷) + 스태프 override 허용. (live join 아님.)
--
-- Q5 매출 SSOT 무접촉: reference_price·할인율 = CRM 내부 통계표시 전용. 오가닉/광고 split·급여/비급여/
--   공단부담 split·인센티브 분모 어디에도 미참여. 마감 outbox payload·fct_revenue_daily 무접촉
--   (AXIS-DATAPATH-GUARD 유지).
--
-- 멱등: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / named CHECK DO 가드 / seed ON CONFLICT DO NOTHING. 재실행 안전.
-- RECONCILE(MSG-20260708-224250, DA 단일권위): (A) 저장토큰 Re:Born canonical / (B) 마스터=treatment_standard_prices
--   +standard_price, 스냅샷=packages.reference_price / (C) named CHECK chk_packages_treatment_type·chk_tsp_treatment_type
--   / (D) reference_price·total_amount 동일 grain(계약총액) — N회 write 시 reference_price = standard_price × 횟수 스냅샷(FE CustomerChartPage).
-- 하위호환: 기존 packages 데이터 treatment_type/reference_price NULL 허용, backfill 불필요.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) packages.treatment_type — 패키지 속성 grain 시술유형 태깅(수동 선택, nullable)
--    별개 컬럼: stats.ts 의 session_type→treatment_type 런타임 파생(차감이벤트 grain)과 소스·grain 다름 → 병합 금지.
--    RECONCILE(MSG-20260708-224250 (C)): CHECK = named chk_packages_treatment_type + (IS NULL OR IN 5토큰).
--    ADD COLUMN 과 CHECK 분리(named 부여 위해). named CHECK 는 DO 가드로 IF NOT EXISTS 대체(pg 미지원) → 멱등.
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS treatment_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_packages_treatment_type'
      AND conrelid = 'public.packages'::regclass
  ) THEN
    ALTER TABLE public.packages
      ADD CONSTRAINT chk_packages_treatment_type
      CHECK (treatment_type IS NULL OR treatment_type IN ('비가열','가열','포돌로게','수액','Re:Born'));
  END IF;
END $$;

COMMENT ON COLUMN public.packages.treatment_type IS
  'T-20260708 패키지 시술유형 태깅(수동 선택, 통계 시술유형별 객단가 집계용). CHECK 5토큰(비가열/가열/포돌로게/수액/Re:Born, 저장값=canonical, FE 표시 "리본"). session_type→treatment_type 런타임 파생(차감이벤트 grain)과 별 축 — 병합 금지. NULL=레거시/미태깅 허용.';

-- 2) packages.reference_price — 기준정가 스냅샷(불변). 할인율 = (reference_price − 실결제금액)/reference_price.
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS reference_price integer;

COMMENT ON COLUMN public.packages.reference_price IS
  'T-20260708 기준정가 스냅샷(생성/템플릿 로드 시점 정가 복사, 이후 불변). 할인율=(reference_price−실결제)/reference_price 통계표시 전용. treatment_standard_prices 마스터에 live FK/join 아님(스냅샷). 매출 SSOT/급여/인센티브 무접촉. NULL=미입력 → 할인율 "-" 표기, 객단가는 정상 집계.';

-- 3) treatment_standard_prices — 시술유형별 1회 정상가(정찰가) 마스터. reference_price prefill 소스 SSOT.
CREATE TABLE IF NOT EXISTS public.treatment_standard_prices (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid        NOT NULL REFERENCES public.clinics(id),        -- Q3-2: FK 격리 근거
  treatment_type text        NOT NULL CONSTRAINT chk_tsp_treatment_type CHECK (treatment_type IN ('비가열','가열','포돌로게','수액','Re:Born')),  -- Q3-1/RECONCILE(C): named chk_tsp_treatment_type, packages 와 동일 5토큰(NOT NULL → IS NULL 가드 불필요)
  standard_price integer     NOT NULL DEFAULT 0,                            -- Q3-4: KRW, reference_price 동일 타입
  updated_by     uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, treatment_type)                                        -- Q3: clinic×유형 1행
);

COMMENT ON TABLE public.treatment_standard_prices IS
  '시술유형별 1회 정상가(정찰가) 마스터 = /packages 탭1 정찰가 기준표. reference_price prefill 소스 SSOT(스냅샷 복사, live join 아님). 매출 SSOT 무접촉 — CRM 내부 통계표시 prefill 전용. DA-20260708-FOOT-PKGSTATS.';
COMMENT ON COLUMN public.treatment_standard_prices.standard_price IS
  '시술유형 1회 표준가(KRW). 커스텀 패키지 생성 시 treatment_type 선택→이 값을 packages.reference_price 로 복사(스태프 override 가능). 마스터 값 변경이 과거 패키지 할인율을 소급 변동시키지 않음.';

-- RECONCILE(C): 테이블이 이전 환경에서 anonymous CHECK 로 선생성됐을 경우에도 named chk_tsp_treatment_type 보장(멱등).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_tsp_treatment_type'
      AND conrelid = 'public.treatment_standard_prices'::regclass
  ) THEN
    ALTER TABLE public.treatment_standard_prices
      ADD CONSTRAINT chk_tsp_treatment_type
      CHECK (treatment_type IN ('비가열','가열','포돌로게','수액','Re:Born'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_treatment_standard_prices_clinic ON public.treatment_standard_prices(clinic_id);

ALTER TABLE public.treatment_standard_prices ENABLE ROW LEVEL SECURITY;

-- RLS: clinic_id 격리(repo 공통 패턴). read/write 동일 술어.
DROP POLICY IF EXISTS treatment_standard_prices_clinic_isolation ON public.treatment_standard_prices;
CREATE POLICY treatment_standard_prices_clinic_isolation ON public.treatment_standard_prices
  FOR ALL TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_approved_user() AND clinic_id = current_user_clinic_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treatment_standard_prices TO authenticated;

-- 4) seed — 각 clinic × 시술유형 5종 = 각 1행(standard_price 0 placeholder, 스태프가 탭1에서 입력).
--    멱등: ON CONFLICT (clinic_id, treatment_type) DO NOTHING.
INSERT INTO public.treatment_standard_prices (clinic_id, treatment_type, standard_price)
SELECT c.id, t.tt, 0
FROM public.clinics c
CROSS JOIN (VALUES ('비가열'),('가열'),('포돌로게'),('수액'),('Re:Born')) AS t(tt)
ON CONFLICT (clinic_id, treatment_type) DO NOTHING;

-- ── 통계(B안) RPC 2종 (ADDITIVE, packages grain) ──────────────────────────────
-- foot_stats_consultant 실장 귀속 체인과 동일(check_ins.package_id→packages, 패키지당 최이른 check_in 1회 귀속).
-- 매출 SSOT 무접촉(Q5) — packages 내부 통계표시 전용. contract_date(DATE) 기간 파라미터.

-- (1) 실장별 할인율: 할인율 = (reference_price − total_amount)/reference_price, reference_price 있는 건만.
--     reference_price 미입력 건은 discount_pkg_count 에서 제외 → avg_discount_rate NULL(FE '-' 표기). 객단가엔 무관.
CREATE OR REPLACE FUNCTION foot_stats_pkg_discount_by_consultant(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  consultant_id      UUID,
  name               TEXT,
  pkg_count          INT,
  discount_pkg_count INT,
  avg_discount_rate  NUMERIC   -- 0~1 비율(NULL=기준정가 있는 패키지 없음 → FE '-')
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH pkg_consultant AS (
    -- 패키지당 최이른 check_in 의 consultant 1회 귀속(이중집계 방지, pkg_once 동형)
    SELECT DISTINCT ON (ci.package_id)
      ci.package_id,
      ci.consultant_id
    FROM check_ins ci
    WHERE ci.clinic_id = p_clinic_id
      AND ci.package_id IS NOT NULL
      AND ci.consultant_id IS NOT NULL
    ORDER BY ci.package_id, ci.checked_in_at ASC
  ),
  attributed AS (
    SELECT p.id, pc.consultant_id, p.reference_price, p.total_amount
    FROM packages p
    JOIN pkg_consultant pc ON pc.package_id = p.id
    WHERE p.clinic_id = p_clinic_id
      AND p.contract_date BETWEEN p_from AND p_to
      AND p.status NOT IN ('cancelled', 'refunded')
  )
  SELECT
    s.id   AS consultant_id,
    s.name AS name,
    COUNT(*)::int AS pkg_count,
    COUNT(*) FILTER (WHERE a.reference_price IS NOT NULL AND a.reference_price > 0)::int AS discount_pkg_count,
    AVG( (a.reference_price - a.total_amount)::numeric / a.reference_price )
      FILTER (WHERE a.reference_price IS NOT NULL AND a.reference_price > 0) AS avg_discount_rate
  FROM attributed a
  JOIN staff s ON s.id = a.consultant_id AND s.clinic_id = p_clinic_id
  GROUP BY s.id, s.name
  ORDER BY discount_pkg_count DESC, pkg_count DESC;
$$;

REVOKE ALL ON FUNCTION foot_stats_pkg_discount_by_consultant(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_pkg_discount_by_consultant(UUID, DATE, DATE) TO authenticated;
COMMENT ON FUNCTION foot_stats_pkg_discount_by_consultant(UUID, DATE, DATE)
  IS 'foot-stats(B안): 실장별 패키지 할인율. 할인율=(reference_price−total_amount)/reference_price(기준정가 있는 건만). 실장 귀속=foot_stats_consultant 체인(패키지당 최이른 check_in). 매출 SSOT 무접촉. T-20260708 PKGSTATS.';

-- (2) 시술유형별 평균 객단가: reference_price 유무 무관 결제금액(total_amount) 기준 평균. 직접입력·종류선택 통합.
CREATE OR REPLACE FUNCTION foot_stats_pkg_avg_by_treatment(
  p_clinic_id UUID,
  p_from      DATE,
  p_to        DATE
)
RETURNS TABLE (
  treatment_type TEXT,
  pkg_count      INT,
  avg_amount     BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    p.treatment_type,
    COUNT(*)::int AS pkg_count,
    ROUND(AVG(p.total_amount))::bigint AS avg_amount
  FROM packages p
  WHERE p.clinic_id = p_clinic_id
    AND p.treatment_type IS NOT NULL
    AND p.contract_date BETWEEN p_from AND p_to
    AND p.status NOT IN ('cancelled', 'refunded')
  GROUP BY p.treatment_type
  ORDER BY p.treatment_type;
$$;

REVOKE ALL ON FUNCTION foot_stats_pkg_avg_by_treatment(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION foot_stats_pkg_avg_by_treatment(UUID, DATE, DATE) TO authenticated;
COMMENT ON FUNCTION foot_stats_pkg_avg_by_treatment(UUID, DATE, DATE)
  IS 'foot-stats(B안): 시술유형별 평균 객단가(total_amount 평균, 기준정가 무관). 직접입력·종류선택 통합. 매출 SSOT 무접촉. T-20260708 PKGSTATS.';

-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260708220000', 'foot_pkg_treatment_type_reference_price')
ON CONFLICT (version) DO NOTHING;

COMMIT;

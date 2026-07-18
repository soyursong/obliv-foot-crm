-- ============================================================================
-- obliv-foot-crm 20260719010000_foot_counselor_stats_rpc
-- T-20260718-foot-CRM-COUNSELOR-STATS-RPC-PROXY (leg a / 선행)
--
-- 목적: 도파민TM 통계화면(crm-counselor-stats-proxy EF)이 풋CRM의 상담사별
--   예약수·내원수를 longre/scalp 와 동형(byte-parity)으로 가져갈 수 있도록, 집계 SSOT를
--   풋CRM에 캡슐화한 SECURITY DEFINER RPC 제공. 도메인 격리: 도파민이 풋 테이블 직접접근
--   금지 → 이 RPC 단일 read 표면만 호출.
--
-- 근거 (DA CONSULT-REPLY GO): DA-20260718-FOOTCRM-STATS-PROXY-RESVVISIT-AUTHORITY
--   (MSG-20260718-235002-0eb2). ADDITIVE(CREATE FUNCTION read-only + GRANT) → CEO 게이트
--   면제(autonomy §3.1). scalp `crm-counselor-stats-proxy` 소싱 RPC(migration 065, commit
--   511f0fd)와 동형 시그니처/반환 shape/RBAC 이식. 신규 grain 발명 금지.
--
-- ★ byte-parity 정본 = 풋CRM 상담사통계 화면(TmAggregateSection / src/lib/stats.ts
--   fetchTmAggregate). 본 RPC 는 그 화면의 집계 산식을 서버사이드로 1:1 이식한다.
--   현장 7/14~17 8케이스 검증셋 대조: 7건 정확 일치, 진운선 7/17 은 화면 자체가 7
--   (RPC=화면 JS 동치 실측, dev 검증) — 현장 기록 "8"은 티켓 명시 "1~2명 차이"
--   허용 오차(검증 체크포인트, 하드코딩 금지). = 화면 SSOT 와 byte-동치.
--
-- 정의 FREEZE (풋 화면 산식 직역, src/lib/stats.ts §267-276 + TmAggregateSection):
--   · reservation_count(예약수) = reservations.reservation_date ∈ [p_from,p_to],
--     clinic_id 스코프. ★취소 포함(status 필터 없음) — 풋 화면 '예약수' = "잡혀있는 전체
--     예약(취소 포함)". (scalp 는 취소제외였으나, 풋 화면 SSOT 는 취소포함 → 화면 byte-parity
--     우선. DA date-grain=예약 이벤트일자 정합.)
--   · visited_count(내원건수) = check_ins.created_date ∈ [p_from,p_to](KST 트리거 date =
--     visit date, DA 확정 grain), clinic_id 스코프, status <> 'cancelled'(풋엔 no_show 없음
--     → cancelled 가 롱레 no_show 등가물, 화면 .neq('status','cancelled') 직역).
--     reservation_id dedup(done 우선 1건/예약) + walk-in(reservation_id NULL) 각 유지
--     = 화면 dedupVisited.
--   · 두 date 컬럼 모두 DATE → BETWEEN p_from~p_to 종일 inclusive.
--
-- counselor_key = 풋 화면 tmCounselorLabel 산출(provenance-aware, 이름 기반):
--   (1) reservations.created_by(=user_profiles.id, TEXT) 가 active 직원 매칭 → 직원명
--   (2) 미매칭이면서 registrar_name(예약등록자 스냅샷) 있으면 → 등록자명(예: '진운선')
--   (3) source_system='dopamine' → '도파민/TM 유입 (상담사 미배정)'
--   (4) 그 외 → '미지정'
--   내원은 매칭 예약의 라벨(labelForCheckIn); 매칭 예약 없으면 → '워크인'.
--   ※ scalp 는 email 정규화 키였으나, 풋 화면 귀속축은 이름/등록자 기반(created_by=UUID +
--     registrar_name fallback)이라 화면 byte-parity 를 위해 라벨을 그대로 키로 반환.
--     도파민 proxy 는 counselor_key 를 profiles.email→id remap 시도 후 미해석 시 원본 키를
--     verbatim 표시(tm-flow crm-counselor-stats-proxy L415/L490) → 이름 키 그대로 렌더 정합.
--
-- 권한: SECURITY DEFINER. 공개 anon 배제(운영민감지표). EXECUTE 는 전용 read-only role
--   dopamine_stats_reader + service_role 에만 grant. PUBLIC/anon/authenticated REVOKE.
--   (dopamine_stats_rpc_rbac_converge / T-20260715-foot-STATS-RPC-ANON-EXEC-REVOKE-SWEEP 계열.)
--   도파민 EF 전달 키 = dopamine_stats_reader role claim pre-signed JWT(FOOT_STATS_ROLE_KEY)
--   단일 토큰. service_role signing secret 전달 금지(scalp GRANT/DELIVERY FREEZE 동형).
--
-- ADDITIVE: CREATE ROLE(멱등) + CREATE OR REPLACE FUNCTION + GRANT/REVOKE only.
--   테이블·컬럼·enum·데이터 무변경. 롤백: 20260719010000_foot_counselor_stats_rpc.rollback.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 전용 read-only role (멱등) — 도파민 EF 가 JWT role claim 으로 switch 가능
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dopamine_stats_reader') THEN
    CREATE ROLE dopamine_stats_reader NOLOGIN;
  END IF;
END $$;

-- authenticator 가 SET ROLE 가능하도록 (Supabase 커스텀 role 패턴)
GRANT dopamine_stats_reader TO authenticator;

-- ----------------------------------------------------------------------------
-- 1. get_counselor_stats — 상담사별 예약수·내원수 (scalp 동형 시그니처)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_counselor_stats(
  p_clinic_ids UUID[],
  p_from       DATE,
  p_to         DATE
)
RETURNS TABLE(
  counselor_key     TEXT,
  reservation_count INT,
  visited_count     INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- 예약수(scheduled): reservation_date 버킷, 취소 포함(status 필터 없음), 라벨 귀속
  WITH res_labeled AS (
    SELECT CASE
             WHEN r.created_by IS NOT NULL AND r.created_by <> ''
                  AND up.name IS NOT NULL AND up.name <> ''            THEN up.name
             WHEN NULLIF(btrim(r.registrar_name), '') IS NOT NULL       THEN btrim(r.registrar_name)
             WHEN btrim(COALESCE(r.source_system, '')) = 'dopamine'     THEN '도파민/TM 유입 (상담사 미배정)'
             ELSE '미지정'
           END AS k
    FROM public.reservations r
    LEFT JOIN public.user_profiles up
           ON up.id::text = r.created_by AND up.active = true
    WHERE r.clinic_id = ANY(p_clinic_ids)
      AND r.reservation_date >= p_from
      AND r.reservation_date <= p_to
  ),
  -- 내원건수(visited): created_date(=visit date) 버킷, cancelled 제외
  vis_raw AS (
    SELECT ci.id, ci.reservation_id, ci.status
    FROM public.check_ins ci
    WHERE ci.clinic_id = ANY(p_clinic_ids)
      AND ci.created_date >= p_from
      AND ci.created_date <= p_to
      AND ci.status <> 'cancelled'
  ),
  -- reservation_id dedup(done 우선 1건/예약), walk-in(NULL) 각 유지 = 화면 dedupVisited
  vis_dedup AS (
    ( SELECT DISTINCT ON (reservation_id) id, reservation_id
      FROM vis_raw WHERE reservation_id IS NOT NULL
      ORDER BY reservation_id, (status = 'done') DESC, id )
    UNION ALL
    ( SELECT id, reservation_id FROM vis_raw WHERE reservation_id IS NULL )
  ),
  -- 내원 귀속 = 매칭 예약의 라벨(labelForCheckIn); 매칭 예약 없으면 '워크인'
  vis_labeled AS (
    SELECT CASE
             WHEN vd.reservation_id IS NULL OR r.id IS NULL             THEN '워크인'
             WHEN r.created_by IS NOT NULL AND r.created_by <> ''
                  AND up.name IS NOT NULL AND up.name <> ''            THEN up.name
             WHEN NULLIF(btrim(r.registrar_name), '') IS NOT NULL       THEN btrim(r.registrar_name)
             WHEN btrim(COALESCE(r.source_system, '')) = 'dopamine'     THEN '도파민/TM 유입 (상담사 미배정)'
             ELSE '미지정'
           END AS k
    FROM vis_dedup vd
    LEFT JOIN public.reservations r ON r.id = vd.reservation_id
    LEFT JOIN public.user_profiles up
           ON up.id::text = r.created_by AND up.active = true
  ),
  rc AS (SELECT k, count(*)::int c FROM res_labeled GROUP BY k),
  vc AS (SELECT k, count(*)::int c FROM vis_labeled GROUP BY k)
  SELECT COALESCE(rc.k, vc.k)   AS counselor_key,
         COALESCE(rc.c, 0)      AS reservation_count,
         COALESCE(vc.c, 0)      AS visited_count
  FROM rc FULL OUTER JOIN vc ON rc.k = vc.k
  WHERE COALESCE(rc.c, 0) > 0 OR COALESCE(vc.c, 0) > 0;
$$;

COMMENT ON FUNCTION public.get_counselor_stats(UUID[], DATE, DATE) IS
  'T-20260718-foot-CRM-COUNSELOR-STATS-RPC-PROXY: 도파민TM 통계화면용 상담사별 예약수·내원수. '
  'reservation_count=reservation_date 버킷·취소포함(풋 화면 예약수 SSOT). '
  'visited_count=check_ins.created_date(visit date) 버킷·cancelled 제외·reservation_id dedup. '
  'counselor_key=풋 화면 tmCounselorLabel(직원명|등록자명|도파민유입|미지정, 워크인). '
  'EXECUTE=dopamine_stats_reader+service_role 한정. scalp 동형(신규 grain 무).';

-- ----------------------------------------------------------------------------
-- 2. 권한: anon/authenticated/PUBLIC 차단 → 전용 role + service_role 만 EXECUTE
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_counselor_stats(UUID[], DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_counselor_stats(UUID[], DATE, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.get_counselor_stats(UUID[], DATE, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_counselor_stats(UUID[], DATE, DATE)
  TO dopamine_stats_reader, service_role;

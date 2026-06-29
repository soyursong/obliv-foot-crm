-- ============================================================================
-- T-20260629-foot-FOOTDIRECT-CAL-READ-SURFACE
-- 풋 direct/walk-in 예약(source_system IS NULL) cross-CRM read surface
--   = 부모 T-20260629-dopamine-FOOTDIRECT-REVERSE-VISIBILITY (intent (가) display-only) 의 풋 측 절반.
--   도파민이 풋 직접/워크인 예약을 라이브 pull → 화면 투영만(도파민 DB 미적재, 정본=풋).
--
-- DA B SHAPE 명세: CONSULT-REPLY MSG-20260629-154106-p5yt / 계약 §6-6-9 (v1.22)
-- SSOT: cross_crm_data_contract.md §6-6-9
--
-- ── 메커니즘 (§1-1) ─────────────────────────────────────────────────────────
--   server-side read 함수 — SECURITY DEFINER. service_role(전용 secret 게이트 EF)로만 호출.
--   §4-1 write RPC 오버로드 금지 → 본 함수는 별도 read 전용. WRITE 0.
--
-- ── allowlist 투영 (§1-4, PHI 최소노출 — 함수 시그니처에 SQL 레벨로 강제) ──────
--   허용: reservation_id(opaque) · 슬롯일시 · 시술유형 라벨 · 상태 · room · 환자명 마스킹(김**).
--   DENY: 풀 전화번호 · RRN(주민번호) · 진료기록 PHI → RETURNS TABLE 에 컬럼 자체가 없음
--         (EF 레벨 필터가 아니라 DB 함수 시그니처에서 구조적으로 차단 → include_full_pii 류 우회 불가).
--   room: 예약(체크인 전)은 방 미배정 → reservations 에 room 컬럼 부재 → 항상 NULL 투영.
--
-- ── dedup (§1-2, 계약 고정) ─────────────────────────────────────────────────
--   WHERE source_system IS NULL (풋 직접/워크인). source_system='dopamine' 제외(중복표시 방지).
--
-- ── 하드펜스 8 (§1-6) ───────────────────────────────────────────────────────
--   ① WRITE=0 (LANGUAGE sql, SELECT only) ② MINT=0 (cue_card 미접촉)
--   ③ FUNNEL 미진입 (silver/gold 팩트뷰 join 0) ④ process_status 무부여
--   ⑦ 멱등·무상태 ⑧ 정본=풋
--
-- ── 게이트 ──────────────────────────────────────────────────────────────────
--   ADDITIVE DDL: 신규 함수 + 신규 access_log 테이블 + grant 분리. 데이터파괴 0·backfill 0·
--   기존 reservations 스키마 무변경. DA = ADDITIVE/계약-clean 판정(대표 게이트 면제).
--   잔여 = supervisor read surface 한정 EF/RLS-diff 게이트(§6-6-9 7항).
-- ============================================================================

-- ── 1. 경량 read-access log (AC-6) ──────────────────────────────────────────
--   read 호출 감사용. 도메인 데이터(reservations/customers/cue_cards) 무접촉 → 하드펜스 ①
--   "WRITE=0" 위반 아님(audit-only). anon 차단, service_role 만 insert.
CREATE TABLE IF NOT EXISTS public.foot_calendar_read_access_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  caller      text,                 -- 예: 'dopamine'
  clinic_slug text,
  date_from   date,
  date_to     date,
  status_filter text,
  row_count   integer
);

COMMENT ON TABLE public.foot_calendar_read_access_log IS
  'T-20260629-foot-FOOTDIRECT-CAL-READ-SURFACE: cross-CRM read surface 호출 감사 로그(audit-only, 도메인 write 아님).';

ALTER TABLE public.foot_calendar_read_access_log ENABLE ROW LEVEL SECURITY;
-- RLS 정책 무부여 = 기본 거부. service_role 은 RLS 우회(BYPASSRLS)라 insert 가능, anon/authenticated 차단.
REVOKE ALL ON public.foot_calendar_read_access_log FROM anon, authenticated;
GRANT INSERT, SELECT ON public.foot_calendar_read_access_log TO service_role;

-- ── 2. read 전용 SECURITY DEFINER 함수 (§1-1, AC-1/3/4/5) ────────────────────
CREATE OR REPLACE FUNCTION public.foot_calendar_read_direct(
  p_clinic_slug text,
  p_date_from   date,
  p_date_to     date,
  p_status      text DEFAULT NULL,    -- NULL/'all' = 전체. 그 외 reservations.status 동등필터
  p_limit       integer DEFAULT 200
)
RETURNS TABLE (
  reservation_id        uuid,
  reservation_date      date,
  reservation_time      time,
  service_label         text,         -- 시술유형 라벨(services.name) — 비-PHI
  visit_type            text,         -- new/returning/experience — 비-PHI
  status                text,
  room                  text,         -- 예약(체크인 전)은 방 미배정 → 항상 NULL
  customer_name_masked  text          -- 김** (첫 글자 + **)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id,
    r.reservation_date,
    r.reservation_time,
    s.name,
    r.visit_type,
    r.status,
    NULL::text AS room,    -- §1-4 allowlist 허용항이나 예약은 방 미배정 → NULL
    -- AC-4 마스킹: 첫 글자 + ** (한/영 무관). 빈/NULL 이름은 '**'.
    CASE
      WHEN COALESCE(NULLIF(r.customer_name, ''), c.name) IS NULL THEN '**'
      ELSE left(COALESCE(NULLIF(r.customer_name, ''), c.name), 1) || '**'
    END AS customer_name_masked
  FROM public.reservations r
  JOIN public.clinics   cl ON cl.id = r.clinic_id
  LEFT JOIN public.services  s ON s.id = r.service_id
  LEFT JOIN public.customers c ON c.id = r.customer_id
  WHERE cl.slug = p_clinic_slug                 -- AC-5 clinic 스코프
    AND r.source_system IS NULL                 -- AC-1 dedup: 직접/워크인만 (dopamine 제외)
    AND r.reservation_date >= p_date_from
    AND r.reservation_date <= p_date_to
    AND (p_status IS NULL OR p_status = 'all' OR r.status = p_status)
  ORDER BY r.reservation_date DESC, r.reservation_time DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

COMMENT ON FUNCTION public.foot_calendar_read_direct(text, date, date, text, integer) IS
  'T-20260629-foot-FOOTDIRECT-CAL-READ-SURFACE: 풋 direct/walk-in 예약(source_system IS NULL) read-only 투영. allowlist=마스킹명/슬롯/시술라벨/상태/room. DENY=풀phone/RRN/PHI(시그니처 부재). 호출=service_role(전용 secret EF) 한정.';

-- ── 3. grant 분리 (AC-2) — anon/authenticated 실행 차단, service_role 만 ──────
REVOKE ALL ON FUNCTION public.foot_calendar_read_direct(text, date, date, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.foot_calendar_read_direct(text, date, date, text, integer) TO service_role;

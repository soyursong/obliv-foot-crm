-- T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE  (dev-foot)
-- 유입경로 inflow_channel 신규 필드 + 11코드 접수 필수입력 — 풋센터(obliv-foot-crm)
-- assignee: dev-foot | db_change: true | 전량 ADDITIVE (신규 nullable 3컬럼 + system_codes 11 INSERT + code_availability 오버레이)
-- 2026-08-01 23:00 KST
-- ★ 착수 GATE = CLEARED: data-architect CONSULT-REPLY 조건부 GO(ADDITIVE) 수신 (부모 T-20260801-xcrm-INFLOW-CHANNEL-11CODE-INTAKE).
--    codify = cross_crm_data_contract.md §36(v1.66). autonomy §3.1 대표게이트 면제 → supervisor DDL-diff only.
--    5-CRM 물리 동일(happy-flow-queue 20260801160000 정본과 물리 스키마 일치).
--    dual-anchor 물리 3컬럼(reservations.inflow_channel + check_ins.inflow_channel + customers.first_inflow_channel/at/source_ref)
--    + system_codes 신규그룹 code_type='inflow_channel' 11종 + code_availability 오버레이(센터별 노출 제어).
-- =====================================================
-- ADDITIVE-safe 근거:
--   ① 신규 컬럼은 전량 nullable → 기존 row·grain·집계 의미 무변경. DROP/타입변경/enum제거 0.
--   ② forward-only: 기존 row 소급 UPDATE 없음(과거 예약 "채널 미상"=NULL). 무데이터손실·가역.
--   ③ referral_source/visit_route 무접점(FREEZE) — 본 마이그 read/write 0.
--   ④ system_codes/code_availability = 신규 테이블(IF NOT EXISTS), medium 9종 canonical 혼입 금지(신규그룹).
--   ⑤ 멱등: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / INSERT ... ON CONFLICT DO NOTHING.
--   ⑥ carve-out: partner.agency 코드 등록만(목록 노출). 전용계정 write-path(staff role/RLS/PHI) 미구현 = 별도 DA 게이트
--       (T-20260801-xcrm-INFLOW-PARTNER-AGENCY-WRITEPATH-DAGATE).
--   ※ 풋 신규/재진 이중동선 — 재진 접수 경로에서도 customers.first_inflow_channel 자동상속(app-layer first-write-wins).
-- ⚠ top-level BEGIN/COMMIT 없음(무영속 dry-run 러너 harness 호환, migration_dryrun_no_persistence_standard.md v1.0).
-- =====================================================

-- ════════════════════════════════════════════════════════════════════
-- Step 1: dual-anchor 물리 3컬럼 (전량 nullable ADDITIVE)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS inflow_channel text;
COMMENT ON COLUMN public.reservations.inflow_channel IS
  'T-20260801 유입경로 이벤트값(예약 발급 카드). system_codes code_type=inflow_channel canonical. source_system(매출축)·visit_route(legacy)·referral_source(freeze legacy)와 직교축 방화벽.';

ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS inflow_channel text;
COMMENT ON COLUMN public.check_ins.inflow_channel IS
  'T-20260801 유입경로 이벤트값(워크인=예약없는 접수 발급앵커). referral_source(freeze legacy)와 무접점.';

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS first_inflow_channel text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS first_inflow_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS first_inflow_source_ref text;
COMMENT ON COLUMN public.customers.first_inflow_channel IS
  'T-20260801 최초유입 canonical(first-touch, immutable first-write-wins). 이벤트값 inflow_channel과 의도적 별칭=축 방화벽. 불변성 물리가드(BEFORE UPDATE 트리거)=Phase-2.';

-- ════════════════════════════════════════════════════════════════════
-- Step 2: system_codes SSOT (신규 테이블) — 신규그룹 code_type='inflow_channel'
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.system_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_type       text    NOT NULL,
  code            text    NOT NULL,
  label           text    NOT NULL,
  series          text,                                   -- inbound / partner / internal (prefix 파생 차원)
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  requires_reason boolean NOT NULL DEFAULT false,          -- inbound.etc = 사유 필수
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_type, code)
);

ALTER TABLE public.system_codes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='system_codes' AND policyname='system_codes_select') THEN
    CREATE POLICY "system_codes_select" ON public.system_codes FOR SELECT TO authenticated, anon USING (true);
  END IF;
END $$;

-- 11종 코드 시드 (code_type='inflow_channel', idempotent)
INSERT INTO public.system_codes (code_type, code, label, series, sort_order, requires_reason)
VALUES
  ('inflow_channel', 'inbound.walkin',           '워크인',                 'inbound',   0, false),
  ('inflow_channel', 'inbound.phone',            '전화 문의',              'inbound',   1, false),
  ('inflow_channel', 'inbound.naver_place',      '네이버',                 'inbound',   2, false),
  ('inflow_channel', 'inbound.homepage',         '공식 홈페이지',          'inbound',   3, false),
  ('inflow_channel', 'inbound.referral',         '지인 소개',              'inbound',   4, false),
  ('inflow_channel', 'inbound.revisit',          '기존 고객 재방문',       'inbound',   5, false),
  ('inflow_channel', 'inbound.etc',              '기타 (사유 필수 입력)',  'inbound',   6, true),
  ('inflow_channel', 'partner.agency',           '해외환자 유치 에이전시', 'partner',   7, false),
  ('inflow_channel', 'internal.center_referral', '타센터 연계',            'internal',  8, false),
  ('inflow_channel', 'internal.transfer',        '병원 인계',              'internal',  9, false),
  ('inflow_channel', 'internal.staff',           '임직원·가족',            'internal', 10, false)
ON CONFLICT (code_type, code) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- Step 3: code_availability 오버레이 (신규 테이블) — 센터별 노출 제어
--   default(행 부재) = 노출. 특정 clinic 숨김 시 is_available=false 행 삽입.
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.code_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_type    text    NOT NULL,
  code         text    NOT NULL,
  clinic_id    uuid    NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  is_available boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_type, code, clinic_id)
);

ALTER TABLE public.code_availability ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='code_availability' AND policyname='code_availability_select') THEN
    CREATE POLICY "code_availability_select" ON public.code_availability FOR SELECT TO authenticated, anon USING (true);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- Step 4: RPC get_inflow_channels(clinic) — system_codes ∩ code_availability 오버레이
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_inflow_channels(p_clinic_id uuid)
RETURNS TABLE (
  code            text,
  label           text,
  series          text,
  sort_order      integer,
  requires_reason boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT sc.code, sc.label, sc.series, sc.sort_order, sc.requires_reason
  FROM public.system_codes sc
  WHERE sc.code_type = 'inflow_channel'
    AND sc.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.code_availability ca
      WHERE ca.code_type = sc.code_type
        AND ca.code = sc.code
        AND ca.clinic_id = p_clinic_id
        AND ca.is_available = false
    )
  ORDER BY sc.sort_order, sc.code;
$$;

GRANT EXECUTE ON FUNCTION public.get_inflow_channels(uuid) TO authenticated, anon;

-- PostgREST 스키마 캐시 새로고침
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (supervisor MIG-GATE / SQL Editor)
-- ════════════════════════════════════════════════════════════════════
-- 컬럼 존재(5행, 전부 is_nullable='YES'):
--   SELECT table_name, column_name, is_nullable FROM information_schema.columns
--     WHERE table_schema='public' AND (
--       (table_name='reservations' AND column_name='inflow_channel') OR
--       (table_name='check_ins'    AND column_name='inflow_channel') OR
--       (table_name='customers'    AND column_name IN ('first_inflow_channel','first_inflow_at','first_inflow_source_ref')));
-- 코드 시드:
--   SELECT count(*) FROM public.system_codes WHERE code_type='inflow_channel';                     -- 기대: 11
--   SELECT count(*) FROM public.system_codes WHERE code_type='inflow_channel' AND requires_reason; -- 기대: 1(inbound.etc)
-- RPC:
--   SELECT * FROM public.get_inflow_channels((SELECT id FROM public.clinics LIMIT 1));             -- 기대: 11행(오버레이 무설정 시)

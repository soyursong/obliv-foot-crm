-- T-20260803-foot-VISIT-NATURE-COLUMN-DERIVESEED  (dev-foot)
-- 방문성격 visit_nature 축 5-CRM 표준화 — 풋센터(obliv-foot-crm) 신규 컬럼 ADDITIVE 신설
-- assignee: dev-foot | db_change: true | 전량 ADDITIVE (신규 nullable 2컬럼 + system_codes 4 INSERT + code_availability 오버레이 + RPC)
-- 2026-08-03 23:00 KST
-- ★ 착수 GATE = CLEARED: data-architect CONSULT-REPLY 조건부 GO(ADDITIVE) 수신
--    (부모 T-20260803-xcrm-VISIT-NATURE-AXIS-STANDARDIZE / SSOT da_decision_xcrm_visit_nature_axis_standardize_20260803.md).
--    §3.1 대표게이트 면제 → supervisor DDL-diff only(비-PHI·비-금전 → CEO 게이트 불요).
--    배선 surface = deployed T-20260801-foot-INFLOW-CHANNEL-INTAKE-LANE intake surface 편승
--    (system_codes/code_availability 테이블은 inflow lane 에서 이미 생성 = IF NOT EXISTS 재사용).
-- =====================================================
-- ADDITIVE-safe 근거:
--   ① 신규 컬럼 visit_nature 는 전량 nullable → 기존 row·grain·집계 의미 무변경. DROP/타입변경 0.
--   ② visit_type(new/returning/experience 축) 무접촉 존치 — 본 마이그 read/write 0. (in-place overwrite = DESTRUCTIVE, REJECT 경로.)
--   ③ visit_nature ⊥ inflow_channel 직교 축 방화벽(SSOT §36 doctrine): 서로 덮어쓰기 금지. per-visit 본질(per-customer immutable 필드 없음).
--   ④ system_codes/code_availability = inflow lane 산출 신규 테이블 재사용(IF NOT EXISTS). 신규그룹 code_type='visit_nature'(inflow 11코드와 혼입 없음).
--   ⑤ code_availability 오버레이: foot 은 experience 미노출(body 전용) — 현 DB clinics 전체에 is_available=false 삽입.
--   ⑥ 멱등: ADD COLUMN IF NOT EXISTS / INSERT ... ON CONFLICT DO NOTHING / CREATE OR REPLACE FUNCTION.
--   ⑦ forward default = 접수시점 스태프 커밋 or TM 자동스탬프(FE). 미포착 → NULL(강제 'new' 대입 금지 = garbage-seed 회피).
--   ⑧ derive-seed 백필(visit_type → visit_nature)은 별건 후행 파일(...derive_seed_backfill.sql, SOP 봉투).
-- ⚠ top-level BEGIN/COMMIT 없음(무영속 dry-run 러너 harness 호환, migration_dryrun_no_persistence_standard.md v1.0).
-- =====================================================

-- ════════════════════════════════════════════════════════════════════
-- Step 1: 예약/접수 앵커 물리 2컬럼 (전량 nullable ADDITIVE)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS visit_nature text;
COMMENT ON COLUMN public.reservations.visit_nature IS
  'T-20260803 방문성격(per-visit 본질) canonical. system_codes code_type=visit_nature (new/fulfillment/revisit/experience). visit_type(new/returning 축)·inflow_channel(최초유입 축)과 직교 방화벽. fulfillment 만 AOV/전환율 분모 제외.';

ALTER TABLE public.check_ins ADD COLUMN IF NOT EXISTS visit_nature text;
COMMENT ON COLUMN public.check_ins.visit_nature IS
  'T-20260803 방문성격(워크인=예약없는 접수 발급앵커). per-visit 본질. visit_type 무접촉 존치, derive-seed 로 신규 컬럼에만 파생.';

-- ════════════════════════════════════════════════════════════════════
-- Step 2: system_codes SSOT — 신규그룹 code_type='visit_nature' 4값
--   (테이블은 inflow lane 20260801230000 에서 생성 = IF NOT EXISTS 가드로 재사용/방어)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.system_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_type       text    NOT NULL,
  code            text    NOT NULL,
  label           text    NOT NULL,
  series          text,
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  requires_reason boolean NOT NULL DEFAULT false,
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

-- 4종 코드 시드 (code_type='visit_nature', idempotent)
--   CEO 확정 enum 4값(§7-3-3). experience 는 canonical enum 정식 편입(body-local 방치 아님) → 축 cross-CRM 균질.
INSERT INTO public.system_codes (code_type, code, label, series, sort_order, requires_reason)
VALUES
  ('visit_nature', 'new',         '신규',            'visit', 0, false),
  ('visit_nature', 'revisit',     '재방문',          'visit', 1, false),
  ('visit_nature', 'fulfillment', '이행(회차권)',    'visit', 2, false),
  ('visit_nature', 'experience',  '체험',            'visit', 3, false)
ON CONFLICT (code_type, code) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- Step 3: code_availability 오버레이 — foot 은 experience 미노출(body 전용)
--   default(행 부재) = 노출. experience 만 현 DB 전 clinic 에 is_available=false 삽입 → picker 미노출.
--   (테이블은 inflow lane 에서 생성 = IF NOT EXISTS 방어)
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

-- foot 전용 오버레이: experience 미노출(body 전용 값). 현 DB 전 clinic 대상 is_available=false.
INSERT INTO public.code_availability (code_type, code, clinic_id, is_available)
SELECT 'visit_nature', 'experience', c.id, false
FROM public.clinics c
ON CONFLICT (code_type, code, clinic_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- Step 4: RPC get_visit_natures(clinic) — system_codes ∩ code_availability 오버레이
--   (inflow lane get_inflow_channels 물리 동형)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_visit_natures(p_clinic_id uuid)
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
  WHERE sc.code_type = 'visit_nature'
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

GRANT EXECUTE ON FUNCTION public.get_visit_natures(uuid) TO authenticated, anon;

-- PostgREST 스키마 캐시 새로고침
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (supervisor MIG-GATE / SQL Editor)
-- ════════════════════════════════════════════════════════════════════
-- 컬럼 존재(2행, 전부 is_nullable='YES'):
--   SELECT table_name, column_name, is_nullable FROM information_schema.columns
--     WHERE table_schema='public' AND column_name='visit_nature' AND table_name IN ('reservations','check_ins');
-- 코드 시드:
--   SELECT count(*) FROM public.system_codes WHERE code_type='visit_nature';   -- 기대: 4
-- 오버레이(experience 숨김 = clinics 수만큼):
--   SELECT count(*) FROM public.code_availability WHERE code_type='visit_nature' AND code='experience' AND is_available=false;
-- RPC(foot 노출 = experience 제외 3행: new/revisit/fulfillment):
--   SELECT code FROM public.get_visit_natures((SELECT id FROM public.clinics LIMIT 1)) ORDER BY sort_order;  -- 기대: new,revisit,fulfillment

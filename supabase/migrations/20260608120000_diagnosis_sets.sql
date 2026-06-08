-- T-20260608-foot-DX-BUNDLE-SET — 묶음상병(상병 세트) 신규 엔티티
-- 승인: planner approved (MSG-20260608-115731-x1xy / batch MSG-20260608-120716-wzdy). db_change=true.
-- 요청(문지은 대표원장 C0ATE5P6JTH): "묶음상병 — 여러 상병코드를 한 세트로 묶어 진료차트에서 일괄 적용.
--   묶음처방(prescription_sets)이랑 동일 개념."
-- rollback : 20260608120000_diagnosis_sets.rollback.sql
--
-- ⚠️ ADDITIVE ONLY / 신규 빈 테이블 — 기존 데이터/경로 무변경, 무손실.
--    · 상병 정본은 services.category_label='상병' 단일 SSOT 유지(두번째 상병 마스터 신설 아님).
--    · diagnosis_set_items.service_id 는 그 SSOT(services.id)를 FK 참조만 함.
--    · 진료차트 단건 상병 입력 경로(chart_diagnoses)는 무변경 — 세트는 '일괄 적용' additive 동선.
--
-- 미러 기준: prescription_sets(처방세트) 패턴. 단, 적용 대상이 RELATIONAL(chart_diagnoses 행 단위)
--    이므로 items 는 JSONB 가 아닌 정규화 자식 테이블(diagnosis_set_items)로 둠.
--    ⚠️ 묶음처방 네이밍(DXTOOL-MENU-REORG human_pending)에는 결합하지 않음 — 구조 패턴만 차용.
--
-- supervisor SQL 게이트 대상. prod 적용은 supervisor 검토·실행 (dev-foot prod 직접실행 금지).
-- FE(AC-1/2) 는 본 마이그 GO 적용 후 착수(throwaway 방지).

-- ── 1. diagnosis_sets — 상병 묶음 마스터 ────────────────────────────────────────
--  clinic_id = 지점 격리(services.clinic_id 정합). clinic 삭제 시 세트 연쇄 삭제.
--  diagnosis_folder = TEXT polyfolder(처방세트 folder 패턴과 동일, 별도 분류테이블 미참조).
CREATE TABLE IF NOT EXISTS public.diagnosis_sets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name             text NOT NULL,
  diagnosis_folder text,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_sets_clinic
  ON public.diagnosis_sets (clinic_id);

COMMENT ON TABLE public.diagnosis_sets IS
  'T-20260608-foot-DX-BUNDLE-SET 묶음상병 세트(빠른진단 프리셋). clinic 격리. diagnosis_folder=TEXT polyfolder.';

-- ── 2. diagnosis_set_items — 묶음 내 상병 항목(정규화, 순서 유지) ──────────────────
--  service_id FK → services.id (category_label='상병' 정본). 세트/약 삭제 시 연쇄 정리.
--  diagnosis_type = 주상병/부상병 구분(진료차트 chart_diagnoses 와 정합). 기본 primary.
CREATE TABLE IF NOT EXISTS public.diagnosis_set_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_set_id uuid NOT NULL REFERENCES public.diagnosis_sets(id) ON DELETE CASCADE,
  service_id       uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  diagnosis_type   text NOT NULL DEFAULT 'primary'
    CHECK (diagnosis_type IN ('primary', 'secondary')),
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_set_items_set
  ON public.diagnosis_set_items (diagnosis_set_id);
CREATE INDEX IF NOT EXISTS idx_diagnosis_set_items_service
  ON public.diagnosis_set_items (service_id);

-- 같은 세트 내 동일 상병 중복 방지(멱등 추가 안전망)
CREATE UNIQUE INDEX IF NOT EXISTS uq_diagnosis_set_items_set_service
  ON public.diagnosis_set_items (diagnosis_set_id, service_id);

COMMENT ON TABLE public.diagnosis_set_items IS
  'T-20260608-foot-DX-BUNDLE-SET 묶음 내 상병 항목(service_id FK → services.category_label=상병). 정렬 유지.';

-- ── 3. RLS (처방세트/상병폴더 동일 톤: authenticated read-all + write) ─────────────
ALTER TABLE public.diagnosis_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS diagnosis_sets_read_all  ON public.diagnosis_sets;
DROP POLICY IF EXISTS diagnosis_sets_write_auth ON public.diagnosis_sets;
CREATE POLICY diagnosis_sets_read_all  ON public.diagnosis_sets FOR SELECT TO authenticated USING (true);
CREATE POLICY diagnosis_sets_write_auth ON public.diagnosis_sets FOR ALL    TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.diagnosis_set_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS diagnosis_set_items_read_all  ON public.diagnosis_set_items;
DROP POLICY IF EXISTS diagnosis_set_items_write_auth ON public.diagnosis_set_items;
CREATE POLICY diagnosis_set_items_read_all  ON public.diagnosis_set_items FOR SELECT TO authenticated USING (true);
CREATE POLICY diagnosis_set_items_write_auth ON public.diagnosis_set_items FOR ALL    TO authenticated USING (true) WITH CHECK (true);

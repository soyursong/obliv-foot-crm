-- T-20260607-foot-DXRX-MGMT-2PANEL 갈래① 상병명 관리 — 3-A additive FK
-- 승인: planner D2 (MSG-20260607-141544-8dlp). db_change=true 확정.
-- 요청 맥락: 상병명 2패널 관리 UI(폴더 트리 + 항목). TEXT 폴더명 → 정규화 FK 격상.
-- rollback : 20260607200000_diagnosis_folders_fk.rollback.sql
-- backfill : 20260607200000_diagnosis_folders_fk.backfill.sql (supervisor 게이트 후 별도 실행)
--
-- ⚠️ ADDITIVE ONLY / 무손실 —
--    · 기존 services.diagnosis_folder TEXT 보존 (20260606160000 자산). DROP 안 함.
--    · services.diagnosis_folder_id uuid NULL FK 신규 additive 추가.
--    · 두 컬럼 공존 → backfill 로 TEXT→FK 매핑. TEXT 는 안전망으로 유지(추후 deprecate 별건).
--    · 상병 정본은 services.category_label='상병' 단일 SSOT 유지 (두번째 상병 마스터 신설 아님 —
--      diagnosis_folders 는 '분류 폴더'일 뿐 상병 항목 마스터가 아님).
--
-- ⚠️ 선행 의존: services.diagnosis_folder TEXT 컬럼.
--    dev DB 실측(2026-06-07) 결과 해당 컬럼 미적용 상태였음 → 본 마이그가 IF NOT EXISTS 로
--    방어적 보강(아래 0번). 적용 순서 무관하게 self-sufficient.
--
-- supervisor SQL 게이트 대상. prod 적용은 supervisor 검토·실행 (dev-foot prod 직접실행 금지).

-- ── 0. 선행 컬럼 방어 보강 (idempotent, 20260606160000 과 중복 무해) ────────────────
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS diagnosis_folder TEXT;

-- ── 1. diagnosis_folders — 상병 폴더(자기참조 다단계 트리) ──────────────────────────
--  parent_id NULL = 루트 폴더. ON DELETE CASCADE = 부모 폴더 삭제 시 하위 폴더 연쇄 삭제.
--  clinic_id = 지점 격리(services.clinic_id 정합). clinic 삭제 시 폴더 연쇄 삭제.
CREATE TABLE IF NOT EXISTS public.diagnosis_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES public.diagnosis_folders(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.diagnosis_folders IS
  'T-20260607-foot-DXRX-MGMT-2PANEL 상병 폴더 트리(자기참조 다단계). 상병 분류용. 상병 항목 정본 아님(services.category_label=상병 SSOT).';

CREATE INDEX IF NOT EXISTS idx_diagnosis_folders_clinic
  ON public.diagnosis_folders (clinic_id);
CREATE INDEX IF NOT EXISTS idx_diagnosis_folders_parent
  ON public.diagnosis_folders (parent_id);

-- 형제 폴더 이름 중복 방지 (NULL parent 는 별도 partial unique 로 처리: NULL 은 = 비교 불가)
CREATE UNIQUE INDEX IF NOT EXISTS uq_diagnosis_folders_root_name
  ON public.diagnosis_folders (clinic_id, name)
  WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_diagnosis_folders_child_name
  ON public.diagnosis_folders (clinic_id, parent_id, name)
  WHERE parent_id IS NOT NULL;

-- ── 2. services.diagnosis_folder_id — 상병→폴더 FK (additive) ─────────────────────
--  ON DELETE SET NULL = 폴더 삭제 시 상병 항목은 보존되고 미분류로 환원(처방 폴더와 동일 시맨틱).
--  NULL = 미분류. category_label='상병' 행에서만 의미(앱 레이어 필터).
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS diagnosis_folder_id uuid
    REFERENCES public.diagnosis_folders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.services.diagnosis_folder_id IS
  '상병(category_label=상병) 폴더 FK. NULL=미분류. TEXT diagnosis_folder 의 정규화 후신. T-20260607-foot-DXRX-MGMT-2PANEL';

CREATE INDEX IF NOT EXISTS idx_services_diagnosis_folder_id
  ON public.services (diagnosis_folder_id);

-- ── 3. RLS — 읽기: 인증사용자 전원 / 쓰기: 인증사용자(앱레이어 admin gate) ──────────
--  prescription_folders(20260607180000) 와 동일 패턴. clinic 격리는 앱레이어 필터 + clinic_id 컬럼.
ALTER TABLE public.diagnosis_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "diagnosis_folders_read_all"
  ON public.diagnosis_folders FOR SELECT TO authenticated USING (true);
CREATE POLICY "diagnosis_folders_write_auth"
  ON public.diagnosis_folders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 재실행 안전: CREATE TABLE/INDEX/COLUMN IF NOT EXISTS. (정책은 rollback 후 재적용)

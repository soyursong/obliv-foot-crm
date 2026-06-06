-- T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-0 RESOLVED 2026-06-06, planner MSG-150034-3hbt)
-- 상병명(진단명) 시스템 재설계 — [A] 폴더 분류 + [C] 원장별 즐겨찾기
-- 요청: 문지은 대표원장 (C0ATE5P6JTH, MSG-20260606-132414-hon1)
-- rollback: see 20260606160000_diagnosis_folder_and_favorites.rollback.sql
--
-- ⚠️ ADDITIVE ONLY — 기존 컬럼/테이블/저장경로(medical_charts.diagnosis) 무변경.
--    AC-0 정본 결정: (a) 기존 services 확장 채택 / (b) 신규 상병 마스터 테이블 기각.
--    "두번째 상병 마스터 신설 금지" 준수 — 상병 정본은 services.category_label='상병' 단일 SSOT 유지.
--
-- supervisor SQL 게이트 대상. prod 적용은 supervisor 검토·실행. (dev-foot prod 직접실행 금지)

-- ── [A] services.diagnosis_folder — 상병 폴더(그룹) 분류 ─────────────────────────
--  처방세트(prescription_sets.folder) 폴더 패턴을 상병 마스터에 미러.
--  nullable: 기존 상병 데이터는 전부 NULL(미분류)로 시작 → backfill 불요(graceful).
--  category_label='상병' 행에서만 의미를 가지며, 그 외 services 행에는 영향 없음(앱 레이어 필터).
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS diagnosis_folder TEXT;

COMMENT ON COLUMN public.services.diagnosis_folder IS
  '상병(category_label=상병) 폴더 분류명. NULL=미분류. T-20260606-foot-DIAGNOSIS-MASTER-MGMT';

-- ── [C] doctor_diagnosis_favorites — 원장별 상병 즐겨찾기 (nice-to-have, 분리가능) ──
--  원장(로그인 사용자)별 개별 즐겨찾기. auth.uid() 기준 RLS로 원장 간 완전 격리.
--  staff_id = auth.users(id) (앱의 profile.id 와 동일 키 — clinic_memos.created_by 패턴과 정합).
--  service_id = 상병 마스터(services) 링크. on delete cascade 로 상병 삭제 시 즐겨찾기 자동정리.
CREATE TABLE IF NOT EXISTS public.doctor_diagnosis_favorites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id  uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_doctor_diagnosis_favorites_staff
  ON public.doctor_diagnosis_favorites (staff_id);

-- ── RLS — 원장별 격리: 본인(auth.uid()) 행만 read/write ───────────────────────────
ALTER TABLE public.doctor_diagnosis_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ddf_select_own" ON public.doctor_diagnosis_favorites
  FOR SELECT TO authenticated USING (staff_id = auth.uid());

CREATE POLICY "ddf_insert_own" ON public.doctor_diagnosis_favorites
  FOR INSERT TO authenticated WITH CHECK (staff_id = auth.uid());

CREATE POLICY "ddf_delete_own" ON public.doctor_diagnosis_favorites
  FOR DELETE TO authenticated USING (staff_id = auth.uid());

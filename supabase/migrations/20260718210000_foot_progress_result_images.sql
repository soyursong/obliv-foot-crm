-- T-20260702-foot-PROGRESS-CSV-BULKRESULT — 경과분석 결과이미지 일괄업로드 → 환자 자동매칭·첨부 (백엔드)
-- CEO 결정 B(2026-07-18) + DA CONSULT-REPLY GO(ADDITIVE, DA-20260718-foot-PROGRESS-BULKRESULT-AUTOMATCH).
-- SSOT = _silver/2026-07-18/da_decision_foot_progress_bulkresult_automatch_contract_20260718.md
--
-- 스키마 ADDITIVE (§7): 신규 storage 버킷(private) + 첨부 테이블. 대표 게이트 면제(autonomy §3.1) → supervisor DDL-diff.
-- 계약 준수:
--   §4 dedup/멱등: 멱등키 (clinic_id, chart_no, visit_date, content_hash) UNIQUE.
--       · 동일파일 재업(동일 hash) → INSERT ... ON CONFLICT DO NOTHING = no-op(멱등, FE 책임)
--       · 동일 (chart_no,date) 다른 N장(다른 hash) → 각각 INSERT = 정상 1:N
--       · 재분석(다른 hash) → append 새 행, 이전본 파괴적 덮어쓰기 없음(감사 보존)
--   §6 PII: 결과이미지=임상 PHI → 버킷 private + storage RLS admin/manager 한정 + 첨부 감사컬럼.
--   §5 G6 감사: uploaded_by·matched_by·match_status·file_name·content_hash 컬럼 영속.
-- 멱등: idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING).
-- 롤백: 20260718210000_foot_progress_result_images.rollback.sql

BEGIN;

-- ── 1. Storage 버킷 (private) ───────────────────────────────────────────
-- 경로 컨벤션: progress-results/{clinic_id}/{customer_id}/{visit_date}_{content_hash8}.{ext}
INSERT INTO storage.buckets (id, name, public) VALUES
  ('progress-results', 'progress-results', false)
ON CONFLICT (id) DO NOTHING;

-- storage RLS: 기존 버킷(signatures/photos/documents=authenticated ALL)과 달리
--   임상 PHI(§6) → admin/manager(is_admin_or_manager: admin/manager/director) 한정.
DROP POLICY IF EXISTS "progress_results_admin_all" ON storage.objects;
CREATE POLICY "progress_results_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'progress-results' AND public.is_admin_or_manager())
  WITH CHECK (bucket_id = 'progress-results' AND public.is_admin_or_manager());

-- ── 2. 첨부 메타 테이블 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.progress_result_images (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid        NOT NULL REFERENCES public.clinics(id),
  customer_id  uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  chart_no     text        NOT NULL,                     -- §1 단독 조인키(파일명 파싱값, 정규화 후)
  visit_date   date        NOT NULL,                     -- §2 grain 축(방문일). 파일명 3번째 토큰
  image_url    text        NOT NULL,                     -- 'progress-results' 버킷 내부 경로
  file_name    text        NOT NULL,                     -- 원본 파일명(감사)
  content_hash text        NOT NULL,                     -- §4 sha256 hex (dedup/멱등)
  matched_by   text        NOT NULL DEFAULT 'auto' CHECK (matched_by IN ('auto','manual')),
  match_status text        NOT NULL DEFAULT 'auto' CHECK (match_status IN ('auto','manual','flagged')),
  -- match_status: auto=방문존재 자동매칭 / manual=사람 수동매칭·confirm / flagged=첨부되었으나 해당일 방문기록 없음(soft-flag §3-4)
  uploaded_by  uuid        REFERENCES auth.users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  note         text,
  -- §4 멱등키: 동일파일 재업 no-op / 다른 N장 정상 / 재분석 append
  CONSTRAINT progress_result_images_idem_uq UNIQUE (clinic_id, chart_no, visit_date, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_pri_customer ON public.progress_result_images(customer_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_pri_clinic   ON public.progress_result_images(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pri_chart    ON public.progress_result_images(clinic_id, chart_no, visit_date);

ALTER TABLE public.progress_result_images ENABLE ROW LEVEL SECURITY;

-- §6 PHI: admin/manager(is_admin_or_manager = admin/manager/director) + clinic 스코프 한정 read/insert.
DROP POLICY IF EXISTS "pri_admin_select" ON public.progress_result_images;
CREATE POLICY "pri_admin_select" ON public.progress_result_images
  FOR SELECT TO authenticated
  USING (clinic_id = public.current_user_clinic_id() AND public.is_admin_or_manager());

DROP POLICY IF EXISTS "pri_admin_insert" ON public.progress_result_images;
CREATE POLICY "pri_admin_insert" ON public.progress_result_images
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = public.current_user_clinic_id() AND public.is_admin_or_manager());

-- 오첨부 정정용 — 업로더 본인 행만 삭제(메타만; storage object는 FE 별도). 클리닉+권한 스코프 동반.
DROP POLICY IF EXISTS "pri_own_delete" ON public.progress_result_images;
CREATE POLICY "pri_own_delete" ON public.progress_result_images
  FOR DELETE TO authenticated
  USING (clinic_id = public.current_user_clinic_id() AND public.is_admin_or_manager() AND uploaded_by = auth.uid());

COMMENT ON TABLE public.progress_result_images IS
  '경과분석 외부분석 결과이미지 첨부 메타 (T-20260702-foot-PROGRESS-CSV-BULKRESULT). 파일명 이름_차트번호_날짜 파싱→chart_no 단독조인 자동매칭. 파일실체=progress-results 버킷(private). DA-20260718-foot-PROGRESS-BULKRESULT-AUTOMATCH 계약.';

COMMIT;

-- ============================================================
-- T-20260526-foot-PROGRESS-CHECKPOINT Phase 2 (AC-3 tag / AC-4)
-- reservations 테이블에 progress_check_required 컬럼 추가
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-05-27
-- 선행: 20260526170000_progress_plans.sql (package_progress_plans 존재)
-- 롤백: 20260527000000_progress_check_resv.rollback.sql
-- risk: ADD COLUMN DEFAULT FALSE — 기존 행 변경 없음. GO (0/5)
-- ============================================================

BEGIN;

-- ── reservations: 경과분석 필요 플래그 + 레이블 ──────────────────────────────

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS progress_check_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS progress_check_label    TEXT;

COMMENT ON COLUMN public.reservations.progress_check_required IS
  'T-PROGRESS-CHECKPOINT AC-3: 예약 생성 시 package_progress_plans 체크포인트 도달 여부.
   TRUE = 이 예약 회차가 경과분석 대상. 예약 생성 후 FE 비즈니스 로직으로 설정.';

COMMENT ON COLUMN public.reservations.progress_check_label IS
  'package_progress_plans.label 복사 (예: "6회 중간 경과분석"). 예약 카드 배지 표시용.';

-- 인덱스: 경과분석 필요 예약 빠른 조회 (대시보드 필터)
CREATE INDEX IF NOT EXISTS idx_reservations_progress_check
  ON public.reservations (clinic_id, reservation_date)
  WHERE progress_check_required = TRUE;

COMMIT;

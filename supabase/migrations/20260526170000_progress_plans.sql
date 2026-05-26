-- ============================================================
-- T-20260526-foot-PROGRESS-CHECKPOINT Phase 1 (AC-1)
-- package_progress_plans: 경과분석 체크포인트 설정 테이블
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-05-26
-- 선행: T-20260525-foot-MESSAGING-V1 (notification_logs 존재 확인)
-- 롤백: 20260526170000_progress_plans.rollback.sql
-- risk: INSERT only — 기존 테이블 변경 없음 (Phase 1). GO 0/5
-- ============================================================

BEGIN;

-- ── package_progress_plans 테이블 ─────────────────────────────────────────────
-- 클리닉·패키지타입별 경과분석 회차를 관리하는 설정 테이블
-- Phase 2에서 reservations.anticipated_session_number와 JOIN하여 milestone 여부 판단

CREATE TABLE IF NOT EXISTS public.package_progress_plans (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          UUID          NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  package_type       TEXT          NOT NULL,    -- 'package1' | 'blelabel' | 'special' | ...
  session_milestone  INTEGER       NOT NULL,    -- 경과분석 대상 회차 (예: 6, 12, 18)
  label              TEXT          NOT NULL DEFAULT '경과분석',
                                               -- 카드·알림에 표시할 레이블
  notify_staff       BOOLEAN       NOT NULL DEFAULT TRUE,   -- 스태프 인앱 알림
  notify_patient     BOOLEAN       NOT NULL DEFAULT FALSE,  -- 환자 SMS 알림 (Phase 2)
  is_active          BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by         TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT chk_ppp_milestone_positive CHECK (session_milestone > 0),
  CONSTRAINT uq_ppp_clinic_type_milestone UNIQUE (clinic_id, package_type, session_milestone)
);

COMMENT ON TABLE  public.package_progress_plans IS
  'T-PROGRESS-CHECKPOINT: 패키지 타입별 경과분석 회차 설정. Phase 2에서 예약 연동.';
COMMENT ON COLUMN public.package_progress_plans.package_type IS
  'packages.package_type과 동일값 (join key). 예: package1, blelabel, special';
COMMENT ON COLUMN public.package_progress_plans.session_milestone IS
  '경과분석 대상 회차. anticipated_session_number와 비교.';
COMMENT ON COLUMN public.package_progress_plans.label IS
  '예약 카드·알림에 표시할 한글 레이블. 예: "6회 중간 경과분석"';
COMMENT ON COLUMN public.package_progress_plans.notify_patient IS
  'TRUE = Phase 2 SMS 발송 대상. FALSE = 스태프 인앱 알림만.';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_ppp_clinic_active
  ON public.package_progress_plans(clinic_id, is_active);

CREATE INDEX IF NOT EXISTS idx_ppp_clinic_type_milestone
  ON public.package_progress_plans(clinic_id, package_type, session_milestone)
  WHERE is_active = TRUE;

-- updated_at 자동 갱신
DROP TRIGGER IF EXISTS trg_ppp_updated_at ON public.package_progress_plans;
CREATE TRIGGER trg_ppp_updated_at
  BEFORE UPDATE ON public.package_progress_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.package_progress_plans ENABLE ROW LEVEL SECURITY;

-- SELECT: 인증된 사용자 — 자기 클리닉만
DROP POLICY IF EXISTS ppp_select ON public.package_progress_plans;
CREATE POLICY ppp_select ON public.package_progress_plans
  FOR SELECT TO authenticated
  USING (clinic_id = public.current_user_clinic_id());

-- INSERT/UPDATE/DELETE: admin · manager · director 만
DROP POLICY IF EXISTS ppp_write ON public.package_progress_plans;
CREATE POLICY ppp_write ON public.package_progress_plans
  FOR ALL TO authenticated
  USING (
    clinic_id = public.current_user_clinic_id()
    AND public.current_user_role() IN ('admin', 'manager', 'director')
  )
  WITH CHECK (
    clinic_id = public.current_user_clinic_id()
    AND public.current_user_role() IN ('admin', 'manager', 'director')
  );

-- ── 기본 시드 데이터 (종로 풋센터: jongno-foot) ─────────────────────────────

DO $$
DECLARE
  v_clinic UUID;
BEGIN
  SELECT id INTO v_clinic FROM public.clinics WHERE slug = 'jongno-foot';
  IF v_clinic IS NULL THEN
    RAISE WARNING 'jongno-foot clinic not found — seed skipped';
    RETURN;
  END IF;

  -- idempotent: 충돌 시 label·notify_staff·is_active 갱신
  INSERT INTO public.package_progress_plans
    (clinic_id, package_type, session_milestone, label, notify_staff, notify_patient, is_active)
  VALUES
    -- 패키지1 (12회)
    (v_clinic, 'package1',  6,  '6회 중간 경과분석',  TRUE, FALSE, TRUE),
    (v_clinic, 'package1', 12,  '12회 최종 경과분석', TRUE, FALSE, TRUE),
    -- 블레라벨 (36회)
    (v_clinic, 'blelabel',  6,  '6회 경과분석',       TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 12,  '12회 중간 경과분석', TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 18,  '18회 경과분석',      TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 24,  '24회 경과분석',      TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 30,  '30회 경과분석',      TRUE, FALSE, TRUE),
    (v_clinic, 'blelabel', 36,  '36회 최종 경과분석', TRUE, FALSE, TRUE),
    -- 스페셜
    (v_clinic, 'special',   6,  '6회 중간 경과분석',  TRUE, FALSE, TRUE),
    (v_clinic, 'special',  12,  '12회 최종 경과분석', TRUE, FALSE, TRUE)
  ON CONFLICT (clinic_id, package_type, session_milestone)
    DO UPDATE SET
      label         = EXCLUDED.label,
      notify_staff  = EXCLUDED.notify_staff,
      is_active     = EXCLUDED.is_active,
      updated_at    = now();

  RAISE NOTICE '✅ package_progress_plans: 종로 풋센터 시드 10건 완료';
END $$;

COMMIT;

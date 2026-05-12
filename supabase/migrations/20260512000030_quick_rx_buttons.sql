-- ============================================================
-- T-20260512-foot-QUICK-RX-BUTTON
-- 빠른처방 단축 버튼 + check_ins.prescription_status
-- Rollback: 20260512000030_quick_rx_buttons.down.sql
-- ============================================================

BEGIN;

-- ─── 1. check_ins.prescription_status 컬럼 추가 ──────────────
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS prescription_status TEXT NOT NULL DEFAULT 'none'
    CHECK (prescription_status IN ('none', 'pending', 'confirmed'));

COMMENT ON COLUMN public.check_ins.prescription_status IS
  '빠른처방 상태: none=없음 | pending=임시(치료사 입력) | confirmed=확정(의사 컨펌)';

-- ─── 2. quick_rx_buttons 테이블 ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.quick_rx_buttons (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID        REFERENCES public.clinics(id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  icon                TEXT        NOT NULL DEFAULT 'pill',
  prescription_set_id INT         NOT NULL REFERENCES public.prescription_sets(id) ON DELETE CASCADE,
  sort_order          INT         NOT NULL DEFAULT 0,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.quick_rx_buttons IS
  '빠른처방 단축 버튼 — 어드민 등록, 차트/리스트에서 원클릭 처방';
COMMENT ON COLUMN public.quick_rx_buttons.icon IS
  'lucide icon name: pill | activity | zap | heart | stethoscope | thermometer | bandage | syringe';

-- ─── 3. updated_at 트리거 ─────────────────────────────────────
DROP TRIGGER IF EXISTS quick_rx_buttons_updated_at ON public.quick_rx_buttons;
CREATE TRIGGER quick_rx_buttons_updated_at
  BEFORE UPDATE ON public.quick_rx_buttons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 4. RLS ───────────────────────────────────────────────────
ALTER TABLE public.quick_rx_buttons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_read_quick_rx_buttons"
  ON public.quick_rx_buttons FOR SELECT
  TO authenticated USING (true);

-- admin/manager/director만 쓰기 (치료사는 읽기만)
CREATE POLICY "admin_write_quick_rx_buttons"
  ON public.quick_rx_buttons FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role IN ('admin', 'manager', 'director')
        AND user_profiles.active = true
    )
  );

COMMIT;

-- T-20260506-foot-LAYOUT-DEFAULT-SAVE
-- 배치편집 마지막 저장 → 전 직원 기본세팅 (localStorage → DB 전환)
-- 2026-05-06 dev-foot
-- A안: 클리닉당 공유 레이아웃 1개 (clinic_id UNIQUE)
-- B안(개인 오버라이드): 추후 별도 테이블로 확장 가능

CREATE TABLE IF NOT EXISTS clinic_dashboard_layouts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID        NOT NULL UNIQUE REFERENCES clinics(id) ON DELETE CASCADE,
  layout_data JSONB      NOT NULL,           -- { groupOrder: string[], zoomLevel: number }
  saved_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clinic_dashboard_layouts_clinic_idx
  ON clinic_dashboard_layouts(clinic_id);

COMMENT ON TABLE clinic_dashboard_layouts IS
  '대시보드 배치 편집 결과 — 클리닉당 1건, 전 직원 공유 (A안). 2026-05-06';

-- RLS 활성화
ALTER TABLE clinic_dashboard_layouts ENABLE ROW LEVEL SECURITY;

-- 같은 클리닉 활성 계정: 읽기 (전 직원)
CREATE POLICY "clinic_dashboard_layouts_select" ON clinic_dashboard_layouts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = clinic_dashboard_layouts.clinic_id
        AND active    = true
        AND approved  = true
    )
  );

-- admin/manager: INSERT
CREATE POLICY "clinic_dashboard_layouts_insert" ON clinic_dashboard_layouts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = clinic_dashboard_layouts.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

-- admin/manager: UPDATE (upsert 시 사용)
CREATE POLICY "clinic_dashboard_layouts_update" ON clinic_dashboard_layouts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = clinic_dashboard_layouts.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

-- admin/manager: DELETE
CREATE POLICY "clinic_dashboard_layouts_delete" ON clinic_dashboard_layouts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = clinic_dashboard_layouts.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

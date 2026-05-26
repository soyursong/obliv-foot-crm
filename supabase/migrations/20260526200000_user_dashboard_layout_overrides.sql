-- T-20260526-foot-LAYOUT-USER-CUSTOM
-- 대시보드 배치편집 계정별 커스텀 오버라이드
-- 별도 테이블 방식: clinic_dashboard_layouts(지점 기본) + user_dashboard_layout_overrides(개인)
-- 로딩 우선순위: 개인 → 지점 기본 → 코드 기본값 fallback
-- 2026-05-26 dev-foot

CREATE TABLE IF NOT EXISTS user_dashboard_layout_overrides (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  layout_data JSONB       NOT NULL,           -- { groupOrder: string[], zoomLevel: number }
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT udlo_clinic_user_unique UNIQUE (clinic_id, user_id)
);

CREATE INDEX IF NOT EXISTS udlo_clinic_idx ON user_dashboard_layout_overrides(clinic_id);
CREATE INDEX IF NOT EXISTS udlo_user_idx  ON user_dashboard_layout_overrides(user_id);

COMMENT ON TABLE user_dashboard_layout_overrides IS
  '대시보드 배치편집 계정별 개인 오버라이드. 개인→지점기본→코드기본 3단계 폴백. 2026-05-26 (T-20260526-foot-LAYOUT-USER-CUSTOM)';

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE user_dashboard_layout_overrides ENABLE ROW LEVEL SECURITY;

-- SELECT: 같은 클리닉 활성 계정이면 자신의 행 조회 가능
CREATE POLICY "udlo_select" ON user_dashboard_layout_overrides
  FOR SELECT USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = user_dashboard_layout_overrides.clinic_id
        AND active    = true
        AND approved  = true
    )
  );

-- INSERT: 자기 user_id 행만 (같은 클리닉 활성 계정)
CREATE POLICY "udlo_insert" ON user_dashboard_layout_overrides
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = user_dashboard_layout_overrides.clinic_id
        AND active    = true
        AND approved  = true
    )
  );

-- UPDATE: 자기 행만
CREATE POLICY "udlo_update" ON user_dashboard_layout_overrides
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = user_dashboard_layout_overrides.clinic_id
        AND active    = true
        AND approved  = true
    )
  );

-- DELETE: 자기 행만
CREATE POLICY "udlo_delete" ON user_dashboard_layout_overrides
  FOR DELETE USING (user_id = auth.uid());

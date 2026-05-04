-- T-20260504-foot-CLINIC-MEMO
-- 원내 공지 메모란: 날짜별 메모 (원장님 스케줄, 원내 공지 등)
-- 2026-05-04 dev-foot

CREATE TABLE IF NOT EXISTS clinic_memos (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  content     TEXT        NOT NULL,
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (clinic_id, date)
);

CREATE INDEX IF NOT EXISTS clinic_memos_clinic_date_idx
  ON clinic_memos(clinic_id, date);

COMMENT ON TABLE clinic_memos IS
  '날짜별 원내 공지 메모 — 원장님 스케줄, 당일 공지 등 (1날짜 1건)';

-- RLS 활성화
ALTER TABLE clinic_memos ENABLE ROW LEVEL SECURITY;

-- 같은 클리닉 활성 계정: 읽기
CREATE POLICY "clinic_memos_select" ON clinic_memos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = clinic_memos.clinic_id
        AND active    = true
        AND approved  = true
    )
  );

-- admin/manager: INSERT
CREATE POLICY "clinic_memos_insert" ON clinic_memos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = clinic_memos.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

-- admin/manager: UPDATE
CREATE POLICY "clinic_memos_update" ON clinic_memos
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = clinic_memos.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

-- admin/manager: DELETE
CREATE POLICY "clinic_memos_delete" ON clinic_memos
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = clinic_memos.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_clinic_memos_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clinic_memos_updated_at
  BEFORE UPDATE ON clinic_memos
  FOR EACH ROW EXECUTE FUNCTION update_clinic_memos_updated_at();

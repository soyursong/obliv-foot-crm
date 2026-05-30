-- T-20260530-foot-CLOSING-TRANSFER-ROW
-- 일마감 실제정산에 「이체」 ReconRow 추가 — actual_transfer_total 컬럼 신설
-- additive · NOT NULL DEFAULT 0 → 기존 행 자동 0 채움, 무중단
ALTER TABLE daily_closings
  ADD COLUMN IF NOT EXISTS actual_transfer_total INTEGER NOT NULL DEFAULT 0;

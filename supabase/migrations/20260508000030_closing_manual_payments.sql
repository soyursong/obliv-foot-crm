-- T-20260508-foot-DAILY-CLOSING-MENU
-- 일마감 수기 결제내역 테이블
-- 일마감 결제내역 탭에서 수기 추가/수정 가능한 항목을 저장

CREATE TABLE IF NOT EXISTS closing_manual_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  close_date  date NOT NULL,
  pay_time    text,                -- HH:mm 형식
  chart_number text,
  customer_name text NOT NULL,
  lead_source text,
  visit_type  text,               -- 'new' | 'returning' | 'experience' | null
  staff_name  text,               -- 결제담당
  amount      integer NOT NULL DEFAULT 0,
  method      text NOT NULL DEFAULT 'card', -- card | cash | transfer
  memo        text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_closing_manual_payments_clinic_date
  ON closing_manual_payments (clinic_id, close_date);

-- RLS
ALTER TABLE closing_manual_payments ENABLE ROW LEVEL SECURITY;

-- admin/manager/coordinator는 읽기+쓰기 가능
CREATE POLICY "closing_manual_read" ON closing_manual_payments
  FOR SELECT USING (true);

CREATE POLICY "closing_manual_insert" ON closing_manual_payments
  FOR INSERT WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles
      WHERE id = auth.uid() AND active = true
    )
  );

CREATE POLICY "closing_manual_update" ON closing_manual_payments
  FOR UPDATE USING (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles
      WHERE id = auth.uid() AND active = true
    )
  );

CREATE POLICY "closing_manual_delete" ON closing_manual_payments
  FOR DELETE USING (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles
      WHERE id = auth.uid() AND active = true
    )
  );

-- 롤백: DROP TABLE IF EXISTS closing_manual_payments;

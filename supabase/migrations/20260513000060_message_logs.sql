-- T-20260513-foot-C21-TAB-RESTRUCTURE-C: 문자 발송 이력 테이블
-- 환자에게 발송한 문자/알림톡 이력을 기록. 현재는 스태프 수동 입력,
-- 추후 알림톡 API 연동 시 자동 기록으로 전환 예정.

CREATE TABLE IF NOT EXISTS message_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  clinic_id   uuid NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  content     text NOT NULL,
  status      text NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent', 'failed', 'pending')),
  message_type text NOT NULL DEFAULT 'manual'
                CHECK (message_type IN ('sms', 'kakao', 'manual')),
  sent_by_name text,
  memo        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자 전체 허용 (clinic_id 기반 세분화는 알림톡 API 연동 시 강화)
CREATE POLICY "message_logs_authenticated"
  ON message_logs FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- 인덱스
CREATE INDEX IF NOT EXISTS message_logs_customer_idx
  ON message_logs (customer_id, sent_at DESC);

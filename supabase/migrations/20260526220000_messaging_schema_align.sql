-- T-20260525-foot-MESSAGING-V1 S1 스키마 정렬
-- 풋 DB 스키마를 롱레(happy-flow-queue) 스키마 및 EF 기대값과 동기화
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 롤백: 20260526220000_messaging_schema_align.rollback.sql
-- 작성: dev-foot / 2026-05-26
--
-- 수정 항목:
--   1. notification_templates.template  → body
--   2. notification_templates.active    → is_active
--   3. notification_templates.channel CHECK: 'push','kakao' → 'lms','alimtalk'
--   4. notification_logs.provider_msg_id → solapi_message_id (rename)
--   5. notification_logs: body_rendered TEXT 컬럼 추가
--   6. notification_logs: error_code TEXT 컬럼 추가
--   7. notification_logs.status CHECK: 'opt_out','skipped' 추가
--   8. notification_logs.channel CHECK: 'lms','alimtalk' 추가
--
-- 배경:
--   20260525030000_messaging_module.sql 은 롱레 원본 대신 별도 설계로 생성되어
--   EF(send-notification) 및 AdminSettings.tsx 가 기대하는 컬럼명/CHECK 와 불일치.
--   이 마이그레이션으로 풋 DB를 롱레/EF 표준으로 맞춤.

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- SECTION 1: notification_templates 컬럼 이름 정렬
-- ══════════════════════════════════════════════════════════════════

-- 1-A. template → body
ALTER TABLE public.notification_templates
  RENAME COLUMN template TO body;

COMMENT ON COLUMN public.notification_templates.body IS
  'T-20260525-foot-MESSAGING-V1: 메시지 본문 (치환 변수 포함). '
  '예: [오블리브 풋 #{지점명}] #{고객명}님, 내일 #{예약시간} 방문 예정입니다...';

-- 1-B. active → is_active
ALTER TABLE public.notification_templates
  RENAME COLUMN active TO is_active;

COMMENT ON COLUMN public.notification_templates.is_active IS
  'T-20260525-foot-MESSAGING-V1: 템플릿 활성화 여부. FALSE = 해당 이벤트 발송 비활성.';

-- 1-C. channel CHECK 업데이트: 'kakao','push' → 'lms','alimtalk'
ALTER TABLE public.notification_templates
  DROP CONSTRAINT IF EXISTS notification_templates_channel_check;

ALTER TABLE public.notification_templates
  ADD CONSTRAINT notification_templates_channel_check
  CHECK (channel IN ('sms', 'lms', 'alimtalk'));

-- ══════════════════════════════════════════════════════════════════
-- SECTION 2: notification_logs 컬럼 정렬
-- ══════════════════════════════════════════════════════════════════

-- 2-A. provider_msg_id → solapi_message_id
ALTER TABLE public.notification_logs
  RENAME COLUMN provider_msg_id TO solapi_message_id;

COMMENT ON COLUMN public.notification_logs.solapi_message_id IS
  'T-20260525-foot-MESSAGING-V1: Solapi 외부 발송 공급자로부터 반환된 메시지 ID';

-- 2-B. body_rendered 컬럼 추가 (치환 완료된 실발송 본문)
ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS body_rendered TEXT;

COMMENT ON COLUMN public.notification_logs.body_rendered IS
  'T-20260525-foot-MESSAGING-V1: 치환 완료된 실발송 본문';

-- 2-C. error_code 컬럼 추가 (Solapi/외부 오류 코드)
ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS error_code TEXT;

COMMENT ON COLUMN public.notification_logs.error_code IS
  'T-20260525-foot-MESSAGING-V1: 발송 실패 시 Solapi 오류 코드';

-- 2-D. status CHECK 업데이트: 'opt_out','skipped' 추가
--      기존 CHECK: ('pending','sent','failed','cancelled')
--      신규 CHECK: ('pending','sent','failed','cancelled','opt_out','skipped')
ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_status_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_status_check
  CHECK (status IN ('pending','sent','failed','cancelled','opt_out','skipped'));

-- 2-E. channel CHECK 업데이트: 'kakao','push' → 'lms','alimtalk'
ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_channel_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_channel_check
  CHECK (channel IN ('sms', 'lms', 'alimtalk'));

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- POST-DEPLOY CHECKLIST
-- ══════════════════════════════════════════════════════════════════
-- [ ] 컬럼 이름 확인:
--     SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'notification_templates'
--     ORDER BY ordinal_position;
--     → body, is_active 포함 확인
--
-- [ ] notification_logs 컬럼 확인:
--     SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'notification_logs'
--     ORDER BY ordinal_position;
--     → solapi_message_id, body_rendered, error_code 포함 확인
--
-- [ ] status CHECK 확인 (opt_out/skipped 가능 여부):
--     INSERT INTO public.notification_logs (
--       clinic_id, event_type, channel, status)
--     VALUES (gen_random_uuid(), 'test', 'sms', 'opt_out');
--     → 오류 없이 삽입 성공해야 함
--     (테스트 후 롤백: ROLLBACK 또는 DELETE)
-- ══════════════════════════════════════════════════════════════════

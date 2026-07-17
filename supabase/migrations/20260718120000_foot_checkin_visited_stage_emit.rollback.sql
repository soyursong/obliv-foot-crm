-- ROLLBACK — T-20260717-foot-CHECKIN-VISITED-EMIT-DOPAMINE (접근 B, stage 축 emit)
-- 20260718120000_foot_checkin_visited_stage_emit.sql 역연산.
--
-- ⚠ 순서: 트리거·함수 제거 → visited_stage outbox 행 정리 → CHECK 원복(visited_stage 제거).
--   CHECK 원복 전 visited_stage 행이 남아 있으면 제약 위반으로 실패하므로 먼저 정리.
--   미발신분=무해 폐기, 발신완료분도 audit 성격이라 삭제 가능(수신부 foot_callback_log 는 별도 유지).
--   운영 중 롤백 시 미착지 visited_stage 유실 감수(멱등키 재적재로 재개 가능).
--
-- ※ 기존 process_status 축(enqueue_dopamine_callback/trg_dopamine_cb_checkin) 및
--   reschedule 은 무접촉 — 본 롤백은 stage 축 신규 leg 만 원복.

BEGIN;

-- 1) 트리거 + 함수 제거 (stage 축)
DROP TRIGGER IF EXISTS trg_dopamine_cb_checkin_stage ON public.check_ins;
DROP FUNCTION IF EXISTS public.enqueue_dopamine_visited_stage();

-- 2) visited_stage outbox 행 정리 (CHECK 원복 전 위반 제거)
DELETE FROM public.dopamine_callback_outbox WHERE event_type = 'visited_stage';

-- 3) event_type CHECK 원복 (visited_stage 제거 = 직전 6→5값: reschedule 까지 보존)
ALTER TABLE public.dopamine_callback_outbox
  DROP CONSTRAINT IF EXISTS dopamine_callback_outbox_event_type_check;

ALTER TABLE public.dopamine_callback_outbox
  ADD CONSTRAINT dopamine_callback_outbox_event_type_check
  CHECK (event_type IN ('visited','no_show','cancelled','rejected','reschedule'));

COMMIT;

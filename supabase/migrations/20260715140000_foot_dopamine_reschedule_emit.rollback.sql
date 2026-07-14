-- ROLLBACK — T-20260714-foot-LIFECYCLE-CALLBACK-OUTBOX-EMIT (step2, reschedule emit)
-- 20260715140000_foot_dopamine_reschedule_emit.sql 역연산.
--
-- ⚠ 순서: 트리거·함수 제거 → CHECK 를 원복(reschedule 제거).
--   CHECK 원복 전 reschedule 행이 남아 있으면 제약 위반으로 실패하므로,
--   잔여 reschedule outbox 행을 먼저 정리(미발신분 무해 폐기, 발신완료분도 audit 성격이라 삭제 가능).
--   운영 중 롤백 시 미착지 reschedule 유실 감수(shadow/dry-run 단계 전제).

BEGIN;

-- 1) 트리거 + 함수 제거
DROP TRIGGER IF EXISTS trg_dopamine_cb_resv_reschedule ON public.reservations;
DROP FUNCTION IF EXISTS public.enqueue_dopamine_reschedule();

-- 2) reschedule outbox 행 정리 (CHECK 원복 전 위반 제거)
DELETE FROM public.dopamine_callback_outbox WHERE event_type = 'reschedule';

-- 3) event_type CHECK 원복 (reschedule 제거 = 원래 4값)
ALTER TABLE public.dopamine_callback_outbox
  DROP CONSTRAINT IF EXISTS dopamine_callback_outbox_event_type_check;

ALTER TABLE public.dopamine_callback_outbox
  ADD CONSTRAINT dopamine_callback_outbox_event_type_check
  CHECK (event_type IN ('visited','no_show','cancelled','rejected'));

COMMIT;

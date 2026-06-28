-- T-20260628-foot-NOTIFLOG-STATUS-CHECK-DELIVERED-ALTER
-- notification_logs.status CHECK 에 단말 도달/미도달 버킷 ADDITIVE 추가
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 롤백: 20260628120000_notiflog_status_delivered_atafail.rollback.sql
-- 작성: dev-foot / 2026-06-28
-- CONSULT: data-architect GO (MSG-20260628-151114-5bmx)
--
-- 변경 (ADDITIVE only — 기존 값 보존):
--   기존 6값: ('pending','sent','failed','cancelled','opt_out','skipped')
--   신규 8값: ('pending','sent','failed','cancelled','opt_out','skipped','delivered','ata_fail')
--
-- 정본 어휘 고정:
--   'delivered' = 단말 도달 (수신자 단말에 메시지가 실제 도달)
--   'ata_fail'  = 단말 미도달 (발송 제출은 됐으나 단말 도달 실패)
--   ★ 'failed'(제출 실패) ≠ 'ata_fail'(단말 미도달) → 절대 병합 금지, 별 버킷 유지.
--   자의 변형(failed_delivery 등) 금지.
--
-- 배경:
--   FOOT alimtalk 현재 발송 0건이나, 풀퍼널(알림톡 ATA 콜백) 대비
--   write 경로를 롱레/표준과 동일하게 선개방. DA 정당 인정.
--
-- 게이트: ADDITIVE + DA GO → 대표 게이트 면제(autonomy §3.1).
--         supervisor DDL-diff GO 후 prod 적용. E2E 면제(db_only).

BEGIN;

ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_status_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_status_check
  CHECK (status IN (
    'pending','sent','failed','cancelled','opt_out','skipped',
    'delivered','ata_fail'
  ));

COMMENT ON CONSTRAINT notification_logs_status_check ON public.notification_logs IS
  'T-20260628-foot-NOTIFLOG-STATUS-CHECK-DELIVERED-ALTER: '
  'delivered=단말 도달, ata_fail=단말 미도달. '
  'failed(제출 실패) != ata_fail(단말 미도달) — 별 버킷, 병합 금지.';

COMMIT;

-- ── 검수 체크리스트 ──────────────────────────────────────────────
-- [ ] 제약 정의 확인:
--     SELECT pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conname='notification_logs_status_check';
--     → delivered, ata_fail 8값 포함 확인
-- [ ] delivered INSERT 가능 확인:
--     INSERT INTO public.notification_logs (clinic_id, event_type, channel, status)
--       VALUES (gen_random_uuid(), 'test', 'alimtalk', 'delivered');
-- [ ] ata_fail INSERT 가능 확인:
--     INSERT INTO public.notification_logs (clinic_id, event_type, channel, status)
--       VALUES (gen_random_uuid(), 'test', 'alimtalk', 'ata_fail');
-- [ ] 잘못된 값 거부 확인 (failed_delivery → 제약 위반 기대):
--     INSERT ... status='failed_delivery';  -- 23514 expected

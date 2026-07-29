-- ════════════════════════════════════════════════════════════════════════════
-- T-20260725-foot-MEDIREC-ROOMCAPTURE-FIELD-CONFIRM — 백필 ROLLBACK (시간경계 FALLBACK)
--
-- 1순위 롤백 = .rollback.mjs (archive JSON 의 정확 id-set → NULL, 값 일치 시에만).
-- 본 .sql = archive 유실 시 결정적 FALLBACK. 백필 APPLY 시각(2026-07-30 01:43 KST =
--   2026-07-29 16:43 UTC) 이전 transitioned_at 의 룸수반 room_id 만 NULL 복원.
--
-- 근거: 백필 前 in-window room_id NOT NULL = 0건(dry-run pre-probe 실증). 따라서
--   APPLY 시각 이전 transitioned_at 을 가진 룸수반 전이의 room_id NOT NULL 은 전부 백필분.
--   FE 캡처가 채우는 신규 전이는 transitioned_at > APPLY 시각 → 시간경계로 명확 분리(무접촉).
-- 안전: 60일 window 하한도 함께 걸어 백필 대상 범위 밖은 건드리지 않음.
-- author: dev-foot / 2026-07-30
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE status_transitions
   SET room_id = NULL
 WHERE clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
   AND to_status IN ('consultation','preconditioning','laser','heated_laser','examination')
   AND room_id IS NOT NULL
   AND transitioned_at <  TIMESTAMPTZ '2026-07-29 16:43:00+00'   -- 백필 APPLY 시각
   AND transitioned_at >= TIMESTAMPTZ '2026-07-29 16:43:00+00' - interval '60 days';

COMMIT;

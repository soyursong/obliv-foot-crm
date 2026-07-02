-- T-20260702-foot-DOPAINGEST-PHONE-HOVER-MISSING — rollback backfill
-- 대상 2건(apply RETURNING으로 확인된 id)만 customer_phone → NULL 복원.
-- 신규 인입은 EF forward fix가 채우므로 rollback 무관(旣존 backfill분만 되돌림).
BEGIN;

UPDATE reservations
SET customer_phone = NULL,
    updated_at = now()
WHERE id IN (
  'b9eb8032-048a-4f0d-9edd-0b4d768e00e8',  -- 풋테스트4
  '048e1be8-5d4c-4527-9030-39ec2735f59d'   -- 발톱스모크0702
);

COMMIT;

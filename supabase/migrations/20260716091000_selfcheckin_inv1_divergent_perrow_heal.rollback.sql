-- ROLLBACK — T-20260715-foot-SELFCHECKIN-LEGACYCREATE-SOURCECLOSE-HEAL Phase B
-- 폴백(§2-F): heal 로 checked_in 된 frozen reservation 을 old value 'confirmed' 로 원복.
-- 멱등: 명시 PK + status='checked_in' 가드(heal 이 만든 상태) → 재실행 무해.

BEGIN;

UPDATE public.reservations
   SET status = 'confirmed', updated_at = now()
 WHERE id = '26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a'::uuid
   AND status = 'checked_in';

COMMIT;

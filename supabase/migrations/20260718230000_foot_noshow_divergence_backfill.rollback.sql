-- ROLLBACK — T-20260716-foot-NOSHOW-CHECKIN-STATUS-DIVERGENCE-BACKFILL
-- 백필로 checked_in 으로 수렴시킨 2 PK 를 confirmed 로 역전 (DATA only, no DDL).
--
-- DA SOP §3-3 롤백 경로: status='confirmed' WHERE id IN(2 PK) AND status='checked_in'.
--   forward 가 confirmed→checked_in 만 수행하므로 이 역전이 forward 를 정확히 되돌린다.
--   멱등(old-value 임베드): checked_in 아닌 행(이미 롤백/타경로 변경)은 무접촉.
-- 안전: UPDATE only. check_ins 무접촉. 비파괴.

BEGIN;

UPDATE public.reservations
   SET status = 'confirmed'
 WHERE id IN (
   '26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a',
   '9f45105b-eff7-4056-a61d-e1308b837c0f'
 )
   AND status = 'checked_in';

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260718230000';

COMMIT;

-- ROLLBACK — T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL (김규리 CTB 3건 backfill)
--   삽입 PK DELETE(F-4550·F-5016 각 line+payment) + F-4906 seller 귀속 되돌림(→NULL).
--   고정 PK 기준 정확 되돌림. 재실행 안전(없으면 0-row).
-- ⚠ 순수 DML(트랜잭션 제어문 없음).

-- (B)(D) payment INSERT 되돌림
DELETE FROM public.payments
 WHERE id IN (
   '7a0935ed-f4ac-491d-86c0-8d09d0d9440f'::uuid,  -- F-4550 CTB payment
   '16729866-5bc8-40d6-9fc9-dc1286f692b8'::uuid   -- F-5016 CTB payment
 );

-- (A)(C) 라인 INSERT 되돌림
DELETE FROM public.check_in_services
 WHERE id IN (
   'bee88b6d-002c-4149-8c99-67d832b0e930'::uuid,  -- F-4550 CTB line
   '81c754c8-8cd8-4477-83fd-30fcbfe9bc19'::uuid   -- F-5016 CTB line
 );

-- (E) F-4906 seller 귀속 되돌림 (backfill 이 채운 값만 → NULL, 타 값이면 미접촉)
UPDATE public.check_in_services
   SET seller_staff_id = NULL
 WHERE id = 'f519496a-e90f-4961-bed6-087e882ee18d'::uuid
   AND seller_staff_id = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'::uuid;

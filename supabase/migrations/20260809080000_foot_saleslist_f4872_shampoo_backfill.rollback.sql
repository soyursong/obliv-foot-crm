-- ROLLBACK — T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL (F-4872 김정숙 풋샴푸 42,000 backfill)
--   삽입 PK DELETE(F-4872 line + payment). 고정 PK 기준 정확 되돌림. 재실행 안전(없으면 0-row).
--   seller UPDATE 없음(분기①은 신규 INSERT 만) → 되돌림도 DELETE 2행뿐.
-- ⚠ 순수 DML(트랜잭션 제어문 없음).

-- (B) payment INSERT 되돌림
DELETE FROM public.payments
 WHERE id = '7b8b9f74-c7aa-4d23-92ad-42033ec02096'::uuid;  -- F-4872 풋샴푸 payment

-- (A) 라인 INSERT 되돌림
DELETE FROM public.check_in_services
 WHERE id = '87beac3a-df9b-433b-827e-43e51a1d2107'::uuid;  -- F-4872 풋샴푸 line

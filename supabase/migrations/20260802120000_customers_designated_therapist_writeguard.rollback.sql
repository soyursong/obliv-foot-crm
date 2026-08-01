-- Rollback: T-20260725-foot-DESIGNPT-THERAPIST-ROLE-WRITEBLOCK
-- 지정 치료사 컬럼 write-guard 트리거/함수 제거.
-- 롤백 후 designated_therapist_id 쓰기 제약은 FE 게이트(T-20260722)만 남고 백엔드 강제는 사라진다(우회 재개방).

BEGIN;

DROP TRIGGER IF EXISTS trg_designated_therapist_writeguard ON public.customers;
DROP FUNCTION IF EXISTS public.fn_designated_therapist_writeguard();

COMMIT;

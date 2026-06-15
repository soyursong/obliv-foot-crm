-- ROLLBACK: 20260615170000_rls_clinic_isolation_anon_rpc_additive.sql
-- Phase 2a 는 ADDITIVE(RPC 7종 + GRANT) → 롤백 = 함수 DROP. anon SELECT 정책 무변경이었으므로
-- 데이터·기존 동선 무영향. (FE 가 아직 RPC 미사용 상태에서만 안전 롤백; 전환 후엔 2b 까지 함께 검토.)

BEGIN;

DROP FUNCTION IF EXISTS public.fn_selfcheckin_reservation_banner(UUID,TEXT);
DROP FUNCTION IF EXISTS public.fn_selfcheckin_find_customer(UUID,TEXT);
DROP FUNCTION IF EXISTS public.fn_selfcheckin_existing_checkin_today(UUID,UUID);
DROP FUNCTION IF EXISTS public.fn_selfcheckin_match_reservation(UUID,UUID,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.fn_selfcheckin_linked_checkin(UUID,UUID);
DROP FUNCTION IF EXISTS public.fn_selfcheckin_upsert_customer(UUID,TEXT,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.fn_selfcheckin_create_check_in(UUID,UUID,TEXT,TEXT,TEXT,TEXT,INT,JSONB,UUID);

COMMIT;

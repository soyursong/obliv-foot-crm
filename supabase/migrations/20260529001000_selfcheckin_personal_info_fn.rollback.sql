-- T-20260529-foot-SELFCHECKIN-FLOW-REVAMP rollback
DROP FUNCTION IF EXISTS public.fn_selfcheckin_update_personal_info(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_selfcheckin_create_health_q_token(UUID, UUID);

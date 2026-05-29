-- Rollback: T-20260529-crm-SELFCHECKIN-QR-REISSUE
-- fn_dashboard_reissue_health_q_token 제거

DROP FUNCTION IF EXISTS public.fn_dashboard_reissue_health_q_token(TEXT, TEXT, TEXT);

-- ============================================================================
-- ROLLBACK — T-20260802-foot-ATTENDANCE-QR-PORT
--   전량 ADDITIVE 이식의 역방향. 신규 테이블/뷰/RPC/컬럼 제거 + get_vault_secret 화이트리스트 원복.
--
-- ⚠ Vault 키(attendance_qr/otp/device_hmac_key)는 롤백에서 제거하지 않음(보안 자산 보존, rotation runbook 소관).
-- ⚠ staff.phone / staff_attendance.scheduled_* / clinics.attendance_* 컬럼은 데이터 유실 방지 위해
--    기본은 보존(주석 처리). 완전 원복이 필요하면 아래 DROP COLUMN 주석 해제.
-- ============================================================================

BEGIN;

DROP VIEW IF EXISTS public.v_attendance_reconcile;

DROP FUNCTION IF EXISTS public.revoke_attendance_device(UUID);
DROP FUNCTION IF EXISTS public.approve_attendance_device(UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_attendance_record_punch(UUID, UUID, TEXT, TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.fn_attendance_verdict(UUID, UUID, DATE);
DROP FUNCTION IF EXISTS public.set_staff_phone(UUID, UUID, TEXT);

DROP TABLE IF EXISTS public.attendance_device;
DROP TABLE IF EXISTS public.attendance_audit;
DROP TABLE IF EXISTS public.attendance_punch;
DROP TABLE IF EXISTS public.attendance_otp;

-- get_vault_secret 화이트리스트 원복 (attendance_ 제거)
CREATE OR REPLACE FUNCTION public.get_vault_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  IF p_name NOT SIMILAR TO '(solapi_|internal_cron_|supabase_)%' THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  RETURN v_secret;
END;
$$;

-- ADDITIVE 컬럼 — 데이터 유실 방지 기본 보존. 완전 원복 시 아래 주석 해제:
-- ALTER TABLE public.clinics          DROP COLUMN IF EXISTS attendance_absent_cutoff;
-- ALTER TABLE public.clinics          DROP COLUMN IF EXISTS attendance_late_grace_min;
-- ALTER TABLE public.staff_attendance DROP COLUMN IF EXISTS scheduled_end_at;
-- ALTER TABLE public.staff_attendance DROP COLUMN IF EXISTS scheduled_start_at;
-- ALTER TABLE public.staff            DROP COLUMN IF EXISTS phone;

COMMIT;

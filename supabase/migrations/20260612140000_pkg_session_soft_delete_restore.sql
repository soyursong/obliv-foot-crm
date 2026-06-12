-- T-20260612-foot-USAGEHIST-DELETE-RESTORE
-- 시술 사용이력(회차) 실수 삭제 원복 — HARD DELETE → SOFT DELETE + 복원.
--
-- 배경: src/pages/CustomerChartPage.tsx deleteSession() 가 package_sessions row를
--       물리삭제(.delete()) → 앱 복원 경로 0. 직원이 '수정' 대신 '삭제'를 실수로 누르면 회복 불가.
-- 해법: status='deleted' 표식 + deleted_at/deleted_by 감사컬럼. 복원 = status='used' 환원.
-- 잔여횟수 정합: computeRemainingFromSessionRows / 모든 UI 집계가 status='used'만 카운트하므로
--               'deleted' 전환 시 자동 +1, 복원 시 자동 -1 (추가 보정 불필요).
--
-- 권한 비확대 가드: 평범한 UPDATE로 status를 바꾸면 consultant/coordinator/therapist UPDATE 정책이
--   OR로 걸려 삭제권한이 확대됨. → SECURITY DEFINER RPC로 is_admin_or_manager() 게이트를
--   현재 DELETE 정책(package_sessions_admin_all)과 동일하게 강제. RLS 정책은 변경하지 않음.
--
-- ⚠️ supervisor DB게이트 통과 후 적용. data-architect CONSULT 선행(신규 컬럼 + status enum 확장).

-- 1) 감사 컬럼
ALTER TABLE package_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE package_sessions ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES staff(id);

-- 2) status CHECK 제약에 'deleted' 추가 (인라인 익명 CHECK → 표준명 package_sessions_status_check)
--    ⚠️ supervisor: 적용 전 실제 제약명 확인
--    SELECT conname FROM pg_constraint WHERE conrelid='package_sessions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%';
ALTER TABLE package_sessions DROP CONSTRAINT IF EXISTS package_sessions_status_check;
ALTER TABLE package_sessions ADD CONSTRAINT package_sessions_status_check
  CHECK (status IN ('used','cancelled','refunded','deleted'));

-- 3) soft-delete RPC (admin/manager 게이트 = 기존 DELETE 권한과 동일)
CREATE OR REPLACE FUNCTION soft_delete_package_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only';
  END IF;
  UPDATE package_sessions
     SET status = 'deleted', deleted_at = now(), deleted_by = current_staff_id()
   WHERE id = p_session_id AND status = 'used';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or not in used state';
  END IF;
END;
$$;

-- 4) restore RPC (동일 게이트)
CREATE OR REPLACE FUNCTION restore_package_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'permission denied: admin/manager only';
  END IF;
  UPDATE package_sessions
     SET status = 'used', deleted_at = NULL, deleted_by = NULL
   WHERE id = p_session_id AND status = 'deleted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or not in deleted state';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION soft_delete_package_session(UUID) FROM public;
REVOKE ALL ON FUNCTION restore_package_session(UUID) FROM public;
GRANT EXECUTE ON FUNCTION soft_delete_package_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_package_session(UUID) TO authenticated;

COMMENT ON FUNCTION soft_delete_package_session(UUID) IS
  'T-20260612-foot-USAGEHIST-DELETE-RESTORE: 회차 soft-delete(status=deleted). admin/manager 한정 = 기존 DELETE 권한 동일.';
COMMENT ON FUNCTION restore_package_session(UUID) IS
  'T-20260612-foot-USAGEHIST-DELETE-RESTORE: 회차 복원(status=used). admin/manager 한정.';

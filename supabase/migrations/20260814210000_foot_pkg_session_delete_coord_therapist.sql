-- T-20260814-foot-PKGDEDUCT-DELETE-PERM-COORDTHERAPIST
-- 패키지 시술 차감내역(회차) soft-delete·복원 권한을 coordinator·therapist 에도 ADDITIVE 확대.
--
-- 배경: 고객상세 2번째 탭(펜차트/자동기록)의 '패키지 시술 차감내역 삭제'가 현재 admin/manager/director
--       (RPC 내부 is_admin_or_manager() 게이트)만 가능. 현장(김주연 총괄, 슬랙 C0ATE5P6JTH) 코디·치료사도
--       삭제하도록 권한 확대 요청.
--
-- census(권한 구현층 판별, 티켓 line52-54):
--   · 이 게이트는 RLS 정책이 아니라 SECURITY DEFINER RPC(soft_delete_package_session /
--     restore_package_session) 내부 role-check(is_admin_or_manager()) = DDL 층.
--     → 본 마이그로 게이트 확대. db_change=true.
--   · package_sessions 테이블 RLS 는 무변경(RPC 가 DEFINER 로 우회) — 정책 신설/변경 없음.
--
-- ★AC2 스코프 하드가드(권한 누수 0): is_admin_or_manager() 자체는 절대 수정하지 않는다
--   (그 헬퍼는 다수 테이블 정책이 공유 → 수정 시 전역 누수). 오직 이 2개 RPC 내부 게이트만
--   인라인으로 5역할(admin/manager/director/coordinator/therapist)로 교체 = 이 surface 전용 확대.
--   consultant 미포함(티켓 명시 스코프 = coordinator·therapist 만).
--
-- ★AC3 삭제 기제(원장 doctrine): 하드 DELETE 신설 없음. 기존 soft-delete(status='deleted') 유지.
--   잔여회차 정합은 status='used'만 집계하므로 자동 +1(무변경). 정산 축 무접촉.
--
-- ★AC4 회귀 0: admin/manager/director 는 5역할 집합에 그대로 포함(확대만·축소 0).
--
-- ★FE union = RPC union: src/lib/permissions.ts canDeletePackageSession(PKG_SESSION_DELETE_ROLES)
--   = {admin,manager,director,coordinator,therapist} 와 1:1 정합. ★동반 landing★(FE 단독 배포 금지).
--
-- ⚠️ apply_before_go: supervisor DB-GATE(DDL-diff) + GO-token 선행. GO-token 前 prod 선집행 금지.
--    data-architect CONSULT 판정(권한 확대 write-set 거버넌스) 선행 여부는 planner FOLLOWUP 로 확인.

BEGIN;

-- 1) soft-delete RPC — 게이트를 5역할로 확대(is_admin_or_manager 미접촉, 인라인 role-set).
CREATE OR REPLACE FUNCTION soft_delete_package_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- T-20260814: admin/manager/director + coordinator/therapist. is_admin_or_manager() 대신
  --   이 RPC 전용 인라인 게이트(권한 누수 0). is_approved_user() 승인 가드 유지.
  IF NOT (is_approved_user()
          AND current_user_role() IN ('admin','manager','director','coordinator','therapist')) THEN
    RAISE EXCEPTION 'permission denied: admin/manager/director/coordinator/therapist only';
  END IF;
  UPDATE package_sessions
     SET status = 'deleted', deleted_at = now(), deleted_by = current_staff_id()
   WHERE id = p_session_id AND status = 'used';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or not in used state';
  END IF;
END;
$$;

-- 2) restore RPC — 동일 5역할 게이트(soft-delete 의 안전 역연산, AC3 "실수 삭제 원복 가능" doctrine).
CREATE OR REPLACE FUNCTION restore_package_session(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (is_approved_user()
          AND current_user_role() IN ('admin','manager','director','coordinator','therapist')) THEN
    RAISE EXCEPTION 'permission denied: admin/manager/director/coordinator/therapist only';
  END IF;
  UPDATE package_sessions
     SET status = 'used', deleted_at = NULL, deleted_by = NULL
   WHERE id = p_session_id AND status = 'deleted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or not in deleted state';
  END IF;
END;
$$;

-- EXECUTE grant 는 기존(authenticated) 그대로 — 재부여 불요(멱등 보강용으로만 재선언).
REVOKE ALL ON FUNCTION soft_delete_package_session(UUID) FROM public;
REVOKE ALL ON FUNCTION restore_package_session(UUID) FROM public;
GRANT EXECUTE ON FUNCTION soft_delete_package_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_package_session(UUID) TO authenticated;

COMMENT ON FUNCTION soft_delete_package_session(UUID) IS
  'T-20260814-foot-PKGDEDUCT-DELETE-PERM-COORDTHERAPIST: 회차 soft-delete(status=deleted). admin/manager/director/coordinator/therapist. FE canDeletePackageSession 정합.';
COMMENT ON FUNCTION restore_package_session(UUID) IS
  'T-20260814-foot-PKGDEDUCT-DELETE-PERM-COORDTHERAPIST: 회차 복원(status=used). admin/manager/director/coordinator/therapist.';

COMMIT;

-- ── 검증 쿼리(supervisor 수동, 실행하지 않음) ──────────────────────────────
-- SELECT pg_get_functiondef('soft_delete_package_session(uuid)'::regprocedure);
-- SELECT pg_get_functiondef('restore_package_session(uuid)'::regprocedure);
--   기대: 두 함수 게이트 = is_approved_user() AND current_user_role() IN (admin,manager,director,coordinator,therapist)
-- SELECT pg_get_functiondef('is_admin_or_manager()'::regprocedure);
--   기대: 무변경(admin/manager/director) — 전역 헬퍼 불침범(AC2 누수 0 확인).

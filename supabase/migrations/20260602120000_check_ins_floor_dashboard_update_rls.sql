-- ============================================================
-- T-20260602-foot-DASH-CUSTMOVE-STAFF-RESET — 직원(비-admin) 대시보드 고객 이동 저장 차단 해소
-- ============================================================
-- 근본원인 (AC-1): check_ins UPDATE RLS(20260426000000_rls_role_separation)가
--   - coordinator: status IN ('registered','checklist','exam_waiting') 단계만 UPDATE 허용
--   - therapist/technician: 본인 배정(therapist_id/technician_id = self) 케이스만
-- 으로 좁혀, 직원 계정이 대시보드 칸반에서 고객을 treatment/laser/consultation/done 등
-- 다른 슬롯으로 이동하면 USING/WITH CHECK 실패 → 0행 UPDATE.
-- PostgREST .update()는 RLS 0행 거부 시에도 error 없이 204를 반환 → FE는 성공으로 오인,
-- 새로고침/Realtime 시 원위치로 silent 리셋되어 보였다.
--
-- 수정 (분기 A — 권한 확대, 최소·clinic 스코프 보존):
--   대시보드 floor 운영 role(consultant/coordinator/therapist/technician)에게
--   "자기 clinic" check_ins UPDATE를 허용하는 정책을 ADD(기존 정책은 OR로 유지, 회귀 없음).
--   - clinic 스코프 보존(AC-3): clinic_id = current_user_clinic_id() 강제 → 타 clinic 이동 불가
--   - anon/public 쓰기 신설 없음: TO authenticated + is_approved_user() 게이트
--   - admin/manager/director는 기존 check_ins_admin_all로 이미 ALL 보유 (영향 없음)
-- ============================================================

BEGIN;

-- 재적용 안전(idempotent)
DROP POLICY IF EXISTS check_ins_floor_dashboard_update ON check_ins;

-- floor 운영 role의 대시보드 고객 이동(UPDATE) — 자기 clinic 한정
CREATE POLICY check_ins_floor_dashboard_update ON check_ins FOR UPDATE TO authenticated
  USING (
    is_approved_user()
    AND current_user_role() IN ('consultant','coordinator','therapist','technician')
    AND clinic_id = current_user_clinic_id()
  )
  WITH CHECK (
    is_approved_user()
    AND current_user_role() IN ('consultant','coordinator','therapist','technician')
    AND clinic_id = current_user_clinic_id()
  );

COMMIT;

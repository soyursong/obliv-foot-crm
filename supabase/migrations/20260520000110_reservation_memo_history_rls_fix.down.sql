-- T-20260520-foot-C2Z1-MEMO-ACTIVE ROLLBACK
-- rmh_clinic_access 정책 제거 후 기존 clinic_isolation_rmh 복원
--
-- 주의: 기존 정책은 broken 상태(staff.id = auth.uid)이므로 롤백 시 다시 비활성 증상 재현됨.
--        롤백 후 즉시 supervisor에게 에스컬레이션 필요.

DROP POLICY IF EXISTS rmh_clinic_access ON reservation_memo_history;

-- 기존 깨진 정책 복원 (히스토리 목적)
CREATE POLICY clinic_isolation_rmh ON reservation_memo_history
  USING (clinic_id = (SELECT clinic_id FROM staff WHERE id = auth.uid()));

COMMENT ON POLICY clinic_isolation_rmh ON reservation_memo_history IS
  'ROLLBACK-ONLY: staff.id = auth.uid 오류 있음 — 예약메모 비활성 재현. 즉시 수정 필요.';

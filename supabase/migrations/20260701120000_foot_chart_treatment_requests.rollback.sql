-- ============================================================
-- ROLLBACK — T-20260701-foot-CHART2-TREATREQ-SPLIT
-- ============================================================
-- [A] chart_treatment_requests 제거(순수 신설 → DROP 안전, 다운스트림 FK 없음).
-- [B] session_type CHECK 를 본 티켓 이전 상태(ribbon 미포함, 7값)로 원복.
--     ⚠ ribbon session_type 행이 이미 존재하면 원복 CHECK 위반 → 먼저 확인.
-- ============================================================

BEGIN;

-- [B] session_type CHECK 원복(ribbon 제거). ribbon 행 존재 시 중단(데이터 손실 방지).
DO $guard$
DECLARE
  v_ribbon int;
BEGIN
  SELECT count(*) INTO v_ribbon FROM package_sessions WHERE session_type = 'ribbon';
  IF v_ribbon > 0 THEN
    RAISE EXCEPTION 'ribbon session_type 행 % 건 존재 — CHECK 원복 불가(먼저 데이터 정리 필요)', v_ribbon;
  END IF;
END
$guard$;

ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS package_sessions_session_type_check;

ALTER TABLE package_sessions
  ADD CONSTRAINT package_sessions_session_type_check
    CHECK (session_type IN (
      'heated_laser', 'unheated_laser', 'iv', 'preconditioning',
      'podologue', 'trial', 'reborn'
    ));

-- [A] 테이블 제거
DROP TABLE IF EXISTS chart_treatment_requests;

COMMIT;

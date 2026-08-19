-- ROLLBACK — T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE
-- 순서: 계약자산 RPC 2종을 body-drift 이전(인라인)으로 복원 → 신규 함수 의존성 제거 → DROP.
--   consume_package_sessions_for_checkin  ← 인라인 CIS 블록(widened §128-150) 복원
--   deduct_session_atomic                 ← 인라인 package_sessions INSERT 복원
--   그 후 consume_one_session / fn_mark_cis_for_consumed_session DROP.
-- 멱등: CREATE OR REPLACE + DROP IF EXISTS. author: dev-foot / 2026-08-19

-- ① consume_package_sessions_for_checkin — 인라인 CIS 블록 복원 (widened 20260723190000 원형)
CREATE OR REPLACE FUNCTION consume_package_sessions_for_checkin(
  p_check_in_id      UUID,
  p_customer_id      UUID,
  p_clinic_id        UUID,
  p_counts           JSONB,
  p_service_sessions JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_types      TEXT[] := ARRAY['heated_laser','unheated_laser','iv','podologue'];
  v_type       TEXT;
  v_desired    INT;
  v_existing   INT;
  v_short      INT;
  v_pkg_id     UUID;
  v_next       INT;
  v_session_id UUID;
  v_marked_id  UUID;
  v_inserted   INT := 0;
  v_marked     INT := 0;
BEGIN
  FOREACH v_type IN ARRAY v_types LOOP
    v_desired := COALESCE((p_counts->>v_type)::int, 0);
    IF v_desired <= 0 THEN
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO v_existing
      FROM package_sessions
     WHERE check_in_id = p_check_in_id
       AND session_type = v_type
       AND status = 'used';

    v_short := v_desired - v_existing;

    WHILE v_short > 0 LOOP
      SELECT p.id INTO v_pkg_id
        FROM packages p
       WHERE p.customer_id = p_customer_id
         AND p.clinic_id   = p_clinic_id
         AND p.status      = 'active'
         AND (
               CASE v_type
                 WHEN 'heated_laser'   THEN p.heated_sessions
                 WHEN 'unheated_laser' THEN p.unheated_sessions
                 WHEN 'iv'             THEN p.iv_sessions
                 WHEN 'podologue'      THEN p.podologe_sessions
               END
               - COALESCE((
                   SELECT COUNT(*) FROM package_sessions ps
                    WHERE ps.package_id = p.id
                      AND ps.session_type = v_type
                      AND ps.status = 'used'
                 ), 0)
             ) > 0
       ORDER BY p.contract_date ASC, p.id ASC
       LIMIT 1
       FOR UPDATE OF p;

      IF v_pkg_id IS NULL THEN
        EXIT;
      END IF;

      SELECT COALESCE(MAX(session_number), 0) + 1 INTO v_next
        FROM package_sessions WHERE package_id = v_pkg_id;

      INSERT INTO package_sessions (package_id, session_number, session_type, status, check_in_id)
      VALUES (v_pkg_id, v_next, v_type, 'used', p_check_in_id)
      RETURNING id INTO v_session_id;

      v_inserted := v_inserted + 1;

      IF p_service_sessions IS NOT NULL THEN
        UPDATE check_in_services cis
           SET package_session_id = v_session_id,
               is_package_session = true
         WHERE cis.id = (
                 SELECT c.id
                   FROM check_in_services c
                  WHERE c.check_in_id = p_check_in_id
                    AND c.package_session_id IS NULL
                    AND c.service_id IN (
                          SELECT (elem->>'service_id')::uuid
                            FROM jsonb_array_elements(p_service_sessions) elem
                           WHERE elem->>'session_type' = v_type
                        )
                  ORDER BY c.created_at ASC, c.id ASC
                  LIMIT 1
               )
        RETURNING cis.id INTO v_marked_id;
        IF v_marked_id IS NOT NULL THEN
          v_marked := v_marked + 1;
          v_marked_id := NULL;
        END IF;
      END IF;

      v_short  := v_short - 1;
      v_pkg_id := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted, 'marked', v_marked);
END;
$$;

COMMENT ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB, JSONB)
  IS '선수금차감 회차 소진(멱등, 초과차감 방지) + check_in_services 소비-파생 마킹(package_session_id 전방배선 + is_package_session=true 동시 SET, C1 deterministic service_id, C2 1:1 FIFO/idempotent). T-20260723-foot-PKGSESSION-LINK-UNWIRED';

REVOKE EXECUTE ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB, JSONB) TO authenticated;

-- ② deduct_session_atomic — 인라인 INSERT 복원 (race_condition_fixes 20260420000013 원형)
CREATE OR REPLACE FUNCTION deduct_session_atomic(
  p_check_in_id UUID,
  p_package_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_pkg RECORD;
  v_used INT;
  v_remaining INT;
  v_session_type TEXT;
  v_next_num INT;
BEGIN
  SELECT * INTO v_pkg FROM packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '패키지를 찾을 수 없습니다');
  END IF;
  IF v_pkg.status <> 'active' THEN
    RETURN jsonb_build_object('error', '패키지가 활성 상태가 아닙니다');
  END IF;

  IF EXISTS (SELECT 1 FROM package_sessions WHERE package_id = p_package_id AND check_in_id = p_check_in_id) THEN
    RETURN jsonb_build_object('ok', true, 'msg', 'already_deducted');
  END IF;

  SELECT COUNT(*) INTO v_used FROM package_sessions WHERE package_id = p_package_id AND status = 'used';
  v_remaining := v_pkg.total_sessions - v_used;

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('error', '남은 회차가 없습니다');
  END IF;

  v_session_type := CASE
    WHEN v_pkg.heated_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'heated_laser' AND status = 'used'), 0) > 0 THEN 'heated_laser'
    WHEN v_pkg.unheated_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'unheated_laser' AND status = 'used'), 0) > 0 THEN 'unheated_laser'
    WHEN v_pkg.iv_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'iv' AND status = 'used'), 0) > 0 THEN 'iv'
    WHEN v_pkg.preconditioning_sessions - COALESCE((SELECT COUNT(*) FROM package_sessions WHERE package_id = p_package_id AND session_type = 'preconditioning' AND status = 'used'), 0) > 0 THEN 'preconditioning'
    ELSE 'heated_laser'
  END;

  v_next_num := v_used + 1;

  INSERT INTO package_sessions (package_id, check_in_id, session_number, session_type, session_date, status)
  VALUES (p_package_id, p_check_in_id, v_next_num, v_session_type, CURRENT_DATE, 'used');

  RETURN jsonb_build_object('ok', true, 'session_number', v_next_num, 'session_type', v_session_type, 'remaining', v_remaining - 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ③ 신규 함수 DROP (의존성 제거 후)
DROP FUNCTION IF EXISTS consume_one_session(UUID, TEXT, UUID, DATE, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TEXT, JSONB);
DROP FUNCTION IF EXISTS fn_mark_cis_for_consumed_session(UUID, UUID, TEXT, JSONB);

NOTIFY pgrst, 'reload schema';

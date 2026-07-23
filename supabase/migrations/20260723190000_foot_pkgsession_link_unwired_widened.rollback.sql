-- ROLLBACK T-20260723-foot-PKGSESSION-LINK-UNWIRED
-- 5-arg widened 함수를 DROP 하고 구 4-arg(p_counts only, 마킹 없음) 함수를 복원.
-- (원본 = 20260703040000_foot_pkg_triple_defect_transfer_deduct.sql (c))

DROP FUNCTION IF EXISTS consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB, JSONB);

CREATE OR REPLACE FUNCTION consume_package_sessions_for_checkin(
  p_check_in_id  UUID,
  p_customer_id  UUID,
  p_clinic_id    UUID,
  p_counts       JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_types    TEXT[] := ARRAY['heated_laser','unheated_laser','iv','podologue'];
  v_type     TEXT;
  v_desired  INT;
  v_existing INT;
  v_short    INT;
  v_pkg_id   UUID;
  v_next     INT;
  v_inserted INT := 0;
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
      VALUES (v_pkg_id, v_next, v_type, 'used', p_check_in_id);

      v_inserted := v_inserted + 1;
      v_short    := v_short - 1;
      v_pkg_id   := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted);
END;
$$;

COMMENT ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB)
  IS '선수금차감 회차 소진(멱등, 초과차감 방지). 수납확정 시 package_sessions insert → 잔여 정확 차감. T-20260703-foot-JONGNO-PACKAGE-TRIPLE-DEFECT';

GRANT EXECUTE ON FUNCTION consume_package_sessions_for_checkin(UUID, UUID, UUID, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

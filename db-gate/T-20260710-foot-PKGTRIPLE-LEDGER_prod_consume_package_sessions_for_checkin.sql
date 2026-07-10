CREATE OR REPLACE FUNCTION public.consume_package_sessions_for_checkin(p_check_in_id uuid, p_customer_id uuid, p_clinic_id uuid, p_counts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

    -- 멱등: 동일 체크인에 이미 기록된 동일 type 'used' 회차만큼 제외
    SELECT COUNT(*) INTO v_existing
      FROM package_sessions
     WHERE check_in_id = p_check_in_id
       AND session_type = v_type
       AND status = 'used';

    v_short := v_desired - v_existing;

    WHILE v_short > 0 LOOP
      -- 해당 type 잔여가 남은 활성 패키지 1건(가장 오래된 계약 우선) 선택 + 잠금
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

      -- 초과차감 방지: 잔여 있는 패키지 없음 → 이 type 중단
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
$function$

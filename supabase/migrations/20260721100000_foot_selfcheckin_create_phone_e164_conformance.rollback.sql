-- ROLLBACK — T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN
-- self_checkin_create 를 phone-정규화 前(raw p_phone 사용) = 20260714120000 정의로 CREATE OR REPLACE 원복.
--   · v_phone 선언/도출 제거, 조회 WHERE phone=p_phone, customers/check_ins INSERT = p_phone.
--   · 가드(masked-PII / length·name·clinic) 및 나머지 로직 무변경.
-- ⚠ 되돌림 시 계약(§Phone E.164) 재이탈 = 로컬포맷 kiosk 전달 시 중복 customers row 위험 복귀.
-- GRANT/ACL: CREATE OR REPLACE 보존. author: dev-foot / 2026-07-21
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.self_checkin_create(p_clinic_slug text, p_phone text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic_id uuid;
  v_customer_id uuid;
  v_visit_count int;
  v_visit_type text;
  v_check_in_id uuid;
  v_queue_number int;
  v_package_id uuid;
  v_package_count int;
BEGIN
  -- ── 마스킹-reject 가드 (DA-20260714, fail-closed) — 탐지=helper / raise=여기 ──
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  -- Validate inputs
  IF p_phone IS NULL OR length(regexp_replace(p_phone, '[^0-9]', '', 'g')) < 9 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 1 OR length(p_name) > 50 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_clinic';
  END IF;

  SELECT id INTO v_clinic_id FROM clinics WHERE slug = p_clinic_slug;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic_not_found';
  END IF;

  -- Find or create customer
  SELECT id INTO v_customer_id
  FROM customers
  WHERE clinic_id = v_clinic_id AND phone = p_phone
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (clinic_id, name, phone, visit_type, created_by)
    VALUES (v_clinic_id, trim(p_name), p_phone, 'new', 'self_checkin')
    RETURNING id INTO v_customer_id;
  END IF;

  -- Determine visit type based on prior check-ins
  SELECT count(*) INTO v_visit_count
  FROM check_ins
  WHERE customer_id = v_customer_id AND clinic_id = v_clinic_id;

  v_visit_type := CASE WHEN v_visit_count > 0 THEN 'returning' ELSE 'new' END;

  -- Auto-link active package if returning and exactly one
  IF v_visit_type = 'returning' THEN
    SELECT count(*), max(id) INTO v_package_count, v_package_id
    FROM packages
    WHERE customer_id = v_customer_id AND status = 'active';
    IF v_package_count <> 1 THEN
      v_package_id := NULL;
    END IF;
  END IF;

  -- Get queue number
  v_queue_number := next_queue_number(v_clinic_id);

  -- Insert check-in
  INSERT INTO check_ins (
    clinic_id, customer_id, customer_name, customer_phone,
    visit_type, status, queue_number, package_id
  ) VALUES (
    v_clinic_id, v_customer_id, trim(p_name), p_phone,
    v_visit_type, 'registered', v_queue_number, v_package_id
  )
  RETURNING id INTO v_check_in_id;

  -- Update customer visit_type to returning if this isn't their first visit
  IF v_visit_type = 'returning' THEN
    UPDATE customers SET visit_type = 'returning', updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'check_in_id', v_check_in_id,
    'customer_id', v_customer_id,
    'queue_number', v_queue_number,
    'visit_type', v_visit_type,
    'package_id', v_package_id
  );
END;
$function$;

COMMIT;

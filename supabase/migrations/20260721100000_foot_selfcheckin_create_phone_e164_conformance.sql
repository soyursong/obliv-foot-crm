-- T-20260721-foot-SELF-CHECKIN-PHONE-NORMALIZE-HARDEN — self_checkin_create phone E.164 계약 CONFORMANCE 정정
-- ════════════════════════════════════════════════════════════════════════════
-- 불변식(cross_crm_data_contract §Phone, DA 소유): customers.phone 저장 = 반드시 +82… E.164.
--   GLOBAL JOIN KEY = phone E.164(L34) · UNIQUE(clinic_id, phone)(L33) · normalize_phone(text)→text(L47-51).
--
-- 배경: self_checkin_create(20260714120000, mig 07-14)가 raw p_phone 을 조회 WHERE 및 customers/
--   check_ins INSERT 에 그대로 사용 = 계약 위반 상태. 형제 RPC upsert_reservation_from_source
--   (20260715120000 L271 v_norm_phone)는 이미 normalize_phone 적용 = house pattern. 셀프접수만 이탈.
--   customers_phone_e164_chk(20260426090000)가 로컬포맷 원천 차단 → prod row 는 전부 E.164 이므로
--   kiosk 로컬포맷 전달 시 셀프접수는 check_violation 라이브 실패 위험. write-boundary 정규화로 정합.
--
-- DA CONSULT-REPLY (MSG-20260721-030943-9hj0 / DA-20260721-FOOT-SELFCHECKIN-NORMALIZE):
--   · 판정 GO. belt-and-suspenders 아니라 계약 CONFORMANCE 정정. ADDITIVE-equivalent: YES.
--   · 근거: 스키마 무변경(no DDL) · 기존 normalize_phone(IMMUTABLE STRICT, idempotent) 재사용 · 되돌림 가능.
--     조회키 v_phone 정규화 → 로컬입력→+82→저장된 +82 매칭률 상승뿐, 기존 매칭 무훼손 = 순-개선.
--   · 필수조건 1: 조회 WHERE phone=v_phone 와 INSERT VALUES(…,v_phone,…)에 동일 v_phone 일관 적용
--     (둘 중 하나만 정규화 시 조회 miss → 중복 customers row = UNIQUE/GLOBAL JOIN KEY 오염). ← 준수.
--   · 검증순서: masked-PII guard + length(digits)>=9 는 raw p_phone 에 pre-normalize 로 유지(방어 보존).
--     normalize 는 non-KR/invalid 에 원본 반환 → garbage 는 여전히 CHECK 에서 걸림.
--
-- 변경범위: self_checkin_create 본문만. 가드 2건(masked-PII / length·name·clinic)은 raw p_phone 에 verbatim.
--   v_phone := normalize_phone(p_phone) 를 가드 통과 후 도출 → customers 조회/INSERT + check_ins INSERT 에 일관 적용.
--   search_path / SECURITY DEFINER / 시그니처 / RETURN / 나머지 로직 = prod 정의 verbatim 보존.
-- 스키마: 신규 컬럼/enum/테이블 0. GRANT/ACL: CREATE OR REPLACE 보존(batch2 REVOKE/KEEP 상태 무훼손).
-- 멱등: CREATE OR REPLACE 자연 멱등. cross-CRM 영향: foot-local. 되돌림: rollback.sql (07-14 정의 원복).
-- author: dev-foot / 2026-07-21
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
  v_phone text;
BEGIN
  -- ── 마스킹-reject 가드 (DA-20260714, fail-closed) — 탐지=helper / raise=여기 ──
  --   phone-only find-or-create 경로 → masked payload 시 신규 masked customers row INSERT 벡터.
  --   ⚠ 가드는 raw p_phone 에 pre-normalize 로 판정(정규화 전). normalize 로 마스킹 지문이 흐려지지 않도록.
  IF public._fn_is_masked_pii(p_name, p_phone) THEN
    RAISE EXCEPTION 'masked PII rejected (self-checkin ingress)'
      USING ERRCODE = '22023',
            HINT = 'T-20260714-foot-SELFCHECKIN-DUP-CUSTOMER-MASK-REPRO: raw name/phone 필요(마스킹값 write 금지)';
  END IF;

  -- Validate inputs (raw p_phone 기준 — length(digits)>=9 방어 보존)
  IF p_phone IS NULL OR length(regexp_replace(p_phone, '[^0-9]', '', 'g')) < 9 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 1 OR length(p_name) > 50 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF p_clinic_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_clinic';
  END IF;

  -- ── phone E.164 정규화 (cross_crm_data_contract §Phone / DA-20260721 GO) ──
  --   가드 통과 후 도출. 이하 customers 조회·INSERT + check_ins INSERT 에 동일 v_phone 일관 적용.
  --   normalize_phone: IMMUTABLE STRICT, idempotent, non-KR/invalid → 원본 반환(가드가 이미 걸러냄).
  v_phone := public.normalize_phone(p_phone);

  SELECT id INTO v_clinic_id FROM clinics WHERE slug = p_clinic_slug;
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'clinic_not_found';
  END IF;

  -- Find or create customer (조회키 = v_phone, 계약 GLOBAL JOIN KEY 정합)
  SELECT id INTO v_customer_id
  FROM customers
  WHERE clinic_id = v_clinic_id AND phone = v_phone
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (clinic_id, name, phone, visit_type, created_by)
    VALUES (v_clinic_id, trim(p_name), v_phone, 'new', 'self_checkin')
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

  -- Insert check-in (customer_phone 스냅샷도 E.164 로 일관 저장)
  INSERT INTO check_ins (
    clinic_id, customer_id, customer_name, customer_phone,
    visit_type, status, queue_number, package_id
  ) VALUES (
    v_clinic_id, v_customer_id, trim(p_name), v_phone,
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

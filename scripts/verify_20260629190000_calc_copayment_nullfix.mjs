/**
 * T-20260629-foot-COPAYCALC-SERVER-NULLFIX — 비파괴 검증 (db_only, E2E 면제)
 *
 * NEW 로직을 pg_temp 세션-임시 함수로 정의해 실제 calc_copayment 를 건드리지 않고
 * OLD(현행 v1.1, persisted) vs NEW(v1.2) 결과를 실제 prod 행으로 대조한다.
 * 환경: SUPABASE_ACCESS_TOKEN 필요 (.env.local). 실행: node scripts/verify_20260629190000_calc_copayment_nullfix.mjs
 *
 * 기대 (2026-06-29 실행 검증 완료):
 *   A,B (hira_score 보유, 정상분기)  → OLD==NEW 100% 동일 (AC-2 회귀 무변경)
 *   C   (hira NULL, general)         → NEW full self-pay(covered=0,copay=price,rate=1.0) — OLD phantom covered 소거
 *   D,E (hira NULL, unverified/NULL) → NEW data_incomplete=true (all 0, rate NULL) — default-deny BLOCK
 */
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN, PROJ = 'rxlomoozakkjesdqjtvd';
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  return [r.status, await r.json()];
};

const SVC_NULL = 'de611ed5-154a-475d-9eb3-19d6d3bad881'; // 초진진찰료-의원, covered, hira_score NULL, price 18840
const SVC_HIRA = 'b98f6831-12a3-459b-b199-f543dd15cba1'; // 진찰료(초진), covered, hira_score 153.36, price 0
const C_GEN = '0919062a-d4cd-4957-8a49-1d74b1feebd7';    // general
const C_UNV = 'ad1b935f-9989-435d-89e7-66938b3fd348';    // unverified
const C_NULL = '005027c3-1032-4597-8801-76b57e39545d';   // grade NULL -> 'unverified'
const CLINIC = 'b4dc0de5-f007-4a57-8888-aabbccddeeff';   // hira_unit_value 89.40

// NEW logic defined as a session-temp function — never touches real calc_copayment.
const TEMP_FN = `
CREATE FUNCTION pg_temp.cc(p_service_id UUID, p_customer_id UUID, p_clinic_id UUID, p_visit_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE(base_amount INTEGER, insurance_covered_amount INTEGER, copayment_amount INTEGER, exempt_amount INTEGER, applied_rate NUMERIC, applied_grade TEXT, data_incomplete BOOLEAN)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_service services%ROWTYPE; v_customer customers%ROWTYPE; v_clinic clinics%ROWTYPE;
  v_grade TEXT; v_rate NUMERIC; v_base INT; v_copay INT; v_covered INT; v_exempt INT := 0;
BEGIN
  SELECT * INTO v_service FROM services WHERE id = p_service_id;
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  SELECT * INTO v_clinic FROM clinics WHERE id = p_clinic_id;
  IF v_service.id IS NULL THEN RAISE EXCEPTION 'service not found'; END IF;
  IF v_customer.id IS NULL THEN RAISE EXCEPTION 'customer not found'; END IF;
  IF v_clinic.id IS NULL THEN RAISE EXCEPTION 'clinic not found'; END IF;
  v_grade := COALESCE(v_customer.insurance_grade, 'unverified');
  IF NOT COALESCE(v_service.is_insurance_covered, false) OR v_grade = 'foreigner' THEN
    v_base := COALESCE(v_service.price, 0);
    RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false; RETURN;
  END IF;
  IF v_service.hira_score IS NULL THEN
    IF v_grade = 'general' THEN
      v_base := COALESCE(v_service.price, 0);
      RETURN QUERY SELECT v_base, 0, v_base, 0, 1.000::NUMERIC, v_grade, false; RETURN;
    ELSE
      RETURN QUERY SELECT 0, 0, 0, 0, NULL::NUMERIC, v_grade, true; RETURN;
    END IF;
  END IF;
  v_base := ROUND(v_service.hira_score * COALESCE(v_clinic.hira_unit_value, 89.4));
  v_rate := CASE v_grade WHEN 'general' THEN 0.30 WHEN 'low_income_1' THEN 0.14 WHEN 'low_income_2' THEN 0.14
    WHEN 'medical_aid_1' THEN 0.00 WHEN 'medical_aid_2' THEN 0.15 WHEN 'infant' THEN 0.21
    WHEN 'elderly_flat' THEN 0.30 ELSE 0.30 END;
  IF v_service.copayment_rate_override IS NOT NULL THEN v_rate := v_service.copayment_rate_override; END IF;
  IF v_grade = 'medical_aid_1' THEN v_copay := LEAST(1000, v_base); v_covered := v_base - v_copay;
  ELSIF v_grade = 'elderly_flat' AND v_base <= 15000 THEN v_copay := LEAST(1500, v_base); v_covered := v_base - v_copay;
  ELSE v_copay := CEIL((v_base * v_rate)/100.0)*100; IF v_copay > v_base THEN v_copay := v_base; END IF; v_covered := v_base - v_copay; END IF;
  RETURN QUERY SELECT v_base, v_covered, v_copay, v_exempt, v_rate, v_grade, false;
END; $$;
`;

const cmp = (label, svc, cust) => `
  SELECT '${label}'::text label,
    o.base_amount o_base, o.insurance_covered_amount o_cov, o.copayment_amount o_copay, o.applied_rate o_rate, o.applied_grade o_grade,
    n.base_amount n_base, n.insurance_covered_amount n_cov, n.copayment_amount n_copay, n.applied_rate n_rate, n.applied_grade n_grade, n.data_incomplete n_inc
  FROM calc_copayment('${svc}','${cust}','${CLINIC}') o
  CROSS JOIN pg_temp.cc('${svc}','${cust}','${CLINIC}') n`;

const SQL = `${TEMP_FN}
${cmp('A normal hira / general (REGRESSION)', SVC_HIRA, C_GEN)}
UNION ALL ${cmp('B normal hira / unverified (REGRESSION)', SVC_HIRA, C_UNV)}
UNION ALL ${cmp('C NULL-hira / general (ALLOWLIST->self-pay)', SVC_NULL, C_GEN)}
UNION ALL ${cmp('D NULL-hira / unverified (DENY->block)', SVC_NULL, C_UNV)}
UNION ALL ${cmp('E NULL-hira / grade-NULL (DENY->block)', SVC_NULL, C_NULL)}
ORDER BY 1;`;

const [st, body] = await q(SQL);
console.log('HTTP', st);
console.log(JSON.stringify(body, null, 1));

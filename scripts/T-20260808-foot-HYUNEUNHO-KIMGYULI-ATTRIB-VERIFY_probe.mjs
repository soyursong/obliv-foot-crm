/**
 * T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY — READ-ONLY 재진단 probe.
 * 목적: 현은호 케어토어밴드(CTB) 15,000 결제(2e8f7aa5)의 실상태 + 대응 cis 판매라인 유무 확인.
 *   A-1: payment 2e8f7aa5 현재 상태.
 *   A-2: 이 케어토어밴드에 대응하는 check_in_services(cis) 판매라인 존재 여부 + seller_staff_id.
 *   A-3: SalesStaffTab 화장품 매출 소스축(cis) 재확인 데이터.
 * READ-ONLY (SELECT only). prod write 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const out = {};

// A-1: payment 2e8f7aa5 실상태 (prefix match — 정확 uuid 조각만 알고 있음)
out.A1_payment = await q(`
  SELECT p.id, p.amount, p.method, p.external_status, p.appr_info, p.merchant_no,
         p.payment_type, p.status, p.is_simulation,
         p.check_in_id, p.customer_id, p.package_id, p.service_charge_id,
         p.accounting_date, p.created_at, p.memo,
         c.name AS customer_name, c.chart_number
  FROM payments p
  LEFT JOIN customers c ON c.id = p.customer_id
  WHERE p.id::text LIKE '2e8f7aa5%';
`);

// A-1b: bind check_in c33dfc76 — 담당치료사(therapist_id) 현재값
out.A1b_checkin = await q(`
  SELECT ci.id, ci.customer_id, ci.therapist_id, ci.technician_id,
         ci.checked_in_at, ci.clinic_id,
         st.name AS therapist_name, cu.name AS customer_name, cu.chart_number
  FROM check_ins ci
  LEFT JOIN staff st ON st.id = ci.therapist_id
  LEFT JOIN customers cu ON cu.id = ci.customer_id
  WHERE ci.id::text LIKE 'c33dfc76%';
`);

// 케어토어밴드 service (e17ba3a3) 확인
out.svc_ctb = await q(`
  SELECT id, name, category, category_label, clinic_id
  FROM services
  WHERE id::text LIKE 'e17ba3a3%';
`);

// 풋화장품 카테고리 service 집합 (SalesStaffTab cosmeticLines 쿼리와 동일 기준)
out.cosmetic_services = await q(`
  SELECT id, name, category, category_label
  FROM services
  WHERE category = '풋화장품' OR category_label = '풋화장품';
`);

// A-2: 현은호 고객 식별 (check_in 경유)
out.A2_customer = await q(`
  SELECT cu.id, cu.name, cu.chart_number, cu.clinic_id
  FROM customers cu
  WHERE cu.name = '현은호';
`);

// A-2: 2e8f7aa5 결제에 연결된 check_in(c33dfc76) 의 cis 라인 전체 (케어토어밴드/화장품 여부)
out.A2_cis_by_checkin = await q(`
  SELECT cis.id, cis.check_in_id, cis.service_id, cis.service_name,
         cis.price, cis.seller_staff_id, cis.voided_at, cis.created_at,
         s.category, s.category_label,
         st.name AS seller_name
  FROM check_in_services cis
  LEFT JOIN services s ON s.id = cis.service_id
  LEFT JOIN staff st ON st.id = cis.seller_staff_id
  WHERE cis.check_in_id::text LIKE 'c33dfc76%'
  ORDER BY cis.created_at;
`);

// A-2b: 케어토어밴드(e17ba3a3) service 로 걸린 cis 라인 전체 (누가 팔았든) — 현은호 관련만
out.A2b_cis_ctb_all = await q(`
  SELECT cis.id, cis.check_in_id, cis.service_id, cis.service_name, cis.price,
         cis.seller_staff_id, cis.voided_at, cis.created_at,
         ci.customer_id, ci.therapist_id, ci.checked_in_at,
         cu.name AS customer_name, st.name AS seller_name
  FROM check_in_services cis
  JOIN check_ins ci ON ci.id = cis.check_in_id
  LEFT JOIN customers cu ON cu.id = ci.customer_id
  LEFT JOIN staff st ON st.id = cis.seller_staff_id
  WHERE cis.service_id::text LIKE 'e17ba3a3%'
    AND cu.name = '현은호'
  ORDER BY cis.created_at;
`);

// 김규리 staff id 확인
out.staff_kimgyuli = await q(`
  SELECT id, name, role, clinic_id FROM staff WHERE name = '김규리';
`);

// A-3 소스축 재확인: 현은호의 화장품 cis 라인(풋화장품 카테고리) 7~8월 존재 여부
out.A3_hyuneunho_cosmetic_cis = await q(`
  SELECT cis.id, cis.service_id, cis.service_name, cis.price, cis.seller_staff_id,
         cis.voided_at, ci.checked_in_at, ci.therapist_id,
         s.category, s.category_label, st.name AS seller_name
  FROM check_in_services cis
  JOIN check_ins ci ON ci.id = cis.check_in_id
  JOIN customers cu ON cu.id = ci.customer_id
  LEFT JOIN services s ON s.id = cis.service_id
  LEFT JOIN staff st ON st.id = cis.seller_staff_id
  WHERE cu.name = '현은호'
    AND (s.category = '풋화장품' OR s.category_label = '풋화장품')
  ORDER BY ci.checked_in_at;
`);

console.log(JSON.stringify(out, null, 2));

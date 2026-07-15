/**
 * T-20260715-foot-REVENUE-SALESDAILY-INSURANCE-SPLIT-FIX — ★진찰료 write-path 검증 (READ-ONLY)
 * 총괄 follow-up MSG-20260715-093124-zqz6: 진찰료(건보) 공단/본인부담이 매출집계 급여 칸에 잡히는가?
 * 판별: (A) service_charges is_insurance_covered=TRUE 적재 → read-side FIX만으로 반영
 *       (B) payments plain single(tax_type=null)로만 기록 → write-path 보강 필요 (스코프 초과)
 * READ-ONLY (SELECT only).
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
const show = (label, rows) => { console.log(`\n===== ${label} =====`); console.log(JSON.stringify(rows, null, 2)); };

// 0) payments 테이블 컬럼 확인 (진찰료 식별 필드 파악)
show('0. payments columns', await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payments'
  ORDER BY ordinal_position;`));

// 1) services 중 진찰료(consultation) 항목 — is_insurance_covered / hira_category
show('1. services 진찰료(consultation) 항목', await q(`
  SELECT id, name, category, category_label, is_insurance_covered, hira_category, hira_code, hira_score, price
  FROM services
  WHERE hira_category='consultation' OR name ILIKE '%진찰%' OR category_label ILIKE '%진찰%'
  ORDER BY is_insurance_covered DESC, name;`));

// 2) service_charges 최근 30일 진찰료(consultation) 적재 실태
show('2. service_charges 최근30일 진찰료 적재 (is_insurance_covered/copay/nhis/base)', await q(`
  SELECT sc.id, sc.calculated_at, s.name AS svc_name, s.hira_category,
         sc.is_insurance_covered, sc.base_amount, sc.copayment_amount,
         sc.insurance_covered_amount, sc.exempt_amount, sc.customer_grade_at_charge
  FROM service_charges sc
  JOIN services s ON s.id = sc.service_id
  WHERE (s.hira_category='consultation' OR s.name ILIKE '%진찰%')
    AND sc.calculated_at >= now() - interval '30 days'
  ORDER BY sc.calculated_at DESC LIMIT 50;`));

// 3) service_charges 전체 진찰료 존재 여부 (기간 무관, count)
show('3. service_charges 진찰료 전체 count + insurance-covered count', await q(`
  SELECT COUNT(*) AS total_consult_charges,
         COUNT(*) FILTER (WHERE sc.is_insurance_covered) AS covered_count,
         SUM(sc.copayment_amount) FILTER (WHERE sc.is_insurance_covered) AS copay_sum,
         SUM(sc.insurance_covered_amount) FILTER (WHERE sc.is_insurance_covered) AS nhis_sum
  FROM service_charges sc JOIN services s ON s.id=sc.service_id
  WHERE s.hira_category='consultation' OR s.name ILIKE '%진찰%';`));

// 4) payments 최근 7일 진찰료로 보이는 수납 (amount 8900 근처 + 진찰 키워드)
//    payments 스키마 미확정이라 넓게 조회 후 육안 판별
show('4. payments 최근7일 진찰료 후보 (amount 8000~10000)', await q(`
  SELECT p.*
  FROM payments p
  WHERE p.created_at >= now() - interval '7 days'
    AND COALESCE(p.amount,0) BETWEEN 8000 AND 10000
  ORDER BY p.created_at DESC LIMIT 40;`));

// 5) 07-14 8,900 수납 건 (허유희/이재성) — payments 정본화 확인
show('5. 07-14 KST amount=8900 payments (허유희 F-4696 / 이재성 F-4702)', await q(`
  SELECT p.*
  FROM payments p
  WHERE p.amount = 8900
    AND p.created_at >= '2026-07-13 15:00:00+00' AND p.created_at < '2026-07-15 15:00:00+00'
  ORDER BY p.created_at DESC LIMIT 20;`));

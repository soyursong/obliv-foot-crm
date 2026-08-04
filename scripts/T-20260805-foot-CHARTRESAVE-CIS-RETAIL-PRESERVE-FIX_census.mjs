/**
 * T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX — census 실행 (READ-ONLY)
 *
 * planner MSG-20260805-034317-nm7x 지시: docs/chartresave_cosmetic_cis_wipe_census.sql
 * 를 prod service_role 로 실행 → 수치 첨부(forward loss 규모 + backfill scope 인풋).
 *
 * 인증컨텍스트 = service_role (RLS 우회) — exec_sql_ro RPC 경유. **읽기 전용 SELECT only.**
 *   ⚠️ anon 키 실행 시 RLS 로 0-row(+error=null) 오독 위험 → 반드시 SERVICE_ROLE_KEY 사용.
 *
 * 실행: node scripts/T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX_census.mjs
 */
import fs from 'fs';

// ── env 로드 (.env.local = prod rxlomoozakkjesdqjtvd) ──
function loadEnv(path) {
  const out = {};
  if (!fs.existsSync(path)) return out;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...loadEnv('.env.local'), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = 'rxlomoozakkjesdqjtvd';
if (!SUPABASE_URL || !ACCESS_TOKEN) { console.error('❌ VITE_SUPABASE_URL / SUPABASE_ACCESS_TOKEN 필요 (.env.local)'); process.exit(1); }
if (!SUPABASE_URL.includes(PROJECT_REF)) { console.error('❌ prod(rxlomoozakkjesdqjtvd) 아님 — 중단:', SUPABASE_URL); process.exit(1); }
console.log('✅ target = prod', PROJECT_REF, '(Management API /database/query = postgres role, RLS 우회)');

// Supabase Management API — arbitrary SQL as postgres role (service-role 등가, RLS 우회). READ-ONLY SELECT only.
async function runSql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

const SECTIONS = {
  '§1 재저장 지문 집계 (delete-all→reinsert after payment)': `
WITH cis_fp AS (
  SELECT cis.check_in_id, count(*) AS cis_lines,
         count(DISTINCT cis.created_at) AS distinct_cts,
         max(cis.created_at) AS cis_reinsert_ct
  FROM check_in_services cis GROUP BY cis.check_in_id),
pay_alive AS (
  SELECT p.check_in_id, min(p.created_at) AS first_pay_ct,
         sum(CASE WHEN p.payment_type='payment' THEN p.amount
                  WHEN p.payment_type='refund' THEN -p.amount ELSE 0 END) AS net_paid
  FROM payments p WHERE p.check_in_id IS NOT NULL GROUP BY p.check_in_id)
SELECT
  count(*) FILTER (WHERE f.distinct_cts=1 AND f.cis_reinsert_ct>a.first_pay_ct) AS resave_after_payment_checkins,
  count(*) FILTER (WHERE f.distinct_cts=1) AS homogeneous_ct_checkins,
  count(*) AS total_paid_checkins_with_cis
FROM cis_fp f JOIN pay_alive a ON a.check_in_id=f.check_in_id WHERE a.net_paid>0;`,

  '§2 결제-라인 unlink census (payment_items witness)': `
WITH cosmetic_cis AS (
  SELECT DISTINCT cis.check_in_id FROM check_in_services cis
  JOIN services s ON s.id=cis.service_id
  WHERE s.category='풋화장품' OR s.category_label='풋화장품'),
cosmetic_pi AS (
  SELECT pi.check_in_id, count(*) AS cosmetic_pi_lines, sum(pi.line_amount) AS cosmetic_pi_amount
  FROM payment_items pi LEFT JOIN services s ON s.id=pi.service_id
  WHERE (s.category='풋화장품' OR s.category_label='풋화장품' OR pi.service_name LIKE '%화장품%')
    AND pi.check_in_id IS NOT NULL GROUP BY pi.check_in_id),
pay_alive AS (
  SELECT p.check_in_id, p.customer_id,
         sum(CASE WHEN p.payment_type='payment' THEN p.amount
                  WHEN p.payment_type='refund' THEN -p.amount ELSE 0 END) AS net_paid
  FROM payments p WHERE p.check_in_id IS NOT NULL GROUP BY p.check_in_id, p.customer_id)
SELECT
  count(*) FILTER (WHERE pi.check_in_id IS NOT NULL AND cc.check_in_id IS NULL) AS unlink_checkins,
  count(DISTINCT a.customer_id) FILTER (WHERE pi.check_in_id IS NOT NULL AND cc.check_in_id IS NULL) AS unlink_customers,
  coalesce(sum(pi.cosmetic_pi_amount) FILTER (WHERE cc.check_in_id IS NULL),0) AS unlink_cosmetic_amount,
  count(*) FILTER (WHERE pi.check_in_id IS NULL) AS no_pi_witness_checkins
FROM pay_alive a
LEFT JOIN cosmetic_cis cc ON cc.check_in_id=a.check_in_id
LEFT JOIN cosmetic_pi pi ON pi.check_in_id=a.check_in_id WHERE a.net_paid>0;`,

  '§3 화장품 매출 line-item 정합 (cis vs payment_items, 월별)': `
WITH cis_cosmetic AS (
  SELECT date_trunc('month', cis.created_at) AS mon, count(*) AS cis_lines, sum(cis.price) AS cis_amount
  FROM check_in_services cis JOIN services s ON s.id=cis.service_id
  WHERE s.category='풋화장품' OR s.category_label='풋화장품' GROUP BY 1),
pi_cosmetic AS (
  SELECT date_trunc('month', pi.created_at) AS mon, count(*) AS pi_lines, sum(pi.line_amount) AS pi_amount
  FROM payment_items pi LEFT JOIN services s ON s.id=pi.service_id
  WHERE s.category='풋화장품' OR s.category_label='풋화장품' OR pi.service_name LIKE '%화장품%' GROUP BY 1)
SELECT coalesce(c.mon,p.mon) AS month,
  coalesce(c.cis_lines,0) AS cis_cosmetic_lines,
  coalesce(p.pi_lines,0) AS pi_cosmetic_lines,
  coalesce(p.pi_lines,0)-coalesce(c.cis_lines,0) AS lines_delta,
  coalesce(p.pi_amount,0)-coalesce(c.cis_amount,0) AS amount_delta
FROM cis_cosmetic c FULL OUTER JOIN pi_cosmetic p ON p.mon=c.mon ORDER BY 1;`,

  '§4 forward-risk: 비활성/NULL/부재 service 를 가리키는 현행 cis 라인': `
SELECT
  count(*) FILTER (WHERE cis.service_id IS NULL) AS null_service_id_lines,
  count(*) FILTER (WHERE s.id IS NULL AND cis.service_id IS NOT NULL) AS missing_service_lines,
  count(*) FILTER (WHERE s.active=false) AS inactive_service_lines,
  count(*) FILTER (WHERE (s.category='풋화장품' OR s.category_label='풋화장품') AND s.active=false) AS inactive_cosmetic_lines
FROM check_in_services cis LEFT JOIN services s ON s.id=cis.service_id;`,

  '§5 (추가) soft-void 정합 프로브 — voided 컬럼 실재 시 현행 voided cis 규모': `
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='check_in_services' AND column_name='voided_at') AS voided_at_col_exists,
  (SELECT count(*) FROM check_in_services
     WHERE (SELECT count(*) FROM information_schema.columns
              WHERE table_name='check_in_services' AND column_name='voided_at')=1
       AND voided_at IS NOT NULL) AS voided_cis_rows;`,
};

const out = [];
for (const [title, sql] of Object.entries(SECTIONS)) {
  process.stdout.write(`\n━━ ${title} ━━\n`);
  try {
    const rows = await runSql(sql.trim());
    console.log(JSON.stringify(rows, null, 2));
    out.push({ section: title, rows });
  } catch (e) {
    console.error('  ⚠️', e.message);
    out.push({ section: title, error: e.message });
  }
}
fs.writeFileSync('docs/T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX_census_result.json',
  JSON.stringify({ ran_at_utc: new Date().toISOString?.() ?? null, target: SUPABASE_URL, ctx: 'service_role', out }, null, 2));
console.log('\n✅ 결과 → docs/T-20260805-foot-CHARTRESAVE-CIS-RETAIL-PRESERVE-FIX_census_result.json');

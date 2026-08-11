/**
 * CENSUS (READ-ONLY): T-20260810-foot-INFLOW-RESV-COVERAGE-COMPLETE
 *   foot reservations.inflow_channel 채움률 surface-proxy census.
 *   전부 SELECT introspection (prod, Management API). WRITE 0 · DDL 0.
 *
 *   목적: DA 재실측 20.9%(32/153) 갭의 구조적 원인 분해 —
 *     C1: 전체 채움률 재확인 (분모/분자)
 *     C2: created_via 별 채움률 (surface proxy)
 *     C3: visit_type 별 채움률 (신규 vs 재진)
 *     C4: ★ inheritable-gap = inflow_channel NULL 이지만 연결고객(customer_id)의
 *         first_inflow_channel 은 non-null → 순수 상속누락(재진 surface 미배선 지문)
 *     C5: source_system 별 (dopamine/TM vs native) 채움률 — §36 축 read-only
 *
 * 실행: node scripts/T-20260810-foot-INFLOW-RESV-COVERAGE-COMPLETE_census.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { q } from './dryrun_lib.mjs';

const QUERIES = [
  { probe: 'C1_overall', label: 'C1 전체 reservations 채움률',
    sql: `SELECT count(*) AS total,
                 count(inflow_channel) AS filled,
                 round(100.0*count(inflow_channel)/nullif(count(*),0),1) AS pct
          FROM reservations;` },
  { probe: 'C2_by_created_via', label: 'C2 created_via 별 채움률 (surface proxy)',
    sql: `SELECT coalesce(created_via,'(null)') AS created_via,
                 count(*) AS total,
                 count(inflow_channel) AS filled,
                 round(100.0*count(inflow_channel)/nullif(count(*),0),1) AS pct
          FROM reservations GROUP BY 1 ORDER BY total DESC;` },
  { probe: 'C3_by_visit_type', label: 'C3 visit_type 별 채움률',
    sql: `SELECT coalesce(visit_type,'(null)') AS visit_type,
                 count(*) AS total,
                 count(inflow_channel) AS filled,
                 round(100.0*count(inflow_channel)/nullif(count(*),0),1) AS pct
          FROM reservations GROUP BY 1 ORDER BY total DESC;` },
  { probe: 'C4_inheritable_gap', label: 'C4 ★ 상속누락 갭 (resv.inflow NULL & customer.first_inflow non-null)',
    sql: `SELECT
             count(*) FILTER (WHERE r.inflow_channel IS NULL) AS resv_null,
             count(*) FILTER (WHERE r.inflow_channel IS NULL AND c.first_inflow_channel IS NOT NULL) AS inheritable_gap,
             count(*) FILTER (WHERE r.inflow_channel IS NULL AND r.customer_id IS NOT NULL AND c.first_inflow_channel IS NULL) AS null_customer_firsttouch,
             count(*) FILTER (WHERE r.inflow_channel IS NULL AND r.customer_id IS NULL) AS null_no_customer
          FROM reservations r
          LEFT JOIN customers c ON c.id = r.customer_id;` },
  { probe: 'C5_by_source_system', label: 'C5 source_system 별 채움률 (§36 축 read-only)',
    sql: `SELECT coalesce(source_system,'(null)') AS source_system,
                 count(*) AS total,
                 count(inflow_channel) AS filled,
                 round(100.0*count(inflow_channel)/nullif(count(*),0),1) AS pct
          FROM reservations GROUP BY 1 ORDER BY total DESC;` },
  { probe: 'C6_customers_firsttouch', label: 'C6 customers.first_inflow_channel 채움률',
    sql: `SELECT count(*) AS total_customers,
                 count(first_inflow_channel) AS filled,
                 round(100.0*count(first_inflow_channel)/nullif(count(*),0),1) AS pct
          FROM customers;` },
];

const out = [];
for (const { probe, label, sql } of QUERIES) {
  try {
    const rows = await q(sql);
    console.log(`\n=== ${probe} — ${label} ===`);
    console.log(JSON.stringify(rows, null, 2));
    out.push({ probe, label, rows });
  } catch (e) {
    console.log(`\n=== ${probe} — ${label} ===\nERROR: ${e.message}`);
    out.push({ probe, label, error: e.message });
  }
}
console.log('\n\n__CENSUS_JSON__' + JSON.stringify(out));

/**
 * CENSUS (READ-ONLY): T-20260810-foot-INFLOW-RESV-CAPTURE-REMEASURE-FIX
 *   foot inflow_channel(§36① canonical 캡처축) 재실측 + save-path split + cohort split.
 *
 *   인증컨텍스트: Supabase Management API PAT(SUPABASE_ACCESS_TOKEN, .env.local) =
 *     service-role-equivalent(RLS bypass, 전건 read). WRITE 0 · DDL 0 · SELECT-only introspection.
 *
 *   §36 방화벽 준수: read 대상 = inflow_channel(축①) + first_inflow_channel + inflow_channel_self_reported(candidate).
 *     referral_source(§36③ freeze) 무접점 · 더미번호(phone) 조인 0 · 조인은 customer_id(UUID FK)만.
 *
 *   딜리버러블(DA 재실측 요청 3분기):
 *     (c1) 저장경로 split — reservations.inflow_channel(canonical) vs check_ins.inflow_channel
 *          vs check_ins.inflow_channel_self_reported(키오스크 candidate, lower-trust) vs notes.
 *     (b)  optional skip 채택률 — inflow NULL 인데 저장된 예약 비율(게이트 완화/미배선 흔적).
 *     (a-proxy) created_via 별 채움률 = 데스크주면 vs 도파민/TM 렌더-갭 proxy.
 *     cohort split(신규-비광고 vs 재진 vs 도파민).
 */
import { q } from './dryrun_lib.mjs';

const QUERIES = [
  { probe: 'C1_overall_resv', label: 'C1 reservations.inflow_channel 전체 채움률(canonical 분모/분자)',
    sql: `SELECT count(*) AS total, count(inflow_channel) AS filled,
                 round(100.0*count(inflow_channel)/nullif(count(*),0),1) AS pct
          FROM reservations;` },

  { probe: 'C2_by_created_via', label: 'C2 created_via 별 채움률 (데스크주면 vs 도파민 렌더-갭 proxy)',
    sql: `SELECT coalesce(created_via,'(null)') AS created_via, count(*) AS total,
                 count(inflow_channel) AS filled,
                 round(100.0*count(inflow_channel)/nullif(count(*),0),1) AS pct
          FROM reservations GROUP BY 1 ORDER BY total DESC;` },

  { probe: 'C3_by_source_system', label: 'C3 source_system 별 채움률 (도파민/TM=광고 vs native=오가닉, §36축 read-only)',
    sql: `SELECT coalesce(source_system,'(null)') AS source_system, count(*) AS total,
                 count(inflow_channel) AS filled,
                 round(100.0*count(inflow_channel)/nullif(count(*),0),1) AS pct
          FROM reservations GROUP BY 1 ORDER BY total DESC;` },

  { probe: 'C4_cohort_split', label: 'C4 ★ 코호트 split (신규-비광고 vs 재진 vs 도파민)',
    sql: `WITH cohort AS (
            SELECT r.id,
              CASE
                WHEN r.source_system = 'dopamine' OR r.created_via = 'dopamine' THEN 'dopamine(광고/TM)'
                WHEN coalesce(r.visit_type,'') ILIKE '%재진%' OR coalesce(r.visit_type,'') ILIKE '%revisit%'
                     OR coalesce(r.visit_type,'') ILIKE '%기존%' THEN '재진'
                ELSE '신규-비광고(native)'
              END AS cohort,
              r.inflow_channel
            FROM reservations r)
          SELECT cohort, count(*) AS total, count(inflow_channel) AS filled,
                 round(100.0*count(inflow_channel)/nullif(count(*),0),1) AS pct
          FROM cohort GROUP BY 1 ORDER BY total DESC;` },

  { probe: 'C5_inheritable_gap', label: 'C5 ★ 상속누락 갭 (resv.inflow NULL & customer.first_inflow non-null = 미배선 주면 지문)',
    sql: `SELECT
             count(*) FILTER (WHERE r.inflow_channel IS NULL) AS resv_null,
             count(*) FILTER (WHERE r.inflow_channel IS NULL AND c.first_inflow_channel IS NOT NULL) AS inheritable_gap,
             count(*) FILTER (WHERE r.inflow_channel IS NULL AND r.customer_id IS NOT NULL AND c.first_inflow_channel IS NULL) AS null_customer_firsttouch,
             count(*) FILTER (WHERE r.inflow_channel IS NULL AND r.customer_id IS NULL) AS null_no_customer
          FROM reservations r LEFT JOIN customers c ON c.id = r.customer_id;` },

  { probe: 'C6_savepath_checkins', label: 'C6 ★ 저장경로 split — check_ins canonical vs candidate(self_reported)',
    sql: `SELECT count(*) AS total_checkins,
                 count(inflow_channel) AS ci_inflow_filled,
                 count(inflow_channel_self_reported) AS ci_selfreport_filled,
                 count(*) FILTER (WHERE inflow_channel IS NULL AND inflow_channel_self_reported IS NOT NULL) AS candidate_only_no_canonical
          FROM check_ins;` },

  { probe: 'C7_customers_firsttouch', label: 'C7 customers.first_inflow_channel 채움률(상속 원천 커버리지)',
    sql: `SELECT count(*) AS total_customers, count(first_inflow_channel) AS filled,
                 round(100.0*count(first_inflow_channel)/nullif(count(*),0),1) AS pct
          FROM customers;` },

  { probe: 'C8_recent_30d', label: 'C8 최근 30일 예약 채움률(배포 후 forward 추세 — RESVFORM-DROPDOWN-WIRING 효과 확인)',
    sql: `SELECT count(*) AS total, count(inflow_channel) AS filled,
                 round(100.0*count(inflow_channel)/nullif(count(*),0),1) AS pct
          FROM reservations
          WHERE created_at >= now() - interval '30 days';` },
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

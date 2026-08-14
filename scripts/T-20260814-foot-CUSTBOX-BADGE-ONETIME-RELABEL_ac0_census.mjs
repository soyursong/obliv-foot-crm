/**
 * CENSUS (READ-ONLY): T-20260814-foot-CUSTBOX-BADGE-ONETIME-RELABEL AC-0
 *   대시보드 고객박스 '1회권' 배지 relabel 의 canonical 식별값 확정.
 *   가설 (a) packages.package_name '1회권' 정확일치  vs  (b) 회차/세션 카운트=1 (total_sessions=1).
 *   전부 SELECT introspection (prod, Management API). WRITE 0 · DDL 0.
 *
 * 실행: node scripts/T-20260814-foot-CUSTBOX-BADGE-ONETIME-RELABEL_ac0_census.mjs
 * 필요: .env.local SUPABASE_ACCESS_TOKEN (Management API PAT).
 */
import { q } from './dryrun_lib.mjs';

const QUERIES = [
  // (a) package_name 정확일치 '1회권' 존부
  { probe: 'A_name_exact_1hoegwon', label: "(a) package_name trim='1회권' 정확일치 행수",
    sql: `SELECT count(*) AS exact_1hoegwon
          FROM packages
          WHERE btrim(package_name) = '1회권';` },

  // (a') '회권' 부분문자열 계열 상위 분포 (오탐 리스크 파악)
  { probe: "Ap_name_hoegwon_like", label: "(a') package_name '%회권%' 상위 분포",
    sql: `SELECT btrim(package_name) AS name, count(*) AS n
          FROM packages
          WHERE package_name LIKE '%회권%'
          GROUP BY 1 ORDER BY n DESC LIMIT 30;` },

  // (b) total_sessions 분포
  { probe: 'B_total_sessions_dist', label: '(b) total_sessions 분포',
    sql: `SELECT total_sessions, count(*) AS n
          FROM packages
          GROUP BY 1 ORDER BY total_sessions LIMIT 30;` },

  // (b') total_sessions=1 인 것의 package_name 분포 (1회권 후보의 실제 이름)
  { probe: "Bp_ts1_names", label: "(b') total_sessions=1 패키지의 package_name 분포",
    sql: `SELECT btrim(package_name) AS name, count(*) AS n
          FROM packages
          WHERE total_sessions = 1
          GROUP BY 1 ORDER BY n DESC LIMIT 30;` },

  // 교차: 체험권 티켓(무좀/내성체험권)의 total_sessions — 1회권 판정과 충돌 여부 확인
  { probe: 'C_trial_ts', label: '체험권(무좀/내성체험권) total_sessions 분포 (배타성 확인)',
    sql: `SELECT btrim(package_name) AS name, total_sessions, count(*) AS n
          FROM packages
          WHERE btrim(package_name) IN ('무좀체험권','내성체험권')
          GROUP BY 1,2 ORDER BY 1,2;` },

  // 활성+잔여>0 관점 (배지 실제 노출 대상): status='active' & total_sessions=1
  { probe: 'D_active_ts1', label: "활성(status=active) & total_sessions=1 행수",
    sql: `SELECT count(*) AS active_ts1
          FROM packages
          WHERE status='active' AND total_sessions = 1;` },
];

const out = {};
for (const { probe, label, sql } of QUERIES) {
  try {
    const rows = await q(sql);
    out[probe] = { label, rows };
    console.log(`\n### ${probe} — ${label}`);
    console.table(rows);
  } catch (e) {
    out[probe] = { label, error: String(e) };
    console.error(`\n### ${probe} FAILED:`, e);
  }
}
console.log('\n===JSON===\n' + JSON.stringify(out, null, 2));

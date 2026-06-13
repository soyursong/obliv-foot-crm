/**
 * T-20260614-foot-VISITPATH-JINSOGAE-TYPO — RCA (read-only)
 * 코드(소스/로컬빌드/프로덕션번들) 전부 '지인소개' 정상값 확인됨.
 * → '진소개'는 DB 저장 데이터 가설. 모든 text/varchar 컬럼 전수검색.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('✅ DB 연결\n');

// 1) 모든 public text/varchar 컬럼에서 '진소개'(지인소개 제외) 검색
const colsRes = await c.query(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema='public'
    AND data_type IN ('text','character varying','character')
  ORDER BY table_name, column_name`);

let hits = [];
for (const { table_name, column_name } of colsRes.rows) {
  try {
    const q = `SELECT count(*)::int AS n FROM public."${table_name}" WHERE "${column_name}" LIKE '%진소개%' AND "${column_name}" NOT LIKE '%지인소개%'`;
    const r = await c.query(q);
    if (r.rows[0].n > 0) hits.push({ table_name, column_name, n: r.rows[0].n });
  } catch (e) { /* view/permission skip */ }
}

console.log('=== "진소개"(지인소개 제외) 저장 컬럼 ===');
if (hits.length === 0) {
  console.log('  → DB 어디에도 "진소개" 단독값 없음 (0건)');
} else {
  for (const h of hits) {
    console.log(`  ${h.table_name}.${h.column_name}: ${h.n}건`);
    const sample = await c.query(`SELECT "${h.column_name}" AS v, count(*)::int AS n FROM public."${h.table_name}" WHERE "${h.column_name}" LIKE '%진소개%' AND "${h.column_name}" NOT LIKE '%지인소개%' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
    for (const s of sample.rows) console.log(`     · "${s.v}" × ${s.n}`);
  }
}

// 2) 참고: 정상 '지인소개' 분포 (customers.visit_route_detail / visit_route)
console.log('\n=== 참고: 정상 "지인소개" 분포 ===');
for (const [t, col] of [['customers','visit_route'],['customers','visit_route_detail'],['customers','lead_source']]) {
  try {
    const r = await c.query(`SELECT count(*)::int AS n FROM public."${t}" WHERE "${col}" LIKE '%지인소개%'`);
    console.log(`  ${t}.${col} 지인소개 포함: ${r.rows[0].n}건`);
  } catch (e) { console.log(`  ${t}.${col}: (조회불가)`); }
}
await c.end();
console.log('\n=== RCA 완료 ===');

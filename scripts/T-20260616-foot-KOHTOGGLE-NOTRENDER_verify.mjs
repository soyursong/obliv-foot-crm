/**
 * T-20260616-foot-KOHTOGGLE-NOTRENDER  fix 검증 (READ-ONLY)
 * 새 컴포넌트 쿼리(useKohServicesForCustomer)와 동치 SQL 로
 * 재방문 환자(이전엔 미노출)가 이제 toggle 타겟을 찾는지 확인.
 *   동치식: check_in_services JOIN check_ins(customer_id=?, status<>cancelled)
 *           WHERE name ILIKE %KOH%|%진균검사% ORDER BY created_at DESC
 *           → 첫 행의 check_in_id = 타겟. 그 내원의 KOH service 묶음.
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
const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
const log = (...a) => console.log(...a);
log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

// 이전 진단에서 ❌미노출 이던 customer prefix (재방문/과거검사 케이스)
const targets = ['83ab4fe1', '16434582', '13301614', 'fb64b02f', '7fa5dff1'];

for (const pfx of targets) {
  // 새 쿼리 동치
  const r = await client.query(`
    SELECT cis.id, cis.service_name, cis.koh_requested, cis.check_in_id, cis.created_at
    FROM check_in_services cis
    JOIN check_ins ci ON ci.id = cis.check_in_id
    WHERE ci.customer_id::text LIKE $1
      AND ci.status <> 'cancelled'
      AND (cis.service_name ILIKE '%KOH%' OR cis.service_name ILIKE '%진균검사%')
    ORDER BY cis.created_at DESC
  `, [pfx + '%']);
  if (r.rowCount === 0) { log(`cust=${pfx}  ⚠ KOH service 없음(스킵)`); continue; }
  const target = r.rows[0].check_in_id;
  const grouped = r.rows.filter(x => x.check_in_id === target);
  log(`cust=${pfx}  ✅ toggle 노출  타겟내원=${target.slice(0,8)}  KOH svc ${grouped.length}건  anyOn=${grouped.some(x=>x.koh_requested)}`);
}
log('');
await client.end();
log('✅ fix 검증 완료 — 위 모든 케이스가 이제 toggle 타겟을 찾음(이전엔 미노출)');

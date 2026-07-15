/**
 * T-20260715-foot-RESVDETAIL-CUSTMEMO-C2Z1-SYNC — AC-0 divergence 측정 (read-only, PHI 무노출)
 * customer_memo(예약팝업/체크인/고객목록 canonical) vs customer_note(2번차트 1구역 only)
 * COUNT/NULL-flag 집계만. 메모 내용(PHI) 미조회.
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

const q = await c.query(`
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE nullif(btrim(customer_memo),'') IS NOT NULL) AS has_memo,
    count(*) FILTER (WHERE nullif(btrim(customer_note),'') IS NOT NULL) AS has_note,
    count(*) FILTER (WHERE nullif(btrim(customer_note),'') IS NOT NULL
                       AND nullif(btrim(customer_memo),'') IS NULL) AS note_only,
    count(*) FILTER (WHERE nullif(btrim(customer_memo),'') IS NOT NULL
                       AND nullif(btrim(customer_note),'') IS NULL) AS memo_only,
    count(*) FILTER (WHERE nullif(btrim(customer_note),'') IS NOT NULL
                       AND nullif(btrim(customer_memo),'') IS NOT NULL
                       AND btrim(customer_note) IS DISTINCT FROM btrim(customer_memo)) AS both_diff,
    count(*) FILTER (WHERE nullif(btrim(customer_note),'') IS NOT NULL
                       AND btrim(customer_note) = btrim(customer_memo)) AS both_same
  FROM customers
`);
console.log('customers 고객메모 컬럼 divergence:');
console.table(q.rows);

// 3구역 예약메모 히스토리 seed 영향 파악: customer_memo 있는데 history row 아직 없는 고객 수(un-seeded)
const seed = await c.query(`
  SELECT count(*) AS memo_present_unseeded
  FROM customers cu
  WHERE nullif(btrim(cu.customer_memo),'') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM customer_reservation_memos m WHERE m.customer_id = cu.id)
`);
console.log('\n예약메모 히스토리 미seed(customer_memo 존재):', seed.rows[0]);

await c.end();

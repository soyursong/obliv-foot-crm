/**
 * T-20260617-foot-BUNDLERX-CREATE-FLOW-OVERHAUL — Part A 검증 COUNT (READ-ONLY)
 * reporter 직접 수동삭제 완료 후 dev 검증용 (MSG-20260618-105312-yqa4).
 *   - prescription_sets 잔재 0건 기대 (이전 19건 → reporter 수동삭제)
 *   - prescription_codes 보존 확인 (자체약19 + 보험약494 = 513 기대, 삭제 미해당)
 * SELECT only. DELETE / write 절대 금지.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log(`✅ DB 연결 (READ-ONLY)  ${new Date().toISOString()}\n`);

// 1) prescription_sets 잔재 검증 (0 기대)
const ps = await client.query(`SELECT count(*)::int AS n FROM prescription_sets`);
const psN = ps.rows[0].n;
console.log(`[1] prescription_sets 전체 : ${psN} 건  (기대=0)  ${psN === 0 ? '✅ PASS' : '⚠ 잔재 — FOLLOWUP 필요(추정 DELETE 금지)'}`);

if (psN !== 0) {
  const dist = await client.query(
    `SELECT id, name, folder, jsonb_array_length(COALESCE(items,'[]'::jsonb)) AS items_len, created_at
     FROM prescription_sets ORDER BY created_at LIMIT 50`);
  console.log(`  [잔재 상세]`);
  for (const r of dist.rows) console.log(`   - ${r.id} | ${r.name} | folder=${r.folder} | items=${r.items_len} | ${r.created_at}`);
}

// 2) prescription_codes 보존 검증 (513 기대)
const reg = await client.query(`SELECT to_regclass('public.prescription_codes') AS oid`);
if (reg.rows[0].oid) {
  const pc = await client.query(`SELECT count(*)::int AS n FROM prescription_codes`);
  console.log(`\n[2] prescription_codes 전체 : ${pc.rows[0].n} 건  (기대≈513: 자체약19+보험약494, 삭제 미해당 — 보존)`);
  // code_type 분포
  const ct = await client.query(
    `SELECT COALESCE(code_type,'(NULL)') AS code_type, count(*)::int AS n
     FROM prescription_codes GROUP BY code_type ORDER BY n DESC`);
  console.log(`  [code_type 분포]`);
  for (const r of ct.rows) console.log(`   - ${r.code_type}: ${r.n}`);
} else {
  console.log(`\n[2] prescription_codes 테이블 미발견`);
}

await client.end();
console.log(`\n✅ Part A 검증 COUNT 완료 (READ-ONLY, DELETE 미실행)`);

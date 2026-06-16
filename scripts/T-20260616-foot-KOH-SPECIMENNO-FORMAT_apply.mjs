/**
 * T-20260616-foot-KOH-SPECIMENNO-FORMAT — APPLY (영속)
 * 검체번호 포맷 핀: next_koh_specimen_no(uuid,date,text) 교체 + publish_koh_result 검체번호 활성.
 * dev-foot 직접 DB 적용(pg 직접 연결). 마이그 파일(BEGIN/COMMIT 내장) 실행 후 시그니처·포맷 검증.
 * 회귀 시 20260616180000_koh_specimen_no_format.rollback.sql 로 복구.
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
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const migPath = 'supabase/migrations/20260616180000_koh_specimen_no_format.sql';
const sql = fs.readFileSync(migPath, 'utf8');

// ── 1) APPLY ──
const c1 = conn();
await c1.connect();
console.log(`✅ DB 연결 (APPLY)  ${new Date().toISOString()}\n`);
try {
  await c1.query(sql); // 파일 내 BEGIN..COMMIT + DO $verify$
  console.log('✅ 마이그 실행 완료 (COMMIT, $verify$ 통과).');
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  await c1.end();
  process.exit(1);
}
await c1.end();

// ── 2) 별도 연결로 시그니처·포맷 영속 검증 ──
const c2 = conn();
await c2.connect();
const sig = await c2.query(`
  SELECT pg_get_function_identity_arguments(oid) AS args
    FROM pg_proc WHERE proname='next_koh_specimen_no' ORDER BY args`);
console.log('\nnext_koh_specimen_no 시그니처:', sig.rows.map(r => r.args));

const fmt = await c2.query(
  `SELECT next_koh_specimen_no('00000000-0000-0000-0000-000000000000'::uuid, '2026-06-16'::date, '1234') AS s`);
console.log('포맷 샘플 (기대 K260616-1234):', fmt.rows[0].s);

const pub = await c2.query(
  `SELECT pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='publish_koh_result' LIMIT 1)) AS def`);
const hasCall = /v_specimen_no\s*:=\s*next_koh_specimen_no/.test(pub.rows[0].def);
console.log('publish_koh_result 검체번호 호출 활성:', hasCall);

await c2.end();
if (sig.rows.length === 1 && sig.rows[0].args === 'p_clinic uuid, p_base_date date, p_phone_last4 text'
    && fmt.rows[0].s === 'K260616-1234' && hasCall) {
  console.log('\n✅ 검증 통과 — 시그니처 교체 + 포맷 핀 + 호출 활성 확정.');
} else {
  console.error('\n❌ 검증 실패'); process.exit(1);
}

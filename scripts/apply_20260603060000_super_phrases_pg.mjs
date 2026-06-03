/**
 * T-20260603-foot-RX-CHART-FOLLOWUP2 #7 (= RX-SUPER-PHRASE 마이그 갭 해소)
 *   super_phrases 테이블 prod 생성 — RX-SUPER-PHRASE deployed 이나 db_applied:false 로
 *   prod 미적용 → SuperPhrasesTab 런타임 에러(#7). 마이그 20260603060000_super_phrases.sql 직접 실행.
 *
 *   전부 additive · 멱등(CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS). 레거시 무영향.
 *   node-pg pooler 직접 연결. 적용 후 무결성 dry-run(insert→rollback).
 *   supervisor 마이그 리뷰 전제(AC-7-1) — 적용 결과 PUSH-ESCALATION 통보.
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

const SQL = fs.readFileSync('supabase/migrations/20260603060000_super_phrases.sql', 'utf8');

console.log('🚀 #7 super_phrases 마이그 적용 (RX-SUPER-PHRASE 갭 해소)');
try {
  await client.connect();
  console.log('✅ DB 연결');

  await client.query(SQL);
  console.log('✅ 마이그 SQL 실행 완료');

  const t = await client.query(`SELECT to_regclass('public.super_phrases') t;`);
  console.log(`✅ super_phrases 테이블 ${t.rows[0].t ? '존재' : '실패'}`);

  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='super_phrases' ORDER BY ordinal_position;`);
  console.log('   컬럼:', cols.rows.map(r => r.column_name).join(', '));

  const pol = await client.query(
    `SELECT policyname FROM pg_policies WHERE tablename='super_phrases';`);
  console.log('   RLS 정책:', pol.rows.map(r => r.policyname).join(', '));

  // ── dry-run: insert→rollback (스키마 무결성 + 부분슬롯 허용 확인) ──
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO super_phrases (name, diagnosis, clinical_progress, rx_items) VALUES ($1,$2,$3,$4);`,
      ['DRYRUN 슈퍼상용구', '진단명 테스트', null, JSON.stringify([{ name: '약A', dosage: '1정', route: '경구', frequency: '1일 3회', days: 3, notes: '' }])]);
    console.log('✅ dry-run: super_phrases insert OK (부분슬롯 nullable 확인, 롤백 예정)');
  } finally {
    await client.query('ROLLBACK');
    console.log('↩️  dry-run 롤백 완료 (실데이터 무변경)');
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}

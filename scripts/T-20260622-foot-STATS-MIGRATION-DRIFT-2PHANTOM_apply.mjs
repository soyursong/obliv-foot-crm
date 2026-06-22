/**
 * T-20260622-foot-STATS-MIGRATION-DRIFT-2PHANTOM — AC2 적용
 * 20260623120000_foot_therapist_stats_designated_on_roster.sql 적용.
 * 절차: (1) 적용 전 시그니처 확인 → (2) dry-run(BEGIN;apply;ROLLBACK) → (3) 실적용(COMMIT) → (4) 검증.
 * 재실행 안전: DROP IF EXISTS + CREATE. 롤백 = *.rollback.sql.
 * 인자: --apply (없으면 dry-run 까지만).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const DO_APPLY = process.argv.includes('--apply');

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
  port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const SQL = fs.readFileSync(
  'supabase/migrations/20260623120000_foot_therapist_stats_designated_on_roster.sql', 'utf8');

async function sig(label) {
  const { rows } = await client.query(`
    SELECT pg_get_function_result(p.oid) AS result
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='foot_stats_therapist_summary';`);
  console.log(`[${label}] summary result: ${rows[0]?.result}`);
}

async function smoke(label) {
  // 이번 달 전 클리닉 designated 값 노출 확인 + 무결성(분자<=분모, rate 계산)
  const { rows } = await client.query(`
    SELECT s.name, s.treatment_count, s.designated_count, s.total_checkin_count, s.designated_rate
    FROM clinics cl
    CROSS JOIN LATERAL foot_stats_therapist_summary(cl.id, date_trunc('month', now())::date, now()::date) s
    ORDER BY s.total_checkin_count DESC NULLS LAST, s.name;`);
  console.log(`\n[${label}] 행수=${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.name}: treat=${r.treatment_count} desig=${r.designated_count}/${r.total_checkin_count} rate=${r.designated_rate ?? 'NULL'}`);
  }
  // 무결성 가드
  const bad = rows.filter(r => r.designated_count > r.total_checkin_count);
  if (bad.length) { console.error('❌ 무결성 위반: designated_count > total_checkin_count', bad); throw new Error('integrity'); }
  console.log('  ✓ 무결성: designated_count <= total_checkin_count 전행 통과');
}

try {
  await client.connect();
  console.log('✅ DB 연결 성공\n');

  await sig('적용 전');

  // (2) dry-run
  console.log('\n── dry-run (BEGIN; apply; ROLLBACK) ──');
  await client.query('BEGIN');
  await client.query(SQL.replace(/^BEGIN;|COMMIT;$/gm, ''));  // 내부 BEGIN/COMMIT 제거 후 외부 트랜잭션 사용
  await sig('dry-run(rollback 전)');
  await smoke('dry-run');
  await client.query('ROLLBACK');
  await sig('dry-run 롤백 후(원복 확인)');

  if (!DO_APPLY) {
    console.log('\n⏸️  dry-run 까지만. 실적용은 --apply 플래그.');
    process.exit(0);
  }

  // (3) 실적용
  console.log('\n── 실적용 (COMMIT) ──');
  await client.query(SQL);  // 파일 자체 BEGIN..COMMIT
  await sig('적용 후');
  await smoke('적용 후');
  console.log('\n✅ 적용 완료');
} catch (e) {
  console.error('❌', e.message);
  try { await client.query('ROLLBACK'); } catch {}
  process.exit(1);
} finally {
  await client.end();
}

/**
 * T-20260622-foot-STATS-THERAPIST-LOAD-STAFFFILTER
 * 치료사 통계 RPC 2종 직원 소스 단일화(AC3) + 재직 치료사 한정(AC4) 적용.
 * supabase/migrations/20260622120000_foot_therapist_stats_staff_source_filter.sql 그대로 적용.
 * node-pg 직접 연결. dev-foot DB 직접 실행 정책 준수.
 *
 * 절차: (1) 적용 전 진단(치료사 명단·제외 대상 노출 여부) → (2) dry-run(BEGIN;apply;ROLLBACK)
 *       → (3) 실제 적용(BEGIN;apply;COMMIT) → (4) 적용 후 검증.
 * 재실행 안전: CREATE OR REPLACE (완전 멱등). 롤백 = *.rollback.sql.
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
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const SQL = fs.readFileSync(
  'supabase/migrations/20260622120000_foot_therapist_stats_staff_source_filter.sql', 'utf8');

async function runSummary(label) {
  // 첫 번째 클리닉(jongno-foot) 기준 이번 달 요약 — 명단(이름) 추출
  const { rows } = await client.query(`
    SELECT s.name
    FROM clinics cl
    CROSS JOIN LATERAL foot_stats_therapist_summary(cl.id, date_trunc('month', now())::date, now()::date) s
    ORDER BY s.name;
  `);
  console.log(`\n[${label}] summary 명단(${rows.length}): ${rows.map(r => r.name).join(', ') || '(없음)'}`);
  return rows.map(r => r.name);
}

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  // (1) 진단: staff 치료사·재직 명단 vs 현 RPC 노출 명단
  const { rows: roster } = await client.query(`
    SELECT name, role, active FROM staff
    WHERE role = 'therapist' AND active = true
    ORDER BY name;`);
  console.log(`\n[진단] staff 치료사·재직 명단(${roster.length}): ${roster.map(r => r.name).join(', ')}`);
  const { rows: nonTher } = await client.query(`
    SELECT name, role, active FROM staff
    WHERE role <> 'therapist' OR active = false
    ORDER BY active, role, name;`);
  console.log(`[진단] 비치료사/퇴사자(staff): ${nonTher.map(r => `${r.name}(${r.role},active=${r.active})`).join(', ')}`);

  const before = await runSummary('적용 전');

  // (2) dry-run
  await client.query('BEGIN');
  await client.query(SQL.replace(/^BEGIN;|COMMIT;$/gm, '')); // 내부 BEGIN/COMMIT 중복 방지
  const dry = await runSummary('dry-run(미커밋)');
  await client.query('ROLLBACK');
  console.log('✅ dry-run 정상 (ROLLBACK 완료)');

  // (3) 실제 적용
  await client.query(SQL);
  console.log('\n✅ RPC 2종 적용 완료 (COMMIT)');

  // (4) 검증
  const after = await runSummary('적용 후');

  const { rows: fns } = await client.query(`
    SELECT proname, obj_description(oid) AS cmt FROM pg_proc
    WHERE proname IN ('foot_stats_therapist_summary','foot_stats_therapist_services')
    ORDER BY proname;`);
  console.log('\n[검증] 함수 코멘트:');
  fns.forEach(f => console.log(`  - ${f.proname}: ${f.cmt}`));

  const rosterNames = new Set(roster.map(r => r.name));
  const leaked = after.filter(n => !rosterNames.has(n));
  if (leaked.length) {
    console.log(`\n⚠️ 적용 후에도 비-roster 명단 노출: ${leaked.join(', ')}`);
  } else {
    console.log('\n✅ 적용 후 summary 명단이 모두 staff 치료사·재직 명단 내 (비치료사/퇴사자 0건)');
  }
  console.log(`\n요약: before=${before.length}명 → after=${after.length}명 (roster=${roster.length}명)`);
} catch (e) {
  console.error('❌ 실패:', e.message);
  try { await client.query('ROLLBACK'); } catch { /* noop */ }
  process.exit(1);
} finally {
  await client.end();
}

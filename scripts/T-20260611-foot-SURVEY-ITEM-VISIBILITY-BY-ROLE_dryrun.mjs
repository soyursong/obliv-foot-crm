/**
 * T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE — DRY-RUN
 * 마이그레이션을 트랜잭션 안에서 적용 → 결과 정책 검증 → ROLLBACK (영속 변경 없음).
 * 구문/헬퍼 존재/결과 술어를 확인만 한다. 실제 prod 적용은 supervisor DB 게이트.
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
console.log(`✅ DB 연결  ${new Date().toISOString()}  (DRY-RUN — 끝에서 ROLLBACK)\n`);

const migPath = 'supabase/migrations/20260611150000_health_q_rls_canonical_identity.sql';
// COMMIT/BEGIN 을 제거하고 단일 트랜잭션으로 감싸 검증 후 롤백
let sql = fs.readFileSync(migPath, 'utf8')
  .split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

const before = await client.query(
  `SELECT tablename, policyname, cmd, qual FROM pg_policies
     WHERE schemaname='public' AND tablename IN ('health_q_results','health_q_tokens')
     ORDER BY tablename, cmd, policyname`);
console.log('── BEFORE 정책 ──');
for (const r of before.rows) console.log(`  ${r.tablename}.${r.policyname} [${r.cmd}]`);

try {
  await client.query('BEGIN');
  await client.query(sql);
  const after = await client.query(
    `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
       WHERE schemaname='public' AND tablename IN ('health_q_results','health_q_tokens')
       ORDER BY tablename, cmd, policyname`);
  console.log('\n── AFTER 정책 (트랜잭션 내, 미커밋) ──');
  for (const r of after.rows) {
    console.log(`  ${r.tablename}.${r.policyname} [${r.cmd}]`);
    if (r.cmd === 'SELECT') console.log(`      USING: ${(r.qual||'').replace(/\s+/g,' ')}`);
    if (r.cmd === 'INSERT') console.log(`      WITH CHECK: ${(r.with_check||'').replace(/\s+/g,' ')}`);
  }
  // 회귀가드 자동 점검
  const selPols = after.rows.filter(r => r.cmd==='SELECT');
  const okIdentity = selPols.every(r => /is_approved_user\(\)/.test(r.qual) && /current_user_clinic_id\(\)/.test(r.qual));
  const okNoStaff  = selPols.every(r => !/FROM staff/.test(r.qual));
  const insertUntouched = after.rows.some(r => r.tablename==='health_q_tokens' && r.cmd==='INSERT');
  const noResultsWrite = !after.rows.some(r => r.tablename==='health_q_results' && r.cmd!=='SELECT');
  console.log('\n── 회귀가드 자동 점검 ──');
  console.log(`  AC-1/2 정규 신원(user_profiles)+clinic 스코프 적용 : ${okIdentity ? '✅' : '❌'}`);
  console.log(`  비정규 staff.user_id 패턴 제거                    : ${okNoStaff ? '✅' : '❌'}`);
  console.log(`  AC-3 tokens INSERT 정책 불변                      : ${insertUntouched ? '✅' : '❌'}`);
  console.log(`  AC-3 results 쓰기 정책 신설 없음                  : ${noResultsWrite ? '✅' : '❌'}`);
  await client.query('ROLLBACK');
  console.log('\n↩️  ROLLBACK 완료 — prod 영속 변경 없음.');
  console.log((okIdentity && okNoStaff && insertUntouched && noResultsWrite)
    ? '\n✅ DRY-RUN PASS — SQL 구문/헬퍼/술어/회귀가드 모두 통과.'
    : '\n❌ DRY-RUN FAIL — 위 항목 확인.');
} catch (e) {
  await client.query('ROLLBACK').catch(()=>{});
  console.error('\n❌ DRY-RUN 적용 중 오류 (ROLLBACK 됨):', e.message);
  process.exitCode = 1;
}
await client.end();

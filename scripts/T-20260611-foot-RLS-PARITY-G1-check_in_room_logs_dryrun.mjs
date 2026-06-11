/**
 * T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY  Phase 2-A / G1 (check_in_room_logs) — DRY-RUN
 * 마이그를 트랜잭션 안에서 적용 → 결과 정책 검증 → ROLLBACK (영속 변경 없음).
 * 단일 [ALL] → SELECT canonical + 쓰기 3정책(원 user_profiles 술어 보존) 분리를 확인.
 * 실제 prod 적용은 supervisor DB 게이트.
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

const TBL = 'check_in_room_logs';
const migPath = 'supabase/migrations/20260611170000_check_in_room_logs_select_rls_canonical.sql';
const sql = fs.readFileSync(migPath, 'utf8')
  .split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

const q = `SELECT policyname, cmd, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='${TBL}' ORDER BY cmd, policyname`;
const norm = s => (s||'').replace(/\s+/g,' ').trim();

const before = await client.query(q);
console.log('── BEFORE 정책 ──');
for (const r of before.rows) console.log(`  ${TBL}.${r.policyname} [${r.cmd}]  USING:${norm(r.qual)}  CHECK:${norm(r.with_check)}`);

try {
  await client.query('BEGIN');
  await client.query(sql);
  const after = await client.query(q);
  console.log('\n── AFTER 정책 (트랜잭션 내, 미커밋) ──');
  for (const r of after.rows) console.log(`  ${TBL}.${r.policyname} [${r.cmd}]  USING:${norm(r.qual)}  CHECK:${norm(r.with_check)}`);

  const sel = after.rows.filter(r => r.cmd==='SELECT');
  const writes = after.rows.filter(r => ['INSERT','UPDATE','DELETE'].includes(r.cmd));
  const noAll = after.rows.every(r => r.cmd !== 'ALL');
  const okSelCanonical = sel.length===1 && /is_approved_user\(\)/.test(sel[0].qual) && /current_user_clinic_id\(\)/.test(sel[0].qual);
  // 쓰기 3정책 = 원 [ALL] user_profiles 술어 보존(의미 불변)
  const upPred = /user_profiles[\s\S]*auth\.uid\(\)/;
  const writeKinds = new Set(writes.map(r=>r.cmd));
  const okWritePreserved = writes.length>0
    && ['INSERT','UPDATE','DELETE'].every(k=>writeKinds.has(k))
    && writes.every(r => {
        const pred = r.cmd==='INSERT' ? r.with_check : r.qual;
        return upPred.test(norm(pred)) && !/is_approved_user/.test(norm(pred));
      });

  console.log('\n── 회귀가드 자동 점검 ──');
  console.log(`  단일 [ALL] 해체(ALL 정책 0건)                          : ${noAll ? '✅' : '❌'}`);
  console.log(`  SELECT canonical(is_approved_user()+clinic) 단일 신설  : ${okSelCanonical ? '✅' : '❌'}`);
  console.log(`  AC-4 쓰기 3정책 = 원 user_profiles 술어 보존(의미 불변): ${okWritePreserved ? '✅' : '❌'}`);
  await client.query('ROLLBACK');
  console.log('\n↩️  ROLLBACK 완료 — prod 영속 변경 없음.');
  console.log((noAll && okSelCanonical && okWritePreserved)
    ? '\n✅ DRY-RUN PASS — 분리/canonical/쓰기보존 모두 통과.'
    : '\n❌ DRY-RUN FAIL — 위 항목 확인.');
  if (!(noAll && okSelCanonical && okWritePreserved)) process.exitCode = 1;
} catch (e) {
  await client.query('ROLLBACK').catch(()=>{});
  console.error('\n❌ DRY-RUN 적용 중 오류 (ROLLBACK 됨):', e.message);
  process.exitCode = 1;
}
await client.end();

/**
 * T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN — DRY-RUN
 * 매출집계 read 잠금(daily_closings + closing_manual_payments) 마이그를 트랜잭션 안에서
 * 적용 → 결과 정책 검증 → ROLLBACK (영속 변경 없음).
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

const migPath = 'supabase/migrations/20260611180000_closing_revenue_read_lock.sql';
const sql = fs.readFileSync(migPath, 'utf8')
  .split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

const norm = s => (s||'').replace(/\s+/g,' ').trim();
const q = (t) => `SELECT policyname, cmd, qual, with_check FROM pg_policies
   WHERE schemaname='public' AND tablename='${t}' ORDER BY cmd, policyname`;
const dump = async (t, label) => {
  const r = await client.query(q(t));
  console.log(`── ${label} ${t} ──`);
  for (const p of r.rows) console.log(`  ${p.policyname} [${p.cmd}]  USING:${norm(p.qual)}  CHECK:${norm(p.with_check)}`);
  return r.rows;
};

const dcBefore = await dump('daily_closings', 'BEFORE');
const cmBefore = await dump('closing_manual_payments', 'BEFORE');

try {
  await client.query('BEGIN');
  await client.query(sql);
  console.log('\n');
  const dcAfter = await dump('daily_closings', 'AFTER ');
  const cmAfter = await dump('closing_manual_payments', 'AFTER ');

  const dcSel = dcAfter.filter(r=>r.cmd==='SELECT');
  const cmSel = cmAfter.filter(r=>r.cmd==='SELECT');

  // daily_closings: over-open / therapist 제거, coordinator 제거, staff_read 유지
  const noOverOpen = !dcSel.some(r => norm(r.qual)==='true');
  const noTherapist = !dcSel.some(r => r.policyname==='daily_closings_therapist_read');
  const fin = dcSel.find(r => r.policyname==='daily_closings_finance_read');
  const finNoCoord = fin && /is_consultant_or_above\(\)/.test(fin.qual) && !/is_coordinator_or_above/.test(fin.qual);
  const staffKept = dcSel.some(r => r.policyname==='daily_closings_staff_read' && /is_floor_staff\(\)/.test(r.qual));

  // closing_manual: over-open 제거 → consultant_or_above ∪ floor_staff
  const cmRead = cmSel.find(r=>r.policyname==='closing_manual_read');
  const cmLocked = cmRead && norm(cmRead.qual)!=='true'
    && /is_consultant_or_above\(\)/.test(cmRead.qual) && /is_floor_staff\(\)/.test(cmRead.qual);

  // AC-4: 쓰기 정책 불변(daily_closings ALL ×2, closing_manual insert/update/delete)
  const writeUnchanged = (tBefore, tAfter) => {
    const wb = tBefore.filter(r=>r.cmd!=='SELECT'), wa = tAfter.filter(r=>r.cmd!=='SELECT');
    return wb.length===wa.length && wb.every(b=>{
      const a = wa.find(x=>x.policyname===b.policyname && x.cmd===b.cmd);
      return a && norm(a.qual)===norm(b.qual) && norm(a.with_check)===norm(b.with_check);
    });
  };
  const dcWriteOk = writeUnchanged(dcBefore, dcAfter);
  const cmWriteOk = writeUnchanged(cmBefore, cmAfter);

  console.log('\n── 회귀가드 자동 점검 ──');
  console.log(`  daily_closings over-open(USING true) 제거              : ${noOverOpen ? '✅' : '❌'}`);
  console.log(`  daily_closings therapist_read 회수                     : ${noTherapist ? '✅' : '❌'}`);
  console.log(`  daily_closings finance_read coordinator 회수           : ${finNoCoord ? '✅' : '❌'}`);
  console.log(`  daily_closings staff_read(is_floor_staff) 유지         : ${staffKept ? '✅' : '❌'}`);
  console.log(`  closing_manual over-open 회수→consultant∪floor 게이트  : ${cmLocked ? '✅' : '❌'}`);
  console.log(`  AC-4 daily_closings 쓰기(ALL×2) 불변                   : ${dcWriteOk ? '✅' : '❌'}`);
  console.log(`  AC-4 closing_manual 쓰기(insert/update/delete) 불변    : ${cmWriteOk ? '✅' : '❌'}`);

  const pass = noOverOpen && noTherapist && finNoCoord && staffKept && cmLocked && dcWriteOk && cmWriteOk;
  await client.query('ROLLBACK');
  console.log('\n↩️  ROLLBACK 완료 — prod 영속 변경 없음.');
  console.log(pass ? '\n✅ DRY-RUN PASS — 매출 read 잠금/쓰기 불변 모두 통과.' : '\n❌ DRY-RUN FAIL — 위 항목 확인.');
  if (!pass) process.exitCode = 1;
} catch (e) {
  await client.query('ROLLBACK').catch(()=>{});
  console.error('\n❌ DRY-RUN 적용 중 오류 (ROLLBACK 됨):', e.message);
  process.exitCode = 1;
}
await client.end();

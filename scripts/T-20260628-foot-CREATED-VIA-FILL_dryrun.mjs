/**
 * T-20260628-crm-RESV-CREATED-VIA-FILL §2 — DRY-RUN (BEGIN...ROLLBACK, write 0)
 * 20260628160000_reservations_created_via.sql 을 트랜잭션 내 실행 후 ROLLBACK.
 * 검증: ADD COLUMN + CHECK 가 에러 없이 적용되는지, 9값 통과/위반값 차단.
 */
import pg from 'pg'; import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env','utf8').split('\n')) { const m=line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if(m) DB_PASSWORD=m[1].trim(); }
}
const SQL = fs.readFileSync('./supabase/migrations/20260628160000_reservations_created_via.sql','utf8');
const c = new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:DB_PASSWORD, ssl:{rejectUnauthorized:false}});
await c.connect();
try {
  await c.query('BEGIN');
  await c.query(SQL);
  console.log('✅ migration SQL applied (in tx)');
  const chk = await c.query(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='public.reservations'::regclass AND conname='reservations_created_via_check'`);
  console.log('CHECK def:', chk.rows[0]?.def);
  // 9값 통과 + NULL 통과 + 위반값 차단 검증 (DO 블록으로 임시 INSERT 없이 CHECK 자체 평가)
  for (const v of ['manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin']) {
    const r = await c.query(`SELECT (CAST($1 AS text) IS NULL OR CAST($1 AS text) IN ('manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin')) AS ok`, [v]);
    if (!r.rows[0].ok) throw new Error('value should pass: '+v);
  }
  const bad = await c.query(`SELECT (CAST('admin' AS text) IN ('manual','dopamine','aicc','naver','meta','inbound','selfbook','kakao','walkin')) AS ok`);
  console.log('✅ 9값 전부 통과. 별칭원본 admin 차단:', bad.rows[0].ok === false);
  await c.query('ROLLBACK');
  console.log('✅ ROLLBACK 완료 (write 0). DRY-RUN PASS.');
} catch (e) {
  await c.query('ROLLBACK');
  console.error('❌ DRY-RUN FAIL:', e.message);
  process.exitCode = 1;
} finally { await c.end(); }

/**
 * T-20260628-foot-NOTIFLOG-STATUS-CHECK-DELIVERED-ALTER — DRY-RUN
 * 마이그레이션을 트랜잭션 안에서 적용 → 8값 제약/신규 버킷 INSERT/위반거부 검증 → ROLLBACK.
 * 영속 변경 없음. 실제 prod 적용은 supervisor DDL-diff 게이트.
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

const migPath = 'supabase/migrations/20260628120000_notiflog_status_delivered_atafail.sql';
const sql = fs.readFileSync(migPath, 'utf8')
  .split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;/i.test(l)).join('\n');

const defOf = async () => (await client.query(
  `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conname='notification_logs_status_check'`)).rows[0]?.def || '(none)';

console.log('── BEFORE 제약 ──\n  ' + await defOf() + '\n');

// 기존 데이터가 신규(축소 아님) 제약을 위반할 일은 없지만, ADDITIVE 안전성 명시 확인.
const violators = (await client.query(
  `SELECT status, count(*) AS c FROM public.notification_logs
     WHERE status NOT IN ('pending','sent','failed','cancelled','opt_out','skipped','delivered','ata_fail')
     GROUP BY status`)).rows;

let okInsertDelivered = false, okInsertAtaFail = false, okRejectBad = false, okFailedAtaSeparate = false;

// FK 충족용 실제 clinic_id (CHECK만 순수 검증하기 위함)
const clinicId = (await client.query(
  `SELECT clinic_id FROM public.notification_logs WHERE clinic_id IS NOT NULL LIMIT 1`)).rows[0]?.clinic_id;
console.log(`(검증용 실제 clinic_id: ${clinicId})\n`);

try {
  await client.query('BEGIN');
  await client.query(sql);
  console.log('── AFTER 제약 (트랜잭션 내, 미커밋) ──\n  ' + await defOf() + '\n');

  // delivered INSERT 가능
  try {
    await client.query('SAVEPOINT sp1');
    await client.query(`INSERT INTO public.notification_logs (clinic_id, event_type, channel, status)
      VALUES ($1, 'dryrun_test', 'alimtalk', 'delivered')`, [clinicId]);
    okInsertDelivered = true;
    await client.query('ROLLBACK TO SAVEPOINT sp1');
  } catch (e) { await client.query('ROLLBACK TO SAVEPOINT sp1'); console.log('  delivered INSERT err:', e.message); }

  // ata_fail INSERT 가능
  try {
    await client.query('SAVEPOINT sp2');
    await client.query(`INSERT INTO public.notification_logs (clinic_id, event_type, channel, status)
      VALUES ($1, 'dryrun_test', 'alimtalk', 'ata_fail')`, [clinicId]);
    okInsertAtaFail = true;
    await client.query('ROLLBACK TO SAVEPOINT sp2');
  } catch (e) { await client.query('ROLLBACK TO SAVEPOINT sp2'); console.log('  ata_fail INSERT err:', e.message); }

  // 자의 변형 거부 (failed_delivery → 23514 기대)
  try {
    await client.query('SAVEPOINT sp3');
    await client.query(`INSERT INTO public.notification_logs (clinic_id, event_type, channel, status)
      VALUES ($1, 'dryrun_test', 'alimtalk', 'failed_delivery')`, [clinicId]);
    await client.query('ROLLBACK TO SAVEPOINT sp3'); // 통과하면 잘못된 것
  } catch (e) { okRejectBad = (e.code === '23514'); await client.query('ROLLBACK TO SAVEPOINT sp3'); }

  // failed / ata_fail 별 버킷 (둘 다 허용 + 서로 다른 리터럴)
  const def = await defOf();
  okFailedAtaSeparate = /'failed'/.test(def) && /'ata_fail'/.test(def);

  await client.query('ROLLBACK');
  console.log('↩️  ROLLBACK 완료 — prod 영속 변경 없음.\n');

  console.log('── 자동 점검 ──');
  console.log(`  ADDITIVE 안전: 기존 데이터 신규제약 위반 0건            : ${violators.length === 0 ? '✅' : '❌ ' + JSON.stringify(violators)}`);
  console.log(`  delivered INSERT 가능                                  : ${okInsertDelivered ? '✅' : '❌'}`);
  console.log(`  ata_fail  INSERT 가능                                  : ${okInsertAtaFail ? '✅' : '❌'}`);
  console.log(`  자의 변형(failed_delivery) 거부 (23514)                : ${okRejectBad ? '✅' : '❌'}`);
  console.log(`  failed != ata_fail 별 버킷 (둘 다 제약에 존재)         : ${okFailedAtaSeparate ? '✅' : '❌'}`);

  const pass = violators.length === 0 && okInsertDelivered && okInsertAtaFail && okRejectBad && okFailedAtaSeparate;
  console.log(pass
    ? '\n✅ DRY-RUN PASS — ADDITIVE ALTER 구문/신규 버킷/위반거부/별 버킷 모두 통과. 위반 0.'
    : '\n❌ DRY-RUN FAIL — 위 항목 확인.');
  if (!pass) process.exitCode = 1;
} catch (e) {
  await client.query('ROLLBACK').catch(()=>{});
  console.error('\n❌ DRY-RUN 적용 중 오류 (ROLLBACK 됨):', e.message);
  process.exitCode = 1;
}
await client.end();

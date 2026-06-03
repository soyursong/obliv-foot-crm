/**
 * T-20260603-foot-DASH-NAME-STALE-SYNC — 기존 stale customer_name 1회성 backfill.
 *
 * ⚠️ 승인 게이트: 기본 DRY-RUN(카운트만). 실제 UPDATE 는 --apply 플래그 필요.
 *    backfill 영향 row 수를 planner/supervisor 에 사전 보고 → 승인 후 --apply 실행.
 *    (리스크 #4 대량 데이터 변경)
 *
 * ⚠️ Placeholder 보호 가드:
 *    backfill 은 customers.name 을 스냅샷에 전파한다. 그러나 일부 고객의 customers.name 이
 *    "초진환자N" 등 placeholder 인데 스냅샷에 실명이 들어있는 역방향 케이스가 존재한다
 *    (예: d1d9414d "초진환자1" ← 스냅샷 "고양이", 버그1). 이런 행에 backfill 하면 카드까지
 *    placeholder 로 오염되어 AC-1 을 위반한다. → customers.name 이 '^초진환자[0-9]*$' 패턴이면
 *    backfill 에서 제외한다(스냅샷 실명 보존). 해당 고객 실명 정정은 별도 confirm 후 수동.
 *
 * 사용:
 *   node scripts/backfill_customer_name_stale_20260603.mjs          # dry-run (카운트만)
 *   node scripts/backfill_customer_name_stale_20260603.mjs --apply  # 실제 적용 (승인 후)
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const APPLY = process.argv.includes('--apply');

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) {
  console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)');
  process.exit(1);
}

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

console.log(`🚀 customer_name backfill (${APPLY ? 'APPLY' : 'DRY-RUN'}) — T-20260603-foot-DASH-NAME-STALE-SYNC`);

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  const PLACEHOLDER = `c.name !~ '^초진환자[0-9]*$'`;

  const ciStale = await client.query(`
    SELECT count(*)::int AS n
    FROM check_ins ci JOIN customers c ON ci.customer_id = c.id
    WHERE ci.customer_name IS DISTINCT FROM c.name AND ${PLACEHOLDER};`);
  const resvStale = await client.query(`
    SELECT count(*)::int AS n
    FROM reservations r JOIN customers c ON r.customer_id = c.id
    WHERE r.customer_name IS DISTINCT FROM c.name AND ${PLACEHOLDER};`);
  const ciProtected = await client.query(`
    SELECT count(*)::int AS n
    FROM check_ins ci JOIN customers c ON ci.customer_id = c.id
    WHERE ci.customer_name IS DISTINCT FROM c.name AND NOT (${PLACEHOLDER});`);

  console.log(`ℹ️  backfill 대상 check_ins.customer_name : ${ciStale.rows[0].n} row (placeholder 제외)`);
  console.log(`ℹ️  backfill 대상 reservations.customer_name: ${resvStale.rows[0].n} row (placeholder 제외)`);
  console.log(`🛡️  placeholder('초진환자N') 보호로 제외된 check_ins: ${ciProtected.rows[0].n} row (스냅샷 실명 보존)`);

  // 샘플 (검토용, PII 최소 — id + before/after 이름 + 보호여부)
  const sample = await client.query(`
    SELECT ci.id, ci.customer_name AS snapshot_name, c.name AS current_name,
           (c.name ~ '^초진환자[0-9]*$') AS placeholder_protected
    FROM check_ins ci JOIN customers c ON ci.customer_id = c.id
    WHERE ci.customer_name IS DISTINCT FROM c.name
    ORDER BY ci.checked_in_at DESC LIMIT 30;`);
  if (sample.rows.length) {
    console.log('───── check_ins stale 샘플 (최대 30건) ─────');
    for (const r of sample.rows) {
      const tag = r.placeholder_protected ? '  🛡️PROTECTED(제외)' : '';
      console.log(`  ci.id=${r.id}  snapshot="${r.snapshot_name}" → current="${r.current_name}"${tag}`);
    }
  }

  if (!APPLY) {
    console.log('🛑 DRY-RUN 종료. 실제 적용은 승인 후 --apply 플래그로 실행.');
  } else {
    await client.query('BEGIN');
    const ciUp = await client.query(`
      UPDATE check_ins ci SET customer_name = c.name FROM customers c
      WHERE ci.customer_id = c.id AND ci.customer_name IS DISTINCT FROM c.name AND ${PLACEHOLDER};`);
    const resvUp = await client.query(`
      UPDATE reservations r SET customer_name = c.name FROM customers c
      WHERE r.customer_id = c.id AND r.customer_name IS DISTINCT FROM c.name AND ${PLACEHOLDER};`);
    await client.query('COMMIT');
    console.log(`✅ backfill 적용: check_ins ${ciUp.rowCount} row, reservations ${resvUp.rowCount} row`);

    const post = await client.query(`
      SELECT
        (SELECT count(*)::int FROM check_ins ci JOIN customers c ON ci.customer_id=c.id WHERE ci.customer_name IS DISTINCT FROM c.name AND ${PLACEHOLDER}) AS ci_left,
        (SELECT count(*)::int FROM reservations r JOIN customers c ON r.customer_id=c.id WHERE r.customer_name IS DISTINCT FROM c.name AND ${PLACEHOLDER}) AS resv_left;`);
    console.log(`🔎 적용 후 잔여 stale(placeholder 제외): check_ins ${post.rows[0].ci_left}, reservations ${post.rows[0].resv_left} (AC-4: 0건 기대)`);
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}

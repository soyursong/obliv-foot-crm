/**
 * T-20260603-foot-DASH-NAME-STALE-SYNC
 * customers.name → check_ins/reservations.customer_name 전파 트리거 적용.
 * 트리거 신규(additive, 데이터 무변경) — 향후 성함 UPDATE 시에만 발화.
 * 기존 stale row 정정은 별도 backfill 스크립트(승인 게이트).
 * 부수효과: stale row 수(backfill 영향 규모) DRY-RUN 카운트 보고.
 * node-pg 직접 연결 방식.
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

console.log('🚀 customers.name 동기화 트리거 적용 (T-20260603-foot-DASH-NAME-STALE-SYNC)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  // 1) backfill 영향 규모 DRY-RUN (적용 X, 카운트만) — 승인 게이트 보고용
  const ciStale = await client.query(`
    SELECT count(*)::int AS n
    FROM check_ins ci JOIN customers c ON ci.customer_id = c.id
    WHERE ci.customer_name IS DISTINCT FROM c.name;`);
  const resvStale = await client.query(`
    SELECT count(*)::int AS n
    FROM reservations r JOIN customers c ON r.customer_id = c.id
    WHERE r.customer_name IS DISTINCT FROM c.name;`);
  console.log('────────── BACKFILL DRY-RUN (영향 row 수) ──────────');
  console.log(`  check_ins   stale customer_name: ${ciStale.rows[0].n} row`);
  console.log(`  reservations stale customer_name: ${resvStale.rows[0].n} row`);
  console.log('  → 위 수치는 backfill 승인 게이트 보고용. 이 스크립트는 backfill 미적용.');
  console.log('──────────────────────────────────────────────────');

  // 2) 트리거 적용 (DDL, additive — 데이터 무변경)
  await client.query(`
    CREATE OR REPLACE FUNCTION fn_sync_customer_name()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      IF NEW.name IS DISTINCT FROM OLD.name THEN
        UPDATE public.check_ins
          SET customer_name = NEW.name
          WHERE customer_id = NEW.id AND customer_name IS DISTINCT FROM NEW.name;
        UPDATE public.reservations
          SET customer_name = NEW.name
          WHERE customer_id = NEW.id AND customer_name IS DISTINCT FROM NEW.name;
      END IF;
      RETURN NEW;
    END;
    $$;`);
  console.log('✅ fn_sync_customer_name() 생성');

  await client.query(`DROP TRIGGER IF EXISTS trg_sync_customer_name ON public.customers;`);
  await client.query(`
    CREATE TRIGGER trg_sync_customer_name
      AFTER UPDATE OF name ON public.customers
      FOR EACH ROW
      WHEN (NEW.name IS DISTINCT FROM OLD.name)
      EXECUTE FUNCTION fn_sync_customer_name();`);
  console.log('✅ trg_sync_customer_name 트리거 생성');

  await client.query(`ALTER FUNCTION fn_sync_customer_name() OWNER TO postgres;`);
  console.log('✅ 함수 소유권 postgres');

  // 3) 트리거 검증 — 트랜잭션 내 이름 변경 → 스냅샷 전파 확인 후 롤백
  await client.query('BEGIN');
  try {
    const probe = await client.query(`
      SELECT ci.customer_id, c.name AS cur_name
      FROM check_ins ci JOIN customers c ON ci.customer_id = c.id
      WHERE ci.customer_id IS NOT NULL
      ORDER BY ci.checked_in_at DESC LIMIT 1;`);
    if (probe.rows.length) {
      const cid = probe.rows[0].customer_id;
      const probeName = `__SYNC_TEST_${Date.now()}`;
      await client.query(`UPDATE customers SET name = $1 WHERE id = $2;`, [probeName, cid]);
      const verify = await client.query(
        `SELECT count(*)::int AS n FROM check_ins WHERE customer_id = $1 AND customer_name = $2;`,
        [cid, probeName]);
      console.log(`✅ 트리거 검증: 이름 변경 → check_ins 스냅샷 전파 ${verify.rows[0].n} row (롤백 예정)`);
    } else {
      console.log('ℹ️  검증 skip: customer_id 연결된 check_in 없음');
    }
  } finally {
    await client.query('ROLLBACK');
    console.log('↩️  검증 롤백 완료 (실데이터 무변경)');
  }

} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}

/**
 * probe4 — 배포 prod 경로(foot-checkin)가 쓰는 self_checkin_with_reservation_link 의 권한 상태.
 * ⚠ ROLLBACK-only. prod 영속 변경 0.
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
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log('✅ DB 연결 (probe4, ROLLBACK-only)\n');

const fns = ['self_checkin_with_reservation_link','fn_selfcheckin_find_customer','fn_selfcheckin_upsert_customer_resolve_v3'];
const meta = await c.query(`
  SELECT p.proname, p.prosecdef AS sec_definer, pg_get_userbyid(p.proowner) AS owner,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY($1) ORDER BY p.proname`, [fns]);
console.log('── prod 경로 함수 권한 상태 ──'); console.table(meta.rows);

// self_checkin_with_reservation_link 본문에서 customers write 접점
const body = await c.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc
  WHERE proname='self_checkin_with_reservation_link' AND pronamespace='public'::regnamespace LIMIT 1`);
if (body.rows[0]) {
  const def = body.rows[0].def;
  console.log('\n── self_checkin_with_reservation_link customers write 접점 ──');
  console.log('   INSERT INTO customers:', /INSERT INTO customers/i.test(def));
  console.log('   UPDATE customers:', /UPDATE customers/i.test(def));
  console.log('   INSERT INTO check_ins:', /INSERT INTO check_ins/i.test(def));
}

const clinicId = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const today = '2026-07-19';
console.log('\n── anon 세션 self_checkin_with_reservation_link 호출 재현 (ROLLBACK) ──');
try {
  await c.query('BEGIN');
  await c.query('SET LOCAL ROLE anon');
  const r = await c.query(
    `SELECT public.self_checkin_with_reservation_link($1::uuid,$2::date,$3::jsonb) AS res`,
    [clinicId, today, JSON.stringify({
      name: '__probe삭제대상__', phone: '01000000000', phone_e164: '+821000000000',
      visit_type: 'new', ci_status: 'receiving', sms_opt_in: true, notes: null,
      customer_id: null, reservation_id: null,
    })]);
  console.log('   ✅ 성공(42501 미재현). 반환:', JSON.stringify(r.rows[0]?.res));
} catch (e) {
  console.log(`   결과: code=${e.code} msg="${e.message}"`);
  if (e.code === '42501') console.log('   → 42501 재현! permission denied 발생 지점 확정.');
} finally { await c.query('ROLLBACK'); }

await c.end();
console.log('\n✅ probe4 완료 (ROLLBACK-only).');

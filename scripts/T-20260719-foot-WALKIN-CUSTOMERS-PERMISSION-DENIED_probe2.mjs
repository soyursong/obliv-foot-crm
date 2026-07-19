/**
 * T-20260719-foot-WALKIN-CUSTOMERS-PERMISSION-DENIED — probe2: 라이브 anon 경로 재현 (ROLLBACK-only)
 *
 * ⚠ 모든 write 는 BEGIN...ROLLBACK 안에서만. prod 영속 변경 0 (persisted row 0).
 * 목적: ticket §1.2 — anon 세션이 v3 를 호출할 때 42501 재현 여부 + 정확한 오류.
 *   + customers.created_by 컬럼 정의/default + BEFORE INSERT 트리거(anon 권한 의존) 조사.
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
console.log('✅ DB 연결 (probe2, ROLLBACK-only)\n');

// ── created_by 컬럼 정의 + default ──
const col = await c.query(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers' AND column_name IN ('created_by')`);
console.log('── customers.created_by 컬럼 ──');
console.table(col.rows);

// ── customers 트리거 (BEFORE/AFTER INSERT) ──
const trg = await c.query(`
  SELECT t.tgname, t.tgenabled,
         pg_get_triggerdef(t.oid) AS def
  FROM pg_trigger t
  WHERE t.tgrelid='public.customers'::regclass AND NOT t.tgisinternal
  ORDER BY t.tgname`);
console.log('── customers 트리거 ──');
for (const r of trg.rows) console.log(`   ${r.tgname} [enabled=${r.tgenabled}]: ${r.def.slice(0,140)}`);
if (!trg.rows.length) console.log('   (없음)');

// ── v3 함수 본문에서 created_by INSERT 목록 확인 ──
const body = await c.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc
  WHERE proname='fn_selfcheckin_upsert_customer_resolve_v3' AND pronamespace='public'::regnamespace LIMIT 1`);
const def = body.rows[0]?.def || '';
const insMatch = def.match(/INSERT INTO customers[\s\S]*?VALUES/i);
console.log('\n── v3 INSERT 컬럼 목록 (created_by 포함 여부) ──');
console.log('   created_by in INSERT col-list:', /created_by/i.test(def));
console.log('   prosecdef path (SET ROLE inside?):', /SET ROLE|set_config/i.test(def) ? 'yes(주의)' : 'no');

// ── 실제 clinic_id 확보 (read-only) ──
const clinic = await c.query(`SELECT id, name FROM clinics ORDER BY created_at LIMIT 3`);
console.log('\n── clinic 후보 ──'); console.table(clinic.rows);
const clinicId = clinic.rows[0]?.id;

// ── 라이브 재현: SET LOCAL ROLE anon → v3 호출 → 무조건 ROLLBACK ──
console.log('\n── (핵심) anon 세션 v3 호출 재현 (ROLLBACK) ──');
try {
  await c.query('BEGIN');
  await c.query("SELECT set_config('request.jwt.claims','{\"role\":\"anon\"}',true)");
  await c.query('SET LOCAL ROLE anon');
  const who = await c.query('SELECT current_user, session_user');
  console.log('   current_user=', who.rows[0].current_user);
  const r = await c.query(
    `SELECT * FROM public.fn_selfcheckin_upsert_customer_resolve_v3(
        $1::uuid, $2::text, $3::text, $4::text)`,
    [clinicId, '__probe_테스트_삭제대상__', '01000000000', 'new']);
  console.log('   ✅ RPC 성공 (42501 미재현):', JSON.stringify(r.rows));
} catch (e) {
  console.log(`   ❌ RPC 실패: code=${e.code} message="${e.message}"`);
  if (e.code === '42501') console.log('   → 42501 재현! 42501 발생 지점 = SECURITY DEFINER 우회 실패');
} finally {
  await c.query('ROLLBACK');
  console.log('   (ROLLBACK 완료 — 영속 변경 0)');
}

// ── 대조: authenticated 롤로도 동일 호출 ──
console.log('\n── (대조) authenticated 세션 v3 호출 재현 (ROLLBACK) ──');
try {
  await c.query('BEGIN');
  await c.query('SET LOCAL ROLE authenticated');
  const r = await c.query(
    `SELECT * FROM public.fn_selfcheckin_upsert_customer_resolve_v3($1::uuid,$2::text,$3::text,$4::text)`,
    [clinicId, '__probe_테스트_삭제대상__', '01000000001', 'new']);
  console.log('   ✅ RPC 성공:', JSON.stringify(r.rows));
} catch (e) {
  console.log(`   ❌ RPC 실패: code=${e.code} message="${e.message}"`);
} finally {
  await c.query('ROLLBACK');
}

await c.end();
console.log('\n✅ probe2 완료 (무변경, ROLLBACK-only).');

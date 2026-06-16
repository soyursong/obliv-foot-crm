/**
 * T-20260616-foot-LASER-TIMER-SETTING-NOREFLECT — DIAG2
 *  A) prod CHECK 제약 현재 상태 (마이그 20260616020000 적용 여부)
 *  B) laser_time_units jsonb 라운드트립 (sentinel write→read→복원, 트랜잭션 ROLLBACK)
 *  C) authenticated+admin UPDATE 시뮬 (jsonb, ROLLBACK) → 0-row 무음실패 재현
 *  D) timer_records INSERT 시 비-기본 duration(예:12) 허용 여부 (트랜잭션 ROLLBACK)
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
console.log(`✅ DB 연결  ${new Date().toISOString()}\n`);

// A) CHECK 제약 현재 상태
const chk = await client.query(`SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid='public.timer_records'::regclass AND contype='c'`);
console.log('── A) timer_records CHECK 제약 (prod 현재) ──');
for (const r of chk.rows) console.log(`  ${r.conname}: ${r.def}`);
const loosened = chk.rows.some(r => /BETWEEN 1 AND 180/i.test(r.def));
console.log(`  → 마이그 20260616020000 적용? ${loosened ? '✅ 적용됨(1~180)' : '❌ 미적용(여전히 IN 5,15,20 추정)'}`);
console.log('');

// B) laser_time_units 라운드트립 (service-role, jsonb)
const jr = await client.query(`SELECT id, laser_time_units FROM clinics WHERE slug='jongno-foot'`);
const jongnoId = jr.rows[0].id;
console.log('── B) laser_time_units jsonb 라운드트립 (ROLLBACK) ──');
console.log(`  현재값=${JSON.stringify(jr.rows[0].laser_time_units)}`);
await client.query('BEGIN');
const sentinel = [11, 22, 33];
await client.query(`UPDATE clinics SET laser_time_units=$1::jsonb WHERE id=$2`, [JSON.stringify(sentinel), jongnoId]);
const rb = await client.query(`SELECT laser_time_units FROM clinics WHERE id=$1`, [jongnoId]);
console.log(`  sentinel write=${JSON.stringify(sentinel)} → read back=${JSON.stringify(rb.rows[0].laser_time_units)}`);
console.log(`  → 라운드트립 ${JSON.stringify(rb.rows[0].laser_time_units)===JSON.stringify(sentinel)?'✅ 일치':'❌ 불일치'}`);
await client.query('ROLLBACK');
console.log('');

// C) authenticated+admin UPDATE 시뮬 (jsonb)
console.log('── C) authenticated+admin UPDATE 시뮬 (jsonb, ROLLBACK) ──');
try {
  await client.query('BEGIN');
  // is_admin_or_manager() 가 어떤 입력에 의존하는지 확인
  await client.query(`SET LOCAL role authenticated`);
  await client.query(`SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000"}',true)`);
  const upd = await client.query(`UPDATE clinics SET laser_time_units='[7,9]'::jsonb WHERE id=$1 RETURNING id`, [jongnoId]);
  console.log(`  rowCount=${upd.rowCount}  ${upd.rowCount===0?'❌ 0-row(RLS 차단 — 무음실패 가능)':'✅ 통과'}`);
  await client.query('ROLLBACK');
} catch (e) { await client.query('ROLLBACK'); console.log(`  에러: ${e.message}`); }
console.log('  (참: is_admin_or_manager 정의)');
const fn = await client.query(`SELECT pg_get_functiondef('public.is_admin_or_manager()'::regprocedure) AS d`).catch(()=>({rows:[]}));
if (fn.rows[0]) console.log('   ', fn.rows[0].d.replace(/\n/g,' ').slice(0,400));
console.log('');

// D) timer_records INSERT 비-기본 duration 허용? (service-role, ROLLBACK) — CHECK 영향만 본다
console.log('── D) timer_records INSERT duration=12 허용? (ROLLBACK) ──');
const cols = await client.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema='public' AND table_name='timer_records' ORDER BY ordinal_position`);
console.log('  컬럼:', cols.rows.map(c=>c.column_name).join(', '));
await client.query('BEGIN');
try {
  // 최소 필수 컬럼만 시도 — CHECK 위반 여부만 확인 (다른 NOT NULL 있으면 메시지로 식별)
  await client.query(`INSERT INTO timer_records (duration_minutes) VALUES (12)`);
  console.log('  → duration=12 INSERT ✅ 허용 (CHECK 완화 적용 확인)');
} catch (e) {
  const isCheck = /duration_minutes_check/i.test(e.message);
  console.log(`  → INSERT 거부: ${e.message}`);
  if (isCheck) console.log('  ❌ CHECK(duration IN 5,15,20) 여전 — 비기본 타이머 시작 불가');
  else console.log('  (CHECK 외 NOT NULL 등 다른 제약 — CHECK 자체는 통과)');
}
await client.query('ROLLBACK');

await client.end();
console.log('\n완료.');

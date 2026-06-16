/**
 * DIAG3 — 저장 무음실패(role divergence) 가설 검증
 *  - current_user_role() / is_approved_user() 정의
 *  - profiles 테이블에서 김주연(및 admin/manager 후보) role·approved 상태
 *  - 실제 admin 한 명의 uid 로 RLS UPDATE 시뮬 (ROLLBACK) → rowCount 확인
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

for (const fn of ['current_user_role()', 'is_approved_user()']) {
  try {
    const r = await client.query(`SELECT pg_get_functiondef('public.${fn}'::regprocedure) AS d`);
    console.log(`── ${fn} ──\n  ${r.rows[0].d.replace(/\n/g,' ')}\n`);
  } catch (e) { console.log(`── ${fn} ── 없음/에러: ${e.message}\n`); }
}

// profiles 스키마
const pc = await client.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='user_profiles' ORDER BY ordinal_position`);
console.log('── profiles 컬럼 ──\n  ', pc.rows.map(c=>c.column_name).join(', '), '\n');

// 김주연 + admin/manager 후보
const cols = pc.rows.map(c=>c.column_name);
const nameCol = cols.includes('name') ? 'name' : (cols.includes('full_name')?'full_name':'id');
const approvedExpr = cols.includes('approved') ? 'approved' : (cols.includes('is_approved')?'is_approved':(cols.includes('status')?'status':'NULL'));
const q = `SELECT id, ${nameCol} AS nm, role, ${approvedExpr} AS approved FROM user_profiles
  WHERE ${nameCol} ILIKE '%김주연%' OR role IN ('admin','manager','director') ORDER BY role`;
const pr = await client.query(q);
console.log('── 김주연 + admin/manager/director 후보 ──');
for (const r of pr.rows) console.log(`  ${r.nm}  role=${r.role}  approved=${r.approved}  id=${r.id}`);
console.log('');

// 실제 admin/manager uid 로 RLS UPDATE 시뮬
const admin = pr.rows.find(r => ['admin','manager','director'].includes(r.role) && (r.approved===true || r.approved==='approved' || r.approved===null));
const jr = await client.query(`SELECT id FROM clinics WHERE slug='jongno-foot'`);
const jongnoId = jr.rows[0].id;
if (admin) {
  console.log(`── 실제 ${admin.role}(${admin.nm}) uid 로 RLS UPDATE 시뮬 (ROLLBACK) ──`);
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL role authenticated`);
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ role:'authenticated', sub: admin.id })]);
    const upd = await client.query(`UPDATE clinics SET laser_time_units='[8,16]'::jsonb WHERE id=$1 RETURNING id`, [jongnoId]);
    console.log(`  rowCount=${upd.rowCount}  ${upd.rowCount===0?'❌ 0-row(RLS 차단)':'✅ 통과 — 실 admin 저장 정상'}`);
    await client.query('ROLLBACK');
  } catch (e) { await client.query('ROLLBACK'); console.log(`  에러: ${e.message}`); }
} else {
  console.log('실제 admin 후보 못 찾음');
}

await client.end();
console.log('\n완료.');

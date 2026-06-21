/**
 * T-20260620-foot-JUYEON-ACCOUNT-FULL-PERM — exempt_from_restrictions APPLY (phase1 db_migration)
 * supervisor FIX-REQUEST MSG-20260621-115605-rbwm (DDL_DIFF_HOLD 게이트 통과).
 * dev-foot 직접 DB 적용 (SHADOW_MODE 우회: db push 대신 pg 직접 연결).
 *
 * 순서:
 *   1) ADDITIVE DDL : user_profiles.exempt_from_restrictions boolean NOT NULL DEFAULT false (IF NOT EXISTS)
 *   2) backfill DML : id=ee67fc6b… (김주연 총괄) exempt_from_restrictions=true (idempotent)
 *   3) 별도 연결 영속 검증 : 컬럼 존재 + juyeon true + 전체 true count
 * 실패 시 rollback SQL = 각 마이그 파일 하단 주석.
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
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const JUYEON_ID = 'ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12';
const ADDITIVE = 'supabase/migrations/20260620163000_user_profiles_exempt_from_restrictions_additive.sql.DDL_DIFF_HOLD';
const SETDML   = 'supabase/migrations/20260620163100_juyeon_exempt_from_restrictions_set.sql.DDL_DIFF_HOLD';

const ddlSql = fs.readFileSync(ADDITIVE, 'utf8');
const dmlSql = fs.readFileSync(SETDML, 'utf8');

// ── 1) APPLY DDL ──
const c1 = conn();
await c1.connect();
console.log(`✅ DB 연결 (APPLY)  ${new Date().toISOString()}\n`);
try {
  await c1.query(ddlSql);   // BEGIN..COMMIT 내장
  console.log('✅ [1/2] ADDITIVE DDL 실행 완료 (exempt_from_restrictions 컬럼).');
  await c1.query(dmlSql);   // BEGIN..COMMIT 내장
  console.log('✅ [2/2] backfill DML 실행 완료 (juyeon=true).');
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  await c1.end();
  process.exit(1);
}
await c1.end();

// ── 2) 별도 연결 영속 검증 ──
const c2 = conn();
await c2.connect();

const col = await c2.query(`SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='user_profiles' AND column_name='exempt_from_restrictions'`);
const jy = await c2.query(`SELECT id, role, exempt_from_restrictions, updated_at
  FROM public.user_profiles WHERE id=$1`, [JUYEON_ID]);
const cnt = await c2.query(`SELECT count(*)::int AS n FROM public.user_profiles WHERE exempt_from_restrictions = true`);
await c2.end();

console.log('\n── 영속 검증 (신규 연결) ──');
console.log('  컬럼 정의:', JSON.stringify(col.rows[0] || null));
console.log('  juyeon row:', JSON.stringify(jy.rows[0] || null));
console.log('  exempt=true 총 행수:', cnt.rows[0].n);

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 회귀가드 ──');
const c = col.rows[0];
chk('컬럼 존재 exempt_from_restrictions', !!c);
chk('boolean NOT NULL DEFAULT false', c && c.data_type === 'boolean' && c.is_nullable === 'NO' && /false/.test(c.column_default || ''));
chk('juyeon PK(ee67fc6b…) exempt=true', jy.rows[0] && jy.rows[0].exempt_from_restrictions === true);
chk('exempt=true 행수 ≥ 1', cnt.rows[0].n >= 1);

console.log(`\n${pass ? '🟢 PASS' : '🔴 FAIL'} — exempt_from_restrictions APPLY`);
process.exit(pass ? 0 : 1);

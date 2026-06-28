/**
 * T-20260627-foot-ANON-RLS-PHASE2B — Gate B: fn_selfcheckin_upsert_customer_resolve_v2 적용 (ADDITIVE)
 * 절차: (1) 적용 전 시그니처 확인 → (2) dry-run(BEGIN; apply; smoke; ROLLBACK) → (3) 실적용(--apply, COMMIT) → (4) 검증.
 * 재실행 안전: CREATE OR REPLACE + GRANT. 롤백 = 20260628160000_*.rollback.sql (DROP + REVOKE).
 * 인자: --apply (없으면 dry-run 까지만).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const DO_APPLY = process.argv.includes('--apply');

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const SQL = fs.readFileSync(
  'supabase/migrations/20260628160000_anon_upsert_customer_resolve_v2.sql', 'utf8');

async function sig(label) {
  const { rows } = await client.query(`
    SELECT pg_get_function_result(p.oid) AS result,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_selfcheckin_upsert_customer_resolve_v2';`);
  console.log(`[${label}] result: ${rows[0]?.result ?? '(부재)'}`);
  if (rows[0]) console.log(`[${label}] args  : ${rows[0].args}`);
  // anon GRANT 확인
  const { rows: g } = await client.query(`
    SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='fn_selfcheckin_upsert_customer_resolve_v2';`);
  if (g[0]) console.log(`[${label}] anon EXECUTE: ${g[0].anon_exec}`);
}

async function smoke(label) {
  // 임의 clinic 1개로 created → linked → ambiguous 3분기 검증 (전부 rollback 트랜잭션 내부).
  const { rows: cl } = await client.query(`SELECT id FROM clinics LIMIT 1;`);
  if (!cl.length) { console.log(`[${label}] clinics 0행 — smoke skip`); return; }
  const clinic = cl[0].id;
  const nm = '____anonrls2b_smoke____';
  const ph = '+821099990001';

  // created
  const r1 = await client.query(
    `SELECT * FROM fn_selfcheckin_upsert_customer_resolve_v2($1,$2,$3,'new',true,NULL,NULL,NULL,NULL,NULL,NULL,NULL);`,
    [clinic, nm, ph]);
  console.log(`[${label}] created → link_status=${r1.rows[0]?.link_status} id=${r1.rows[0]?.customer_id ? 'O' : 'NULL'}`);
  if (r1.rows[0]?.link_status !== 'created') throw new Error('expected created');

  // linked (동일 성함+연락처 → 1건 매칭)
  const r2 = await client.query(
    `SELECT * FROM fn_selfcheckin_upsert_customer_resolve_v2($1,$2,$3,'returning',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);`,
    [clinic, nm, ph]);
  console.log(`[${label}] linked  → link_status=${r2.rows[0]?.link_status} same_id=${r2.rows[0]?.customer_id === r1.rows[0]?.customer_id}`);
  if (r2.rows[0]?.link_status !== 'linked') throw new Error('expected linked');
  if (r2.rows[0]?.customer_id !== r1.rows[0]?.customer_id) throw new Error('linked id mismatch');

  // ambiguous: UNIQUE(clinic_id, RAW phone) 때문에 동일 raw 2건은 불가 → 포맷변종(같은 canonical, 다른 raw)으로
  //   중복 차트를 만든다(실데이터 시나리오: '+8210…' vs '0010…' 혼재). resolve_v2 canonical 매칭이 2건 → ambiguous.
  await client.query(`INSERT INTO customers(clinic_id,name,phone,visit_type) VALUES ($1,$2,$3,'new');`, [clinic, nm, '01099990001']);
  const r3 = await client.query(
    `SELECT * FROM fn_selfcheckin_upsert_customer_resolve_v2($1,$2,$3,'new',true,NULL,NULL,NULL,NULL,NULL,NULL,NULL);`,
    [clinic, nm, ph]);
  console.log(`[${label}] ambiguous → link_status=${r3.rows[0]?.link_status} id=${r3.rows[0]?.customer_id ?? 'NULL'}`);
  if (r3.rows[0]?.link_status !== 'ambiguous') throw new Error('expected ambiguous');
  if (r3.rows[0]?.customer_id !== null) throw new Error('ambiguous must return NULL customer_id (PII 0)');
  console.log(`  ✓ 3분기(created/linked/ambiguous) + ambiguous PII 0 통과`);
}

try {
  await client.connect();
  console.log('✅ DB 연결 성공 (rxlomoozakkjesdqjtvd)\n');

  await sig('적용 전');

  console.log('\n── dry-run (BEGIN; apply; smoke; ROLLBACK) ──');
  await client.query('BEGIN');
  await client.query(SQL.replace(/^BEGIN;|^COMMIT;$/gm, ''));
  await sig('dry-run(rollback 전)');
  await smoke('dry-run');
  await client.query('ROLLBACK');
  await sig('dry-run 롤백 후(원복 확인)');

  if (!DO_APPLY) {
    console.log('\n⏸️  dry-run 까지만. 실적용은 --apply 플래그.');
    process.exit(0);
  }

  console.log('\n── 실적용 (COMMIT) ──');
  await client.query(SQL);
  await sig('적용 후');
  console.log('\n✅ 적용 완료.');
} catch (e) {
  console.error('❌ 실패:', e.message);
  try { await client.query('ROLLBACK'); } catch { /* noop */ }
  process.exit(1);
} finally {
  await client.end();
}

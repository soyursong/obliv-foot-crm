/**
 * T-20260615-foot-BLOODTEST-TOGGLE-ADD — blood_test_requested 컬럼 + set_blood_test_requested RPC prod 적용
 *
 * 적용 대상: supabase/migrations/20260617000000_blood_test_requested.sql
 *   - check_in_services.blood_test_requested boolean NOT NULL DEFAULT false  (ADD COLUMN IF NOT EXISTS → 멱등)
 *   - RPC set_blood_test_requested(uuid, boolean)  (CREATE OR REPLACE → 멱등)
 * rollback: 20260617000000_blood_test_requested.rollback.sql
 *
 * data-architect ADDITIVE-GO (MSG-20260616-204655-neg5). KOH set_koh_requested 1:1 미러. supervisor DDL-diff 게이트만.
 *
 * probe / save-test:
 *   - [pg] blood_test_requested 컬럼 존재 + boolean + NOT NULL + default false
 *   - [pg] set_blood_test_requested RPC 정의 존재 + SECURITY DEFINER + authenticated EXECUTE
 *   - [pg] 저장 테스트(TX 내 ROLLBACK, prod 데이터 무변경):
 *       · 승인 사용자 컨텍스트로 true/false 토글 → 반환값 확인
 *       · 미승인 컨텍스트 거부(42501) 확인
 *       · 존재하지 않는 row → not found 예외 확인
 * 실행: node scripts/apply_20260617000000_blood_test_requested.mjs
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim();
}

const MIG_SQL = readFileSync(
  join(REPO, 'supabase/migrations/20260617000000_blood_test_requested.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260615-foot-BLOODTEST-TOGGLE-ADD_evidence.md');

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: ENV.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const log = [];
const out = (s) => { console.log(s); log.push(s); };
let failed = false;
const assert = (cond, label) => {
  out(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!cond) failed = true;
};

(async () => {
  await client.connect();
  out('# T-20260615-foot-BLOODTEST-TOGGLE-ADD — DB-gate evidence (prod apply)');
  out(`# at: ${new Date().toISOString()}`);
  out('# 적용: blood_test_requested boolean + set_blood_test_requested RPC (KOH 1:1 미러, ADDITIVE)');
  out('');

  // ── 1. 적용 ──
  out('## 1. 마이그레이션 적용');
  await client.query(MIG_SQL);
  out('  ✓ 20260617000000_blood_test_requested.sql 적용 완료');
  out('');

  // ── 2. 컬럼 probe ──
  out('## 2. 컬럼 probe');
  const col = (await client.query(
    `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='check_in_services' AND column_name='blood_test_requested'`,
  )).rows[0];
  assert(!!col, 'blood_test_requested 컬럼 존재');
  assert(col && col.data_type === 'boolean', `타입 boolean (got ${col?.data_type})`);
  assert(col && col.is_nullable === 'NO', 'NOT NULL');
  assert(col && /false/.test(col.column_default || ''), `default false (got ${col?.column_default})`);
  out('');

  // ── 3. RPC probe ──
  out('## 3. RPC probe');
  const fn = (await client.query(
    `SELECT p.prosecdef AS secdef,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='set_blood_test_requested'`,
  )).rows[0];
  assert(!!fn, 'set_blood_test_requested RPC 존재');
  assert(fn && fn.secdef === true, 'SECURITY DEFINER');
  assert(fn && fn.auth_exec === true, 'authenticated EXECUTE 권한');
  out('');

  // ── 4. 저장 테스트 (TX 내 ROLLBACK — prod 데이터 무변경) ──
  out('## 4. 저장 테스트 (toggle, TX rollback / prod 무변경)');
  const approvedUser = (await client.query(
    `SELECT id FROM user_profiles WHERE COALESCE(approved,false)=true AND COALESCE(active,true)=true LIMIT 1`,
  )).rows[0];
  const svc = (await client.query(`SELECT id FROM check_in_services LIMIT 1`)).rows[0];

  if (!approvedUser || !svc) {
    out(`  ⓘ 저장 테스트 스킵: approvedUser=${!!approvedUser} check_in_services_row=${!!svc}`);
  } else {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: approvedUser.id, role: 'authenticated' })]);

      // 4a. ON 저장 → true 반환
      const on = (await client.query(
        `SELECT set_blood_test_requested($1, true) AS r`, [svc.id],
      )).rows[0].r;
      assert(on === true, `ON 저장 → true (got ${on})`);

      // 4b. OFF 저장 → false 반환(행 유지)
      const off = (await client.query(
        `SELECT set_blood_test_requested($1, false) AS r`, [svc.id],
      )).rows[0].r;
      assert(off === false, `OFF 저장 → false, 행 유지 (got ${off})`);

      // 4c. NULL → false coalesce
      const nul = (await client.query(
        `SELECT set_blood_test_requested($1, null) AS r`, [svc.id],
      )).rows[0].r;
      assert(nul === false, `NULL → false coalesce (got ${nul})`);

      // 4d. 존재하지 않는 row → not found 예외
      let notFound = false;
      try {
        await client.query(`SELECT set_blood_test_requested($1, true)`,
          ['00000000-0000-0000-0000-000000000000']);
      } catch { notFound = true; }
      assert(notFound, '존재하지 않는 row → 예외(not found)');
    } finally {
      await client.query('ROLLBACK');
    }

    // 4e. 미승인 컨텍스트 거부
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', role: 'authenticated' })]);
      let denied = false;
      try {
        await client.query(`SELECT set_blood_test_requested($1, true)`, [svc.id]);
      } catch (e) { denied = e.code === '42501'; }
      assert(denied, '미승인 사용자 거부 (42501)');
    } finally {
      await client.query('ROLLBACK');
    }
  }
  out('');

  out(`## 결과: ${failed ? 'FAIL ✗' : 'PASS ✓'}`);

  mkdirSync(EVID_DIR, { recursive: true });
  writeFileSync(EVID_FILE, log.join('\n') + '\n');
  out(`\n# evidence → ${EVID_FILE}`);

  await client.end();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('FATAL', e);
  try { await client.end(); } catch {}
  process.exit(1);
});

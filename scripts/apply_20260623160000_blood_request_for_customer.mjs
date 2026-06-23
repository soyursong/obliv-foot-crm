/**
 * T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION — request_blood_test_for_customer RPC prod 적용
 *
 * 적용 대상: supabase/migrations/20260623160000_blood_request_for_customer.sql
 *   - RPC request_blood_test_for_customer(uuid, boolean)  (CREATE OR REPLACE → 멱등)
 *   - 테이블/컬럼/enum 무변경(旣 blood_test_requested 사용). 신규 스키마 CONSULT 불요.
 *   - request_koh_for_customer 1:1 미러.
 * rollback: 20260623160000_blood_request_for_customer.rollback.sql
 *
 * ⚠ prod 적용 게이트: data-architect CONSULT GO 후 실행(② 자동생성 행 청구·통계 이중계상 확인).
 *
 * probe / 동작 테스트 (TX 내 ROLLBACK → prod 데이터 무변경):
 *   - [pg] RPC 정의 존재 + SECURITY DEFINER + authenticated EXECUTE
 *   - [pg] ① 서비스 보유 고객 ON/OFF → blood_test_requested 동기화(旣 FE 루프 동작)
 *   - [pg] ② 서비스 없는 고객 ON → 피검사 요청 행 신규 INSERT(blood_test_requested=true, price=0)
 *   - [pg] ③ 서비스 없는 고객 OFF → no-op(신규행 생성 안 함)
 *   - [pg] 미승인 컨텍스트 거부(42501)
 * 실행: node scripts/apply_20260623160000_blood_request_for_customer.mjs
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
  join(REPO, 'supabase/migrations/20260623160000_blood_request_for_customer.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION_evidence.md');

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
  out('# T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION — DB-gate evidence (prod apply)');
  out(`# at: ${new Date().toISOString()}`);
  out('# 적용: request_blood_test_for_customer RPC (단독 검사신청 차단 해소, KOH 1:1 미러)');
  out('');

  // ── 1. 적용 ──
  out('## 1. 마이그레이션 적용');
  await client.query(MIG_SQL);
  out('  ✓ 20260623160000_blood_request_for_customer.sql 적용 완료');
  out('');

  // ── 2. RPC probe ──
  out('## 2. RPC probe');
  const fn = (await client.query(
    `SELECT p.prosecdef AS secdef,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='request_blood_test_for_customer'`,
  )).rows[0];
  assert(!!fn, 'request_blood_test_for_customer RPC 존재');
  assert(fn && fn.secdef === true, 'SECURITY DEFINER');
  assert(fn && fn.auth_exec === true, 'authenticated EXECUTE 권한');
  out('');

  const approvedUser = (await client.query(
    `SELECT id FROM user_profiles WHERE COALESCE(approved,false)=true AND COALESCE(active,true)=true LIMIT 1`,
  )).rows[0];

  // ── 3. 시나리오A: 서비스 보유 고객 ON/OFF 동기화 ──
  out('## 3. 시나리오A — 서비스 보유 고객 ON/OFF (旣 FE 루프 동작 보존)');
  const svcCust = (await client.query(
    `SELECT ci.customer_id
       FROM check_in_services cis JOIN check_ins ci ON ci.id = cis.check_in_id
      WHERE ci.status <> 'cancelled' AND ci.customer_id IS NOT NULL
      LIMIT 1`,
  )).rows[0];

  if (!approvedUser || !svcCust) {
    out(`  ⓘ 스킵: approvedUser=${!!approvedUser} svcCustomer=${!!svcCust}`);
  } else {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: approvedUser.id, role: 'authenticated' })]);

      const on = (await client.query(
        `SELECT request_blood_test_for_customer($1, true) AS r`, [svcCust.customer_id],
      )).rows[0].r;
      assert(on === true, `서비스보유 ON → true (got ${on})`);
      const cntOn = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1 AND cis.blood_test_requested=true`, [svcCust.customer_id],
      )).rows[0].c;
      assert(cntOn > 0, `ON 후 blood_test_requested=true 행 존재 (got ${cntOn})`);

      const off = (await client.query(
        `SELECT request_blood_test_for_customer($1, false) AS r`, [svcCust.customer_id],
      )).rows[0].r;
      assert(off === false, `서비스보유 OFF → false (got ${off})`);
    } finally { await client.query('ROLLBACK'); }
  }
  out('');

  // ── 4. 시나리오B: 서비스 행 없는 고객 ON → 신규 생성 / OFF → no-op ──
  out('## 4. 시나리오B — 서비스 행 없는 고객 ON 신규생성 / OFF no-op');
  const noSvcCust = (await client.query(
    `SELECT ci.customer_id
       FROM check_ins ci
      WHERE ci.status <> 'cancelled' AND ci.customer_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM check_in_services cis2 JOIN check_ins ci2 ON ci2.id=cis2.check_in_id
           WHERE ci2.customer_id = ci.customer_id AND ci2.status <> 'cancelled'
        )
      LIMIT 1`,
  )).rows[0];

  if (!approvedUser || !noSvcCust) {
    out(`  ⓘ 스킵(정상 — 2번차트 환자는 통상 서비스 보유): approvedUser=${!!approvedUser} noSvcCustomer=${!!noSvcCust}`);
  } else {
    // 4a. OFF 먼저 → no-op(신규행 생성 안 함)
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: approvedUser.id, role: 'authenticated' })]);
      const before = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1`, [noSvcCust.customer_id],
      )).rows[0].c;
      const off = (await client.query(
        `SELECT request_blood_test_for_customer($1, false) AS r`, [noSvcCust.customer_id],
      )).rows[0].r;
      assert(off === false, `서비스없음 OFF → false (got ${off})`);
      const afterOff = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1`, [noSvcCust.customer_id],
      )).rows[0].c;
      assert(before === 0 && afterOff === 0, `OFF no-op: 서비스행 0 유지 (before ${before} after ${afterOff})`);
    } finally { await client.query('ROLLBACK'); }

    // 4b. ON → 피검사 요청 신규 INSERT(blood_test_requested=true, price=0)
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: approvedUser.id, role: 'authenticated' })]);
      const on = (await client.query(
        `SELECT request_blood_test_for_customer($1, true) AS r`, [noSvcCust.customer_id],
      )).rows[0].r;
      assert(on === true, `서비스없음 ON → true (got ${on})`);
      const row = (await client.query(
        `SELECT cis.blood_test_requested, cis.price, cis.is_package_session, cis.service_name, cis.service_id
           FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1
          ORDER BY cis.created_at DESC LIMIT 1`, [noSvcCust.customer_id],
      )).rows[0];
      assert(!!row, 'ON 후 피검사 요청 행 신규 생성');
      assert(row && row.blood_test_requested === true, `신규행 blood_test_requested=true (got ${row?.blood_test_requested})`);
      assert(row && row.price === 0, `신규행 price=0 (매출 비귀속) (got ${row?.price})`);
      assert(row && row.is_package_session === false, `신규행 is_package_session=false (got ${row?.is_package_session})`);

      // 멱등성: 다시 ON → 중복 생성 안 함(보유 분기로 진입)
      await client.query(`SELECT request_blood_test_for_customer($1, true)`, [noSvcCust.customer_id]);
      const cnt = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1`, [noSvcCust.customer_id],
      )).rows[0].c;
      assert(cnt === 1, `재ON 멱등 — 서비스행 1개 유지(중복생성 없음) (got ${cnt})`);
    } finally { await client.query('ROLLBACK'); }
  }
  out('');

  // ── 5. 미승인 컨텍스트 거부 ──
  out('## 5. 권한 게이트');
  if (svcCust || noSvcCust) {
    const anyCust = (svcCust || noSvcCust).customer_id;
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', role: 'authenticated' })]);
      let denied = false;
      try {
        await client.query(`SELECT request_blood_test_for_customer($1, true)`, [anyCust]);
      } catch (e) { denied = e.code === '42501'; }
      assert(denied, '미승인 사용자 거부 (42501)');
    } finally { await client.query('ROLLBACK'); }
  } else {
    out('  ⓘ 스킵: 테스트 고객 없음');
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

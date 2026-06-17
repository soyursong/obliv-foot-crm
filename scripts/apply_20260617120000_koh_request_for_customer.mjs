/**
 * T-20260616-foot-KOH-BUTTON-ALL-CH — request_koh_for_customer RPC prod 적용
 *
 * 적용 대상: supabase/migrations/20260617120000_koh_request_for_customer.sql
 *   - RPC request_koh_for_customer(uuid, boolean)  (CREATE OR REPLACE → 멱등)
 *   - 테이블/컬럼/enum 무변경(旣 koh_requested 사용). 신규 CONSULT 불요.
 * rollback: 20260617120000_koh_request_for_customer.rollback.sql
 *
 * probe / 동작 테스트 (TX 내 ROLLBACK → prod 데이터 무변경):
 *   - [pg] RPC 정의 존재 + SECURITY DEFINER + authenticated EXECUTE
 *   - [pg] ① KOH 보유 고객 ON/OFF → koh_requested 동기화(旣 동작, 시나리오2)
 *   - [pg] ② KOH 이력없는 고객 ON → KOH 검사요청 행 신규 INSERT(koh_requested=true, price=0)
 *   - [pg] ③ KOH 이력없는 고객 OFF → no-op(신규행 생성 안 함)
 *   - [pg] 미승인 컨텍스트 거부(42501)
 * 실행: node scripts/apply_20260617120000_koh_request_for_customer.mjs
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
  join(REPO, 'supabase/migrations/20260617120000_koh_request_for_customer.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260616-foot-KOH-BUTTON-ALL-CH_evidence.md');

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

const KOH_ILIKE = `(service_name ILIKE '%KOH%' OR service_name ILIKE '%진균검사%')`;

(async () => {
  await client.connect();
  out('# T-20260616-foot-KOH-BUTTON-ALL-CH — DB-gate evidence (prod apply)');
  out(`# at: ${new Date().toISOString()}`);
  out('# 적용: request_koh_for_customer RPC (이력무관 전원노출 토글 단일 진입점)');
  out('');

  // ── 1. 적용 ──
  out('## 1. 마이그레이션 적용');
  await client.query(MIG_SQL);
  out('  ✓ 20260617120000_koh_request_for_customer.sql 적용 완료');
  out('');

  // ── 2. RPC probe ──
  out('## 2. RPC probe');
  const fn = (await client.query(
    `SELECT p.prosecdef AS secdef,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='request_koh_for_customer'`,
  )).rows[0];
  assert(!!fn, 'request_koh_for_customer RPC 존재');
  assert(fn && fn.secdef === true, 'SECURITY DEFINER');
  assert(fn && fn.auth_exec === true, 'authenticated EXECUTE 권한');
  out('');

  const approvedUser = (await client.query(
    `SELECT id FROM user_profiles WHERE COALESCE(approved,false)=true AND COALESCE(active,true)=true LIMIT 1`,
  )).rows[0];

  // ── 3. 시나리오2: KOH 보유 고객 ON/OFF 동기화 ──
  out('## 3. 시나리오2 — KOH 보유 고객 ON/OFF (旣 동작 보존)');
  const kohCust = (await client.query(
    `SELECT ci.customer_id
       FROM check_in_services cis JOIN check_ins ci ON ci.id = cis.check_in_id
      WHERE ci.status <> 'cancelled' AND ci.customer_id IS NOT NULL AND ${KOH_ILIKE}
      LIMIT 1`,
  )).rows[0];

  if (!approvedUser || !kohCust) {
    out(`  ⓘ 스킵: approvedUser=${!!approvedUser} kohCustomer=${!!kohCust}`);
  } else {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: approvedUser.id, role: 'authenticated' })]);

      const on = (await client.query(
        `SELECT request_koh_for_customer($1, true) AS r`, [kohCust.customer_id],
      )).rows[0].r;
      assert(on === true, `KOH보유 ON → true (got ${on})`);
      const cntOn = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1 AND ${KOH_ILIKE} AND cis.koh_requested=true`, [kohCust.customer_id],
      )).rows[0].c;
      assert(cntOn > 0, `ON 후 koh_requested=true KOH행 존재 (got ${cntOn})`);

      const off = (await client.query(
        `SELECT request_koh_for_customer($1, false) AS r`, [kohCust.customer_id],
      )).rows[0].r;
      assert(off === false, `KOH보유 OFF → false (got ${off})`);
    } finally { await client.query('ROLLBACK'); }
  }
  out('');

  // ── 4. 시나리오1: KOH 이력없는 고객 ON → 신규 생성 / OFF → no-op ──
  out('## 4. 시나리오1 — KOH 이력없는 고객 ON 신규생성 / OFF no-op');
  const noKohCust = (await client.query(
    `SELECT ci.customer_id
       FROM check_ins ci
      WHERE ci.status <> 'cancelled' AND ci.customer_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM check_in_services cis2 JOIN check_ins ci2 ON ci2.id=cis2.check_in_id
           WHERE ci2.customer_id = ci.customer_id AND ci2.status <> 'cancelled'
             AND (cis2.service_name ILIKE '%KOH%' OR cis2.service_name ILIKE '%진균검사%')
        )
      LIMIT 1`,
  )).rows[0];

  if (!approvedUser || !noKohCust) {
    out(`  ⓘ 스킵: approvedUser=${!!approvedUser} noKohCustomer=${!!noKohCust}`);
  } else {
    // 4a. OFF 먼저 → no-op(신규행 생성 안 함)
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: approvedUser.id, role: 'authenticated' })]);
      const before = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1 AND ${KOH_ILIKE}`, [noKohCust.customer_id],
      )).rows[0].c;
      const off = (await client.query(
        `SELECT request_koh_for_customer($1, false) AS r`, [noKohCust.customer_id],
      )).rows[0].r;
      assert(off === false, `이력없음 OFF → false (got ${off})`);
      const afterOff = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1 AND ${KOH_ILIKE}`, [noKohCust.customer_id],
      )).rows[0].c;
      assert(before === 0 && afterOff === 0, `OFF no-op: KOH행 0 유지 (before ${before} after ${afterOff})`);
    } finally { await client.query('ROLLBACK'); }

    // 4b. ON → KOH 검사요청 신규 INSERT(koh_requested=true, price=0)
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: approvedUser.id, role: 'authenticated' })]);
      const on = (await client.query(
        `SELECT request_koh_for_customer($1, true) AS r`, [noKohCust.customer_id],
      )).rows[0].r;
      assert(on === true, `이력없음 ON → true (got ${on})`);
      const row = (await client.query(
        `SELECT cis.koh_requested, cis.price, cis.is_package_session, cis.service_name
           FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1 AND ${KOH_ILIKE}
          ORDER BY cis.created_at DESC LIMIT 1`, [noKohCust.customer_id],
      )).rows[0];
      assert(!!row, 'ON 후 KOH 검사요청 행 신규 생성');
      assert(row && row.koh_requested === true, `신규행 koh_requested=true (got ${row?.koh_requested})`);
      assert(row && row.price === 0, `신규행 price=0 (매출 비귀속) (got ${row?.price})`);
      assert(row && row.is_package_session === false, `신규행 is_package_session=false (got ${row?.is_package_session})`);

      // 멱등성: 다시 ON → 중복 생성 안 함(보유 분기로 진입)
      await client.query(`SELECT request_koh_for_customer($1, true)`, [noKohCust.customer_id]);
      const cnt = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1 AND ${KOH_ILIKE}`, [noKohCust.customer_id],
      )).rows[0].c;
      assert(cnt === 1, `재ON 멱등 — KOH행 1개 유지(중복생성 없음) (got ${cnt})`);
    } finally { await client.query('ROLLBACK'); }
  }
  out('');

  // ── 5. 미승인 컨텍스트 거부 ──
  out('## 5. 권한 게이트');
  if (kohCust || noKohCust) {
    const anyCust = (kohCust || noKohCust).customer_id;
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: '00000000-0000-0000-0000-000000000000', role: 'authenticated' })]);
      let denied = false;
      try {
        await client.query(`SELECT request_koh_for_customer($1, true)`, [anyCust]);
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

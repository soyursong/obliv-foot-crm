/**
 * T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION — TX-ROLLBACK probe
 *
 * data-architect CONSULT GO(MSG-20260623-170457-nf9z) 후 supervisor DDL-diff 게이트 직전 검증.
 * 본 probe 는 DDL(RPC 생성)까지 단일 트랜잭션 안에서 적용→검증→ROLLBACK 한다.
 *   → prod 에 어떤 영구 변경도 남기지 않음(RPC 도 미잔존). 마이그 SQL 의 유효성·동작만 확인.
 * 영구 prod 적용은 supervisor DDL-diff GO 후 scripts/apply_20260623160000_blood_request_for_customer.mjs 로.
 *
 * 검증:
 *   - [pg] 마이그 SQL TX 내 적용 성공(검증 DO 블록 포함)
 *   - [pg] RPC 정의 존재 + SECURITY DEFINER + authenticated EXECUTE
 *   - [pg] ① 서비스 보유 고객 ON/OFF → blood_test_requested 동기화
 *   - [pg] ② 서비스 없는 고객 ON → 신규 INSERT(blood_test_requested=true, price=0, is_package_session=false)
 *   - [pg] ③ 서비스 없는 고객 OFF → no-op
 *   - [pg] 멱등성(재ON 중복생성 없음)
 *   - [pg] 미승인 컨텍스트 거부(42501)
 * 실행: node scripts/probe_20260623160000_blood_request_txrollback.mjs
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

// 마이그 SQL 에서 외곽 BEGIN;/COMMIT; 를 제거 → 우리가 감싼 단일 TX 안에서 실행.
const RAW = readFileSync(
  join(REPO, 'supabase/migrations/20260623160000_blood_request_for_customer.sql'),
  'utf8',
);
const MIG_BODY = RAW
  .replace(/^\s*BEGIN;\s*$/m, '-- (outer BEGIN stripped for tx-rollback probe)')
  .replace(/^\s*COMMIT;\s*$/m, '-- (outer COMMIT stripped for tx-rollback probe)');

const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION_probe.md');

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

const setJwt = (id) =>
  client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: id, role: 'authenticated' })]);

(async () => {
  await client.connect();
  out('# T-20260623-foot-PKGTAB-BLOODTEST-NOSVCROW-DECISION — TX-ROLLBACK probe');
  out(`# at: ${new Date().toISOString()}`);
  out('# 단일 TX 내 DDL 적용→검증→ROLLBACK (prod 영구 변경 없음)');
  out('');

  await client.query('BEGIN');
  try {
    // ── 1. 마이그 본문(외곽 BEGIN/COMMIT 제거) TX 내 적용 ──
    out('## 1. 마이그 SQL TX 내 적용');
    await client.query(MIG_BODY);
    out('  ✓ RPC 생성 + 검증 DO 블록 통과(TX 내)');
    out('');

    // ── 2. RPC probe ──
    out('## 2. RPC 정의');
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

    // ── 3. 시나리오A: 서비스 보유 고객 ON/OFF ──
    out('## 3. 시나리오A — 서비스 보유 고객 ON/OFF');
    const svcCust = (await client.query(
      `SELECT ci.customer_id
         FROM check_in_services cis JOIN check_ins ci ON ci.id = cis.check_in_id
        WHERE ci.status <> 'cancelled' AND ci.customer_id IS NOT NULL
        LIMIT 1`,
    )).rows[0];
    if (!approvedUser || !svcCust) {
      out(`  ⓘ 스킵: approvedUser=${!!approvedUser} svcCustomer=${!!svcCust}`);
    } else {
      await client.query('SAVEPOINT sa');
      await setJwt(approvedUser.id);
      const on = (await client.query(
        `SELECT request_blood_test_for_customer($1, true) AS r`, [svcCust.customer_id])).rows[0].r;
      assert(on === true, `서비스보유 ON → true (got ${on})`);
      const cntOn = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1 AND cis.blood_test_requested=true`, [svcCust.customer_id])).rows[0].c;
      assert(cntOn > 0, `ON 후 blood_test_requested=true 행 존재 (got ${cntOn})`);
      const off = (await client.query(
        `SELECT request_blood_test_for_customer($1, false) AS r`, [svcCust.customer_id])).rows[0].r;
      assert(off === false, `서비스보유 OFF → false (got ${off})`);
      await client.query('ROLLBACK TO SAVEPOINT sa');
    }
    out('');

    // ── 4. 시나리오B: 서비스 행 없는 고객 ON 신규생성 / OFF no-op ──
    out('## 4. 시나리오B — 서비스 행 없는 고객');
    const noSvcCust = (await client.query(
      `SELECT ci.customer_id
         FROM check_ins ci
        WHERE ci.status <> 'cancelled' AND ci.customer_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM check_in_services cis2 JOIN check_ins ci2 ON ci2.id=cis2.check_in_id
             WHERE ci2.customer_id = ci.customer_id AND ci2.status <> 'cancelled')
        LIMIT 1`,
    )).rows[0];
    if (!approvedUser || !noSvcCust) {
      out(`  ⓘ 스킵(정상 — 2번차트 환자는 통상 서비스 보유): approvedUser=${!!approvedUser} noSvcCustomer=${!!noSvcCust}`);
    } else {
      // 4a. OFF no-op
      await client.query('SAVEPOINT sb1');
      await setJwt(approvedUser.id);
      const off = (await client.query(
        `SELECT request_blood_test_for_customer($1, false) AS r`, [noSvcCust.customer_id])).rows[0].r;
      assert(off === false, `서비스없음 OFF → false (got ${off})`);
      const afterOff = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1`, [noSvcCust.customer_id])).rows[0].c;
      assert(afterOff === 0, `OFF no-op: 서비스행 0 유지 (got ${afterOff})`);
      await client.query('ROLLBACK TO SAVEPOINT sb1');

      // 4b. ON → 신규 INSERT + 멱등
      await client.query('SAVEPOINT sb2');
      await setJwt(approvedUser.id);
      const on = (await client.query(
        `SELECT request_blood_test_for_customer($1, true) AS r`, [noSvcCust.customer_id])).rows[0].r;
      assert(on === true, `서비스없음 ON → true (got ${on})`);
      const row = (await client.query(
        `SELECT cis.blood_test_requested, cis.price, cis.is_package_session, cis.service_name, cis.service_id
           FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1 ORDER BY cis.created_at DESC LIMIT 1`, [noSvcCust.customer_id])).rows[0];
      assert(!!row, 'ON 후 피검사 요청 행 신규 생성');
      assert(row && row.blood_test_requested === true, `신규행 blood_test_requested=true (got ${row?.blood_test_requested})`);
      assert(row && Number(row.price) === 0, `신규행 price=0 (매출 비귀속) (got ${row?.price})`);
      assert(row && row.is_package_session === false, `신규행 is_package_session=false (got ${row?.is_package_session})`);
      assert(row && row.service_id === null, `신규행 service_id=NULL (카탈로그 비귀속) (got ${row?.service_id})`);
      await client.query(`SELECT request_blood_test_for_customer($1, true)`, [noSvcCust.customer_id]);
      const cnt = (await client.query(
        `SELECT count(*)::int AS c FROM check_in_services cis JOIN check_ins ci ON ci.id=cis.check_in_id
          WHERE ci.customer_id=$1`, [noSvcCust.customer_id])).rows[0].c;
      assert(cnt === 1, `재ON 멱등 — 서비스행 1개 유지(중복생성 없음) (got ${cnt})`);
      await client.query('ROLLBACK TO SAVEPOINT sb2');
    }
    out('');

    // ── 5. 권한 게이트 ──
    out('## 5. 권한 게이트 — 미승인 거부');
    const anyCust = (svcCust || noSvcCust);
    if (anyCust) {
      await client.query('SAVEPOINT sc');
      await setJwt('00000000-0000-0000-0000-000000000000');
      let denied = false;
      try {
        await client.query(`SELECT request_blood_test_for_customer($1, true)`, [anyCust.customer_id]);
      } catch (e) { denied = e.code === '42501'; }
      assert(denied, '미승인 사용자 거부 (42501)');
      await client.query('ROLLBACK TO SAVEPOINT sc');
    } else {
      out('  ⓘ 스킵: 테스트 고객 없음');
    }
    out('');
  } finally {
    await client.query('ROLLBACK'); // DDL 포함 전체 롤백 → prod 영구 변경 없음
    out('## TX ROLLBACK 완료 — prod 영구 변경 없음(RPC 미잔존)');
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
  try { await client.query('ROLLBACK'); } catch {}
  try { await client.end(); } catch {}
  process.exit(1);
});

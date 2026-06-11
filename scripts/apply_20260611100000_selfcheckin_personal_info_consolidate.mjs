/**
 * T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED — DB-gate apply + dual probe
 *
 * supervisor FIX-REQUEST (MSG-20260611-104014-tfn2, qa_fail_phase1 db_migration_pending).
 * 요구:
 *   1) 20260611100000_selfcheckin_personal_info_consolidate.sql 운영 DB 적용 (rollback 동반)
 *   2) prod probe 증빙: fn_selfcheckin_update_personal_info 10-arg 호출이 PGRST202 아닌
 *      정상 응답(check_in_not_found 또는 success)임을 로그로 제출
 *
 * 이중 probe:
 *   - [pg]   information_schema / pg_proc 로 10-arg 시그니처·구 시그니처 DROP·컬럼 추가 검증
 *   - [REST] PostgREST 경유 RPC 10-arg(named args, p_postal_code 포함) 실제 호출 →
 *            PGRST202 아님을 증명 (FE 실제 호출 경로 재현, anon key)
 *
 * additive(+RPC replace). 기존 데이터 무손실(백필 금지). rollback:
 *   supabase/migrations/20260611100000_selfcheckin_personal_info_consolidate.rollback.sql
 * 실행: node scripts/apply_20260611100000_selfcheckin_personal_info_consolidate.mjs
 */
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

// .env 파싱 (DB password + REST URL/anon key)
const ENV = {};
for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) ENV[m[1]] = m[2].trim();
}

const MIG_SQL = readFileSync(
  join(REPO, 'supabase/migrations/20260611100000_selfcheckin_personal_info_consolidate.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED_evidence.md');

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

// fn_selfcheckin_update_personal_info 의 모든 오버로드 시그니처(arg 타입 배열) 조회
async function fnSignatures() {
  const { rows } = await client.query(
    `SELECT pg_get_function_identity_arguments(p.oid) AS args,
            pg_get_function_arguments(p.oid)          AS full_args
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='fn_selfcheckin_update_personal_info'
      ORDER BY p.pronargs`,
  );
  return rows;
}

async function customerCols() {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='customers'
        AND column_name = ANY($1::text[])`,
    [['privacy_consent_at', 'sms_opt_in_at']],
  );
  return new Set(rows.map((r) => r.column_name));
}

// PostgREST 경유 10-arg RPC 호출 (FE 실제 경로 재현). 랜덤 UUID → check_in_not_found 기대.
async function restRpcProbe() {
  const url = `${ENV.VITE_SUPABASE_URL}/rest/v1/rpc/fn_selfcheckin_update_personal_info`;
  const body = {
    p_check_in_id: randomUUID(),
    p_clinic_id: randomUUID(),
    p_birth_date: '1990-01-01',
    p_address: '서울시 종로구 (probe)',
    p_address_detail: '101호',
    p_postal_code: '03000',
    p_privacy_consent: true,
    p_insurance_consent: true,
    p_visit_route: '워크인',
    p_visit_route_detail: '검색(probe)',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ENV.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ENV.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

(async () => {
  await client.connect();
  out('# T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED — DB-gate evidence');
  out('');
  out(`- prod: rxlomoozakkjesdqjtvd`);
  out(`- 실행: ${new Date().toISOString()}`);
  out(`- 출처: supervisor FIX-REQUEST MSG-20260611-104014-tfn2 (phase1 db_migration_pending)`);
  out(`- 마이그: supabase/migrations/20260611100000_selfcheckin_personal_info_consolidate.sql (commit 7b04bef)`);
  out('');

  out('## [1] 사전 probe (적용 전)');
  const sigBefore = await fnSignatures();
  const colBefore = await customerCols();
  out('```');
  out('fn_selfcheckin_update_personal_info 시그니처:');
  for (const s of sigBefore) out(`  (${s.args.split(',').length} args) ${s.args}`);
  if (sigBefore.length === 0) out('  (none)');
  out(`customers.privacy_consent_at : ${colBefore.has('privacy_consent_at')}`);
  out(`customers.sms_opt_in_at      : ${colBefore.has('sms_opt_in_at')}`);
  out('```');
  // 적용 전 REST 10-arg 호출 → PGRST202(부재) 재현 시도
  out('적용 전 REST 10-arg 호출:');
  const restBefore = await restRpcProbe();
  out('```');
  out(`HTTP ${restBefore.status} → ${JSON.stringify(restBefore.body)}`);
  out('```');
  out('');

  out('## [2] 마이그레이션 적용 (BEGIN/COMMIT 내장, DROP 구시그니처 → 10-arg 재생성)');
  await client.query(MIG_SQL);
  out('✅ 적용 완료 (에러 없음)');
  // PostgREST 스키마 캐시 리로드 (DDL event trigger 보강)
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out('NOTIFY pgrst reload schema 전송');
  out('');

  out('## [3] 사후 probe — pg 스키마 검증');
  const sigAfter = await fnSignatures();
  const colAfter = await customerCols();
  const tenArg = sigAfter.find((s) => s.args.split(',').length === 10);
  const checks = [
    ['10-arg canonical 시그니처 존재', !!tenArg],
    ['구 시그니처 1종만(오버로드 모호성 제거)', sigAfter.length === 1],
    ['customers.privacy_consent_at 컬럼', colAfter.has('privacy_consent_at')],
    ['customers.sms_opt_in_at 컬럼', colAfter.has('sms_opt_in_at')],
  ];
  out('```');
  out('잔존 시그니처:');
  for (const s of sigAfter) out(`  (${s.args.split(',').length} args) ${s.full_args}`);
  out('');
  for (const [k, v] of checks) out(`${v ? 'PASS' : 'FAIL'}  ${k}`);
  out('```');
  out('');

  out('## [4] 사후 probe — PostgREST 10-arg RPC 호출 (supervisor 핵심 요구)');
  // 캐시 반영 대기 (최대 ~10s)
  let restAfter;
  for (let i = 0; i < 10; i++) {
    restAfter = await restRpcProbe();
    const isPgrst202 = restAfter.status === 404
      && typeof restAfter.body === 'object' && restAfter.body?.code === 'PGRST202';
    if (!isPgrst202) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  out('```');
  out(`HTTP ${restAfter.status} → ${JSON.stringify(restAfter.body)}`);
  out('```');
  const isPgrst202After = restAfter.status === 404
    && typeof restAfter.body === 'object' && restAfter.body?.code === 'PGRST202';
  const restOk = !isPgrst202After
    && (restAfter.body?.error === 'check_in_not_found' || restAfter.body?.success === true
        || restAfter.body?.success === false);
  out(`판정: ${restOk ? 'PASS ✅ (PGRST202 아님 — 10-arg 해석 정상)' : 'FAIL ❌'}`);
  out('');

  const allPass = checks.every(([, v]) => v) && restOk;
  out(`## [결과] db_gate_status = ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);
  out('');
  out('- RPC replace + additive 컬럼. 기존 데이터 무손실. 백필 없음(NULL 유지).');
  out('- rollback: supabase/migrations/20260611100000_selfcheckin_personal_info_consolidate.rollback.sql');

  await client.end();

  mkdirSync(EVID_DIR, { recursive: true });
  writeFileSync(EVID_FILE, log.join('\n') + '\n', 'utf8');
  console.log(`\n📄 evidence → ${EVID_FILE}`);
  process.exit(allPass ? 0 : 2);
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});

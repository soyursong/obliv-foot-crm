/**
 * T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED — merge-path 보강 DB-gate apply + probe
 *
 * supervisor FIX-REQUEST (MSG-20260611-115231-j2zr, qa_fail_phase1 db_migration_pending).
 * ordered pair 2/2 — consolidate(20260611100000) 적용 후 본 마이그 적용.
 * 요구 증빙:
 *   fn_selfcheckin_rrn_match 정의(pg_get_functiondef)에 privacy_consent/sms_opt_in(+_at)
 *   이관 라인이 존재함을 검증.
 *
 * probe:
 *   - [pg] pg_get_functiondef 로 ⑤병합 UPDATE set-list 에 4개 동의 컬럼 이관 라인 grep
 *   - [pg] 동의 audit 컬럼(privacy_consent_at/sms_opt_in_at) 존재 재확인
 *
 * RPC replace only (set-list 확장). 신규 컬럼 없음. 백필 없음. rollback:
 *   supabase/migrations/20260611140000_selfcheckin_rrn_match_consent_sync.rollback.sql
 * 실행: node scripts/apply_20260611140000_selfcheckin_rrn_match_consent_sync.mjs
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
  join(REPO, 'supabase/migrations/20260611140000_selfcheckin_rrn_match_consent_sync.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED_mergepath_evidence.md');

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

async function fnDef() {
  const { rows } = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='fn_selfcheckin_rrn_match'
      ORDER BY p.pronargs`,
  );
  return rows.map((r) => r.def);
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

(async () => {
  await client.connect();
  out('# T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED — merge-path DB-gate evidence (2/2)');
  out('');
  out(`- prod: rxlomoozakkjesdqjtvd`);
  out(`- 실행: ${new Date().toISOString()}`);
  out(`- 출처: supervisor FIX-REQUEST MSG-20260611-115231-j2zr (phase1 db_migration_pending, ordered pair 2/2)`);
  out(`- 마이그: supabase/migrations/20260611140000_selfcheckin_rrn_match_consent_sync.sql`);
  out(`- 선행: 20260611100000_selfcheckin_personal_info_consolidate.sql (PASS, 동일 세션)`);
  out('');

  out('## [1] 사전 probe (적용 전) — fn_selfcheckin_rrn_match 정의');
  const defBefore = await fnDef();
  const beforeHasPrivacy = defBefore.some((d) => /privacy_consent\s*=/.test(d));
  const beforeHasSms = defBefore.some((d) => /sms_opt_in\s*=/.test(d));
  out('```');
  out(`함수 정의 개수: ${defBefore.length}`);
  out(`적용 전 privacy_consent 이관 라인: ${beforeHasPrivacy}`);
  out(`적용 전 sms_opt_in 이관 라인     : ${beforeHasSms}`);
  out('```');
  out('');

  out('## [2] 마이그레이션 적용 (BEGIN/COMMIT 내장, CREATE OR REPLACE)');
  await client.query(MIG_SQL);
  out('✅ 적용 완료 (에러 없음)');
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out('NOTIFY pgrst reload schema 전송');
  out('');

  out('## [3] 사후 probe — fn_selfcheckin_rrn_match 정의 내 동의 이관 라인 검증');
  const defAfter = await fnDef();
  const def = defAfter.join('\n');
  // set-list 이관 라인 존재 확인 (병합 UPDATE 내)
  const checks = [
    ['privacy_consent 이관 라인',     /privacy_consent\s*=\s*CASE WHEN src\.privacy_consent\s*=\s*true/.test(def)],
    ['privacy_consent_at 이관 라인',  /privacy_consent_at\s*=\s*CASE WHEN src\.privacy_consent\s*=\s*true/.test(def)],
    ['sms_opt_in 이관 라인',          /sms_opt_in\s*=\s*CASE WHEN src\.sms_opt_in\s*=\s*true/.test(def)],
    ['sms_opt_in_at 이관 라인',       /sms_opt_in_at\s*=\s*CASE WHEN src\.sms_opt_in\s*=\s*true/.test(def)],
    ['customers.privacy_consent_at 컬럼', (await customerCols()).has('privacy_consent_at')],
    ['customers.sms_opt_in_at 컬럼',      (await customerCols()).has('sms_opt_in_at')],
  ];
  out('```');
  out('정의 내 set-list 발췌 (동의 이관):');
  for (const line of def.split('\n')) {
    if (/privacy_consent|sms_opt_in|hira_consent/.test(line)) out('  ' + line.trim());
  }
  out('');
  for (const [k, v] of checks) out(`${v ? 'PASS' : 'FAIL'}  ${k}`);
  out('```');
  out('');

  const allPass = checks.every(([, v]) => v);
  out(`## [결과] db_gate_status = ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);
  out('');
  out('- RPC replace only (set-list 확장). 신규 컬럼 없음(데이터계약 비변경). 백필 없음.');
  out('- rollback: supabase/migrations/20260611140000_selfcheckin_rrn_match_consent_sync.rollback.sql');

  await client.end();

  mkdirSync(EVID_DIR, { recursive: true });
  writeFileSync(EVID_FILE, log.join('\n') + '\n', 'utf8');
  console.log(`\n📄 evidence → ${EVID_FILE}`);
  process.exit(allPass ? 0 : 2);
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});

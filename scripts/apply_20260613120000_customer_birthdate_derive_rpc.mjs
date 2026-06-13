/**
 * T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN — fn_customer_birthdates RPC 적용 + probe
 *
 * 적용 대상: supabase/migrations/20260613120000_customer_birthdate_derive_rpc.sql
 * 신규 컬럼/테이블/enum 없음 (read-only RPC). 백필 없음.
 * rollback: 20260613120000_customer_birthdate_derive_rpc.rollback.sql
 *
 * probe:
 *   - [pg] fn_customer_birthdates 함수 정의 존재 + SECURITY DEFINER 확인
 *   - [pg] EXECUTE 권한이 authenticated 에 부여됐는지 확인
 *   - [pg] 더미 입력으로 호출 → 에러 없이 0행 반환 (PHI: birth_date_display 컬럼만)
 *   - [pg] 정의 본문에 rrn 평문/뒷자리 반환 라인이 없음(birth_date_display만 SELECT) 확인
 * 실행: node scripts/apply_20260613120000_customer_birthdate_derive_rpc.mjs
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
  join(REPO, 'supabase/migrations/20260613120000_customer_birthdate_derive_rpc.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN_evidence.md');

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
    `SELECT pg_get_functiondef(p.oid) AS def, p.prosecdef AS secdef
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='fn_customer_birthdates'`,
  );
  return rows;
}

(async () => {
  await client.connect();
  out('# T-20260613-foot-CUSTLIST-BIRTHDATE-FROM-RRN — DB-gate evidence');
  out('');
  out(`- prod: rxlomoozakkjesdqjtvd`);
  out(`- 실행: ${new Date().toISOString()}`);
  out(`- 마이그: supabase/migrations/20260613120000_customer_birthdate_derive_rpc.sql`);
  out('');

  out('## [1] 마이그레이션 적용 (BEGIN/COMMIT 내장, CREATE OR REPLACE)');
  await client.query(MIG_SQL);
  out('✅ 적용 완료 (에러 없음)');
  await client.query(`NOTIFY pgrst, 'reload schema';`).catch(() => {});
  out('NOTIFY pgrst reload schema 전송');
  out('');

  out('## [2] 함수 정의 probe');
  const defs = await fnDef();
  const def = defs.map((d) => d.def).join('\n');
  const secdef = defs.some((d) => d.secdef === true);
  // PHI: 반환 select 가 birth_date_display 만 노출(평문 rrn 컬럼 반환 라인 없음)
  const returnsRrnPlain = /RETURN NEXT[\s\S]*v_rrn|birth_date_display\s*:=\s*v_rrn/.test(def);
  out('```');
  out(`함수 존재: ${defs.length > 0}`);
  out(`SECURITY DEFINER: ${secdef}`);
  out(`반환에 rrn 평문 누출 라인: ${returnsRrnPlain}`);
  out('```');
  out('');

  out('## [3] 권한 probe — authenticated EXECUTE');
  const { rows: grants } = await client.query(
    `SELECT grantee, privilege_type
       FROM information_schema.routine_privileges
      WHERE routine_schema='public' AND routine_name='fn_customer_birthdates'`,
  );
  const authHasExec = grants.some((g) => g.grantee === 'authenticated' && g.privilege_type === 'EXECUTE');
  const publicHasExec = grants.some((g) => g.grantee === 'PUBLIC' && g.privilege_type === 'EXECUTE');
  const anonHasExec = grants.some((g) => g.grantee === 'anon' && g.privilege_type === 'EXECUTE');
  out('```');
  for (const g of grants) out(`  ${g.grantee}: ${g.privilege_type}`);
  out(`authenticated EXECUTE: ${authHasExec}`);
  out(`PUBLIC EXECUTE (없어야 함): ${publicHasExec}`);
  out(`anon EXECUTE (PHI: 없어야 함): ${anonHasExec}`);
  out('```');
  out('');

  out('## [4] 호출 probe — 더미 입력(존재하지 않는 clinic/ids) → 0행, birth_date_display 컬럼만');
  const { fields, rows: callRows } = await client.query(
    `SELECT * FROM public.fn_customer_birthdates(
        '00000000-0000-0000-0000-000000000000'::uuid,
        ARRAY['00000000-0000-0000-0000-000000000001']::uuid[])`,
  );
  const cols = fields.map((f) => f.name).sort().join(',');
  const colsOk = cols === 'birth_date_display,customer_id';
  out('```');
  out(`반환 컬럼: ${cols}`);
  out(`반환 행수: ${callRows.length} (더미 → 0 기대)`);
  out(`컬럼 = customer_id,birth_date_display 만: ${colsOk}`);
  out('```');
  out('');

  const checks = [
    ['함수 존재', defs.length > 0],
    ['SECURITY DEFINER', secdef],
    ['rrn 평문 누출 라인 없음', !returnsRrnPlain],
    ['authenticated EXECUTE 부여', authHasExec],
    ['PUBLIC EXECUTE 미부여', !publicHasExec],
    ['anon EXECUTE 미부여 (PHI)', !anonHasExec],
    ['반환 컬럼 = customer_id,birth_date_display', colsOk],
  ];
  const allPass = checks.every(([, v]) => v);
  out('## [결과]');
  for (const [k, v] of checks) out(`${v ? 'PASS' : 'FAIL'}  ${k}`);
  out(`db_gate_status = ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);
  out('');
  out('- read-only RPC. 신규 컬럼/테이블/enum 없음(데이터계약 비변경). 백필 없음.');
  out('- PHI: birth_date(YYYY-MM-DD)만 반환. rrn 평문/뒷자리/성별코드 미노출.');
  out('- rollback: supabase/migrations/20260613120000_customer_birthdate_derive_rpc.rollback.sql');

  await client.end();

  mkdirSync(EVID_DIR, { recursive: true });
  writeFileSync(EVID_FILE, log.join('\n') + '\n', 'utf8');
  console.log(`\n📄 evidence → ${EVID_FILE}`);
  process.exit(allPass ? 0 : 2);
})().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});

/**
 * T-20260612-foot-KOH-REPORT-PHASE15 (A-1) — koh_nail_sites 컬럼 + set_koh_nail_sites RPC prod 적용
 *
 * 적용 대상: supabase/migrations/20260612160000_koh_nail_sites.sql
 *   - check_in_services.koh_nail_sites jsonb NOT NULL DEFAULT '[]'  (ADD COLUMN IF NOT EXISTS → 멱등)
 *   - RPC set_koh_nail_sites(uuid, jsonb)  (CREATE OR REPLACE → 멱등)
 * rollback: 20260612160000_koh_nail_sites.rollback.sql
 *
 * 사유: prod 에서 "set_koh_nail_sites 함수 없음" 토스트 — UI(886edf9)는 배포됐으나 DB게이트 미적용.
 *
 * probe / save-test:
 *   - [pg] koh_nail_sites 컬럼 존재 + NOT NULL + default '[]'
 *   - [pg] set_koh_nail_sites RPC 정의 존재 + SECURITY DEFINER + authenticated EXECUTE
 *   - [pg] 저장 테스트(TX 내 ROLLBACK, prod 데이터 무변경):
 *       · 승인 사용자 컨텍스트로 multi-select 저장 → 구조만 정규화 저장 확인
 *       · closed-enum 위반 입력 거부 확인
 *       · 미승인 컨텍스트 거부(42501) 확인
 * 실행: node scripts/apply_20260612160000_koh_nail_sites.mjs
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
  join(REPO, 'supabase/migrations/20260612160000_koh_nail_sites.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260612-foot-KOH-REPORT-PHASE15_evidence.md');

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
  out('# T-20260612-foot-KOH-REPORT-PHASE15 — DB-gate evidence (prod apply)');
  out(`# at: ${new Date().toISOString()}`);
  out('');

  // ── 1. 적용 ──
  out('## 1. 마이그레이션 적용');
  await client.query(MIG_SQL);
  out('  ✓ 20260612160000_koh_nail_sites.sql 적용 완료');
  out('');

  // ── 2. 컬럼 probe ──
  out('## 2. 컬럼 probe');
  const col = (await client.query(
    `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='check_in_services' AND column_name='koh_nail_sites'`,
  )).rows[0];
  assert(!!col, 'koh_nail_sites 컬럼 존재');
  assert(col && col.data_type === 'jsonb', `타입 jsonb (got ${col?.data_type})`);
  assert(col && col.is_nullable === 'NO', 'NOT NULL');
  assert(col && /\[\]/.test(col.column_default || ''), `default '[]' (got ${col?.column_default})`);
  out('');

  // ── 3. RPC probe ──
  out('## 3. RPC probe');
  const fn = (await client.query(
    `SELECT p.prosecdef AS secdef,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='set_koh_nail_sites'`,
  )).rows[0];
  assert(!!fn, 'set_koh_nail_sites RPC 존재');
  assert(fn && fn.secdef === true, 'SECURITY DEFINER');
  assert(fn && fn.auth_exec === true, 'authenticated EXECUTE 권한');
  out('');

  // ── 4. 저장 테스트 (TX 내 ROLLBACK — prod 데이터 무변경) ──
  out('## 4. 저장 테스트 (multi-select, TX rollback / prod 무변경)');
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

      // jsonb 키 순서 무관 비교 (side+toe 의미 동치 + 잡필드 0)
      const eqSites = (arr, exp) =>
        Array.isArray(arr) && arr.length === exp.length &&
        arr.every((e, i) =>
          Object.keys(e).sort().join() === 'side,toe' &&
          e.side === exp[i].side && Number(e.toe) === exp[i].toe);

      // 4a. 정상 저장 (UI 단일선택 형태 1원소)
      const saved = (await client.query(
        `SELECT set_koh_nail_sites($1, $2::jsonb) AS r`,
        [svc.id, JSON.stringify([{ side: 'Rt', toe: 2 }])],
      )).rows[0].r;
      assert(
        eqSites(saved, [{ side: 'Rt', toe: 2 }]),
        `정상 저장 → 구조만 정규화 (got ${JSON.stringify(saved)})`,
      );

      // 4b. 잡필드 제거 확인 (구조만 저장 강제)
      const stripped = (await client.query(
        `SELECT set_koh_nail_sites($1, $2::jsonb) AS r`,
        [svc.id, JSON.stringify([{ side: 'Lt', toe: 4, label: 'Lt 4지 조갑' }])],
      )).rows[0].r;
      assert(
        eqSites(stripped, [{ side: 'Lt', toe: 4 }]),
        `표시문자열/잡필드 제거 (got ${JSON.stringify(stripped)})`,
      );

      // 4c. 빈 배열(선택 해제) 허용
      const cleared = (await client.query(
        `SELECT set_koh_nail_sites($1, '[]'::jsonb) AS r`, [svc.id],
      )).rows[0].r;
      assert(JSON.stringify(cleared) === '[]', '빈 배열(선택 해제) 허용');

      // 4d. closed-enum 위반 거부
      let rejected = false;
      try {
        await client.query(`SELECT set_koh_nail_sites($1, $2::jsonb)`,
          [svc.id, JSON.stringify([{ side: 'XX', toe: 9 }])]);
      } catch { rejected = true; }
      assert(rejected, 'closed-enum 위반 입력 거부');
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
        await client.query(`SELECT set_koh_nail_sites($1, '[]'::jsonb)`, [svc.id]);
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

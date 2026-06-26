/**
 * T-20260625-foot-PASSPORT-PORT — 여권/외국인 정보 derm 이식 (nationalities FK + customers 5필드)
 *
 * 적용 대상: supabase/migrations/20260625130000_passport_port_nationalities_foreign_fields.sql
 * rollback:  supabase/migrations/20260625130000_passport_port_nationalities_foreign_fields.rollback.sql
 *
 * supervisor DDL-DIFF-GO: MSG-20260626-105431-di96
 *   - ADDITIVE only · IF NOT EXISTS · nullable · seed 23행 ON CONFLICT(name) DO NOTHING
 *   - nationality_id BIGINT FK → nationalities.id (정정1)
 *   - default_language 컬럼 없음 (정정2)
 *
 * 절차: precheck → dry-run(TX ROLLBACK 검증) → 실제 apply(TX COMMIT) → postcheck
 * 실행: node scripts/apply_20260625130000_passport_port_nationalities_foreign_fields.mjs
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
  join(REPO, 'supabase/migrations/20260625130000_passport_port_nationalities_foreign_fields.sql'),
  'utf8',
);
const EVID_DIR = join(REPO, 'db-gate');
const EVID_FILE = join(EVID_DIR, 'T-20260625-foot-PASSPORT-PORT_apply_evidence.md');

const newClient = () => new pg.Client({
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

const NEW_COLS = ['passport_first_name', 'passport_last_name', 'nationality_id', 'foreigner_registration_number', 'foreign_doc_expiry'];

async function snapshot(c) {
  const tbl = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='nationalities'`);
  const cols = await c.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='customers' AND column_name = ANY($1::text[])`,
    [NEW_COLS],
  );
  let natCount = null;
  if (tbl.rowCount) {
    natCount = (await c.query(`SELECT COUNT(*)::int n FROM public.nationalities`)).rows[0].n;
  }
  return {
    nationalitiesExists: !!tbl.rowCount,
    natCount,
    customerCols: cols.rows.reduce((a, r) => (a[r.column_name] = r.data_type, a), {}),
  };
}

(async () => {
  out('# T-20260625-foot-PASSPORT-PORT — DB-gate apply evidence (foot prod rxlomoozakkjesdqjtvd)');
  out(`적용시각: ${new Date().toISOString()}`);
  out(`supervisor GO: MSG-20260626-105431-di96 (DDL-DIFF-GO)`);
  out('');

  // ── PRECHECK ──────────────────────────────────────────────
  const pre = await (async () => { const c = newClient(); await c.connect(); const s = await snapshot(c); await c.end(); return s; })();
  out('## [1] PRECHECK (적용 전 상태)');
  out('```json');
  out(JSON.stringify(pre, null, 2));
  out('```');
  out('');

  // ── DRY-RUN (TX ROLLBACK) ────────────────────────────────
  out('## [2] DRY-RUN (BEGIN → 마이그 실행 → ROLLBACK, prod 데이터 무변경)');
  {
    const c = newClient();
    await c.connect();
    try {
      await c.query('BEGIN');
      // 마이그 본문은 자체 BEGIN/COMMIT 포함 → 외부 TX와 충돌. COMMIT 제거 후 실행.
      const body = MIG_SQL.replace(/^\s*BEGIN;\s*$/m, '-- BEGIN (dry-run wrap)').replace(/^\s*COMMIT;\s*$/m, '-- COMMIT (dry-run skip)');
      await c.query(body);
      const mid = await snapshot(c);
      assert(mid.nationalitiesExists, 'dry-run: nationalities 테이블 존재');
      assert(mid.natCount >= 23, `dry-run: nationalities >= 23행 (실제 ${mid.natCount})`);
      assert(mid.customerCols.nationality_id === 'bigint', `dry-run: customers.nationality_id = bigint (실제 ${mid.customerCols.nationality_id})`);
      for (const col of NEW_COLS) {
        assert(col in mid.customerCols, `dry-run: customers.${col} 존재`);
      }
      await c.query('ROLLBACK');
      out('  ↩ ROLLBACK 완료 (dry-run 데이터 폐기)');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      assert(false, `dry-run 예외: ${e.message}`);
    } finally {
      await c.end();
    }
  }
  out('');

  if (failed) {
    out('## ✗ DRY-RUN 실패 → 실제 적용 중단');
    finalize();
    process.exit(1);
  }

  // ── REAL APPLY (TX COMMIT) ───────────────────────────────
  out('## [3] REAL APPLY (마이그 자체 BEGIN/COMMIT)');
  {
    const c = newClient();
    await c.connect();
    try {
      await c.query(MIG_SQL); // 자체 BEGIN…COMMIT + 검증 DO 블록 포함
      out('  ✓ 마이그 COMMIT 완료 (검증 DO 블록 통과)');
    } catch (e) {
      assert(false, `apply 예외: ${e.message}`);
    } finally {
      await c.end();
    }
  }
  out('');

  // ── POSTCHECK ────────────────────────────────────────────
  const post = await (async () => { const c = newClient(); await c.connect(); const s = await snapshot(c); await c.end(); return s; })();
  out('## [4] POSTCHECK (적용 후 상태)');
  out('```json');
  out(JSON.stringify(post, null, 2));
  out('```');
  assert(post.nationalitiesExists, 'post: nationalities 테이블 존재');
  assert(post.natCount >= 23, `post: nationalities >= 23행 (실제 ${post.natCount})`);
  assert(post.customerCols.nationality_id === 'bigint', `post: customers.nationality_id = bigint`);
  for (const col of NEW_COLS) {
    assert(col in post.customerCols, `post: customers.${col} 존재`);
  }
  out('');

  finalize();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

function finalize() {
  out('');
  out(failed ? '## 결과: ✗ FAIL' : '## 결과: ✓ PASS (적용 완료)');
  try { mkdirSync(EVID_DIR, { recursive: true }); } catch {}
  writeFileSync(EVID_FILE, log.join('\n') + '\n');
  console.log(`\nevidence → ${EVID_FILE}`);
}

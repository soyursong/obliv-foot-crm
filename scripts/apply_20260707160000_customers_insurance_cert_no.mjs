/**
 * T-20260707-foot-CHART2-INSURANCE-CERTNO-FIELD
 *   customers 에 insurance_cert_no TEXT NULL ADDITIVE 신설 (건강보험증 번호, 일반 PII tier).
 * 게이트: ADDITIVE(신규 NULLABLE + backfill 0 + 멱등) + DA GO(MSG-20260707-160129-j591)
 *         → §3.1 대표 게이트 면제. supervisor DDL-diff PHI DB-GATE 승인분(FIX-REQUEST MSG-20260716-132308-4gwt).
 *
 * 사용:
 *   DRYRUN=1 node scripts/apply_20260707160000_customers_insurance_cert_no.mjs  # No-Persistence 검증
 *   node scripts/apply_20260707160000_customers_insurance_cert_no.mjs           # 실제 적용(COMMIT) + ledger 등재
 *   LEDGER=1 node scripts/apply_20260707160000_customers_insurance_cert_no.mjs  # 3자 원장 대사만
 * rollback: supabase/migrations/20260707160000_customers_insurance_cert_no.rollback.sql
 *
 * No-Persistence Protocol (migration_dryrun_no_persistence_protocol 단일표준):
 *   1) up.sql 내장 txn-control(BEGIN/COMMIT/ROLLBACK/END) strip
 *   2) BEGIN..ROLLBACK 로 재래핑 실행(sentinel 신뢰 금지)
 *   3) 사후 무영속 introspection(post-probe): 별 커넥션에서 컬럼 미잔존 확인 → 실증 PASS
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const MIG = '20260707160000_customers_insurance_cert_no';
const VERSION = '20260707160000';
const NAME = 'customers_insurance_cert_no';
const UP = readFileSync(join(__dir, `../supabase/migrations/${MIG}.sql`), 'utf8');

const DRYRUN = !!process.env.DRYRUN;
const LEDGER = !!process.env.LEDGER;
const TABLE = 'customers';
const COL = 'insurance_cert_no';

const PROJ_REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (() => { try {
       const env = Object.fromEntries(readFileSync(join(__dir, '../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
       if (env.SUPABASE_ACCESS_TOKEN) return env.SUPABASE_ACCESS_TOKEN;
     } catch {} throw new Error('SUPABASE_ACCESS_TOKEN required'); })();

async function q(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJ_REF}/database/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query }) });
  return { ok: resp.ok, status: resp.status, body: await resp.json() };
}

// 내장 txn-control 문 제거 — sentinel bypass 차단
function stripTxn(sql) {
  return sql.split('\n').filter(l => !/^\s*(BEGIN|COMMIT|ROLLBACK|END)\s*;/i.test(l)).join('\n');
}

async function probeCol() {
  const r = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name='${TABLE}' AND column_name='${COL}'`);
  return Array.isArray(r.body) ? r.body : [];
}
async function probeLedger() {
  const r = await q(`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='${VERSION}'`);
  return Array.isArray(r.body) ? r.body : [];
}

// ── LEDGER: 원장(schema_migrations) ↔ 파일 ↔ prod(information_schema) 3자 대사 ──
if (LEDGER) {
  console.log('🧾 [LEDGER] 3자 대사 (원장 ↔ 파일 ↔ prod)');
  const prod = await probeCol();
  const ledger = await probeLedger();
  console.log('  file 선언 컬럼:', JSON.stringify([COL]));
  console.log('  prod 실재 컬럼:', JSON.stringify(prod));
  console.log(`  원장(schema_migrations ${VERSION}):`, JSON.stringify(ledger));
  process.exit(0);
}

if (DRYRUN) {
  console.log('🧪 [DRYRUN] No-Persistence Protocol');
  const before = await probeCol();
  if (before.length > 0) {
    console.log('  (참고) 이미 존재하는 컬럼:', JSON.stringify(before), '— 멱등 ADDITIVE, dry-run 무해');
  }
  const wrapped = `BEGIN;\n${stripTxn(UP)}\nROLLBACK;`;
  const r = await q(wrapped);
  console.log('  exec:', r.status, JSON.stringify(r.body));
  if (!r.ok) { console.error('❌ dry-run 실행 실패'); process.exit(1); }
  const after = await probeCol();
  const delta = after.length - before.length;
  if (delta !== 0) {
    console.error('❌ NO-PERSISTENCE VIOLATION: dry-run 후 컬럼 상태 변화', JSON.stringify(after));
    process.exit(2);
  }
  console.log(`✅ 무영속 확인(post-probe): dry-run 전후 대상 컬럼 수 불변(${before.length}건). DDL 미영속.`);
  process.exit(0);
}

// ── APPLY ──
console.log('🚀 [APPLY] customers.insurance_cert_no (건강보험증 번호, PII, TEXT NULL)');
const before = await probeCol();
if (before.length > 0) console.log('  (참고) 이미 존재:', JSON.stringify(before), '— IF NOT EXISTS 멱등 skip 예상');

const r = await q(UP);
console.log('  exec:', r.status, JSON.stringify(r.body));
if (!r.ok) { console.error('❌ apply 실패'); process.exit(1); }

// post-probe: 컬럼 실재 + TEXT + nullable 검증
const post = await probeCol();
console.log('  post-state 컬럼:', JSON.stringify(post));
if (post.length !== 1) { console.error(`❌ 검증 실패: insurance_cert_no 미실재`); process.exit(3); }
if (post[0].data_type !== 'text' || post[0].is_nullable !== 'YES') {
  console.error(`❌ 검증 실패: 기대 text/YES, 실제 ${post[0].data_type}/${post[0].is_nullable}`); process.exit(4);
}

// ── LEDGER 등재 (schema_migrations) ──
try {
  await q(`INSERT INTO supabase_migrations.schema_migrations(version, name)
    VALUES ('${VERSION}', '${NAME}')
    ON CONFLICT (version) DO NOTHING`);
  const led = await probeLedger();
  if (led.length !== 1) { console.error('❌ ledger 등재 실패'); process.exit(5); }
  console.log(`  ✅ ledger(schema_migrations) 등재:`, JSON.stringify(led));
} catch (e) { console.error('❌ ledger 등재 오류:', e.message); process.exit(6); }

// net-zero 지문: 신규 NULLABLE 컬럼 → 전건 insurance_cert_no=NULL (backfill 0 근거)
const nn = await q(`SELECT count(*)::int AS total, count(insurance_cert_no)::int AS non_null FROM ${TABLE}`);
console.log('  backfill-0 지문(전건 insurance_cert_no=NULL 기대):', JSON.stringify(nn.body));

console.log('✅ APPLY 완료 — insurance_cert_no TEXT NULL 신설, ledger 등재, 전건 NULL(backfill 0).');

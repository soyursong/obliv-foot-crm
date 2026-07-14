/**
 * T-20260714-foot-SOFTVOID-INFRA-FWD-PRIMITIVE
 *   closing_manual_payments 에 soft-void 메타 3컬럼(voided_at/voided_reason/voided_by) ADDITIVE 신설.
 * 게이트: ADDITIVE(신규 NULLABLE + data 불변) + DA GO(Q2) → §3.1 대표 게이트 면제, supervisor DDL-diff.
 *
 * 사용:
 *   DRYRUN=1 node scripts/apply_20260714190000_closing_manual_payments_softvoid.mjs  # No-Persistence 검증
 *   node scripts/apply_20260714190000_closing_manual_payments_softvoid.mjs           # 실제 적용(COMMIT)
 *   LEDGER=1 node scripts/apply_20260714190000_closing_manual_payments_softvoid.mjs  # 3자 원장 대사만
 * rollback: supabase/migrations/20260714190000_closing_manual_payments_softvoid.rollback.sql
 *
 * No-Persistence Protocol (migration_dryrun_no_persistence_protocol 단일표준):
 *   1) up.sql 내장 txn-control(BEGIN/COMMIT/ROLLBACK/END) strip
 *   2) BEGIN..ROLLBACK 로 재래핑 실행(sentinel 신뢰 금지)
 *   3) 사후 무영속 introspection(post-probe): 별 커넥션에서 3컬럼 미잔존 확인 → 실증 PASS
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dir = dirname(fileURLToPath(import.meta.url));
const MIG = '20260714190000_closing_manual_payments_softvoid';
const UP = readFileSync(join(__dir, `../supabase/migrations/${MIG}.sql`), 'utf8');

const DRYRUN = !!process.env.DRYRUN;
const LEDGER = !!process.env.LEDGER;
const TABLE = 'closing_manual_payments';
const COLS = ['voided_at', 'voided_reason', 'voided_by'];

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

async function probeCols() {
  const r = await q(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name='${TABLE}' AND column_name IN (${COLS.map(c => `'${c}'`).join(',')}) ORDER BY column_name`);
  return Array.isArray(r.body) ? r.body : [];
}

// ── LEDGER: 원장(schema_migrations) ↔ 파일 ↔ prod(information_schema) 3자 대사 ──
if (LEDGER) {
  console.log('🧾 [LEDGER] 3자 대사 (원장 ↔ 파일 ↔ prod)');
  const prod = await probeCols();
  const ledger = await q(`SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20260714190000'`);
  console.log('  file 선언 컬럼:', JSON.stringify(COLS));
  console.log('  prod 실재 컬럼:', JSON.stringify(prod));
  console.log('  원장(schema_migrations 20260714190000):', JSON.stringify(ledger.body));
  process.exit(0);
}

if (DRYRUN) {
  console.log('🧪 [DRYRUN] No-Persistence Protocol');
  const before = await probeCols();
  if (before.length > 0) {
    console.log('  (참고) 이미 존재하는 컬럼:', JSON.stringify(before), '— 멱등 ADDITIVE, dry-run 무해');
  }
  const wrapped = `BEGIN;\n${stripTxn(UP)}\nROLLBACK;`;
  const r = await q(wrapped);
  console.log('  exec:', r.status, JSON.stringify(r.body));
  if (!r.ok) { console.error('❌ dry-run 실행 실패'); process.exit(1); }
  // post-probe: 별 HTTP 요청(별 커넥션) — dry-run 트랜잭션 롤백 후 무영속 실증
  const after = await probeCols();
  const delta = after.length - before.length;
  if (delta !== 0) {
    console.error('❌ NO-PERSISTENCE VIOLATION: dry-run 후 컬럼 상태 변화', JSON.stringify(after));
    console.error('   → prod에 잔존 가능. 즉시 rollback.sql 적용 필요.');
    process.exit(2);
  }
  console.log(`✅ 무영속 확인(post-probe): dry-run 전후 대상 컬럼 수 불변(${before.length}건). DDL 미영속.`);
  process.exit(0);
}

// ── APPLY ──
console.log('🚀 [APPLY] closing_manual_payments soft-void 3컬럼');
const r = await q(UP);
console.log('  exec:', r.status, JSON.stringify(r.body));
if (!r.ok) { console.error('❌ apply 실패'); process.exit(1); }
const post = await probeCols();
console.log('  post-state 컬럼:', JSON.stringify(post));
if (post.length !== COLS.length) {
  console.error(`❌ 검증 실패: 기대 ${COLS.length}컬럼, 실제 ${post.length}`); process.exit(3);
}
// 원자배포 검증지문: 전건 voided_at=NULL → 유효행=전건 (합계 불변 근거)
const nn = await q(`SELECT count(*)::int AS total, count(voided_at)::int AS voided FROM ${TABLE}`);
console.log('  net-zero 지문(전건 voided_at=NULL 기대):', JSON.stringify(nn.body));
console.log('✅ APPLY 완료 — 3컬럼 신설, 기존행 전부 voided_at=NULL.');

/**
 * T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE — 레드페이 단말 화이트리스트 SSOT prod forward-apply
 *
 * supervisor QA = NO_GO(FIX-REQUEST MSG-20260718-005439-qoi0): db_change=true 인데 마이그가 prod 미적용.
 *   코드/마이그 게이트(빌드·ADDITIVE·RLS·회귀0·롤백·폴러 재배선)는 전항 PASS.
 *   dryrun 은 BEGIN..ROLLBACK(무영속)이라 prod 실재 미증명 → prod apply runner + evidence 필요.
 *
 * 마이그 특성 (Migration Dry-Run No-Persistence Protocol 대조):
 *   forward .sql 내 txn 제어문(BEGIN/COMMIT/ROLLBACK) 0 — 전부 ADDITIVE DDL(CREATE TABLE IF NOT EXISTS,
 *   CREATE OR REPLACE VIEW/FUNCTION, 멱등 seed ON CONFLICT DO NOTHING, 원장 idempotent INSERT).
 *   → sentinel-bypass hazard 없음. applyMigration(Track3 단일경로)로 적용 = 원장 기록.
 *
 * 절차:
 *   (1) BEFORE: prod introspection — 테이블/알람뷰 부재·원장 미기록·viewdef 하드코딩(prior) 스냅샷
 *   (2) applyMigration(--apply): DDL 적용 + schema_migrations 원장 idempotent 기록
 *   (3) AFTER (신규 Management API 요청 = 영속 확인, FIX-REQUEST 체크리스트):
 *       - redpay_terminal_registry 실재 + domain='foot' active seed 17행
 *       - v_redpay_unclassified_merchants 실재
 *       - v_redpay_reconciliation_daily / v_receipt_settlement_daily viewdef 에 registry 파생 반영
 *       - get_redpay_feed_freshness() 정의에 registry 파생 반영
 *       - schema_migrations 에 20260711140000 1행
 *
 * 사용:  node scripts/T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE_apply.mjs           # dry-run(스냅샷만, write 0)
 *        node scripts/T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE_apply.mjs --apply   # PROD forward-apply
 *
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260711140000';
const FILE = '20260711140000_redpay_terminal_registry_ssot.sql';

function nowKst() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
}
async function one(sql) {
  const rows = await query(sql);
  return (Array.isArray(rows) ? rows : [])[0] || {};
}

async function introspect(label) {
  console.log(`\n[${label}] prod introspection (${nowKst()})`);
  const t = await one(`SELECT to_regclass('public.redpay_terminal_registry')::text AS reg,
                              to_regclass('public.v_redpay_unclassified_merchants')::text AS unclass;`);
  console.log(`  redpay_terminal_registry     = ${t.reg}`);
  console.log(`  v_redpay_unclassified_merch. = ${t.unclass}`);

  let seed = { n: null };
  if (t.reg) {
    seed = await one(`SELECT count(*)::int AS n FROM public.redpay_terminal_registry WHERE domain='foot' AND active;`);
    console.log(`  foot active seed rows        = ${seed.n}`);
  }

  const led = await one(`SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`);
  console.log(`  ledger 20260711140000 rows   = ${led.n}`);

  // 뷰/함수가 BEFORE 에 부재할 수 있음(CREATE OR REPLACE 가 신설) → 존재 가드 후 정의 검사.
  const viewDeriv = async (v) => {
    const e = await one(`SELECT to_regclass('public.${v}')::text AS r;`);
    if (!e.r) return { exists: false, deriv: false };
    const d = await one(`SELECT position('redpay_terminal_registry' in pg_get_viewdef('public.${v}'::regclass)) AS pos;`);
    return { exists: true, deriv: d.pos > 0 };
  };
  const recon = await viewDeriv('v_redpay_reconciliation_daily');
  const recv  = await viewDeriv('v_receipt_settlement_daily');
  const fnEx  = await one(`SELECT count(*)::int AS n FROM pg_proc WHERE proname='get_redpay_feed_freshness' AND pronamespace='public'::regnamespace;`);
  let fnDeriv = false;
  if (fnEx.n > 0) {
    const fd = await one(`SELECT position('redpay_terminal_registry' in pg_get_functiondef('public.get_redpay_feed_freshness'::regproc)) AS pos;`);
    fnDeriv = fd.pos > 0;
  }
  console.log(`  recon viewdef  registry-deriv= ${recon.deriv} (exists=${recon.exists})`);
  console.log(`  receipt viewdef registry-der.= ${recv.deriv} (exists=${recv.exists})`);
  console.log(`  freshness fn   registry-deriv= ${fnDeriv} (exists=${fnEx.n > 0})`);

  return { reg: t.reg, unclass: t.unclass, seed: seed.n, ledger: led.n,
           reconDeriv: recon.deriv, recvDeriv: recv.deriv, fnDeriv };
}

console.log(`=== T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);
console.log(`project: rxlomoozakkjesdqjtvd (obliv-foot-crm prod)`);

await introspect('BEFORE');

const res = await applyMigration({ version: VERSION, file: FILE, dryRun: !APPLY,
  createdBy: 'T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE' });
console.log(`\napplyMigration:`, JSON.stringify(res));

if (!APPLY) {
  console.log('\n(dry-run — SQL·원장 미실행. --apply 로 실적용)');
  process.exit(0);
}

const a = await introspect('AFTER');
const checks = [
  ['redpay_terminal_registry 실재',            a.reg === 'redpay_terminal_registry'],
  ['foot active seed = 17행',                   a.seed === 17],
  ['v_redpay_unclassified_merchants 실재',     a.unclass === 'v_redpay_unclassified_merchants'],
  ['recon viewdef registry 파생',              a.reconDeriv],
  ['receipt viewdef registry 파생',            a.recvDeriv],
  ['freshness fn registry 파생',               a.fnDeriv],
  ['schema_migrations 20260711140000 1행',     a.ledger === 1],
];
console.log('\n── 사후검증 (FIX-REQUEST 체크리스트) ──');
let pass = true;
for (const [label, ok] of checks) { console.log(`  ${ok ? '✅' : '❌'} ${label}`); if (!ok) pass = false; }
console.log(pass ? `\n✅✅ PASS — registry SSOT prod 영속 확인 (applied_at=${nowKst()})`
                 : '\n❌ FAIL — 미충족 항목 존재');
process.exit(pass ? 0 : 1);

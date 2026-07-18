/**
 * T-20260711-foot-REDPAY-TERMINAL-REGISTRY-TABLE — redpay family 5종 prod 실측 introspection
 * FIX-REQUEST MSG-20260718-022303-rvh4 (supervisor Option A GO + drift 범위 확대) 조치 1·3.
 *
 * 목적: PostgREST 캐시 우회(Management API 직접 SQL)로
 *   (a) schema_migrations 원장행 유무  AND  (b) 실제 객체/데이터 실재 를 분리 확인.
 *   → ledger-있음/객체-부재 divergence(특히 20260714170100 body-seed silent-SKIP hazard) 탐지.
 * 또한 조치 3 = 20260710 VALIDATE fail-closed 프리체크(receipt_ocr_results PCI regex count).
 *
 * usage: node scripts/T-20260711-...introspect.mjs [--tag BEFORE|AFTER]
 * read-only. prod write 없음.
 */
import { query } from './lib/foot_migration_ledger.mjs';

const TAG = (process.argv.find((a) => a.startsWith('--tag='))?.split('=')[1])
  || (process.argv[process.argv.indexOf('--tag') + 1]) || 'SNAPSHOT';

const one = async (sql) => {
  const rows = await query(sql);
  return Array.isArray(rows) ? rows : [];
};
const scalar = async (sql) => {
  const rows = await one(sql);
  const r = rows[0] || {};
  return r[Object.keys(r)[0]];
};

console.log('════════════════════════════════════════════════════════════');
console.log(`[${TAG}] redpay family 5종 prod introspection — ref rxlomoozakkjesdqjtvd`);
console.log('════════════════════════════════════════════════════════════');

// ── A. schema_migrations 원장행 (있음/없음) ──────────────────────────────
const versions = ['20260710120000', '20260711140000', '20260714170000', '20260714170100', '20260714210000'];
const ledger = await one(
  `SELECT version, name FROM supabase_migrations.schema_migrations
   WHERE version IN (${versions.map((v) => `'${v}'`).join(',')}) ORDER BY version;`,
);
const ledgerSet = new Set(ledger.map((r) => r.version));
const ledgerMax = await scalar('SELECT max(version) AS v FROM supabase_migrations.schema_migrations;');
console.log('\n── A. LEDGER (schema_migrations 원장행) ──');
for (const v of versions) console.log(`  ${v}  ledger=${ledgerSet.has(v) ? 'PRESENT' : 'ABSENT'}`);
console.log(`  ledger MAX version = ${ledgerMax}`);

// ── B. 객체/데이터 실재 (원장과 분리) ────────────────────────────────────
console.log('\n── B. OBJECT/DATA 실재 (원장과 분리 확인) ──');

// B1. registry 테이블 + domain별 count
const regExists = await scalar(`SELECT to_regclass('public.redpay_terminal_registry') AS v;`);
console.log(`  redpay_terminal_registry table = ${regExists ?? 'ABSENT'}`);
let footCnt = null; let bodyCnt = null;
if (regExists) {
  const dc = await one('SELECT domain, count(*)::int AS n FROM public.redpay_terminal_registry GROUP BY 1 ORDER BY 1;');
  console.log(`    domain counts: ${JSON.stringify(dc)}`);
  footCnt = dc.find((r) => r.domain === 'foot')?.n ?? 0;
  bodyCnt = dc.find((r) => r.domain === 'body')?.n ?? 0;
  console.log(`    → foot=${footCnt} (기대 17), body=${bodyCnt} (기대 14)`);
}

// B2. 소비 뷰/함수 실재 + registry 파생 여부
for (const obj of ['public.v_receipt_settlement_daily', 'public.v_redpay_unclassified_merchants',
  'public.v_redpay_reconciliation_daily']) {
  const ex = await scalar(`SELECT to_regclass('${obj}') AS v;`);
  console.log(`  ${obj} = ${ex ?? 'ABSENT'}`);
}
if (await scalar(`SELECT to_regclass('public.v_redpay_reconciliation_daily') AS v;`)) {
  const derived = await scalar(
    `SELECT (pg_get_viewdef('public.v_redpay_reconciliation_daily'::regclass) ILIKE '%redpay_terminal_registry%') AS v;`,
  );
  console.log(`    v_redpay_reconciliation_daily registry-derived = ${derived}`);
}

// B3. payments 컬럼 실재 (20260710 적용 지표)
const payCols = await one(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='payments'
     AND column_name IN ('image_url','ocr_receipt_datetime') ORDER BY 1;`,
);
console.log(`  payments 신규컬럼(image_url/ocr_receipt_datetime) present = ${JSON.stringify(payCols.map((r) => r.column_name))}`);
const roaCol = await scalar(
  `SELECT count(*)::int AS n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='receipt_ocr_results' AND column_name='parsed_approval_no';`,
);
console.log(`  receipt_ocr_results.parsed_approval_no present = ${roaCol > 0}`);

// B4. paylog center 컬럼 + CHECK + 인덱스
const centerCol = await one(
  `SELECT is_nullable, column_default FROM information_schema.columns
   WHERE table_schema='public' AND table_name='payment_reconciliation_log' AND column_name='center';`,
);
console.log(`  payment_reconciliation_log.center = ${centerCol.length ? JSON.stringify(centerCol[0]) : 'ABSENT'}`);
const centerChk = await scalar(
  `SELECT count(*)::int AS n FROM pg_constraint WHERE conname='payment_reconciliation_log_center_check';`,
);
console.log(`  center CHECK constraint present = ${centerChk > 0}`);
if (centerCol.length) {
  const cc = await one('SELECT center, count(*)::int AS n FROM public.payment_reconciliation_log GROUP BY 1 ORDER BY 1;');
  console.log(`    center value dist: ${JSON.stringify(cc)}`);
}

// B5. body 뷰 + role
const bodyView = await scalar(`SELECT to_regclass('public.v_redpay_reconciliation_body') AS v;`);
console.log(`  v_redpay_reconciliation_body = ${bodyView ?? 'ABSENT'}`);
if (bodyView) {
  const centerLeak = await scalar(
    `SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_schema='public' AND table_name='v_redpay_reconciliation_body' AND column_name='center';`,
  );
  console.log(`    (deploy-precheck i) center 컬럼 노출 count = ${centerLeak} (MUST 0)`);
}
const roleExists = await scalar(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname='body_recon_ro';`);
console.log(`  role body_recon_ro present = ${roleExists > 0}`);
if (roleExists > 0 && bodyView) {
  const pBase = await scalar(`SELECT has_table_privilege('body_recon_ro','public.payment_reconciliation_log','SELECT') AS v;`);
  const pFoot = await scalar(`SELECT has_table_privilege('body_recon_ro','public.v_redpay_reconciliation_daily','SELECT') AS v;`);
  const pBody = await scalar(`SELECT has_table_privilege('body_recon_ro','public.v_redpay_reconciliation_body','SELECT') AS v;`);
  console.log(`    (deploy-precheck ii) grant base=${pBase}(MUST false) foot=${pFoot}(MUST false) body=${pBody}(MUST true)`);
}

// ── C. VALIDATE fail-closed 프리체크 (조치 3) ────────────────────────────
console.log('\n── C. VALIDATE FAIL-CLOSED PRECHECK (receipt_ocr_results PCI) ──');
const roTotal = await scalar(`SELECT count(*)::int AS n FROM public.receipt_ocr_results;`);
const roPan = await scalar(`SELECT count(*)::int AS n FROM public.receipt_ocr_results WHERE raw_text ~ '[0-9]{13,}';`);
console.log(`  receipt_ocr_results total rows = ${roTotal}`);
console.log(`  raw_text ~ '[0-9]{13,}' count = ${roPan}  → ${roPan > 0 ? '⛔ ABORT (0 전제 붕괴)' : '✅ SAFE (VALIDATE 통과 가능)'}`);

// ── D. HAZARD 판정 ───────────────────────────────────────────────────────
console.log('\n── D. HAZARD 판정 (body-seed silent-SKIP) ──');
const hazard = ledgerSet.has('20260714170100') && (!regExists || (bodyCnt === 0));
console.log(`  20260714170100 ledger=${ledgerSet.has('20260714170100') ? 'PRESENT' : 'ABSENT'}, registry=${regExists ? 'EXISTS' : 'ABSENT'}, body count=${bodyCnt}`);
console.log(`  → body-seed REPAIR 필요 = ${hazard ? 'YES (ledger-있음 but seed-부재 hazard 확정)' : (regExists && bodyCnt === 14 ? 'NO (이미 14)' : 'apply 후 재판정')}`);

console.log('\n[' + TAG + '] introspection 완료.\n');

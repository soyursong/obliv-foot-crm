/**
 * T-20260628-foot-ANON-KIOSK-CUTOVER — [D] 원장(schema_migrations) forward-doc reconcile
 *
 * INFO MSG-20260718-180533-1qo3 (supervisor). 사후검증 PASS(GO) + 원장 reconcile 판정.
 *
 * ── 판정 (Migration Ledger Reconciliation 단일표준) ──
 *   정본 = prod 실재. 아래 3건은 (a) prod 실재 introspection 검증됨 (b) ADDITIVE
 *   (c) DA-GO (v2=lh9k / v3=m449 개보법§23) (d) main-resident 정의 파일 + 롤백 SQL 존재.
 *   Management API 경유 apply → schema_migrations 원장 미기록이 유일 divergence 원인.
 *   → 분기 (F) forward-doc: 원장에 (version, name) 행 INSERT 만.
 *
 * ── 절대 금지 (supervisor 명시) ──
 *   · DDL 재실행 금지 (정의 파일 이미 prod 실재 — 재적용 불필요/hazard).
 *   · db repair 거짓승인 금지 (recordLedger = 순수 원장 INSERT, ON CONFLICT DO NOTHING).
 *   → 본 러너는 recordLedger(순수 원장 catch-up)만 사용. applyMigration(DDL 재실행) 미사용.
 *
 * ── 대상 (prod-materialized 3 version) ──
 *   · 20260628160000  anon_upsert_customer_resolve_v2   (fn_selfcheckin_upsert_customer_resolve_v2)
 *   · 20260629120000  foot_consent_sensitive            (customers.consent_sensitive/_agreed_at/_version)
 *   · 20260629160000  anon_upsert_customer_resolve_v3   (fn_selfcheckin_upsert_customer_resolve_v3 + anon EXECUTE)
 *
 *   NB: 20260628160000·20260629120000 은 형제 마이그 파일(reservations_created_via /
 *   staff_assign_sort_order)과 version prefix 를 공유한다. schema_migrations.version 은
 *   PK 이므로 version 1행이 해당 timestamp 의 모든 형제 DDL 을 원장상 커버한다(name 은 문서용).
 *   본 reconcile 은 supervisor scope 가 지목한 anon/consent 를 대표 name 으로 기록한다.
 *
 * usage: node scripts/T-20260628-foot-ANON-KIOSK-CUTOVER_ledger_reconcile.mjs          (PRE-PROBE + DRY 계획)
 *        node scripts/T-20260628-foot-ANON-KIOSK-CUTOVER_ledger_reconcile.mjs --apply  (PRE-PROBE + recordLedger + POST-PROBE)
 * author: dev-foot / 2026-07-18
 */
import { query, recordLedger, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(원장 forward-doc)' : 'DRY(PRE-PROBE only)';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const CREATED_BY = 'T-20260628-ANON-KIOSK-CUTOVER-forward-doc-1qo3';

const TARGETS = [
  { version: '20260628160000', name: 'anon_upsert_customer_resolve_v2' },
  { version: '20260629120000', name: 'foot_consent_sensitive' },
  { version: '20260629160000', name: 'anon_upsert_customer_resolve_v3' },
];

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

async function objectProbe(label) {
  console.log(`\n── [OBJECT-PROBE:${label}] prod 실재 (ref rxlomoozakkjesdqjtvd) ──`);
  const v2 = await scalar(
    "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_selfcheckin_upsert_customer_resolve_v2';"
  );
  const v3 = await scalar(
    "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_selfcheckin_upsert_customer_resolve_v3';"
  );
  const v3AnonExec = await scalar(
    "SELECT has_function_privilege('anon', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='fn_selfcheckin_upsert_customer_resolve_v3' LIMIT 1;"
  );
  const consentCols = await scalar(
    "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name IN ('consent_sensitive','consent_agreed_at','consent_version');"
  );
  console.log(`  fn_selfcheckin_upsert_customer_resolve_v2 = ${v2 ?? 'ABSENT'}`);
  console.log(`  fn_selfcheckin_upsert_customer_resolve_v3 = ${v3 ?? 'ABSENT'}  (anon EXECUTE=${v3AnonExec})`);
  console.log(`  customers consent 3컬럼 실재 수            = ${consentCols}/3`);
  return { v2: !!v2, v3: !!v3, v3AnonExec, consentCols: Number(consentCols) };
}

async function ledgerProbe(label) {
  const led = await ledgerVersions();
  console.log(`\n── [LEDGER-PROBE:${label}] schema_migrations version 기록 ──`);
  const state = TARGETS.map((t) => ({ ...t, present: led.has(t.version) }));
  for (const t of state) console.log(`  ${t.version} (${t.name}) = ${t.present ? 'PRESENT' : 'ABSENT'}`);
  return state;
}

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] ANON-KIOSK-CUTOVER 원장 forward-doc — ${nowKst()}`);
console.log('════════════════════════════════════════════════════════════');

const obj = await objectProbe('PRE');
const objOk = obj.v2 && obj.v3 && obj.v3AnonExec === true && obj.consentCols === 3;
if (!objOk) {
  console.error('\n⛔ OBJECT-PROBE FAIL — prod 정본 실재 전제 불충족. forward-doc 근거 붕괴 → 중단, supervisor 보고.');
  console.error('   (forward-doc 은 prod 실재를 전제로만 정당하다. 부재 시 forward-doc 아닌 재적용 판단 필요.)');
  process.exit(2);
}
console.log('  ✅ prod 정본 3건 전부 실재 확인 (forward-doc 전제 성립).');

const pre = await ledgerProbe('PRE');
const missing = pre.filter((t) => !t.present);

if (!APPLY) {
  console.log('\n── [DRY] forward-doc 계획 ──');
  if (missing.length === 0) {
    console.log('  ✅ 3 version 원장 전량 PRESENT — reconcile 불필요(이미 정합).');
  } else {
    for (const t of missing) console.log(`  INSERT schema_migrations (version='${t.version}', name='${t.name}', statements='{}')  [ON CONFLICT DO NOTHING]`);
    console.log(`\n  ⚠ 미기록 ${missing.length}건 → --apply 로 forward-doc. (DDL 재실행 없음)`);
  }
  console.log('\n실적용: --apply 플래그.\n');
  process.exit(0);
}

// ── APPLY: 순수 원장 forward-doc (recordLedger, ON CONFLICT DO NOTHING). DDL 재실행 없음. ──
console.log('\n── [APPLY] recordLedger 순수 원장 INSERT (DDL 재실행 없음) ──');
for (const t of TARGETS) {
  const r = await recordLedger({ version: t.version, name: t.name, createdBy: CREATED_BY, dryRun: false });
  console.log(`  ✅ recordLedger ${r.version} (${r.name})`);
}

// ── POST-PROBE: 원장 3 version 전량 PRESENT + prod 객체 무변경 재확인 ──
const post = await ledgerProbe('POST');
const stillMissing = post.filter((t) => !t.present);
const objPost = await objectProbe('POST');
const objUnchanged = objPost.v2 && objPost.v3 && objPost.v3AnonExec === true && objPost.consentCols === 3;

if (stillMissing.length > 0) {
  console.error(`\n⛔ POST-PROBE FAIL — 원장 미기록 잔존: ${stillMissing.map((t) => t.version).join(', ')}. supervisor 보고.`);
  process.exit(3);
}
if (!objUnchanged) {
  console.error('\n⛔ POST-PROBE FAIL — prod 객체 상태 변동 감지(forward-doc 은 무-DDL 이어야 함). supervisor 보고.');
  process.exit(4);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log(`✅ forward-doc 완료 — 원장 3 version PRESENT, prod 객체 무변경 (${nowKst()})`);
console.log('   mig_ledger_check: drift → reconciled. DDL 재실행/데이터 변경 0.');
console.log('════════════════════════════════════════════════════════════\n');

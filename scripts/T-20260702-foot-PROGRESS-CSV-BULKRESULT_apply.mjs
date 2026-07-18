/**
 * T-20260702-foot-PROGRESS-CSV-BULKRESULT — progress_result_images + progress-results 버킷 apply
 * DA CONSULT-REPLY GO (ADDITIVE, DA-20260718-foot-PROGRESS-BULKRESULT-AUTOMATCH). supervisor DDL-diff.
 *
 * ── 단일경로 apply = 원장 기록 ──
 *   applyMigration() 경유 = SQL 적용 + schema_migrations 원장 idempotent INSERT (drift 차단).
 *   ADDITIVE(신규 버킷+테이블) — 기존 오브젝트 무접촉.
 *
 * POSTCHECK: (a) 테이블 실재+13컬럼 (b) 멱등 UNIQUE (c) RLS 활성+정책3종
 *            (d) private 버킷 실재 (e) storage 정책 실재 (f) ledger 등재
 *
 * usage: node scripts/T-20260702-...apply.mjs          (DRY — BEFORE 실측만)
 *        node scripts/T-20260702-...apply.mjs --apply  (실적용 + POSTCHECK)
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(BEFORE 실측만)';
const VERSION = '20260718210000';
const FILE = '20260718210000_foot_progress_result_images.sql';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

const getTableExists = () => scalar(
  `SELECT to_regclass('public.progress_result_images') IS NOT NULL AS ok;`);
const getColCount = () => scalar(
  `SELECT count(*)::int AS n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='progress_result_images';`);
const getUniqueCount = () => scalar(
  `SELECT count(*)::int AS n FROM pg_constraint
   WHERE conrelid = to_regclass('public.progress_result_images') AND contype='u';`);
const getRls = () => scalar(
  `SELECT relrowsecurity AS ok FROM pg_class WHERE oid = to_regclass('public.progress_result_images');`);
const getPolCount = () => scalar(
  `SELECT count(*)::int AS n FROM pg_policies
   WHERE schemaname='public' AND tablename='progress_result_images';`);
const getBucket = () => scalar(
  `SELECT count(*)::int AS n FROM storage.buckets WHERE id='progress-results' AND public=false;`);
const getStoragePol = () => scalar(
  `SELECT count(*)::int AS n FROM pg_policies
   WHERE schemaname='storage' AND tablename='objects' AND policyname='progress_results_admin_all';`);

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] progress_result_images mig ${VERSION} apply — ref rxlomoozakkjesdqjtvd (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════\n');

const ledgerBefore = await ledgerVersions();
console.log('── BEFORE (prod 실측) ──');
console.log(`  ledger has ${VERSION}? : ${ledgerBefore.has(VERSION)}`);
console.log(`  table exists?          : ${await getTableExists()}`);
console.log(`  bucket(private) n      : ${await getBucket()}`);

if (!APPLY) {
  console.log('\n[DRY] 계획만. 실적용은 --apply. (applyMigration 단일경로: DDL + ledger)');
  process.exit(0);
}

if (ledgerBefore.has(VERSION)) {
  console.log(`\n⚠ ${VERSION} 이미 ledger 존재 — 재apply 스킵(멱등). POSTCHECK 만 수행.`);
} else {
  console.log(`\n── APPLY ${VERSION} (applyMigration 단일경로) ──`);
  const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'T-20260702-foot-PROGRESS-CSV-BULKRESULT' });
  console.log(`  applied: ${JSON.stringify(res)}`);
}
const appliedAt = nowKst();

console.log('\n════════════════════════════════════════════════════════════');
console.log('POSTCHECK (prod 실측)');
console.log('════════════════════════════════════════════════════════════');
const pcTable = await getTableExists();
const pcCols = await getColCount();
const pcUq = await getUniqueCount();
const pcRls = await getRls();
const pcPol = await getPolCount();
const pcBucket = await getBucket();
const pcStPol = await getStoragePol();
const ledgerAfter = await ledgerVersions();

console.log(`(a) 테이블 실재 : ${pcTable === true ? '✅' : '❌'}  · 컬럼수 ${pcCols} : ${pcCols === 13 ? '✅' : '❌'}`);
console.log(`(b) 멱등 UNIQUE n=${pcUq} : ${pcUq >= 1 ? '✅' : '❌'}`);
console.log(`(c) RLS 활성 ${pcRls} : ${pcRls === true ? '✅' : '❌'}  · 정책 n=${pcPol} : ${pcPol === 3 ? '✅' : '❌'}`);
console.log(`(d) private 버킷 n=${pcBucket} : ${pcBucket === 1 ? '✅' : '❌'}`);
console.log(`(e) storage 정책 n=${pcStPol} : ${pcStPol === 1 ? '✅' : '❌'}`);
console.log(`(f) ledger 등재(after) : ${ledgerAfter.has(VERSION) ? '✅' : '❌'}`);

const allPass = pcTable === true && pcCols === 13 && pcUq >= 1 && pcRls === true
  && pcPol === 3 && pcBucket === 1 && pcStPol === 1 && ledgerAfter.has(VERSION);
console.log(`\n${allPass ? '✅ ALL POSTCHECK PASS' : '❌ POSTCHECK FAIL — supervisor 보고'}`);
console.log(`applied_at(KST) = ${appliedAt}`);
process.exit(allPass ? 0 : 3);

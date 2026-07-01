/**
 * T-20260701-foot-CUSTOMERS-LANG-MIGRATE-APPLY (P0 hotfix / DB drift 치유)
 *
 * ── 배경 (RC, DA read-only HARD PROOF) ──
 * foot prod customers.language 부재 확정(PostgREST 42703). FE Customers.tsx update@926/insert@1219
 * 은 payload에 language 키를 무조건 포함 → 컬럼 부재로 고객 등록/수정 payload 전체가 42703 실패(내국인 포함).
 * RC = 6/25 canonical 마이그 20260625140000_foreign_lang_save_customers_language.sql repo 존재하나 prod 미적용 drift.
 * (짝 PASSPORT-PORT 마이그는 적용됨 = nationality_id/passport_number/is_foreign 실재)
 *
 * ── 치유 ──
 * canonical 마이그를 foot prod에 적용. ADDITIVE 1 column: customers.language TEXT (nullable·백필0·내국인 무영향).
 * 신규 DDL 작성 아님 = 旣존재 마이그 파일 적용만. IF NOT EXISTS = 멱등.
 *
 * ── 게이트 ──
 * DA CONSULT GO+ADDITIVE (DA-20260701-FOOT-LANG-GRAIN-RECONCILE verdict A, canonical HOLDS).
 * autonomy §3.1 → additive-only → 대표 게이트 불요, supervisor DDL-diff 단일 게이트(정확히 1 additive column).
 *
 * ── 실행 ── (대시보드 수동 실행 금지 — dev-foot 직접 마이그 실행 카드 준수)
 *   node scripts/T-20260701-foot-CUSTOMERS-LANG-MIGRATE-APPLY_apply.mjs --dry-run   # 계획만
 *   node scripts/T-20260701-foot-CUSTOMERS-LANG-MIGRATE-APPLY_apply.mjs             # 실적용 + 원장기록 + verify
 *   node scripts/T-20260701-foot-CUSTOMERS-LANG-MIGRATE-APPLY_apply.mjs --rollback  # ALTER ... DROP COLUMN IF EXISTS language
 *
 * rollback = 무손실(신규 nullable 컬럼) : 20260625140000_foreign_lang_save_customers_language.rollback.sql
 * author: dev-foot / 2026-07-01
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query, applyMigration, ledgerVersions, MIG_DIR } from './lib/foot_migration_ledger.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const rollback = process.argv.includes('--rollback');

const VERSION = '20260625140000';
const FWD_FILE = '20260625140000_foreign_lang_save_customers_language.sql';
const RB_FILE = '20260625140000_foreign_lang_save_customers_language.rollback.sql';

/** customers.language 존재 여부 probe (PostgREST 42703 = 부재). */
async function columnExists() {
  const rows = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='customers' AND column_name='language';`,
  );
  return Array.isArray(rows) && rows.length > 0;
}

console.log(`🚀 T-20260701-foot-CUSTOMERS-LANG-MIGRATE-APPLY ${rollback ? 'ROLLBACK' : dryRun ? 'DRY-RUN' : 'APPLY'}`);

// ── ROLLBACK ──
if (rollback) {
  const SQL = readFileSync(join(MIG_DIR, RB_FILE), 'utf8');
  console.log('↩️  rollback SQL:\n' + SQL);
  await query(SQL);
  console.log('✅ rollback 완료 (customers.language DROP COLUMN IF EXISTS — 무손실)');
  process.exit(0);
}

// ── PRECHECK ──
const before = await columnExists();
console.log(`[precheck] customers.language 존재: ${before}  (기대: false = drift 확정)`);
const ledgerBefore = await ledgerVersions();
console.log(`[precheck] 원장 ${VERSION} 기록됨: ${ledgerBefore.has(VERSION)}`);

if (dryRun) {
  const plan = await applyMigration({ version: VERSION, file: FWD_FILE, dryRun: true });
  console.log('[dry-run] 계획:', JSON.stringify(plan, null, 2));
  console.log('※ 실적용/원장기록 없음. 실행하려면 --dry-run 제거.');
  process.exit(0);
}

if (before) {
  console.log('⚠ customers.language 이미 존재 — DDL은 IF NOT EXISTS로 멱등. 원장만 정합 확인/기록.');
}

// ── APPLY (DDL + 원장 기록 단일 경로) ──
const res = await applyMigration({
  version: VERSION,
  file: FWD_FILE,
  dryRun: false,
  createdBy: 'T-20260701-foot-CUSTOMERS-LANG-MIGRATE-APPLY',
});
console.log('[apply]', JSON.stringify(res, null, 2));

// ── VERIFY ──
const after = await columnExists();
const sample = await query('SELECT language FROM public.customers LIMIT 1;'); // 200 = 컬럼 실재
const ledgerAfter = await ledgerVersions();
console.log(`[verify] customers.language 존재: ${after}  (기대 true)`);
console.log(`[verify] SELECT language LIMIT 1 성공: ${Array.isArray(sample)}  rows=${Array.isArray(sample) ? sample.length : 'n/a'}`);
console.log(`[verify] 원장 ${VERSION} 기록됨: ${ledgerAfter.has(VERSION)}  (기대 true)`);

if (!after || !ledgerAfter.has(VERSION)) {
  console.error('❌ 검증 실패 (컬럼 부재 또는 원장 미기록)');
  process.exit(1);
}
console.log('✅ 완료 — customers.language canonical 마이그 prod 적용 + 원장 기록. drift 치유.');

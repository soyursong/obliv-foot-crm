/**
 * T-20260713-foot-PHONE-E164-BACKFILL-VALIDATE — Step1 up.sql PROD forward-apply
 *   (parent: T-20260713-foot-PHONE-E164-CHK-UNENFORCED, migration 20260713160000, commit fa68512b)
 *
 * 배경: P-A 실측(2026-07-18) FAIL — schema_migrations 20260713160000 미기록(=미적용),
 *   prod 제약 verbatim=舊 `82?` 깨진식 잔존, 로컬 `01012345678` prod ACCEPTED(enforcement 구멍 LIVE).
 *   = FE deployed ≠ DB applied divergence (foot ANONSWEEP 동종 false-verify).
 * 게이트: supervisor DDL-diff GATE = GO (사전승인, QA-REPLY MSG-20260718-193407-zlgb).
 *   데이터 무변경(NOT VALID)·enforcement-forward·원장 무접점 → 대표 게이트 면제(CEO 6pca 계승).
 *
 * 단일경로: applyMigration() = up.sql DDL 적용 + schema_migrations 원장 idempotent 기록.
 *   up.sql 은 자체 BEGIN…COMMIT 로 두 제약 DROP IF EXISTS + re-ADD NOT VALID (멱등).
 *   기존 오염행(cust 21 / resv 98) 무블록·무변경.
 *
 * 사용:
 *   node scripts/..._step1_apply.mjs           # dry-run (기본, DDL·원장 미실행)
 *   node scripts/..._step1_apply.mjs --apply   # PROD forward-apply (supervisor GO 후)
 *
 * author: dev-foot / 2026-07-18
 */
import { applyMigration, ledgerVersions, query } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260713160000';
const FILE = '20260713160000_foot_phone_e164_chk_expr_fix.sql';

// 오염행(신규 정본식 위반) count — 무변경 실증용 predicate (제약 allow식의 부정)
const VIOL_CUST = `SELECT count(*)::int AS n FROM public.customers
  WHERE phone IS NOT NULL AND phone NOT LIKE 'DUMMY-%' AND phone <> '+821000000000'
    AND phone !~ '^\\+82(1[016789]\\d{7,8})$' AND phone !~ '^\\+(?!82)[1-9]\\d{6,14}$';`;
const VIOL_RESV = `SELECT count(*)::int AS n FROM public.reservations
  WHERE customer_phone IS NOT NULL AND customer_phone NOT LIKE 'DUMMY-%' AND customer_phone <> '+821000000000'
    AND customer_phone !~ '^\\+82(1[016789]\\d{7,8})$' AND customer_phone !~ '^\\+(?!82)[1-9]\\d{6,14}$';`;

const one = (r) => (Array.isArray(r) ? r : r.result ?? [])[0]?.n;

console.log(`══ Step1 up.sql PROD apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) ══`);
console.log('시각(UTC):', new Date().toISOString(), '\n');

// ── BEFORE-IMAGE (READ-only) ──
const before = await ledgerVersions();
console.log(`원장 사전: ${before.size}행, ${VERSION} 존재=${before.has(VERSION)}`);
const cViol0 = one(await query(VIOL_CUST));
const rViol0 = one(await query(VIOL_RESV));
console.log(`오염행 사전(before-image): customers=${cViol0}, reservations=${rViol0}`);

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → DDL·원장 write 없음. up.sql 자체 BEGIN…COMMIT(NOT VALID, 데이터 무변경).');
  process.exit(0);
}

// ── APPLY ──
console.log('\n── PROD apply 실행 ──');
const r = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'T-20260713-PHONE-E164-BACKFILL-VALIDATE-step1' });
console.log(`  ✓ ${VERSION} DDL 적용 + 원장 기록 (${r.name})`);

// ── AFTER (무변경 실증) ──
const after = await ledgerVersions();
const cViol1 = one(await query(VIOL_CUST));
const rViol1 = one(await query(VIOL_RESV));
console.log(`\n원장 사후: ${after.size}행, ${VERSION} 존재=${after.has(VERSION)}`);
console.log(`오염행 사후: customers=${cViol1} (Δ=${cViol1 - cViol0}), reservations=${rViol1} (Δ=${rViol1 - rViol0})`);
const noChange = cViol1 === cViol0 && rViol1 === rViol0;
console.log(`데이터 무변경(NOT VALID): ${noChange ? '✅ 실증 (오염행 count 보존)' : '❌ 변동 발생 — 조사 필요'}`);
process.exit(noChange ? 0 : 1);

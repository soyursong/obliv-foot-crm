/**
 * T-20260629-foot-DUMMY-CHECKIN-RESV-LINK — Path B prod apply runner (dev-foot)
 * supervisor DB-GATE VERDICT: DB-GATE-REPLY MSG-20260718-011255-npot = Path B 조건부 GO.
 *   §1 DDL = GO/ADDITIVE 확정. §2 DML = 조건부 GO.
 *   MANDATORY: §1 DDL apply → --apply 직전 dry-run 재실행(fresh counts·혼입0·before-image) → --apply → 사후검증.
 *
 * 이 러너 = §1 DDL 만 담당(멱등, applyMigration 단일경로=적용+원장기록).
 *   §2 DML 은 별도 스크립트(...link.mjs) 로 dry-run 재실행 후 --apply.
 *
 * BEFORE/AFTER introspection + fail-closed:
 *   - BEFORE: medical_charts.check_in_id 실재 여부(supervisor 실측=ABSENT), check_ins.id PK 타입(UUID),
 *             sim customer 수·sim orphan medical_charts 수(대상셋 실측).
 *   - apply(멱등): ADD COLUMN IF NOT EXISTS + FK + partial index + comment + 검증 DO.
 *   - AFTER: 컬럼/FK/index 실재 재확인.
 *
 * usage:  node scripts/T-20260629-...pathB_apply.mjs           # DRY (BEFORE 실측 + 계획만)
 *         node scripts/T-20260629-...pathB_apply.mjs --apply   # 실적용 (supervisor GO 경유)
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY(실적용)' : 'DRY(BEFORE 실측 + 계획만)';
const nowKst = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
const VERSION = '20260629170000';
const FILE = '20260629170000_medical_charts_check_in_id_fk.sql';

const scalar = async (sql) => {
  const rows = await query(sql);
  const r = (Array.isArray(rows) ? rows : [])[0] || {};
  return r[Object.keys(r)[0]];
};

console.log('════════════════════════════════════════════════════════════');
console.log(`[${MODE}] Path B §1 DDL apply — medical_charts.check_in_id FK — ref rxlomoozakkjesdqjtvd (${nowKst()})`);
console.log('════════════════════════════════════════════════════════════\n');

// ── BEFORE 실측 ──
console.log('── [BEFORE] prod 실측 ──');
const colExists = await scalar(
  "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_charts' AND column_name='check_in_id') AS x;");
const ciPkType = await scalar(
  "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='check_ins' AND column_name='id';");
const simCust = await scalar('SELECT count(*)::int AS n FROM public.customers WHERE is_simulation = true;');
const simMc = await scalar('SELECT count(*)::int AS n FROM public.medical_charts m JOIN public.customers c ON c.id = m.customer_id WHERE c.is_simulation = true;');
console.log(`  medical_charts.check_in_id 실재: ${colExists}   (supervisor 실측 = ABSENT 예상)`);
console.log(`  check_ins.id PK 타입: ${ciPkType}   (UUID 예상)`);
console.log(`  sim customers: ${simCust}`);
console.log(`  sim medical_charts(총): ${simMc}\n`);

// fail-closed: check_ins.id 가 UUID 아니면 FK 타입 불일치 → abort
if (String(ciPkType).toLowerCase() !== 'uuid') {
  console.error(`⛔ ABORT — check_ins.id PK 타입 = ${ciPkType} ≠ uuid. FK 타입 불일치 위험. supervisor 보고.`);
  process.exit(2);
}

if (!APPLY) {
  console.log('[DRY] --apply 없음 → DDL 미적용. 계획:');
  console.log(`  applyMigration(version=${VERSION}, file=${FILE}) — ADD COLUMN IF NOT EXISTS(멱등)`);
  console.log(`  colExists=${colExists} → ${colExists ? '이미 존재(멱등 no-op 예상)' : '신규 apply(깨끗)'}`);
  process.exit(0);
}

// ── APPLY (멱등) ──
console.log('── [APPLY] §1 DDL 적용 (applyMigration 단일경로=적용+원장기록) ──');
const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot-pathB-DUMMY-CHECKIN-RESV-LINK' });
console.log(`  applied: ${JSON.stringify(res)}\n`);

// ── AFTER 실측 ──
console.log('── [AFTER] prod 재실측 ──');
const colAfter = await scalar(
  "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='medical_charts' AND column_name='check_in_id') AS x;");
const fkAfter = await scalar(
  "SELECT EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE table_name='medical_charts' AND constraint_name='medical_charts_check_in_id_fkey' AND constraint_type='FOREIGN KEY') AS x;");
const idxAfter = await scalar(
  "SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='medical_charts' AND indexname='idx_mc_check_in_id') AS x;");
console.log(`  컬럼 실재: ${colAfter}   FK 실재: ${fkAfter}   partial index 실재: ${idxAfter}`);
if (!(colAfter && fkAfter && idxAfter)) {
  console.error('⛔ AFTER 검증 실패 — 컬럼/FK/index 중 누락. supervisor 보고.');
  process.exit(3);
}
console.log('\n✅ §1 DDL apply 완료 + AFTER 검증 통과. 다음: link.mjs dry-run 재실행 → --apply.');

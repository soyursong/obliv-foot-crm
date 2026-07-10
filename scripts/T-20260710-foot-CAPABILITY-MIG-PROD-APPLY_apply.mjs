/**
 * T-20260710-foot-CAPABILITY-MIG-PROD-APPLY — AC1 forward-apply (prod)
 *
 * schema_migrations 원장에 미기록 + prod 미실재인 AC1 두 마이그를 forward-apply.
 * applyMigration() 단일경로 = DDL 적용 + 원장 idempotent 기록. 각 파일 말미 NOTIFY reload 동봉.
 *   → 부모 T-20260710-foot-ASSIGN-ORDER-SCROLL-TREATSELECT AC2 capMissing=false 자동해소.
 *
 * AC3 (20260703040000 pkg_triple) = carve-out. DA CONSULT lineage 미확인 → 본 스크립트 미대상
 *   (planner FOLLOWUP 로 별도 DA CONSULT 티켓 분리 요청). prod실재=Y/원장=N divergence 는 그 티켓에서 수렴.
 *
 * 사용:
 *   node scripts/..._apply.mjs           # dry-run (기본)
 *   node scripts/..._apply.mjs --apply   # PROD forward-apply (supervisor 게이트 후)
 *
 * author: dev-foot / 2026-07-10
 */
import { applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');

const AC1 = [
  { version: '20260701120000', file: '20260701120000_foot_chart_treatment_requests.sql' },
  { version: '20260701130000', file: '20260701130000_foot_therapist_capabilities.sql' },
];

console.log(`── AC1 forward-apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);
const before = await ledgerVersions();
console.log(`원장 사전 ${before.size}행`);
for (const m of AC1) console.log(`  ${before.has(m.version) ? '(원장기존)' : '+ 신규'} ${m.version} ${m.file}`);

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → DDL·원장 write 없음.');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const m of AC1) {
  try {
    const r = await applyMigration({ version: m.version, file: m.file, dryRun: false, createdBy: 'T-20260710-CAPABILITY-MIG-PROD-APPLY' });
    ok++;
    console.log(`  ✓ ${m.version} 적용+원장기록 (${r.name})`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${m.version}: ${e.message}`);
    break; // 순서 의존 없음이나 실패 시 중단(post-reconcile 로 상태 확정)
  }
}
const after = await ledgerVersions();
console.log(`\n완료: 적용 ${ok} / 실패 ${fail}. 원장 사후 ${after.size}행 (max=${[...after].sort().pop()})`);
process.exit(fail ? 1 : 0);

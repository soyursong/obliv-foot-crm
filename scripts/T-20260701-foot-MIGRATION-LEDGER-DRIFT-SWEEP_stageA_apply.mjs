/**
 * T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — Track2 Stage A 배치 apply
 *
 * 대상 = MED casualty 3건(전부 ADDITIVE·파괴적 0, Track1 진단 확정):
 *   #1 20260618200000_staff_attendance_ssot            근태 SSOT 테이블+4정책+idx
 *   #2 20260628200000_waiting_board_projection         대기보드 프로젝션 table+fn+trigger+정책
 *   #6 20260625140000_foreign_lang_save_customers_language  customers.language 컬럼
 *
 * 특징:
 *   - 전부 helper(applyMigration) 경유 → 적용 성공 시 supabase_migrations 원장에 자동 기록(Track3 시퀀싱).
 *     helper 없이 apply 하면 ledger 미기록 재발 → 반드시 이 경로.
 *   - 전 마이그 재적용 안전(IF NOT EXISTS / DROP..IF EXISTS 후 CREATE). rollback.sql 동반.
 *   - 순수 additive → 데이터 mutation 0, DROP 0. blast radius 0.
 *
 * 게이트: supervisor DDL-diff 배치 단위 게이트 통과 후에만 --apply.
 *   기본 dry-run(계획만). rollback: 각 마이그의 *.rollback.sql 을 supervisor 게이트 후 수동 실행.
 *
 * 사용:
 *   node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_stageA_apply.mjs           # dry-run
 *   node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_stageA_apply.mjs --apply    # PROD 적용(게이트 후)
 *
 * author: dev-foot / 2026-07-01
 */
import { applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');

const BATCH = [
  { version: '20260618200000', file: '20260618200000_staff_attendance_ssot.sql' },
  { version: '20260628200000', file: '20260628200000_waiting_board_projection.sql' },
  { version: '20260625140000', file: '20260625140000_foreign_lang_save_customers_language.sql' },
].sort((a, b) => a.version.localeCompare(b.version));

console.log(`── Track2 Stage A 배치 apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);
console.log(`대상 ${BATCH.length}건 (helper 경유 → 적용시 원장 자동기록):`);
BATCH.forEach((b) => console.log(`  · ${b.version}  ${b.file}`));

// 사전 원장 대조(이미 기록됐으면 재적용 불필요 알림 — 그래도 DDL 은 idempotent)
let ledger = new Set();
try { ledger = await ledgerVersions(); } catch (e) { console.warn('⚠ 원장 조회 실패(계속):', e.message); }
BATCH.forEach((b) => {
  if (ledger.has(b.version)) console.log(`  ⓘ ${b.version} 은 이미 원장 존재 — DDL 재적용은 idempotent, 원장은 ON CONFLICT no-op.`);
});

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → PROD write 없음.');
  console.log('supervisor DDL-diff 배치 게이트 통과 후 --apply 로 실행하세요.');
  console.log('rollback: 각 supabase/migrations/<version>_*.rollback.sql (수동, 게이트 후).');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const b of BATCH) {
  try {
    const r = await applyMigration({ version: b.version, file: b.file, dryRun: false, createdBy: 'ledger-drift-sweep-track2-stageA' });
    ok++;
    console.log(`  ✓ ${b.version} 적용+원장기록 (${r.name})`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${b.version} 실패: ${e.message}`);
    console.error('     → 중단. 부분적용 여부 확인 후 필요시 rollback.sql 실행.');
    break; // 배치 무결성: 첫 실패에서 중단
  }
}
console.log(`\n완료: 적용 ${ok} / 실패 ${fail}`);
const after = await ledgerVersions();
console.log(`원장 사후 ${after.size}행 (max=${[...after].sort().pop()})`);
process.exit(fail ? 1 : 0);

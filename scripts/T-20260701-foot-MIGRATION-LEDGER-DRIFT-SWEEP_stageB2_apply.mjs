/**
 * T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — Track2 Stage B2 apply (#3 daily_room_status RLS)
 *
 * HOLD-RELEASE: planner INFO MSG-20260701-112313-h6hh (DA 재판정 GO / DA-20260701-B2-DRS-READJ · MSG-20260701-112104-q38l).
 *   Stage B2 HOLD(포스처 diff 선행) = **해제 GO**. 근거: read-only 포스처 diff(commit acb309d6,
 *   scripts/audit_out/..._stageB2_daily_room_status_posture_diff.md)가 재apply의 포스처 rollback/loosen 0 입증.
 *   후속 경로 = B1과 동일: supervisor DDL-diff → helper apply. **본 배치는 B1 supervisor DDL-diff 게이트에 fold**
 *   (별도 게이트 발행 불필요·배치 처리). CEO 게이트 불요 / 추가 DA 재CONSULT 불요.
 *
 * 대상 (helper 경유 → 적용시 원장 자동기록):
 *   #3 20260630200000_daily_room_status_staff_unlock_6menu_rls_additive
 *      DROP POLICY IF EXISTS(no-op, PROD 부재) → CREATE POLICY PERMISSIVE FOR ALL (ADDITIVE 정책 복원)
 *
 * DA 3-불변식 self-check (dev-foot, 2026-07-01 — DDL-diff 게이트 첨부용):
 *   ① 기존 3정책(admin_manager_write / approved_read / staff_own_write) 무접촉 ✓
 *      — 마이그가 참조하는 정책명은 staff_unlock_6menu 단 1개. DROP/ALTER 대상 아님.
 *   ② REVOKE·신규 GRANT 전무 ✓ — 본문에 GRANT/REVOKE/ALTER DEFAULT PRIVILEGES 없음(grant 포스처 무변경).
 *   ③ USING ≡ WITH CHECK ✓ — read/write 술어 동일(role∈{consultant,coordinator,therapist} ∧ clinic_id 격리).
 *   → 3불변식 부합 → DA 재호출 불요, 그대로 apply. (위반문 발견 시에만 DA 재호출 — 본건 해당 없음.)
 *
 * side-flag(비차단·HOLD-NOTE): daily_room_status anon table-level GRANT 잔존 = 별도 anon-hardening 스윕(§12-6)
 *   후보. RLS ENABLE + 전 정책 authenticated → anon row 0(기능 leak 없음). #3 재apply 판정과 무관. 본 배치 비포함.
 *
 * 게이트: B1 supervisor DDL-diff 배치 게이트(fold)에 합류 → GO 후 --apply. 기본 dry-run.
 * 롤백: 20260630200000_..._rls_additive.rollback.sql 동반(DROP POLICY, ADDITIVE 원복).
 *
 * 사용:
 *   node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_stageB2_apply.mjs           # dry-run
 *   node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_stageB2_apply.mjs --apply    # PROD(게이트 후)
 *
 * author: dev-foot / 2026-07-01
 */
import { applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');

const BATCH = [
  {
    version: '20260630200000',
    file: '20260630200000_daily_room_status_staff_unlock_6menu_rls_additive.sql',
    kind: 'additive-rls-restore',
  },
];

console.log(`── Track2 Stage B2 apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);
console.log('DA 3-불변식 self-check PASS: ①기존3정책 무접촉 / ②REVOKE·신규GRANT 전무 / ③USING≡WITH CHECK.');
console.log('HOLD-RELEASE GO: DA-20260701-B2-DRS-READJ (MSG-20260701-112104-q38l). B1 DDL-diff 게이트에 fold.');
BATCH.forEach((b) => console.log(`  · ${b.version}  ${b.file}  [${b.kind}]`));

let ledger = new Set();
try { ledger = await ledgerVersions(); } catch (e) { console.warn('⚠ 원장 조회 실패(계속):', e.message); }
BATCH.forEach((b) => { if (ledger.has(b.version)) console.log(`  ⓘ ${b.version} 이미 원장 존재 — DROP IF EXISTS→CREATE 멱등, 원장 no-op.`); });

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → PROD write 없음. B1 supervisor DDL-diff 게이트(fold) GO 후 --apply.');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const b of BATCH) {
  try {
    const r = await applyMigration({ version: b.version, file: b.file, dryRun: false, createdBy: 'ledger-drift-sweep-track2-stageB2' });
    ok++;
    console.log(`  ✓ ${b.version} 적용+원장기록 (${r.name})`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${b.version} 실패: ${e.message} → 중단.`);
    break;
  }
}
console.log(`\n완료: 적용 ${ok} / 실패 ${fail}`);
const after = await ledgerVersions();
console.log(`원장 사후 ${after.size}행 (max=${[...after].sort().pop()})`);
process.exit(fail ? 1 : 0);

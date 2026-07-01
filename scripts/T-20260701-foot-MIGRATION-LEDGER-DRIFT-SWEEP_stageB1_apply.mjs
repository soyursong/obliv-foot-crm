/**
 * T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — Track2 Stage B1 배치 apply
 *
 * planner NEW-TASK MSG-20260701-110653-9wia (DA grant-audit CONSULT-REPLY e4yk 해소):
 *   Stage B1 = GO 3건 (body-shape self-check → supervisor DDL-diff → apply). CEO 게이트 불요.
 *   #3 daily_room_status RLS = B2 HOLD(포스처 diff 선행) — 본 배치 제외.
 *
 * 대상 (helper 경유 → 적용시 원장 자동기록):
 *   #1 20260616010000_phi_anon_grant_revoke_hardening   REVOKE ALL ON 4 PHI/EDI table FROM anon
 *   #2 20260629140000_anon_pii_leak_revoke_phase1        anon 파괴/불요 verb 회수(셀프체크인 권한 보존)
 *   #4 20260611210000_rx_audit_log                        CREATE TABLE IF NOT EXISTS + RLS + anon REVOKE(§12-6 append)
 *
 * body-shape self-check (dev-foot, 2026-07-01):
 *   #1 §15-3 revoke-only ✓ — anon-only, per-table 명시 4건, ALTER DEFAULT PRIVILEGES 無, 보상 GRANT 無, authenticated 유지.
 *   #2 §15-3 revoke-only ✓ — anon-only, per-table 5건, DEFAULT PRIV 無, 보상 GRANT 無, 셀프체크인 SELECT/INSERT/UPDATE 보존.
 *   #4 additive ✓ — CREATE TABLE IF NOT EXISTS, (a) anon SELECT GRANT 無, (b) RLS ENABLE 有. §12-6 anon-REVOKE 1줄 append 완료.
 *   → DA 재CONSULT·CEO 게이트 불요. supervisor DDL-diff에 self-check 첨부하여 apply.
 *
 * 게이트: supervisor DDL-diff 배치 게이트 통과 후 --apply. 기본 dry-run.
 * 롤백: #2/#4 는 *.rollback.sql 동반. #1 은 by-design rollback 없음(re-GRANT=보안구멍 재도입 방지, §15-3 ④).
 *
 * 사용:
 *   node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_stageB1_apply.mjs           # dry-run
 *   node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_stageB1_apply.mjs --apply    # PROD(게이트 후)
 *
 * author: dev-foot / 2026-07-01
 */
import { applyMigration, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');

const BATCH = [
  { version: '20260611210000', file: '20260611210000_rx_audit_log.sql', kind: 'additive' },
  { version: '20260616010000', file: '20260616010000_phi_anon_grant_revoke_hardening.sql', kind: 'revoke-only' },
  { version: '20260629140000', file: '20260629140000_anon_pii_leak_revoke_phase1.sql', kind: 'revoke-only' },
].sort((a, b) => a.version.localeCompare(b.version));

console.log(`── Track2 Stage B1 배치 apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);
console.log('body-shape self-check PASS: #1 §15-3 / #2 §15-3 / #4 additive+RLS+anonREVOKE.');
BATCH.forEach((b) => console.log(`  · ${b.version}  ${b.file}  [${b.kind}]`));

let ledger = new Set();
try { ledger = await ledgerVersions(); } catch (e) { console.warn('⚠ 원장 조회 실패(계속):', e.message); }
BATCH.forEach((b) => { if (ledger.has(b.version)) console.log(`  ⓘ ${b.version} 이미 원장 존재 — REVOKE/DDL 멱등, 원장 no-op.`); });

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → PROD write 없음. supervisor DDL-diff 게이트 후 --apply.');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const b of BATCH) {
  try {
    const r = await applyMigration({ version: b.version, file: b.file, dryRun: false, createdBy: 'ledger-drift-sweep-track2-stageB1' });
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

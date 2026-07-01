/**
 * T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP — Track 3 원장 백필
 *
 * 목적: 6/09 이후 원장 정지 구간에서 실제 PROD 에 반영(APPLIED)된 마이그를 원장에 소급 기록.
 *   → 원장이 현재까지 전진하게 복구. 이후 신규 apply 는 공용 helper 경유로 자동 기록(재발차단).
 *
 * 백필 대상 = Track1 진단(track1.json) verdict==='APPLIED' AND in_ledger===false 인 버전만.
 *   ▸ casualty(MISSING/DRIFT)는 백필 금지 = "PROD 미반영" 진실을 원장에 그대로 보존(Track2 apply 후 기록).
 *   ▸ UNKNOWN(순수 GRANT/REVOKE)도 백필 금지 = 객체 probe 불가 → DA grant-audit 후 별도 판정(Stage B).
 *   ▸ superseded 92a95431(20260620120000)은 애초에 APPLIED 아님 + 4ROLE 소유 → 이중 가드로 명시 제외.
 *
 * 게이트: 원장 write = PROD write → supervisor 게이트 경유. 기본 dry-run, --apply 는 게이트 통과 후에만.
 *
 * 사용:
 *   node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_track3_ledger_backfill.mjs           # dry-run
 *   node scripts/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_track3_ledger_backfill.mjs --apply    # PROD 기록(게이트 후)
 *
 * author: dev-foot / 2026-07-01
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { recordLedger, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');
const TRACK1 = join(__dirname, 'audit_out/T-20260701-foot-MIGRATION-LEDGER-DRIFT-SWEEP_track1.json');

// 이중 가드: superseded / 4ROLE 소유 = 절대 백필 금지
const NEVER_BACKFILL = new Set([
  '20260620120000', // 92a95431 staff_write_staffarea_phrases — SUPERSEDED(staffarea_write_phrases), 4ROLE 소유
  '20260701030000', // coordinator_write_staffarea — by-design gate-pending
]);

const rows = JSON.parse(readFileSync(TRACK1, 'utf8'));

// 백필 후보 = APPLIED + 아직 원장 미기록 + NEVER 목록 제외
const applied = rows.filter((r) => r.verdict === 'APPLIED');
const candidates = applied
  .filter((r) => r.in_ledger === false)
  .filter((r) => !NEVER_BACKFILL.has(r.version))
  .map((r) => ({ version: r.version, name: (r.file || '').replace(/^\d{14}_/, '').replace(/\.sql$/, '') }))
  .sort((a, b) => a.version.localeCompare(b.version));

console.log(`── Track3 원장 백필 (${APPLY ? 'APPLY' : 'DRY-RUN'}) ──`);
console.log(`APPLIED 총 ${applied.length} / 그중 원장 미기록·백필대상 ${candidates.length}`);
console.log(`제외(가드): ${[...NEVER_BACKFILL].join(', ')}`);

// 실측 원장과 대조(중복 방지 — helper 의 ON CONFLICT 로도 안전하나 사전 필터로 로그 명확화)
let ledger = new Set();
try { ledger = await ledgerVersions(); } catch (e) { console.warn('⚠ 원장 조회 실패(계속):', e.message); }
const todo = candidates.filter((c) => !ledger.has(c.version));
console.log(`원장 현재 ${ledger.size}행 → 신규 기록 예정 ${todo.length}행`);
todo.forEach((c) => console.log(`  + ${c.version}  ${c.name}`));

if (!APPLY) {
  console.log('\n[dry-run] --apply 미지정 → 원장 write 없음. supervisor 게이트 통과 후 --apply 로 실행.');
  process.exit(0);
}

let ok = 0, fail = 0;
for (const c of todo) {
  try {
    await recordLedger({ version: c.version, name: c.name, dryRun: false });
    ok++;
    console.log(`  ✓ ${c.version}`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${c.version}: ${e.message}`);
  }
}
console.log(`\n완료: 기록 ${ok} / 실패 ${fail}`);
// 사후 검증
const after = await ledgerVersions();
console.log(`원장 사후 ${after.size}행 (max=${[...after].sort().pop()})`);
process.exit(fail ? 1 : 0);

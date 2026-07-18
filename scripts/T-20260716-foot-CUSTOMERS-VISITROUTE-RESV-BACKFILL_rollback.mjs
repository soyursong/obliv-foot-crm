/**
 * T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL — ROLLBACK (APPLY 짝)
 * ────────────────────────────────────────────────────────────────────────────
 * _apply.mjs 가 남긴 _APPLY_archive.json 을 근거로 customers.visit_route 를 복원(→NULL).
 *
 * 안전 가드:
 *   - archive.rows 의 각 고객에 대해, **현재 값이 apply가 넣은 applied_value 와 정확히 같을 때만** 복원.
 *     (apply 후 스태프가 수동 변경했다면 current ≠ applied_value → 그 행은 skip = 수동입력 보호)
 *   - old_visit_route(=NULL/'') 로 되돌림.
 *   - 멱등: 이미 복원된(현재값이 applied_value 아님) 행은 자동 skip.
 *   - 원장(schema_migrations) 무접점.
 *
 * usage:
 *   node scripts/T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL_rollback.mjs --confirm-rollback [--dry]
 */
import { q } from './dryrun_lib.mjs';
import { readFileSync } from 'node:fs';

const ROOT = 'scripts/T-20260716-foot-CUSTOMERS-VISITROUTE-RESV-BACKFILL';
const args = process.argv.slice(2);
if (!args.includes('--confirm-rollback')) {
  console.error(`❌ ROLLBACK BLOCKED — 명시 확인 필요: --confirm-rollback [--dry]`);
  process.exit(64);
}
const DRY = args.includes('--dry');

const archive = JSON.parse(readFileSync(`${ROOT}_APPLY_archive.json`, 'utf8'));
if (archive.mode !== 'APPLY') {
  console.error(`⚠ archive.mode='${archive.mode}' — 실제 APPLY 스냅샷이 아님. 복원 대상 없음.`);
  process.exit(1);
}
const rows = archive.rows; // [{customer_id, old_visit_route:null, applied_value}]
console.log(`== rollback 후보 ${rows.length}건 (archive: ${archive.mode}) ==`);

// 현재값이 applied_value 와 같은 것만 복원 대상(수동변경 보호). old=NULL 이므로 → NULL 로.
let restored = 0, skipped = 0;
for (const r of rows) {
  const cur = await q(`SELECT COALESCE(visit_route,'<NULL>') v FROM customers WHERE id = '${r.customer_id}'`);
  const curVal = cur[0]?.v;
  if (curVal !== r.applied_value) { skipped++; continue; } // 수동변경/이미복원 → 보호
  if (DRY) { restored++; continue; }
  await q(`UPDATE customers SET visit_route = NULL WHERE id = '${r.customer_id}' AND visit_route = '${r.applied_value}'`);
  restored++;
}
console.log(DRY
  ? `\n== --dry: 복원 대상 ${restored}건 / 보호(수동변경·이미복원) ${skipped}건. UPDATE 미실행. ==`
  : `\n✅ ROLLBACK 완료 — ${restored}건 복원(→NULL), ${skipped}건 보호(수동변경·이미복원 skip).`);
process.exit(0);

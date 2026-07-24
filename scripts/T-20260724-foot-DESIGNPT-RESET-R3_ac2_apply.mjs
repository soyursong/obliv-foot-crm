/**
 * T-20260724-foot-DESIGNPT-RESET-R3 — AC-2 APPLY (WRITE)
 *
 * ⚠️ --confirmed 플래그 필수. 없으면 DRY(WRITE 0).
 *
 * 집행 대상 = R3 명시 열거 8 charts (designated_therapist_id → NULL).
 * 보존 = F-4507(최민지, active 박소예 5fb3e3b1).
 * 미집행(probe only) = F-4552(이민태) → inactive 중복 박소예(5c17e4bc, 7/18 dedup) 잔여.
 *   R3 명단 미열거 → SOP상 target 확장 금지. 사후 리포트로 별도 표면화.
 *
 * Cross-CRM Data-Correction 백필 SOP:
 *   - freeze셋 재검증: AC-1 스냅샷 각 id 의 designated_therapist_id 가 변동 없어야 함 (per-row drift → abort)
 *   - 스냅샷 기반 id 명시 UPDATE (전역 count-only 아님)
 *   - 롤백 SQL 자동 생성 (원값 복원)
 *   - Cross-CRM Write Rows-Affected: 영향행수 == 8 검증 (silent write-failure 금지)
 *   - 사후: clinic NOT NULL 10→2, active 박소예 지정=1(F-4507), F-4552 불변, 총건수 불변
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const ACTIVE_SOYE = '5fb3e3b1-1c5a-461b-9159-c330a52feb95'; // active 박소예
const SNAPSHOT = new URL('./T-20260724-foot-DESIGNPT-RESET-R3_snapshot.json', import.meta.url);
const ROLLBACK_OUT = new URL('./T-20260724-foot-DESIGNPT-RESET-R3_rollback.sql', import.meta.url);
const esc = (s) => String(s).replace(/'/g, "''");
const CONFIRMED = process.argv.includes('--confirmed');

async function main() {
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const frozen = snap.rows; // 8 rows {id, designated_therapist_id, chart_number,...}
  const frozenIds = frozen.map((r) => r.id);
  console.log(`===== R3 AC-2 APPLY — freeze셋 ${frozen.length}건 =====`);
  if (frozen.length !== 8) { console.error(`❌ 스냅샷 rows != 8 (=${frozen.length}) — AC-1 재실행 필요. ABORT.`); process.exit(2); }

  // 1) per-row freeze 재검증 — 스냅샷 이후 각 대상의 designated_therapist_id drift 확인
  const inList = frozenIds.map((id) => `'${esc(id)}'`).join(',');
  const cur = await q(`SELECT id, chart_number, designated_therapist_id FROM customers WHERE id IN (${inList}) ORDER BY chart_number;`);
  const curById = Object.fromEntries(cur.map((r) => [r.id, r]));
  const drifts = [];
  for (const r of frozen) {
    const c = curById[r.id];
    if (!c) { drifts.push({ chart: r.chart_number, reason: 'row_missing' }); continue; }
    if (c.designated_therapist_id !== r.designated_therapist_id) {
      drifts.push({ chart: r.chart_number, reason: 'therapist_changed', frozen: r.designated_therapist_id, current: c.designated_therapist_id });
    }
  }
  if (drifts.length) {
    console.error(`❌ FREEZE DRIFT ${drifts.length}건 — 스냅샷 이후 변동 감지. ABORT (SOP: freeze셋 재검증 abort).`);
    console.error(JSON.stringify(drifts, null, 2));
    console.error(`   AC-1 dry-run 재실행 후 재집행 필요.`);
    process.exit(2);
  }
  console.log(`✓ per-row freeze 재검증 통과 — 8건 designated_therapist_id 스냅샷과 동일`);

  // 2) 롤백 SQL 생성 (원값 복원) — 집행 前 디스크 기록
  const rollbackSql = [
    `-- ROLLBACK for T-20260724-foot-DESIGNPT-RESET-R3`,
    `-- 스냅샷 기반 원값(designated_therapist_id) 복원. ${frozen.length} rows.`,
    `BEGIN;`,
    ...frozen.map((r) => `UPDATE customers SET designated_therapist_id = '${esc(r.designated_therapist_id)}' WHERE id = '${esc(r.id)}';  -- ${r.chart_number} ${r.name} → ${r.therapist_name}`),
    `COMMIT;`,
    ``,
  ].join('\n');
  writeFileSync(ROLLBACK_OUT, rollbackSql);
  console.log(`✓ 롤백 SQL 기록: ${ROLLBACK_OUT.pathname} (${frozen.length} 복원문)`);

  if (!CONFIRMED) {
    console.log(`\n⏸  --confirmed 없음 → DRY (WRITE 0). freeze검증/롤백문만 준비 완료.`);
    return;
  }

  // 3) 집행 — freeze셋 id 명시 UPDATE (전역 predicate 아님)
  const beforeTotal = (await q(`SELECT count(*)::int AS n FROM customers WHERE clinic_id='${CLINIC}';`))[0].n;
  const beforeAssigned = (await q(`SELECT count(*)::int AS n FROM customers WHERE clinic_id='${CLINIC}' AND designated_therapist_id IS NOT NULL;`))[0].n;
  const res = await q(`UPDATE customers SET designated_therapist_id = NULL WHERE id IN (${inList}) AND designated_therapist_id IS NOT NULL RETURNING chart_number;`);
  const affected = Array.isArray(res) ? res.length : 0;
  console.log(`\n✓ UPDATE 집행 — 영향행수=${affected}, 해제된 차트: ${res.map((r) => r.chart_number).join(', ')}`);

  // Cross-CRM Write Rows-Affected 검증 (silent write-failure 금지)
  if (affected !== 8) {
    console.error(`❌ 영향행수 ${affected} != 8 — silent write-failure/부분집행 의심. 롤백 SQL로 원복 필요.`);
    process.exit(3);
  }

  // 4) 사후 검증
  const afterTotal = (await q(`SELECT count(*)::int AS n FROM customers WHERE clinic_id='${CLINIC}';`))[0].n;
  const afterAssigned = (await q(`SELECT count(*)::int AS n FROM customers WHERE clinic_id='${CLINIC}' AND designated_therapist_id IS NOT NULL;`))[0].n;
  const soyeActive = await q(`SELECT chart_number, name FROM customers WHERE clinic_id='${CLINIC}' AND designated_therapist_id='${ACTIVE_SOYE}' ORDER BY chart_number;`);
  const remainAssigned = await q(`SELECT c.chart_number, c.name AS patient, s.name AS therapist, s.active
     FROM customers c LEFT JOIN staff s ON s.id=c.designated_therapist_id
     WHERE c.clinic_id='${CLINIC}' AND c.designated_therapist_id IS NOT NULL ORDER BY c.chart_number;`);

  console.log(`\n===== 사후 검증 =====`);
  console.log(`  customers 총건수: ${beforeTotal} → ${afterTotal} (기대=불변, DELETE 아님)`);
  console.log(`  지정배정 NOT NULL: ${beforeAssigned} → ${afterAssigned} (기대=10→2)`);
  console.log(`  active 박소예(${ACTIVE_SOYE}) 지정건: ${soyeActive.length}건 [${soyeActive.map((r) => r.chart_number + ' ' + r.name).join(', ')}] (기대=1, F-4507)`);
  console.log(`  잔존 지정배정 전체:`);
  for (const r of remainAssigned) console.log(`    - ${r.chart_number} ${r.patient} → ${r.therapist} (staff active=${r.active})`);

  const okTotal = beforeTotal === afterTotal;
  const okSoye = soyeActive.length === 1 && soyeActive[0].chart_number === 'F-4507';
  if (!okTotal) { console.error('❌ 총건수 변동 — 검증 실패'); process.exit(4); }
  if (!okSoye) { console.error('❌ active 박소예 지정 != {F-4507} — 검증 실패'); process.exit(5); }
  console.log(`\n✅ R3 AC-2 완료: 8건 지정치료사 해제, active 박소예=F-4507 1건 보존, 총건수 불변, 롤백문 준비됨.`);
  console.log(`   ⚠ F-4552(이민태)는 inactive 중복 박소예(5c17e4bc, 7/18 dedup) 잔여 — R3 명단 미열거로 미집행. 별도 표면화.`);
}
main().catch((e) => { console.error(e); process.exit(1); });

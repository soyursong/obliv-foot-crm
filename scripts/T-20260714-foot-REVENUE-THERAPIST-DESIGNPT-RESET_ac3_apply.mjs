/**
 * T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET — AC-3 APPLY (WRITE)
 *
 * ⚠️ AC-2 confirm(김주연 총괄 대상범위 승인) 이후에만 실행. --confirmed 플래그 필수.
 *
 * Cross-CRM Data-Correction 백필 SOP:
 *   - freeze셋 재검증: AC-1 스냅샷 대상 == 현재 NOT NULL 대상 (drift 시 abort)
 *   - 스냅샷 기반 UPDATE (전역 count-only UPDATE 아님 — id 명시로 freeze셋만 정정)
 *   - 롤백 SQL 자동 생성 (원값 복원문)
 *   - 사후 무결성 검증: NOT NULL = 0, customers 총건수 불변
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

const SNAPSHOT = new URL('./T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET_snapshot.json', import.meta.url);
const ROLLBACK_OUT = new URL('./T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET_rollback.sql', import.meta.url);

const esc = (s) => String(s).replace(/'/g, "''");
const CONFIRMED = process.argv.includes('--confirmed');

async function main() {
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const frozenIds = snap.rows.map((r) => r.id);
  console.log(`===== AC-3 APPLY — freeze셋 ${frozenIds.length}건 =====`);

  // 1) freeze셋 재검증 — 스냅샷 이후 drift 확인
  const cur = await q(`SELECT id, designated_therapist_id FROM customers WHERE designated_therapist_id IS NOT NULL ORDER BY id;`);
  const curIds = cur.map((r) => r.id).sort();
  const snapIds = [...frozenIds].sort();
  const drift = curIds.length !== snapIds.length || curIds.some((v, i) => v !== snapIds[i]);
  if (drift) {
    console.error(`❌ FREEZE DRIFT: 스냅샷=${snapIds.length}건, 현재 NOT NULL=${curIds.length}건 — 데이터 변동 감지. ABORT.`);
    console.error(`   AC-1 dry-run 재실행 후 재confirm 필요 (SOP: freeze셋 재검증 abort).`);
    process.exit(2);
  }
  console.log(`✓ freeze 재검증 통과 — 스냅샷 대상 == 현재 NOT NULL 대상 (${curIds.length}건)`);

  // 2) 롤백 SQL 생성 (원값 복원) — 집행 前 반드시 디스크 기록
  const rollbackSql = [
    `-- ROLLBACK for T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET`,
    `-- 스냅샷 기반 원값(designated_therapist_id) 복원. ${snap.rows.length} rows.`,
    `BEGIN;`,
    ...snap.rows.map((r) => `UPDATE customers SET designated_therapist_id = '${esc(r.designated_therapist_id)}' WHERE id = '${esc(r.id)}';`),
    `COMMIT;`,
    ``,
  ].join('\n');
  writeFileSync(ROLLBACK_OUT, rollbackSql);
  console.log(`✓ 롤백 SQL 기록: ${ROLLBACK_OUT.pathname} (${snap.rows.length} 복원문)`);

  if (!CONFIRMED) {
    console.log(`\n⏸  --confirmed 없음 → DRY (WRITE 미실행). 롤백문/freeze검증만 준비 완료.`);
    console.log(`   AC-2 confirm 수신 후: node ${new URL(import.meta.url).pathname.split('/').pop()} --confirmed`);
    return;
  }

  // 3) UPDATE 집행 — freeze셋 id 명시 (전역 predicate 아님)
  const before = (await q(`SELECT count(*)::int AS n FROM customers;`))[0].n;
  const inList = frozenIds.map((id) => `'${esc(id)}'`).join(',');
  const res = await q(`UPDATE customers SET designated_therapist_id = NULL WHERE id IN (${inList}) AND designated_therapist_id IS NOT NULL;`);
  console.log(`\n✓ UPDATE 집행 완료`, JSON.stringify(res));

  // 4) 사후 무결성 검증
  const remain = (await q(`SELECT count(*)::int AS n FROM customers WHERE designated_therapist_id IS NOT NULL;`))[0].n;
  const after = (await q(`SELECT count(*)::int AS n FROM customers;`))[0].n;
  console.log(`\n===== 사후 검증 =====`);
  console.log(`  designated_therapist_id NOT NULL 잔존: ${remain}건 (기대=0)`);
  console.log(`  customers 총건수: ${before} → ${after} (기대=불변, DELETE 아님)`);
  if (remain !== 0) { console.error('❌ 잔존 NOT NULL 발생 — 검증 실패'); process.exit(3); }
  if (before !== after) { console.error('❌ 총건수 변동 — 검증 실패'); process.exit(4); }
  console.log(`\n✅ AC-3 완료: 13건 지정정보 비움, 잔존 0, 총건수 불변. 롤백문 준비됨.`);
}
main().catch((e) => { console.error(e); process.exit(1); });

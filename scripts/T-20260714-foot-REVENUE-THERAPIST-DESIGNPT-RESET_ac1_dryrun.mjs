/**
 * T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET — AC-1 (DRY-RUN, READ-ONLY)
 *
 * 목적: 매출집계 > 담당치료사별 [지정환자수] 리셋 前 안전 실행 게이트.
 *   대상: customers.designated_therapist_id NOT NULL 전량 → NULL (김주연 총괄 확정 SQL)
 *   현장 SQL(참고): UPDATE customers SET designated_therapist_id = NULL
 *                    WHERE designated_therapist_id IS NOT NULL;
 *
 * Cross-CRM Data-Correction 백필 SOP 준수:
 *   - 단일 count 기준 UPDATE 금지 → 대상 row 전량 enumerate + freeze
 *   - 사전 스냅샷(id + designated_therapist_id) 저장 = 롤백 근거
 *   - dry-run count + 판정근거(치료사별·clinic별 분포) 스냅샷
 *
 * *** 이 스크립트는 SELECT 만. WRITE 0. ***
 *
 * FE 매핑 확인(dev-foot): src/components/sales/SalesStaffTab.tsx designatedMap
 *   = customers.select('designated_therapist_id').eq(clinic_id).not(...is null)
 *     → group by → count. 전량 NULL 시 map 공백 → 전 치료사 designatedCount=0.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

const OUT_SNAPSHOT = new URL('./T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET_snapshot.json', import.meta.url);
const OUT_REPORT = new URL('./T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET_DRYRUN_REPORT.md', import.meta.url);

const esc = (s) => String(s).replace(/'/g, "''");

async function main() {
  console.log('===== AC-1 DRY-RUN (READ-ONLY): 지정환자수 리셋 대상셋 freeze =====');

  // 1) 대상 row 전량 enumerate (freeze) — 스냅샷/롤백 근거
  const rows = await q(`
    SELECT id, designated_therapist_id, clinic_id
    FROM customers
    WHERE designated_therapist_id IS NOT NULL
    ORDER BY id;
  `);
  const total = rows.length;
  console.log(`\n[dry-run count] designated_therapist_id IS NOT NULL 대상 row = ${total}건 → 전량 NULL 예정`);

  // 2) 치료사별 분포 (headcount) — 확정 대상 판정근거
  const byTherapist = {};
  const byClinic = {};
  for (const r of rows) {
    byTherapist[r.designated_therapist_id] = (byTherapist[r.designated_therapist_id] ?? 0) + 1;
    byClinic[r.clinic_id ?? 'NULL'] = (byClinic[r.clinic_id ?? 'NULL'] ?? 0) + 1;
  }
  const therapistIds = Object.keys(byTherapist);

  // 3) 치료사 이름 resolve (staff)
  let staffMap = {};
  if (therapistIds.length) {
    const inList = therapistIds.map((id) => `'${esc(id)}'`).join(',');
    const staff = await q(`SELECT id, name, role, active FROM staff WHERE id IN (${inList});`);
    for (const s of staff) staffMap[s.id] = s;
  }

  console.log(`\n[치료사별 지정환자수 분포] 대상 치료사 = ${therapistIds.length}명`);
  const therapistSummary = therapistIds
    .map((id) => ({
      therapist_id: id,
      name: staffMap[id]?.name ?? '(staff 행 없음/비활성)',
      role: staffMap[id]?.role ?? null,
      active: staffMap[id]?.active ?? null,
      designated_count: byTherapist[id],
    }))
    .sort((a, b) => b.designated_count - a.designated_count);
  for (const t of therapistSummary) {
    console.log(`  - ${t.name} (id=${String(t.therapist_id).slice(0, 8)}, role=${t.role}, active=${t.active}) : ${t.designated_count}명`);
  }

  console.log(`\n[clinic_id별 분포] (참고 — foot 단일지점 확인용)`);
  for (const [cid, n] of Object.entries(byClinic)) {
    console.log(`  - clinic_id=${cid} : ${n}건`);
  }

  // 4) 스냅샷 저장 (롤백용) — id + 정정 전 designated_therapist_id
  const snapshot = {
    ticket: 'T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET',
    ac: 'AC-1',
    captured_by: 'agent-fdd-dev-foot',
    target_predicate: 'customers.designated_therapist_id IS NOT NULL',
    dry_run_count: total,
    distinct_therapists: therapistIds.length,
    by_clinic: byClinic,
    rows: rows.map((r) => ({ id: r.id, designated_therapist_id: r.designated_therapist_id })),
  };
  writeFileSync(OUT_SNAPSHOT, JSON.stringify(snapshot, null, 2));
  console.log(`\n[스냅샷 저장] ${OUT_SNAPSHOT.pathname} (${total} rows, 롤백 근거)`);

  // 5) 인접 집계 컬럼 회귀 baseline (AC-4 대조용) — customers 다른 필드 무접점 확인
  const [{ n: custTotal }] = await q(`SELECT count(*)::int AS n FROM customers;`);
  console.log(`\n[baseline] customers 전체 = ${custTotal}건 (UPDATE 후 총건수 불변 확인용)`);

  // 6) 확인용 리포트 md 생성
  const report = `# T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET — AC-1 DRY-RUN REPORT

- captured_by: agent-fdd-dev-foot
- target: \`customers.designated_therapist_id IS NOT NULL\` → \`NULL\`
- **dry-run count (변경 대상 row): ${total}건**
- distinct 치료사(지정 보유): ${therapistIds.length}명
- customers 전체: ${custTotal}건 (UPDATE 후 총건수 불변 예정 — DELETE 아님, SET NULL)
- clinic_id 분포: ${JSON.stringify(byClinic)}
- 스냅샷(롤백근거): scripts/T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET_snapshot.json (${total} rows)

## 치료사별 현재 지정환자수 (초기화 시 전원 0)
| 치료사 | role | active | 지정환자수 |
|--------|------|--------|-----------|
${therapistSummary.map((t) => `| ${t.name} | ${t.role ?? '-'} | ${t.active ?? '-'} | ${t.designated_count} |`).join('\n')}

## 실행 계획 (AC-3, confirm 후)
\`\`\`sql
UPDATE customers SET designated_therapist_id = NULL WHERE designated_therapist_id IS NOT NULL;
-- expected affected rows = ${total}
\`\`\`

## 롤백 SQL (스냅샷 기반 복원)
\`\`\`sql
-- snapshot.json rows 각각에 대해:
-- UPDATE customers SET designated_therapist_id = '<orig>' WHERE id = '<id>';
-- (apply 스크립트가 스냅샷에서 자동 생성)
\`\`\`
`;
  writeFileSync(OUT_REPORT, report);
  console.log(`[리포트 저장] ${OUT_REPORT.pathname}`);

  console.log('\n===== AC-1 요약 (AC-2 confirm용) =====');
  console.log(JSON.stringify({
    dry_run_count: total,
    distinct_therapists: therapistIds.length,
    customers_total: custTotal,
    by_clinic: byClinic,
    top_examples: therapistSummary.slice(0, 5).map((t) => `${t.name}:${t.designated_count}명`),
  }, null, 2));
  console.log('===== END AC-1 (WRITE 0) =====');
}
main().catch((e) => { console.error(e); process.exit(1); });

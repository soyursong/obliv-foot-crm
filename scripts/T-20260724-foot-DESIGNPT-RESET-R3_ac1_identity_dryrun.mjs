/**
 * T-20260724-foot-DESIGNPT-RESET-R3 — AC-1 READ-ONLY 신원조회 + dry-run + freeze
 *
 * ⚠️ READ-ONLY — SELECT 만. UPDATE/DELETE/ALTER 일절 없음.
 *
 * R2(T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2)가 AC-1b(c) divergence 게이트로 pause:
 *   clinic 지정배정 실측 10건 (reporter 전제 6건 아님) — 명단 밖 4건:
 *   F-4552(박소예 2번째), F-4702/F-4849(최다혜), F-5055(서은정).
 * R3 요청은 R2의 5건 + 3 outsider(F-4702/F-4849/F-5055) 를 해제 명단에 추가.
 *   → 열거된 해제 대상 = 8 charts. F-4552(박소예 2번째)는 명단에 없음.
 *
 * ⚠️ R3 요청 내부 불일치 (파괴 前 반드시 확인):
 *   - 헤더 "9건" vs 실제 열거 8 charts (1건 미열거)
 *   - 검증 요구 "박소예 1건만 남음" vs R2 실측 박소예 2건(F-4507 + F-4552)
 *   - 10 = 8(열거해제) + 1(F-4507 보존) + 1(F-4552 미열거) 로 정확히 재구성됨
 *   → "9건/1건만" 신호는 F-4552(박소예 2번째)도 해제 의도일 가능성이 큼.
 *     그러나 F-4552는 해제 명단에 명시 열거 안 됨 → SOP상 target 확장 금지.
 *
 * Cross-CRM Data-Correction 백필 SOP:
 *   - 대상셋 freeze (전역 count-only UPDATE 금지 — chart_number IN 명시)
 *   - 신원 실측 대조 + F-4507 박소예 보존 매핑 확인
 *   - F-4552 상태 명시 probe (박소예 2번째) → divergence 입력
 *   - dry-run count + freeze 스냅샷 JSON
 *
 * 실행: node scripts/T-20260724-foot-DESIGNPT-RESET-R3_ac1_identity_dryrun.mjs
 */
import { writeFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SNAPSHOT_OUT = new URL('./T-20260724-foot-DESIGNPT-RESET-R3_snapshot.json', import.meta.url);
const esc = (s) => String(s).replace(/'/g, "''");

// R3 reporter 명시 열거 — 해제 대상 (designated_therapist_id → NULL)
const TARGETS = [
  { chart: 'F-4680', patient: '전지혜', therapist: '최다혜' },
  { chart: 'F-4849', patient: '이원준', therapist: '최다혜' },
  { chart: 'F-4815', patient: '최재영', therapist: '최다혜' },
  { chart: 'F-4702', patient: '이재성', therapist: '최다혜' },
  { chart: 'F-4808', patient: '김문재', therapist: '서은정' },
  { chart: 'F-5055', patient: '조재훈', therapist: '서은정' },
  { chart: 'F-1089', patient: '김상곤', therapist: '최민지' },
  { chart: 'F-4696', patient: '허유희', therapist: '조선미' },
];
// 보존 (절대 건드리지 말 것)
const PRESERVE = { chart: 'F-4507', patient: '최민지', therapist: '박소예' };
// R2가 flag 한 박소예 2번째 — R3 명단에 없음. 상태만 probe (건드리지 않음).
const WATCH = { chart: 'F-4552', note: '박소예 2번째(R2 flag). R3 해제 명단 미포함 → probe only.' };

const chartList = [...TARGETS.map((t) => t.chart), PRESERVE.chart, WATCH.chart].map((c) => `'${esc(c)}'`).join(',');

async function main() {
  console.log('===== R3 AC-1 READ-ONLY 신원조회 + dry-run (WRITE 0) =====');
  console.log(`clinic_id=${CLINIC}`);

  const custs = await q(
    `SELECT id, name, chart_number, designated_therapist_id, updated_at
       FROM customers
      WHERE clinic_id = '${CLINIC}' AND chart_number IN (${chartList})
      ORDER BY chart_number;`,
  );

  const tids = [...new Set(custs.map((c) => c.designated_therapist_id).filter(Boolean))];
  let staffMap = {};
  if (tids.length) {
    const inS = tids.map((id) => `'${esc(id)}'`).join(',');
    const staff = await q(`SELECT id, name FROM staff WHERE id IN (${inS});`);
    staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  }
  const byChart = Object.fromEntries(custs.map((c) => [c.chart_number, c]));

  console.log('\n--- 해제 대상 8건 대조 (R3 명시 열거) ---');
  const divergences = [];
  const frozen = [];
  for (const t of TARGETS) {
    const c = byChart[t.chart];
    if (!c) {
      console.log(`  ❌ ${t.chart} (${t.patient}) — 부재`);
      divergences.push({ type: 'target_missing', chart: t.chart });
      continue;
    }
    const tname = staffMap[c.designated_therapist_id] || '(null/미배정)';
    const isNull = !c.designated_therapist_id;
    const match = tname === t.therapist;
    console.log(
      `  ${isNull ? '⚠ (이미 NULL)' : match ? '✓' : '❌ 불일치'} ${t.chart} 환자=${c.name} 기대치료사=${t.therapist} 실측치료사=${tname}`,
    );
    if (isNull) {
      divergences.push({ type: 'already_null', chart: t.chart, note: 'no-op' });
    } else if (!match) {
      divergences.push({ type: 'target_therapist_mismatch', chart: t.chart, expected: t.therapist, actual: tname });
    } else {
      frozen.push({
        id: c.id, name: c.name, chart_number: c.chart_number,
        designated_therapist_id: c.designated_therapist_id, therapist_name: tname, updated_at: c.updated_at,
      });
    }
  }

  console.log('\n--- 보존 F-4507 (박소예) 확인 ---');
  const pc = byChart[PRESERVE.chart];
  let preserveInfo = null;
  if (!pc) {
    console.log(`  ❌ ${PRESERVE.chart} — 부재 (divergence)`);
    divergences.push({ type: 'preserve_missing', chart: PRESERVE.chart });
  } else {
    const ptn = staffMap[pc.designated_therapist_id] || '(null/미배정)';
    const ok = ptn === PRESERVE.therapist;
    console.log(`  ${ok ? '✓' : '❌'} ${PRESERVE.chart} 환자=${pc.name} 기대=${PRESERVE.therapist} 실측=${ptn}`);
    preserveInfo = { chart: PRESERVE.chart, id: pc.id, name: pc.name, therapist_name: ptn, ok };
    if (!ok) divergences.push({ type: 'preserve_therapist_mismatch', chart: PRESERVE.chart, expected: PRESERVE.therapist, actual: ptn });
  }

  console.log('\n--- WATCH F-4552 (박소예 2번째, R3 명단 미포함) probe ---');
  const wc = byChart[WATCH.chart];
  let watchInfo = null;
  if (!wc) {
    console.log(`  · ${WATCH.chart} — 부재 (이미 해제됐거나 삭제됨)`);
    watchInfo = { chart: WATCH.chart, present: false };
  } else {
    const wtn = staffMap[wc.designated_therapist_id] || '(null/미배정)';
    console.log(`  · ${WATCH.chart} 환자=${wc.name} 실측치료사=${wtn} — R3 명단에 없어 미집행(probe only)`);
    watchInfo = { chart: WATCH.chart, present: true, id: wc.id, name: wc.name, therapist_name: wtn, designated: !!wc.designated_therapist_id };
  }

  // 명단(9 charts=8해제+F-4507보존, F-4552는 watch) 밖 신규 지정배정 탐지
  console.log('\n--- 명단 밖 신규 지정배정 탐지 (AC-1b(c)) ---');
  const allAssigned = await q(
    `SELECT chart_number FROM customers
      WHERE clinic_id = '${CLINIC}' AND designated_therapist_id IS NOT NULL
      ORDER BY chart_number;`,
  );
  const known = new Set([...TARGETS.map((t) => t.chart), PRESERVE.chart, WATCH.chart]);
  const outsiders = allAssigned.map((r) => r.chart_number).filter((cn) => !known.has(cn));
  console.log(`  clinic 전체 지정배정(NOT NULL) 실측: ${allAssigned.length}건`);
  console.log(`  전체 목록: ${allAssigned.map((r) => r.chart_number).join(', ')}`);
  if (outsiders.length) {
    console.log(`  ⚠ 명단(9) 밖 신규 지정배정 ${outsiders.length}건: ${outsiders.join(', ')}`);
    divergences.push({ type: 'outsider_assignment', charts: outsiders });
  } else {
    console.log(`  ✓ 명단 밖 신규 지정배정 없음`);
  }

  const dryCount = frozen.length;
  console.log(`\n===== dry-run count = ${dryCount} (R3 열거 해제=8) =====`);

  // 사후상태 예측: 8 해제 후 박소예에게 남는 지정건
  const postPreserveCharts = [];
  if (preserveInfo?.ok) postPreserveCharts.push('F-4507');
  if (watchInfo?.present && watchInfo?.designated && watchInfo?.therapist_name === '박소예') postPreserveCharts.push('F-4552');

  const snapshot = {
    ticket: 'T-20260724-foot-DESIGNPT-RESET-R3',
    ref_ticket: 'T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET',
    clinic_id: CLINIC,
    captured_at_note: 'AC-1 freeze — apply가 재검증',
    r3_header_claimed_count: 9,
    r3_enumerated_targets: TARGETS.length,
    dry_run_count: dryCount,
    preserve: preserveInfo,
    watch_f4552: watchInfo,
    clinic_total_assigned: allAssigned.length,
    clinic_all_charts: allAssigned.map((r) => r.chart_number),
    outsiders,
    divergences,
    post_state_prediction: {
      note: '8건 명시열거 해제 후 박소예 잔여 지정건',
      remaining_assigned_charts_after_8: postPreserveCharts,
      matches_reporter_expectation_1: postPreserveCharts.length === 1,
    },
    rows: frozen,
  };
  writeFileSync(SNAPSHOT_OUT, JSON.stringify(snapshot, null, 2));
  console.log(`\n✓ freeze 스냅샷 기록: ${SNAPSHOT_OUT.pathname} (${frozen.length} rows)`);

  console.log('\n===== 판정 요약 =====');
  console.log(`  R3 헤더 "9건" vs 열거 8건 → 1건 미열거`);
  console.log(`  8건 해제 후 박소예 잔여 = ${postPreserveCharts.length}건 [${postPreserveCharts.join(', ')}]`);
  console.log(`  reporter 검증요구 "박소예 1건만 남음" 충족 = ${postPreserveCharts.length === 1}`);
  if (postPreserveCharts.length !== 1) {
    console.log(`  ⚠ F-4552(박소예 2번째)가 살아있어 8건만 해제 시 박소예 2건 잔존.`);
    console.log(`    → F-4552 해제 여부는 명시 열거 밖 → 확인 필요 (silent 확장 금지).`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

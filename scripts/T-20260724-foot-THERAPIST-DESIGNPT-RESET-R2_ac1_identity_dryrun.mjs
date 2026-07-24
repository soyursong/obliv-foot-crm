/**
 * T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2 — AC-1 READ-ONLY 신원조회 + dry-run + freeze
 *
 * ⚠️ READ-ONLY — SELECT 만. UPDATE/DELETE/ALTER 일절 없음.
 *
 * R1(T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET) 테스트 churn 재발본.
 * R1은 전량 리셋이었으나 R2는 박소예 담당 F-4507 1건 보존 + 나머지 5건만 SET NULL.
 *
 * Cross-CRM Data-Correction 백필 SOP:
 *   - 대상셋 freeze (전역 count-only UPDATE 금지 — chart_number IN 명시)
 *   - 신원 실측 대조: 5개 차트 실재 + 담당치료사 매핑 + F-4507 박소예 매핑
 *   - dry-run count(=5 기대)
 *   - 명단 밖 신규 지정배정 탐지(AC-1b(c) divergence 게이트 입력)
 *   - freeze 스냅샷 JSON 기록 → AC-2 apply가 재검증
 *
 * 실행: node scripts/T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2_ac1_identity_dryrun.mjs
 */
import { writeFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const SNAPSHOT_OUT = new URL('./T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2_snapshot.json', import.meta.url);
const esc = (s) => String(s).replace(/'/g, "''");

// reporter 명시 열거 — 해제 5건 (designated_therapist_id → NULL)
const TARGETS = [
  { chart: 'F-1089', patient: '김상곤', therapist: '최민지' },
  { chart: 'F-4808', patient: '김문재', therapist: '서은정' },
  { chart: 'F-4680', patient: '전지혜', therapist: '최다혜' },
  { chart: 'F-4815', patient: '최재영', therapist: '최다혜' },
  { chart: 'F-4696', patient: '허유희', therapist: '조선미' },
];
// 보존 (건드리지 말 것)
const PRESERVE = { chart: 'F-4507', patient: '최민지', therapist: '박소예' };

const chartList = [...TARGETS.map((t) => t.chart), PRESERVE.chart].map((c) => `'${esc(c)}'`).join(',');

async function main() {
  console.log('===== AC-1 READ-ONLY 신원조회 + dry-run (WRITE 0) =====');
  console.log(`clinic_id=${CLINIC}`);

  // 1) 대상 + 보존 차트 신원 조회 (READ-ONLY)
  const custs = await q(
    `SELECT id, name, chart_number, designated_therapist_id, updated_at
       FROM customers
      WHERE clinic_id = '${CLINIC}' AND chart_number IN (${chartList})
      ORDER BY chart_number;`,
  );

  // 2) therapist(staff) 이름 조인
  const tids = [...new Set(custs.map((c) => c.designated_therapist_id).filter(Boolean))];
  let staffMap = {};
  if (tids.length) {
    const inS = tids.map((id) => `'${esc(id)}'`).join(',');
    const staff = await q(`SELECT id, name FROM staff WHERE id IN (${inS});`);
    staffMap = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  }

  const byChart = Object.fromEntries(custs.map((c) => [c.chart_number, c]));

  // 3) 대상 5건 실재 + 매핑 대조
  console.log('\n--- 해제 대상 5건 대조 ---');
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
      // 단순 no-op — 파괴적 아님, 로그만
      divergences.push({ type: 'already_null', chart: t.chart, note: 'no-op(집행 잔여만)' });
    } else if (!match) {
      divergences.push({ type: 'target_therapist_mismatch', chart: t.chart, expected: t.therapist, actual: tname });
    } else {
      frozen.push({
        id: c.id,
        name: c.name,
        chart_number: c.chart_number,
        designated_therapist_id: c.designated_therapist_id,
        therapist_name: tname,
        updated_at: c.updated_at,
      });
    }
  }

  // 4) 보존 F-4507 박소예 매핑 확인
  console.log('\n--- 보존 F-4507 (박소예) 확인 ---');
  const pc = byChart[PRESERVE.chart];
  if (!pc) {
    console.log(`  ❌ ${PRESERVE.chart} — 부재 (AC-1b(b) divergence)`);
    divergences.push({ type: 'preserve_missing', chart: PRESERVE.chart });
  } else {
    const ptn = staffMap[pc.designated_therapist_id] || '(null/미배정)';
    const ok = ptn === PRESERVE.therapist;
    console.log(`  ${ok ? '✓' : '❌'} ${PRESERVE.chart} 환자=${pc.name} 기대치료사=${PRESERVE.therapist} 실측치료사=${ptn}`);
    if (!ok) divergences.push({ type: 'preserve_therapist_mismatch', chart: PRESERVE.chart, expected: PRESERVE.therapist, actual: ptn });
  }

  // 5) 명단 밖 신규 지정배정 탐지 (AC-1b(c)) — clinic 전량 NOT NULL vs 명단(6 charts)
  console.log('\n--- 명단 밖 신규 지정배정 탐지 (AC-1b(c)) ---');
  const allAssigned = await q(
    `SELECT chart_number FROM customers
      WHERE clinic_id = '${CLINIC}' AND designated_therapist_id IS NOT NULL
      ORDER BY chart_number;`,
  );
  const known = new Set([...TARGETS.map((t) => t.chart), PRESERVE.chart]);
  const outsiders = allAssigned.map((r) => r.chart_number).filter((cn) => !known.has(cn));
  console.log(`  clinic 전체 지정배정(NOT NULL) 실측: ${allAssigned.length}건`);
  if (outsiders.length) {
    console.log(`  ⚠ 명단 밖 신규 지정배정 ${outsiders.length}건: ${outsiders.join(', ')}`);
    divergences.push({ type: 'outsider_assignment', charts: outsiders });
  } else {
    console.log(`  ✓ 명단(6건) 밖 신규 지정배정 없음`);
  }

  // 6) dry-run count (=5 기대)
  const dryCount = frozen.length;
  console.log(`\n===== dry-run count = ${dryCount} (기대=5) =====`);

  // 7) freeze 스냅샷 기록
  const snapshot = {
    ticket: 'T-20260724-foot-THERAPIST-DESIGNPT-RESET-R2',
    clinic_id: CLINIC,
    captured_at_note: 'AC-1 freeze — apply가 재검증',
    expected_release_count: 5,
    preserve: pc
      ? { chart_number: PRESERVE.chart, id: pc.id, name: pc.name, designated_therapist_id: pc.designated_therapist_id }
      : null,
    clinic_total_assigned: allAssigned.length,
    outsiders,
    divergences,
    rows: frozen,
  };
  writeFileSync(SNAPSHOT_OUT, JSON.stringify(snapshot, null, 2));
  console.log(`✓ freeze 스냅샷 기록: ${SNAPSHOT_OUT.pathname} (${frozen.length} rows)`);

  // 8) 게이트 판정
  console.log('\n===== AC-1b divergence 게이트 판정 =====');
  const blocking = divergences.filter((d) => d.type !== 'already_null');
  if (blocking.length) {
    console.log('❌ BLOCKING divergence 발견 — 파괴적 UPDATE 前 pause + planner 경유 재확인 필요:');
    console.log(JSON.stringify(blocking, null, 2));
    process.exit(2);
  }
  if (dryCount !== 5) {
    const nullNoops = divergences.filter((d) => d.type === 'already_null');
    console.log(`⚠ dry-run count=${dryCount} ≠ 5. no-op(이미 NULL) ${nullNoops.length}건 감안. 잔여만 집행 가능.`);
  }
  console.log(`✅ AC-1 통과 — freeze ${frozen.length}건 준비 완료. AC-2 apply --confirmed 진행 가능.`);
}
main().catch((e) => { console.error(e); process.exit(1); });

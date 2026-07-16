/**
 * T-20260714-foot-REVENUE-THERAPIST-DESIGNPT-RESET — RE-VERIFY (READ-ONLY, WRITE 0)
 *
 * 맥락: 2026-07-16 02:52 dev-foot이 AC-3 집행 直前 freeze 재검증 FAIL로 ABORT.
 *   큐에 남은 NEW-TASK(MSG-...194738, 07-15 19:47)는 abort 이전 지시 → stale 가능.
 *   파괴적 UPDATE 전에 SOP가 요구하는 (a)F-4507 매핑 실측 (b)freeze 재확정
 *   (c)df380b13 신원조회 를 live prod에서 다시 실측하고, 상태가 abort 시점과
 *   동일하면 집행 금지 + planner 반환.
 *
 * *** SELECT only. WRITE 0. ***
 */
import { q } from './dryrun_lib.mjs';

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

async function main() {
  console.log('===== RE-VERIFY (READ-ONLY) 2026-07-16 =====\n');

  // 1) clinic 전체 designated_therapist_id NOT NULL 대상셋 (freeze 재확정)
  const rows = await q(`
    SELECT c.id, c.chart_number, c.name AS customer_name,
           c.designated_therapist_id, s.name AS therapist_name,
           c.updated_at
    FROM customers c
    LEFT JOIN staff s ON c.designated_therapist_id = s.id
    WHERE c.designated_therapist_id IS NOT NULL
      AND c.clinic_id = '${CLINIC}'
    ORDER BY s.name, c.chart_number;
  `);
  console.log(`[freeze 재확정] clinic ${CLINIC} 내 designated_therapist_id NOT NULL = ${rows.length}건`);
  for (const r of rows) {
    console.log(`  - chart=${r.chart_number} | cust=${r.customer_name} | therapist=${r.therapist_name} (${r.designated_therapist_id}) | cust_id=${r.id} | updated=${r.updated_at}`);
  }

  // 2) F-4507 매핑 실측 검증 (총괄: F-4507 → 박소예 보존)
  console.log('\n[F-4507 매핑 실측]');
  const f4507 = await q(`
    SELECT c.id, c.chart_number, c.name AS customer_name,
           c.designated_therapist_id, s.name AS therapist_name, c.clinic_id
    FROM customers c
    LEFT JOIN staff s ON c.designated_therapist_id = s.id
    WHERE c.chart_number = 'F-4507';
  `);
  if (f4507.length === 0) {
    console.log('  ⚠ F-4507 존재하지 않음 (또는 designated_therapist_id 확인 필요)');
  } else {
    for (const r of f4507) {
      console.log(`  - chart=${r.chart_number} | cust=${r.customer_name} | designated_therapist_id=${r.designated_therapist_id} | therapist=${r.therapist_name} | clinic=${r.clinic_id}`);
    }
  }

  // 3) df380b13 신원조회 (abort 시점 freeze셋 밖 신규 1건)
  console.log('\n[df380b13 신원조회 — abort 시점 신규건]');
  const df = await q(`
    SELECT c.id, c.chart_number, c.name AS customer_name,
           c.designated_therapist_id, s.name AS therapist_name,
           c.clinic_id, c.created_at, c.updated_at
    FROM customers c
    LEFT JOIN staff s ON c.designated_therapist_id = s.id
    WHERE c.id = 'df380b13-c069-450a-99a3-2c5bd4d1f17b';
  `);
  if (df.length === 0) {
    console.log('  df380b13 없음 (삭제되었거나 id 변경).');
  } else {
    for (const r of df) {
      console.log(`  - cust_id=${r.id} | chart=${r.chart_number} | cust=${r.customer_name} | designated=${r.designated_therapist_id} | therapist=${r.therapist_name} | clinic=${r.clinic_id} | created=${r.created_at} | updated=${r.updated_at}`);
    }
  }

  // 4) customers 총건수 (churn 관측)
  const totalRes = await q(`SELECT count(*)::int AS n FROM customers WHERE clinic_id='${CLINIC}';`);
  const totalAll = await q(`SELECT count(*)::int AS n FROM customers;`);
  console.log(`\n[총건수] customers(clinic)=${totalRes[0].n} | customers(all)=${totalAll[0].n}`);

  // 5) 12행 후보 (chart != F-4507) — 원 지시의 집행 대상셋
  const target12 = rows.filter(r => r.chart_number !== 'F-4507');
  console.log(`\n[원 지시 집행 대상 후보(chart != F-4507)] = ${target12.length}건 (원 지시 기대치=12)`);

  console.log('\n===== 판정 =====');
  console.log(`freeze NOT NULL 총 ${rows.length}건 (원 스냅샷=13). F-4507 존재=${f4507.length>0}. 집행후보(≠F-4507)=${target12.length}건 (기대=12).`);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });

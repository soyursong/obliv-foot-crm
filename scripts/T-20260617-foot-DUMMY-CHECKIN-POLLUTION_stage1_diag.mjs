/**
 * T-20260617-foot-DUMMY-CHECKIN-POLLUTION — Stage 1 read-only 실측 (무변경)
 *
 * 목적:
 *   김주연 총괄 root-cause("더미가 check_ins 까지 INSERT → 셀프접수 명단 누락 + 일마감 오염") 검증.
 *   1) 오늘(2026-06-17) jongno-foot 더미 고객(is_simulation=true)에 연결된 check_ins 존재/status 실측
 *   2) Stage 3 DELETE 대상을 정확히 한정할 식별 키 확정
 *   3) 진짜 현장 체크인 / 형제티켓 14:30 prod행과의 경계 확인
 *
 * 식별 키(check_ins 엔 자체 is_simulation 없음 → customer 경유):
 *   check_ins.customer_id ∈ (customers WHERE clinic_id=jongno-foot AND is_simulation=true)
 *   AND checked_in_at::date(KST) = '2026-06-17'   ← 오늘 한정(과거 재진판별 체크인 제외)
 *
 * 실행: node scripts/T-20260617-foot-DUMMY-CHECKIN-POLLUTION_stage1_diag.mjs
 * (READ-ONLY: SELECT only, 어떤 write 도 하지 않음)
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_SLUG = process.env.CLINIC_SLUG || 'jongno-foot';
const TODAY = process.env.TARGET_DATE || '2026-06-17';

function kstDate(ts) {
  if (!ts) return null;
  return new Date(new Date(ts).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function main() {
  console.log(`== Stage1 진단 (READ-ONLY) == clinic=${CLINIC_SLUG} today=${TODAY}`);

  const { data: clinic, error: ce } = await sb
    .from('clinics').select('id, slug, name').eq('slug', CLINIC_SLUG).single();
  if (ce || !clinic) throw new Error(`클리닉 조회 실패: ${ce?.message}`);
  const clinicId = clinic.id;
  console.log(`clinic_id=${clinicId} (${clinic.name})\n`);

  // 1) 더미 고객 집합 (is_simulation=true)
  const { data: dummyCust, error: dce } = await sb
    .from('customers')
    .select('id, name, phone, visit_type, created_at')
    .eq('clinic_id', clinicId)
    .eq('is_simulation', true);
  if (dce) throw new Error(`더미 고객 조회 실패: ${dce.message}`);
  const dummyIds = new Set((dummyCust ?? []).map((c) => c.id));
  const custById = new Map((dummyCust ?? []).map((c) => [c.id, c]));
  console.log(`[A] 더미 고객(is_simulation=true) 총 ${dummyIds.size}건`);

  // 2) 오늘 더미 예약 (customer_id ∈ 더미)
  const { data: resv, error: re } = await sb
    .from('reservations')
    .select('id, customer_id, customer_name, customer_phone, visit_type, status, reservation_time, memo, created_at')
    .eq('clinic_id', clinicId)
    .eq('reservation_date', TODAY)
    .order('reservation_time');
  if (re) throw new Error(`예약 조회 실패: ${re.message}`);
  const dummyResv = (resv ?? []).filter((r) => dummyIds.has(r.customer_id));
  console.log(`[B] 오늘(${TODAY}) 예약 총 ${resv?.length ?? 0}건 / 그중 더미고객 예약 ${dummyResv.length}건`);
  const dummyResvIds = new Set(dummyResv.map((r) => r.id));

  // 3) 더미 고객에 연결된 check_ins 전체 (customer_id 경유)
  const dummyIdArr = [...dummyIds];
  let allCI = [];
  // chunk in batches of 200 for .in()
  for (let i = 0; i < dummyIdArr.length; i += 200) {
    const chunk = dummyIdArr.slice(i, i + 200);
    const { data: ci, error: cie } = await sb
      .from('check_ins')
      .select('id, customer_id, reservation_id, customer_name, customer_phone, visit_type, status, checked_in_at, completed_at, created_at, notes')
      .eq('clinic_id', clinicId)
      .in('customer_id', chunk);
    if (cie) throw new Error(`check_ins 조회 실패: ${cie.message}`);
    allCI = allCI.concat(ci ?? []);
  }
  console.log(`[C] 더미고객 연결 check_ins 총 ${allCI.length}건\n`);

  // 4) 오늘 체크인된 더미 check_ins (= 오염 의심 대상)
  const todayCI = allCI.filter((c) => kstDate(c.checked_in_at) === TODAY || kstDate(c.created_at) === TODAY);
  const pastCI = allCI.filter((c) => !(kstDate(c.checked_in_at) === TODAY || kstDate(c.created_at) === TODAY));
  console.log(`[D] 오늘 더미 check_ins ${todayCI.length}건 / 과거(재진판별 등) ${pastCI.length}건`);

  // status 분포
  const statusDist = {};
  for (const c of todayCI) statusDist[c.status] = (statusDist[c.status] ?? 0) + 1;
  console.log(`[E] 오늘 더미 check_ins status 분포:`, JSON.stringify(statusDist));

  // reservation_id 연결 여부
  const ciWithResv = todayCI.filter((c) => c.reservation_id);
  const ciResvIsDummy = ciWithResv.filter((c) => dummyResvIds.has(c.reservation_id));
  console.log(`[F] 오늘 더미 check_ins 중 reservation_id 연결 ${ciWithResv.length}건 / 그중 오늘더미예약 연결 ${ciResvIsDummy.length}건`);

  console.log(`\n── 오늘 더미 check_ins 상세 (최대 40) ──`);
  for (const c of todayCI.slice(0, 40)) {
    const cust = custById.get(c.customer_id);
    console.log(
      `  CI=${c.id.slice(0, 8)} cust=${(c.customer_name || cust?.name || '?')} ` +
      `vt=${c.visit_type} status=${c.status} ` +
      `checked_in=${c.checked_in_at ? kstDate(c.checked_in_at) : '-'} ` +
      `resv=${c.reservation_id ? c.reservation_id.slice(0, 8) + (dummyResvIds.has(c.reservation_id) ? '(dummy)' : '(NON-DUMMY!)') : 'NULL'}`,
    );
  }

  // 5) Stage3 DELETE 후보 식별 키 카운트 (드라이 카운트만, 삭제 안 함)
  console.log(`\n── [STAGE3 후보 식별 키] dry COUNT (삭제 안 함) ──`);
  console.log(`  키: check_ins WHERE clinic_id=${clinicId.slice(0,8)}.. AND customer_id ∈ 더미고객 AND checked_in_at::KST = ${TODAY}`);
  console.log(`  → 후보 ${todayCI.length}건`);
  console.log(`  ⚠ 검증: 이 후보 중 reservation_id 가 NON-DUMMY 예약에 연결된 행이 있으면 재게이트 필요`);
  const suspicious = todayCI.filter((c) => c.reservation_id && !dummyResvIds.has(c.reservation_id));
  console.log(`  → NON-DUMMY 예약 연결(주의) ${suspicious.length}건`);
  if (suspicious.length) {
    for (const c of suspicious) console.log(`     ⚠ CI=${c.id} resv=${c.reservation_id} cust=${c.customer_name}`);
  }

  // 6) 형제티켓 14:30 3건(윤민희·김진화·이시형) 경계 확인
  const siblings = ['윤민희', '김진화', '이시형'];
  console.log(`\n── 형제티켓 14:30 3건 경계 확인 ──`);
  for (const nm of siblings) {
    const r = (resv ?? []).filter((x) => x.customer_name === nm);
    const isDummy = r.map((x) => dummyIds.has(x.customer_id));
    console.log(`  ${nm}: 예약 ${r.length}건, 더미고객여부=${JSON.stringify(isDummy)}, time=${r.map(x=>x.reservation_time).join(',')}`);
  }

  // JSON evidence 출력
  const evidence = {
    ticket: 'T-20260617-foot-DUMMY-CHECKIN-POLLUTION',
    stage: 1,
    measured_at: new Date().toISOString(),
    clinic_id: clinicId,
    today: TODAY,
    dummy_customers: dummyIds.size,
    today_dummy_reservations: dummyResv.length,
    dummy_checkins_total: allCI.length,
    today_dummy_checkins: todayCI.length,
    past_dummy_checkins: pastCI.length,
    today_checkin_status_dist: statusDist,
    today_ci_with_reservation_link: ciWithResv.length,
    today_ci_linked_to_dummy_resv: ciResvIsDummy.length,
    suspicious_non_dummy_resv_links: suspicious.length,
    stage3_delete_candidate_ids: todayCI.map((c) => c.id),
  };
  console.log(`\n===EVIDENCE_JSON===`);
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });

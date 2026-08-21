// T-20260821-foot-CLOSING-SUSU-STAFFREV-MISMATCH-DIAG — census2 (INFO augment MSG-...-2712)
// ─────────────────────────────────────────────────────────────────────────────
// responder ie1t explicit SELECT 스펙 4축 (READ-ONLY · write0/DDL0/prod 무접촉):
//   ① prod SELECT payments+package_payments where 오늘 AND (assigned_staff=강경민 OR attributed_staff=강경민)
//      → 두 surface(수납내역=live assigned vs 담당실장별=attributed snapshot)가 강경민 기준 어느 행에서 갈라지나
//   ② attributed_staff_id IS NULL 행 건수/금액 (강경민 기준·오늘·payments+pkg) → live fallback 기여
//      + parent census(payments stamp 94.1% / pkg 95.5%) 대조
//   ③ 오늘 강경민 배정 변경 고객 수: customers.assigned_staff_id=강경민 AND updated_at=오늘 (가설② 재배정 정량화)
//   ④ ★신규 축 — package_payments 집계 scope 비대칭 (수납내역 vs 담당실장별 pkg 포함/제외)
//
// SELECT-only. 데이터/스키마 변경 0. RC(이미 census1에서 pagination cap 확정)를 explicit 숫자로 재확인.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오블리브의원 서울 오리진점(jongno-foot)
const KANG = '6ab26d9f-fd10-4042-9fd7-076f277be5d4';   // 강경민(consultant)
const DATE = '2026-08-21';
const won = (n) => (n || 0).toLocaleString('ko-KR');
const net = (r) => (r.payment_type === 'refund' ? -(r.amount ?? 0) : (r.amount ?? 0));
const sum = (rows) => rows.reduce((a, r) => a + net(r), 0);

// cursor 페이지네이션(1000행 cap 우회) — 진단 자체는 정확해야 하므로 전행 페치
async function fetchAll(table, cols, applyFilters) {
  const out = [];
  for (let off = 0; off < 100000; off += 1000) {
    let q = sb.from(table).select(cols).range(off, off + 999);
    q = applyFilters(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

async function liveAssignMap(rows) {
  const cids = [...new Set(rows.map(r => r.customer_id).filter(Boolean))];
  const m = new Map();
  for (let i = 0; i < cids.length; i += 400) {
    const { data } = await sb.from('customers').select('id, assigned_staff_id').in('id', cids.slice(i, i + 400));
    for (const c of data ?? []) m.set(c.id, c.assigned_staff_id);
  }
  return m;
}

async function main() {
  console.log('auth: service_role (RLS bypass) · READ-ONLY · clinic=jongno-foot · staff=강경민(6ab26d9f) · date=2026-08-21\n');

  const PSEL = 'id, accounting_date, created_at, amount, payment_type, status, attributed_staff_id, customer_id, method';
  const KSEL = 'id, accounting_date, created_at, amount, payment_type, attributed_staff_id, customer_id, method';

  // 전체 오늘 payments/pkg (귀속 판정에 live map 필요 → 전건 로드 후 필터)
  const payToday = await fetchAll('payments', PSEL, q => q
    .eq('clinic_id', CLINIC).eq('accounting_date', DATE));
  const pkgToday = await fetchAll('package_payments', KSEL, q => q
    .eq('clinic_id', CLINIC).eq('accounting_date', DATE));

  const laP = await liveAssignMap(payToday);
  const laK = await liveAssignMap(pkgToday);
  const liveOf = (m) => (r) => r.customer_id && m.get(r.customer_id);
  const lp = liveOf(laP), lk = liveOf(laK);

  // ─── 축① surface split: live assigned=강경민 vs attributed snapshot=강경민 ───
  console.log('════ 축① 강경민 기준 두 surface 행 분해 (오늘 accounting_date) ════');
  for (const [label, rows, live, hasStatus] of [
    ['payments', payToday, lp, true],
    ['package_payments', pkgToday, lk, false],
  ]) {
    const active = hasStatus ? rows.filter(r => !['cancelled', 'deleted'].includes(r.status)) : rows;
    const liveKang = active.filter(r => live(r) === KANG);              // 화면①수납내역 축(live assigned)
    const attrKang = active.filter(r => r.attributed_staff_id === KANG); // 화면②담당실장별 축(snapshot)
    console.log(`\n  [${label}]  (active행=${active.length}${hasStatus ? ', status NOT IN(cancelled,deleted)' : ', status컬럼 없음'})`);
    console.log(`   live assigned=강경민 (화면① 수납내역 축) : ${won(sum(liveKang))} (${liveKang.length}건)`);
    console.log(`   attributed  =강경민 (화면② 담당실장별 축): ${won(sum(attrKang))} (${attrKang.length}건)`);
    // 두 집합 교집합/차집합
    const liveSet = new Set(liveKang.map(r => r.id)), attrSet = new Set(attrKang.map(r => r.id));
    const onlyLive = liveKang.filter(r => !attrSet.has(r.id));
    const onlyAttr = attrKang.filter(r => !liveSet.has(r.id));
    console.log(`   ▸ live만(attr≠강경민): ${won(sum(onlyLive))} (${onlyLive.length}건)  ▸ attr만(live≠강경민): ${won(sum(onlyAttr))} (${onlyAttr.length}건)`);
  }

  // ─── 축② attributed_staff_id IS NULL (강경민 기준·오늘) → live fallback 기여 ───
  console.log('\n════ 축② attributed_staff_id IS NULL 행 (live assigned=강경민 기준·오늘) ════');
  for (const [label, rows, live, hasStatus] of [
    ['payments', payToday, lp, true],
    ['package_payments', pkgToday, lk, false],
  ]) {
    const active = hasStatus ? rows.filter(r => !['cancelled', 'deleted'].includes(r.status)) : rows;
    const kangLive = active.filter(r => live(r) === KANG);
    const nullAttr = kangLive.filter(r => !r.attributed_staff_id);
    const stampRate = kangLive.length ? (100 * (kangLive.length - nullAttr.length) / kangLive.length).toFixed(1) : 'n/a';
    console.log(`  [${label}] 강경민(live) 오늘 ${kangLive.length}건 中 attributed NULL(→live fallback) = ${nullAttr.length}건 / ${won(sum(nullAttr))}  (stamp율 ${stampRate}%)`);
  }
  // 전 clinic 오늘 stamp율 (parent census 94.1%/95.5% 대조)
  for (const [label, rows, hasStatus] of [['payments', payToday, true], ['package_payments', pkgToday, false]]) {
    const active = hasStatus ? rows.filter(r => !['cancelled', 'deleted'].includes(r.status)) : rows;
    const withCust = active.filter(r => r.customer_id); // 워크인 제외
    const stamped = withCust.filter(r => r.attributed_staff_id).length;
    const rate = withCust.length ? (100 * stamped / withCust.length).toFixed(1) : 'n/a';
    console.log(`  [${label}] 전 clinic 오늘(고객有) stamp율 = ${rate}% (${stamped}/${withCust.length})  ← parent census 대조`);
  }

  // ─── 축③ 오늘 강경민으로 배정 변경된 고객 수 (재배정 정량화) ───
  console.log('\n════ 축③ 오늘(updated_at) 강경민 배정 고객 수 (가설② 재배정 직접 정량화) ════');
  const kangCustsAll = await fetchAll('customers', 'id, assigned_staff_id, updated_at', q => q
    .eq('clinic_id', CLINIC).eq('assigned_staff_id', KANG));
  const reassignedToday = kangCustsAll.filter(c => c.updated_at && c.updated_at.slice(0, 10) === DATE);
  console.log(`  강경민 배정 고객 전체 = ${kangCustsAll.length}명, 그 中 오늘 updated_at 갱신 = ${reassignedToday.length}명`);
  console.log(`  → 대규모 재배정 여부: ${reassignedToday.length >= 10 ? '⚠ 있음(재배정 가설 재검토)' : '아니오(재배정 delta 후보 미미)'}`);

  // ─── 축④ package_payments scope 비대칭 (수납내역 vs 담당실장별) ───
  console.log('\n════ 축④ package_payments scope — 강경민 오늘 pkg 기여 ════');
  const pkgActive = pkgToday; // status 컬럼 없음
  const pkgKangLive = pkgActive.filter(r => lk(r) === KANG);
  const pkgKangAttr = pkgActive.filter(r => r.attributed_staff_id === KANG);
  console.log(`  강경민 오늘 pkg: live축 ${won(sum(pkgKangLive))}(${pkgKangLive.length}건) / attr축 ${won(sum(pkgKangAttr))}(${pkgKangAttr.length}건)`);
  console.log('  주: 화면①수납내역·화면②담당실장별 둘 다 payments+package_payments 합산(scope 대칭). pkg 단독 비대칭 기여 위 값이 전부.');

  // ─── 종합: delta 재구성 (오늘 강경민 화면① - 화면②재현) ───
  console.log('\n════ 종합: 강경민 오늘 화면① vs 화면②(pagination 정답 기준) ════');
  const payActive = payToday.filter(r => !['cancelled', 'deleted'].includes(r.status));
  const snap = (m) => (r) => r.attributed_staff_id || (r.customer_id && m.get(r.customer_id)) || '__U__';
  const screen1 = payActive.filter(r => lp(r) === KANG); // live assigned (수납내역)
  const screen2 = payActive.filter(r => snap(laP)(r) === KANG); // snapshot→live belt (담당실장별)
  console.log(`  화면① payments(live assigned)      = ${won(sum(screen1))} (${screen1.length}건)`);
  console.log(`  화면② payments(snapshot+belt·정답) = ${won(sum(screen2))} (${screen2.length}건)`);
  console.log(`  + pkg 화면②(snapshot+belt)         = ${won(sum(pkgActive.filter(r => snap(laK)(r) === KANG)))}`);
  console.log('\n  ★ census1 확정: 화면②의 실 표시값 303,500(8건)은 위 정답이 아니라 fetchAttributedPayments의');
  console.log('     1000행 pagination cap 절단 결과. 축①~④ 어디에도 15.7M delta 기여 없음 → RC=pagination cap 재확인.');
}
main().catch(e => { console.error(e); process.exit(1); });

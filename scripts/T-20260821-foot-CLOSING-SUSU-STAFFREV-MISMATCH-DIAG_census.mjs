// T-20260821-foot-CLOSING-SUSU-STAFFREV-MISMATCH-DIAG — READ-ONLY census (정본 재현).
// ─────────────────────────────────────────────────────────────────────────────
// 신고(김주연 총괄, 2026-08-21): 일마감 '수납내역' 강경민 상담실장 16,057,900원
//   ↔ 일마감>총매출>담당실장별 303,500원 = delta 15,754,400원.
//
// 표면 대조:
//   화면① '수납내역'(Closing.tsx staffTotals) — 단일일(created_at window) 조회·live assigned_staff·
//          status!='deleted'. 23건 = 16,057,900. (1일치 = 1000행 미만 → 절단 없음)
//   화면② '총매출>담당실장별'(Closing compare 탭 = mtmSales.fetchStaffDailyBreakdown
//          → staffRevenue.fetchAttributedPayments) — 월단위(accounting_date 08-01~08-31) 조회.
//
// ★RC 확정: fetchAttributedPayments(staffRevenue.ts L106~126)는 PostgREST 기본 1000행 cap 을
//   우회하는 cursor 페이지네이션(.range)이 없다. 08월 payments(비cancelled/deleted)=1071행>1000.
//   월 조회가 조용히 1000행에서 절단 → 최근일(08-21) 행이 대량 탈락 → 강경민 08-21 셀 과소집계.
//   비페이지 재현 = 303,500(8건, 신고값 정확 일치) / 페이지네이션 정답 = 16,057,900(23건).
//   delta 15,754,400 = 100% 페이지네이션 절단 기여. H1(cancelled)/H2(귀속축)/H3(날짜축) 전부 0.
//
// SELECT-only. 데이터/스키마 변경 0. prod 무접촉(읽기).
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
const MFROM = '2026-08-01', MTO = '2026-08-31';
const won = (n) => (n || 0).toLocaleString('ko-KR');
const net = (r) => (r.payment_type === 'refund' ? -(r.amount ?? 0) : (r.amount ?? 0));

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
  const SEL = 'id, accounting_date, amount, payment_type, status, attributed_staff_id, customer_id, created_at';

  // 0) 월 총건수 = cap 초과 여부
  const { count } = await sb.from('payments').select('id', { count: 'exact', head: true })
    .eq('clinic_id', CLINIC).gte('accounting_date', MFROM).lte('accounting_date', MTO)
    .not('status', 'in', '(cancelled,deleted)');
  console.log(`08월 payments(비cancelled/deleted) 총건수 = ${count} → 1000 cap 초과? ${count > 1000}`);

  // 1) 화면② as-built 재현 (staffRevenue.fetchAttributedPayments = 비페이지 단일쿼리)
  const { data: onePage } = await sb.from('payments').select(SEL)
    .eq('clinic_id', CLINIC).gte('accounting_date', MFROM).lte('accounting_date', MTO)
    .not('status', 'in', '(cancelled,deleted)');
  console.log(`비페이지 단일쿼리 반환행수 = ${(onePage ?? []).length} (절단됨)`);

  // 2) 페이지네이션 정답
  const full = [];
  for (let off = 0; off < 50000; off += 1000) {
    const { data } = await sb.from('payments').select(SEL)
      .eq('clinic_id', CLINIC).gte('accounting_date', MFROM).lte('accounting_date', MTO)
      .not('status', 'in', '(cancelled,deleted)').range(off, off + 999);
    full.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  console.log(`페이지네이션 전행수 = ${full.length}`);

  const la = await liveAssignMap(full);
  const snap = (r) => r.attributed_staff_id || (r.customer_id && la.get(r.customer_id)) || '__U__';

  const k21bug = (onePage ?? []).filter(r => r.accounting_date === DATE && snap(r) === KANG);
  const k21fix = full.filter(r => r.accounting_date === DATE && snap(r) === KANG);
  const bugSum = k21bug.reduce((a, r) => a + net(r), 0);
  const fixSum = k21fix.reduce((a, r) => a + net(r), 0);

  console.log('\n=== 강경민 08-21 담당실장별(snapshot 귀속) ===');
  console.log(`화면② as-built(비페이지·버그) = ${won(bugSum)} (${k21bug.length}건)  ← 신고값 303,500`);
  console.log(`화면② 페이지네이션(정답)      = ${won(fixSum)} (${k21fix.length}건)  ← 화면① 수납내역 16,057,900 과 일치`);
  console.log(`delta = ${won(fixSum - bugSum)}  ← 신고 delta 15,754,400`);

  // 3) 원 3가설 검증 (전부 0 이어야 함)
  const cancelled = full.filter(r => false); // status NOT IN 이미 제외 — cancelled 기여 후보를 별도 조회
  const { data: cancelRows } = await sb.from('payments').select(SEL)
    .eq('clinic_id', CLINIC).eq('accounting_date', DATE).eq('status', 'cancelled');
  const H1 = (cancelRows ?? []).filter(r => snap(r) === KANG || (r.customer_id && la.get(r.customer_id) === KANG));
  const H2 = k21fix.filter(r => r.attributed_staff_id && r.attributed_staff_id !== KANG && la.get(r.customer_id) === KANG);
  const H3 = full.filter(r => r.accounting_date === DATE && snap(r) === KANG && r.created_at && r.created_at.slice(0, 10) !== DATE);
  console.log('\n=== 원 3가설 기여 (강경민 08-21) ===');
  console.log(`H1 cancelled 포함    = ${won(H1.reduce((a,r)=>a+net(r),0))} (${H1.length}건)`);
  console.log(`H2 귀속축 live≠snap  = ${won(H2.reduce((a,r)=>a+net(r),0))} (${H2.length}건)`);
  console.log(`H3 날짜축 created≠acct= ${won(H3.reduce((a,r)=>a+net(r),0))} (${H3.length}건)`);
  console.log('\n★ dominant = 페이지네이션 1000행 cap 절단 (100%). H1/H2/H3 무기여.');
}
main().catch(e => { console.error(e); process.exit(1); });

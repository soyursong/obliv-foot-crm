/**
 * T-20260804-foot-COSMETIC-CORRECTION-CRM — STEP 3: BLOCKING verify-gate (Q1-5 + Q3)
 *
 * DA CONSULT-REPLY (DA-20260804-foot-COSMETIC-CORRECTION-LINEEXCL, MSG-20260804-191806-g5rl)
 * 게이트 순서 step1 = dev-foot BLOCKING verify-gate. 전부 READ-ONLY. prod write 0.
 *
 * Q1-5 목표:
 *   (a) 제외 4라인(#1a·#1b 김OO / #2b 오렌지족 / #4 정가언)이 "단일 사유(real sale·화장품집계 오계상)"를 공유하는가?
 *   (b) 각 제외 라인이 매출-진성(real money moved) vs non-genuine(test) 인가?
 *       → real  = metric-scoped flag(is_excluded_from_sales, v_daily_revenue 무접촉)
 *       → non-genuine = is_test/is_simulation 트랙(매출 제외·payment 동반) → 재-CONSULT
 * Q3 목표: #3 김정숙 F-4872 풋샴푸 42,000 = 실 수금(payment 존재) vs 미수(payment 부재)?
 *       → (a) 실수금 = check_in_services INSERT + payment INSERT 둘 다
 *       → (b) 미수   = line-only INSERT + payment_waiting
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const REF = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
const J = (x) => JSON.stringify(x, null, 2);

const EXCLUDE_IDS = {
  '#1a': 'b81521e2-3e4f-4d41-8c63-971d78f08482', // 김OO 안티펑거스 287,000
  '#1b': 'aaec854c-31e2-4071-b2d8-535cfed6c55d', // 김OO 풋샴푸 42,000
  '#2b': '81682cf7-317a-4e55-98c5-eeafdda0d605', // 오렌지족 풋샴푸 42,000
  '#4':  '31ea7f5e-fad9-406f-9d50-5bf116b51d23', // 정가언 CTB 15,000
};

async function main() {
  console.log('════════════════ Q1-5 BLOCKING verify-gate ════════════════');

  // ── 1) 제외 4라인 line-grain 실측: 라인 상세 + 소속 방문 + 고객 성격 ──
  const ids = Object.values(EXCLUDE_IDS).map((i) => `'${i}'`).join(',');
  const lines = await runSQL(`
    select cis.id line_id, cis.price, cis.service_name, cis.seller_staff_id,
           cis.check_in_id, ci.checked_in_at, ci.therapist_id,
           cu.id customer_id, cu.chart_number, cu.name cust_name,
           cu.is_simulation cust_is_simulation,
           (select count(*) from check_ins x where x.customer_id=cu.id) cust_total_visits,
           (select count(*) from check_in_services s
              join check_ins x on x.id=s.check_in_id where x.customer_id=cu.id) cust_total_lines
    from check_in_services cis
    join check_ins ci on ci.id = cis.check_in_id
    join customers cu on cu.id = ci.customer_id
    where cis.id in (${ids})
    order by cu.chart_number, cis.price desc;`);
  console.log('\n── (1) 제외 4라인 line detail + 고객 성격 ──');
  console.log(J(lines));

  // ── 2) 각 제외 라인의 소속 방문(check_in)에 real money(payment)가 붙었는가? ──
  //     line grain 직접 payment 링크는 없으므로 방문 grain payment 총액 + 항목으로 real-money 판정.
  const checkInIds = [...new Set(lines.map((l) => l.check_in_id))].map((i) => `'${i}'`).join(',');
  const pays = await runSQL(`
    select p.check_in_id, count(*) pay_cnt, sum(p.amount) pay_sum,
           array_agg(p.amount order by p.amount desc) amounts,
           array_agg(distinct p.method) methods,
           array_agg(distinct coalesce(p.status,'?')) statuses,
           count(*) filter (where p.deleted_at is not null) deleted_cnt,
           count(*) filter (where coalesce(p.is_simulation,false)) sim_cnt,
           min(p.accounting_date) first_acct, max(p.accounting_date) last_acct
    from payments p
    where p.check_in_id in (${checkInIds})
    group by p.check_in_id;`);
  console.log('\n── (2) 제외 라인 소속 방문의 payment(원장) 총액 — real money 판정 ──');
  console.log(J(pays));

  // ── 3) 고객 전체 payment 규모 (Gate-0 근거 재확인: 실환자 vs dummy) ──
  const custIds = [...new Set(lines.map((l) => l.customer_id))].map((i) => `'${i}'`).join(',');
  const custPay = await runSQL(`
    select ci.customer_id, cu.chart_number, cu.name,
           count(distinct p.id) pay_cnt, coalesce(sum(p.amount),0) pay_total
    from check_ins ci
    join customers cu on cu.id = ci.customer_id
    left join payments p on p.check_in_id = ci.id
    where ci.customer_id in (${custIds})
    group by ci.customer_id, cu.chart_number, cu.name
    order by pay_total desc;`);
  console.log('\n── (3) 제외 고객 전체 원장 규모 (실환자 여부 재확인) ──');
  console.log(J(custPay));

  console.log('\n\n════════════════ Q3 BLOCKING verify-gate — #3 김정숙 F-4872 ════════════════');
  // ── 4) 김정숙 F-4872: 방문·라인·payment 전량 (풋샴푸 42,000 실수금 vs 미수) ──
  const kjs = await runSQL(`
    select cu.id customer_id, cu.chart_number, cu.name, cu.is_simulation,
           (select count(*) from check_ins x where x.customer_id=cu.id) visits
    from customers cu where cu.chart_number = 'F-4872';`);
  console.log('\n── (4a) 김정숙 F-4872 고객 ──');
  console.log(J(kjs));
  if (kjs.length) {
    const cid = kjs[0].customer_id;
    const visits = await runSQL(`
      select ci.id check_in_id, ci.checked_in_at, ci.therapist_id,
             (select string_agg(s.service_name||'('||s.price||')', ', ')
                from check_in_services s where s.check_in_id=ci.id) svc_lines,
             (select coalesce(sum(p.amount),0) from payments p where p.check_in_id=ci.id) pay_sum,
             (select count(*) from payments p where p.check_in_id=ci.id) pay_cnt,
             (select string_agg(p.amount::text||'/'||coalesce(p.method,'?')||'/acct:'||coalesce(p.accounting_date::text,'?')||'/'||coalesce(p.status,'?')||(case when p.deleted_at is not null then '/DELETED' else '' end), ', ')
                from payments p where p.check_in_id=ci.id) pay_detail
      from check_ins ci where ci.customer_id='${cid}'
      order by ci.checked_in_at;`);
    console.log('\n── (4b) 김정숙 전 방문 + 라인 + payment (풋샴푸/42000 실수금 흔적 탐색) ──');
    console.log(J(visits));

    // 42,000 or 풋샴푸 관련 payment/line 이 이미 존재하는지 (멱등·중복 방지 정탐)
    const shampooHit = await runSQL(`
      select 'line' src, cis.id ref, cis.service_name, cis.price::text amt, ci.checked_in_at::text ts
      from check_in_services cis join check_ins ci on ci.id=cis.check_in_id
      where ci.customer_id='${cid}' and (cis.service_name ilike '%샴푸%' or cis.price=42000)
      union all
      select 'payment' src, p.id ref, coalesce(p.method,'?')||'/'||coalesce(p.status,'?'), p.amount::text, coalesce(p.accounting_date::text,p.created_at::text)
      from payments p join check_ins ci on ci.id=p.check_in_id
      where ci.customer_id='${cid}' and p.amount=42000;`);
    console.log('\n── (4c) 김정숙 풋샴푸/42,000 기존 흔적 (실수금 원장 존재? 멱등 정탐) ──');
    console.log(J(shampooHit));
  }

  console.log('\n\n════════ VERIFY-GATE 판정 근거 요약 (해석은 티켓 로그에 기술) ════════');
  console.log('※ 이 스크립트는 READ-ONLY. prod write 0. 판정은 산출 데이터 기반으로 dev-foot가 티켓/DA회신에 기술.');
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });

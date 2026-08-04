/**
 * T-20260804-foot-COSMETIC-CORRECTION-CRM — STEP 1: Gate0 판정 근거 + 재귀속 대상 disambiguation
 * READ-ONLY.
 *  1) is_simulation 재사용 blast-radius: 제외대상 3고객(F-0177 김민경/F-4628 오렌지족/F-4981 정가언)의
 *     전체 활동량(check_ins·비화장품 라인·payments·service_charges) 실측 → 고객전체 flag 적합성 판정.
 *  2) 중복 staff 김규리 2건(d26717cb / 3a0c6774) disambiguation — 어느 id 가 재귀속 target 인지.
 *  3) #3 김정숙 F-4872 7월 check_ins (INSERT host 후보) + 화장품 판매의 payment 동반 관행 샘플(원장 접점 판별).
 *  4) 담당치료사별 화장품 집계 소스 = v_daily_revenue 인지 client-query 인지(정정이 실제 반영될 경로).
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
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

async function main() {
  console.log('======== 1) is_simulation blast-radius (제외대상 3고객 전체활동) ========');
  const cust = {
    'F-0177 김민경 (83ab4fe1)': '83ab4fe1-0bbc-4dfc-ab3b-f01378144707',
    'F-4628 오렌지족 (82a06353)': '82a06353-8b36-418f-9435-7e58304a3939',
    'F-4981 정가언 (4dfd32c8)': '4dfd32c8-8ba5-45cd-8c7e-5e7da2d87c1e',
  };
  for (const [label, id] of Object.entries(cust)) {
    const ci = await runSQL(`select count(*) n, min(checked_in_at) first, max(checked_in_at) last from check_ins where customer_id='${id}' and clinic_id='${CLINIC}';`);
    const lines = await runSQL(`select count(*) n from check_in_services cis join check_ins ci on ci.id=cis.check_in_id where ci.customer_id='${id}';`);
    const pays = await runSQL(`select count(*) n, coalesce(sum(amount),0) sum from payments where customer_id='${id}' and status is distinct from 'cancelled' and deleted_at is null;`);
    const sc = await runSQL(`select count(*) n from service_charges where customer_id='${id}';`);
    console.log(`\n[${label}]`);
    console.log(`  check_ins: ${ci[0].n} (first ${ci[0].first} ~ last ${ci[0].last})`);
    console.log(`  check_in_services 총라인: ${lines[0].n}`);
    console.log(`  payments(유효): ${pays[0].n}건 / ${Number(pays[0].sum).toLocaleString()}원`);
    console.log(`  service_charges(의료 명세): ${sc[0].n}건`);
  }

  console.log('\n======== 2) 중복 staff 김규리 disambiguation ========');
  const kr = await runSQL(`
    select s.id, s.name, s.role, s.active, s.created_at,
      (select count(*) from check_in_services cis where cis.seller_staff_id=s.id) as seller_lines,
      (select count(*) from check_ins ci where ci.therapist_id=s.id) as therapist_checkins
    from staff s where s.clinic_id='${CLINIC}' and s.name='김규리' order by s.created_at;`);
  console.log(J(kr));
  console.log('  NOTE: 김민경 대상라인의 therapist_id = 3a0c6774 (=김규리). 재귀속 target 은 이 id 로 통일 검토.');

  console.log('\n======== 3) #3 김정숙 F-4872 INSERT host 후보 + 화장품 payment 동반 관행 ========');
  const kjs = '(select id from customers where clinic_id=\'' + CLINIC + '\' and chart_number=\'F-4872\')';
  const kjsCheckins = await runSQL(`
    select ci.id, ci.checked_in_at, ci.therapist_id, th.name therapist_name,
      (select count(*) from check_in_services x where x.check_in_id=ci.id) svc_lines
    from check_ins ci left join staff th on th.id=ci.therapist_id
    where ci.customer_id=${kjs} and ci.clinic_id='${CLINIC}'
      and ci.checked_in_at >= '2026-07-01T00:00:00+09:00' and ci.checked_in_at <= '2026-07-31T23:59:59+09:00'
    order by ci.checked_in_at;`);
  console.log('김정숙 F-4872 7월 check_ins (INSERT host 후보):');
  console.log(J(kjsCheckins));

  // 화장품 판매 라인 중 payment 동반 비율 샘플 (원장 접점 판별)
  console.log('\n-- 화장품(풋샴푸 200ml) 판매 라인의 payment 동반 관행 (전체 7월) --');
  const payPractice = await runSQL(`
    with cos as (
      select cis.id line_id, cis.price, ci.id checkin_id, ci.customer_id
      from check_in_services cis join check_ins ci on ci.id=cis.check_in_id
      where ci.clinic_id='${CLINIC}' and cis.service_id='89095450-223f-4863-89a9-c7f32f62809d'
        and ci.checked_in_at >= '2026-07-01T00:00:00+09:00' and ci.checked_in_at <= '2026-07-31T23:59:59+09:00'
    )
    select
      (select count(*) from cos) cosmetic_lines,
      (select count(distinct checkin_id) from cos) checkins,
      (select count(*) from payments p where p.check_in_id in (select checkin_id from cos) and p.status is distinct from 'cancelled' and p.deleted_at is null) linked_payments;`);
  console.log(J(payPractice));
  console.log('  → 화장품 라인 다수가 payment 없이 존재하면 #3 INSERT 도 원장 무접점(라인만) 가능. payment 동반 관행이면 supervisor 판단.');

  console.log('\n======== 4) 담당치료사별 화장품 집계 소스 (v_daily_revenue 정의) ========');
  const vdef = await runSQL(`select pg_get_viewdef('public.v_daily_revenue'::regclass, true) as def;`);
  const def = vdef[0].def || '';
  console.log('v_daily_revenue 에 seller_staff_id/화장품 seller 집계 포함?:',
    /seller_staff_id/i.test(def) ? 'YES(seller축 포함)' : 'NO(seller축 없음 → 화면은 client-side 집계일 가능성)');
  console.log('  def 발췌(앞 600자):\n', def.slice(0, 600));
}
main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });

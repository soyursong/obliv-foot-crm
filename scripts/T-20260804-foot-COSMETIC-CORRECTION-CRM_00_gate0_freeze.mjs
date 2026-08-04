/**
 * T-20260804-foot-COSMETIC-CORRECTION-CRM — STEP 0: Gate0 (제외 메커니즘) + freeze셋 PK 확정
 * READ-ONLY. prod write 0.
 *
 * 목적:
 *  A) Gate0 — check_in_services 라인레벨 제외 플래그 존재 여부 실측(is_simulation/is_test/is_voided/
 *     deleted_at/excluded 등). customers.is_simulation 은 고객전체 blast → 라인레벨 제외에 부적합.
 *  B) freeze셋 — 정정 5건(6 line/insert)의 정확한 check_in_services PK 를 F-차트+방문일+service 조합으로 확정.
 *  C) 원장 무접점 사전조사 — payments / service_charges 가 check_in_services 라인과 어떻게 연결되는지(FK) census.
 *
 * 실행: node scripts/T-20260804-foot-COSMETIC-CORRECTION-CRM_00_gate0_freeze.mjs
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const REF = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN 필요');
async function runSQL(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${await res.text()}`);
  return res.json();
}
const J = (x) => JSON.stringify(x, null, 2);

async function main() {
  console.log('======== A) Gate0: check_in_services 컬럼 census (라인레벨 제외 플래그 탐색) ========');
  const cols = await runSQL(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema='public' and table_name='check_in_services'
    order by ordinal_position;`);
  console.table(cols);

  console.log('\n-- 제외성 컬럼 후보 존재여부 --');
  const flagCandidates = cols.map((c) => c.column_name).filter((n) =>
    /sim|test|void|delete|exclud|cancel|refund|active|hidden/i.test(n));
  console.log('후보 컬럼:', flagCandidates.length ? flagCandidates.join(', ') : '(없음)');

  console.log('\n======== A2) 매출집계 화면이 쓰는 뷰/RPC 에서 제외 필터 실측 ========');
  const views = await runSQL(`
    select table_name from information_schema.views
    where table_schema='public' and (table_name ilike '%cosmet%' or table_name ilike '%sales%' or table_name ilike '%revenue%')
    order by table_name;`);
  console.log('관련 뷰:', J(views.map((v) => v.table_name)));

  console.log('\n======== B) freeze셋 — 대상 6건 정확 PK 확정 ========');
  // clinic
  const clinics = await runSQL(`select id, name from clinics order by created_at limit 5;`);
  console.log('clinics:', J(clinics));
  const clinicId = clinics[0].id;

  // cosmetic service ids
  const svc = await runSQL(`
    select id, name, category, category_label from services
    where clinic_id='${clinicId}' and (category='풋화장품' or category_label='풋화장품') order by name;`);
  console.log('풋화장품 services:', J(svc));

  // 대상 고객 5명(F-차트) 조회 → customer_id + is_simulation 확인
  const custs = await runSQL(`
    select id, name, chart_number, is_simulation from customers
    where clinic_id='${clinicId}' and chart_number in ('F-4628','F-4789','F-4872','F-4959','F-4981')
    order by chart_number;`);
  console.log('\n대상 고객(F-4628 오렌지족/F-4789 김현수/F-4872 김정숙/F-4959 김영웅/F-4981 정가언):', J(custs));

  // 김민경(#1) — 차트번호 미상, 이름+김규리 seller 로 조회
  const kmk = await runSQL(`
    select c.id, c.name, c.chart_number, c.is_simulation from customers c
    where c.clinic_id='${clinicId}' and c.name='김민경' order by c.chart_number;`);
  console.log('\n김민경(#1) 고객 후보:', J(kmk));

  // staff 이름 → id
  const staff = await runSQL(`
    select id, name from staff where clinic_id='${clinicId}'
    and name in ('김규리','최다혜','임별','윤시하','최민지') order by name;`);
  console.log('\nstaff:', J(staff));

  // 대상 6건 라인 실측 (cosmetic services 한정, 2026-07)
  const cosmeticIds = svc.map((s) => `'${s.id}'`).join(',');
  const allCustIds = [...custs, ...kmk].map((c) => `'${c.id}'`).join(',');
  if (cosmeticIds && allCustIds) {
    const lines = await runSQL(`
      select cis.id as line_id, cis.price, cis.seller_staff_id, cis.service_name, cis.service_id,
             ci.id as checkin_id, ci.customer_id, ci.therapist_id, ci.checked_in_at,
             cu.name as cust_name, cu.chart_number, cu.is_simulation,
             ss.name as seller_name, th.name as therapist_name
      from check_in_services cis
      join check_ins ci on ci.id = cis.check_in_id
      join customers cu on cu.id = ci.customer_id
      left join staff ss on ss.id = cis.seller_staff_id
      left join staff th on th.id = ci.therapist_id
      where ci.clinic_id='${clinicId}'
        and cis.service_id in (${cosmeticIds})
        and ci.customer_id in (${allCustIds})
        and ci.checked_in_at >= '2026-07-01T00:00:00+09:00'
        and ci.checked_in_at <= '2026-07-31T23:59:59+09:00'
      order by cu.chart_number, ci.checked_in_at;`);
    console.log('\n대상 라인 실측(정정 대상 후보 rows):');
    console.log(J(lines));

    // C) 원장 무접점 census — 이 라인들과 payments/service_charges 연결관계
    const lineIds = lines.map((l) => `'${l.line_id}'`).join(',');
    const checkinIds = [...new Set(lines.map((l) => `'${l.checkin_id}'`))].join(',');
    console.log('\n======== C) 원장 무접점 census ========');
    // service_charges 에 check_in_service 참조 컬럼 있는지
    const scCols = await runSQL(`
      select column_name, data_type from information_schema.columns
      where table_schema='public' and table_name='service_charges' order by ordinal_position;`);
    console.log('service_charges 컬럼:', J(scCols.map((c) => c.column_name)));
    const payCols = await runSQL(`
      select column_name, data_type from information_schema.columns
      where table_schema='public' and table_name='payments' order by ordinal_position;`);
    console.log('payments 컬럼:', J(payCols.map((c) => c.column_name)));

    if (lineIds) {
      // service_charges 가 check_in_service_id 를 참조하면 그 연결 조회
      const scRef = scCols.find((c) => /check_in_service/i.test(c.column_name));
      if (scRef) {
        const scLink = await runSQL(`
          select * from service_charges where ${scRef.column_name} in (${lineIds});`);
        console.log(`service_charges linked to target lines (via ${scRef.column_name}):`, J(scLink));
      } else {
        console.log('service_charges 에 check_in_service 직접참조 컬럼 없음 → checkin 기준 조회');
      }
    }
    console.log('\nNOTE: seller 재귀속(#2a,#5)=seller_staff_id 축만 이동=zero-sum. 위 원장 census 로 금액 무접점 확인.');
  }
}
main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });

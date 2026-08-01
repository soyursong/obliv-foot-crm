// T-20260801-foot-COSMETIC-SALES-LINEITEM-CORRECTION — Tier 1, SELECT-only.
// 원 명단(T-20260801-COSMETIC-SALES-DB-PULL, 2026-07, 8명/27건/711,000원)을 동일 조회경로
// (COALESCE(seller_staff_id, therapist_id)·차감기준·2026-07·cosmeticLines 버킷)로 재조회한 뒤,
// 김주연 총괄 라인별 정정 5건을 애플리케이션 레벨(집계 산출단계)에서 반영해 정정본을 산출한다.
// DB 미변경. 실행: node scripts/T-20260801-cosmetic-sales-lineitem-correction.mjs 2026-07-01 2026-07-31
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY; // read-only 사용
if (!URL_ || !KEY) throw new Error('env missing');
if (!URL_.includes('rxlomoozakkjesdqjtvd')) throw new Error('NOT prod DB: ' + URL_);
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

const from = process.argv[2] || '2026-07-01';
const to = process.argv[3] || '2026-07-31';
const won = (n) => n.toLocaleString('ko-KR') + '원';

async function getSimIds(clinicId) {
  const { data } = await sb.from('customers').select('id').eq('clinic_id', clinicId).eq('is_simulation', true);
  return new Set((data ?? []).map((c) => c.id));
}

async function main() {
  const { data: clinics } = await sb.from('clinics').select('id, name');
  if (!clinics?.length) throw new Error('no clinics');
  const clinic = clinics[0];

  // 1) 풋화장품 service_id 집합 (원 pull과 동일)
  const { data: svcRows } = await sb
    .from('services')
    .select('id, name, category, category_label')
    .eq('clinic_id', clinic.id)
    .or('category.eq.풋화장품,category_label.eq.풋화장품');
  const cosmeticIds = (svcRows ?? []).map((s) => s.id);

  // 2) check_in_services 화장품 라인 + check_ins 귀속 (원 pull과 동일)
  const { data, error } = await sb
    .from('check_in_services')
    .select(
      `id, price, seller_staff_id, service_id, service_name,
       check_ins!inner(therapist_id, clinic_id, checked_in_at, customer_id,
         customers(name, chart_number))`,
    )
    .in('service_id', cosmeticIds)
    .eq('check_ins.clinic_id', clinic.id)
    .gte('check_ins.checked_in_at', `${from}T00:00:00+09:00`)
    .lte('check_ins.checked_in_at', `${to}T23:59:59+09:00`)
    .gt('price', 0);
  if (error) throw error;

  const simIds = await getSimIds(clinic.id);
  let rows = data ?? [];
  if (simIds.size > 0) rows = rows.filter((r) => !r.check_ins?.customer_id || !simIds.has(r.check_ins.customer_id));

  // 정규 아이템으로 변환
  const items = rows.map((r) => ({
    lineId: r.id,
    bucket: r.seller_staff_id ?? r.check_ins?.therapist_id ?? null,
    customerName: r.check_ins?.customers?.name ?? '(비회원/워크인)',
    chart: r.check_ins?.customers?.chart_number ?? null,
    productName: r.service_name ?? '(제품명 없음)',
    amount: r.price ?? 0,
    saleDate: r.check_ins?.checked_in_at ? r.check_ins.checked_in_at.slice(0, 10) : null,
    _sellerDirect: r.seller_staff_id != null, // 7/25 이후 seller 직접기록 여부 판별용
  })).filter((it) => it.bucket);

  // staff 이름
  const staffIds = [...new Set(items.map((it) => it.bucket))];
  const { data: staffRows } = staffIds.length
    ? await sb.from('staff').select('id, name').in('id', staffIds)
    : { data: [] };
  const nameOf = new Map((staffRows ?? []).map((s) => [s.id, s.name]));
  const idOfName = new Map((staffRows ?? []).map((s) => [s.name, s.id]));
  items.forEach((it) => (it.seller = nameOf.get(it.bucket) ?? '(미상)'));

  // ===== 원본(정정 전) =====
  console.log('\n================ 원본 재조회 (정정 전) ================');
  printGroups(items);

  // ===== #3 누락 진단: 임별 / 김정숙 F-4872 풋샴푸 42,000 =====
  console.log('\n================ #3 누락행 진단 (임별/김정숙 F-4872 풋샴푸 42,000) ================');
  // (a) 고객 존재?
  const { data: cust } = await sb
    .from('customers')
    .select('id, name, chart_number, is_simulation')
    .eq('clinic_id', clinic.id)
    .or('chart_number.eq.F-4872,name.eq.김정숙');
  console.log('고객 매칭:', JSON.stringify(cust));
  const custIds = (cust ?? []).map((c) => c.id);
  if (custIds.length) {
    // (b) 해당 고객의 7월 check_in_services 전체(카테고리 필터 없이)
    const { data: allLines } = await sb
      .from('check_in_services')
      .select(`id, price, seller_staff_id, service_id, service_name,
        services(name, category, category_label),
        check_ins!inner(therapist_id, clinic_id, checked_in_at, customer_id)`)
      .eq('check_ins.clinic_id', clinic.id)
      .in('check_ins.customer_id', custIds)
      .gte('check_ins.checked_in_at', `${from}T00:00:00+09:00`)
      .lte('check_ins.checked_in_at', `${to}T23:59:59+09:00`);
    console.log(`해당 고객 7월 check_in_services ${(allLines ?? []).length}건:`);
    (allLines ?? []).forEach((l) => {
      const inCat = cosmeticIds.includes(l.service_id);
      console.log(
        `  line=${l.id} svc="${l.service_name}" price=${l.price} seller=${l.seller_staff_id ?? 'NULL'} ` +
        `svcCat="${l.services?.category ?? ''}"/"${l.services?.category_label ?? ''}" ` +
        `inCosmeticWhitelist=${inCat} at=${l.check_ins?.checked_in_at?.slice(0,10)}`,
      );
    });
    // (c) 풋샴푸 라는 service가 화이트리스트에 있는지
    const { data: shampoo } = await sb
      .from('services')
      .select('id, name, category, category_label')
      .eq('clinic_id', clinic.id)
      .ilike('name', '%샴푸%');
    console.log('샴푸류 service 정의:', JSON.stringify(shampoo));
  }

  // ===== 정정 적용 =====
  const krId = idOfName.get('김규리');
  const log = [];
  let corrected = items.map((it) => ({ ...it }));

  // 1) 김규리 - 김민경 2건 테스트 → 제외
  const before1 = corrected.length;
  corrected = corrected.filter((it) => !(it.seller === '김규리' && it.customerName === '김민경'));
  log.push(`#1 김규리/김민경 테스트 제외: ${before1 - corrected.length}건 제외`);

  // 2b) 오렌지족 테스트 → 제외 (고객명 기준)
  const before2b = corrected.length;
  corrected = corrected.filter((it) => !(it.customerName && it.customerName.includes('오렌지족')));
  log.push(`#2b 오렌지족 테스트 제외: ${before2b - corrected.length}건 제외`);

  // 4) 윤시하 - 정가언 명단에 없음 → 제외
  const before4 = corrected.length;
  corrected = corrected.filter((it) => !(it.seller === '윤시하' && it.customerName === '정가언'));
  log.push(`#4 윤시하/정가언 제외: ${before4 - corrected.length}건 제외`);

  // 2a) 최다혜 - 김현수 → 김규리 재귀속 (zero-sum)
  let moved2a = 0;
  corrected.forEach((it) => {
    if (it.seller === '최다혜' && it.customerName === '김현수') {
      it.seller = '김규리'; it.bucket = krId; it._reattr = true; moved2a++;
    }
  });
  log.push(`#2a 최다혜→김규리 재귀속(김현수): ${moved2a}건 이동`);

  // 5) 최민지 - 김영웅 → 김규리 재귀속 (zero-sum)
  let moved5 = 0;
  corrected.forEach((it) => {
    if (it.seller === '최민지' && it.customerName === '김영웅') {
      it.seller = '김규리'; it.bucket = krId; it._reattr = true; moved5++;
    }
  });
  log.push(`#5 최민지→김규리 재귀속(김영웅): ${moved5}건 이동`);

  // 3) 임별 - 김정숙 F-4872 풋샴푸 42,000 누락 → 추가 (application-level)
  corrected.push({
    seller: '임별', bucket: idOfName.get('임별'), customerName: '김정숙', chart: 'F-4872',
    productName: '풋샴푸', amount: 42000, saleDate: null, _added: true,
  });
  log.push(`#3 임별/김정숙 F-4872 풋샴푸 42,000 누락 추가: 1건 INSERT(명단상)`);

  console.log('\n================ 정정 로그 ================');
  log.forEach((l) => console.log('  ' + l));

  console.log('\n================ 정정본 ================');
  const g0 = items.reduce((s, it) => s + it.amount, 0);
  const g1 = corrected.reduce((s, it) => s + it.amount, 0);
  printGroups(corrected, true);
  console.log(`\n정정 전 합계: ${won(g0)} (${items.length}건)`);
  console.log(`정정 후 합계: ${won(g1)} (${corrected.length}건)`);

  // 재귀속 건 7/25 판별
  console.log('\n================ 재귀속 2건 7/25 판별 (Tier2 대비) ================');
  [...items].filter((it) =>
    (it.seller === '최다혜' && it.customerName === '김현수') ||
    (it.seller === '최민지' && it.customerName === '김영웅')
  ).forEach((it) => {
    console.log(`  ${it.seller}/${it.customerName} ${it.saleDate} sellerDirect=${it._sellerDirect} ` +
      `(${it._sellerDirect ? '7/25이후 seller직접기록→단순정정' : 'seller_staff_id NULL→therapist귀속(7/25이전 성격)'})`);
  });
}

function printGroups(items, corrected = false) {
  const map = new Map();
  items.forEach((it) => {
    const e = map.get(it.seller) ?? { amount: 0, count: 0, items: [] };
    e.amount += it.amount; e.count += 1; e.items.push(it);
    map.set(it.seller, e);
  });
  const groups = [...map.entries()].map(([name, e]) => ({ name, ...e })).sort((a, b) => b.amount - a.amount);
  groups.forEach((g) => {
    console.log(`\n${g.name} — 소계 ${won(g.amount)} (${g.count}건)`);
    g.items.sort((a, b) => (b.saleDate ?? '').localeCompare(a.saleDate ?? '') || b.amount - a.amount);
    g.items.forEach((it) => {
      const tag = it._added ? ' [정정:누락추가]' : it._reattr ? ' [정정:재귀속]' : '';
      console.log(`  - ${it.customerName}${it.chart ? `(${it.chart})` : ''} | ${it.productName} | ${won(it.amount)} | ${it.saleDate ?? '-'}${tag}`);
    });
  });
}

main().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });

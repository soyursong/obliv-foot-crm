// T-20260801-foot-COSMETIC-SALES-DB-PULL — SELECT-only.
// 치료사별 화장품 판매 명단을 SalesStaffTab.tsx 의 cosmeticLines / cosmeticBySeller /
// cosmeticDetailBySeller 버킷 로직과 100% 동일 경로로 재현한다(화면 숫자와 정합 보장).
// 실행: node scripts/T-20260801-cosmetic-sales-pull.mjs 2026-07-01 2026-07-31
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// .env.local (prod: rxlomoozakkjesdqjtvd) 로드
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
  // clinic 확정
  const { data: clinics } = await sb.from('clinics').select('id, name');
  if (!clinics?.length) throw new Error('no clinics');
  const clinic = clinics[0]; // 단일지점(풋). 다지점이면 첫 지점.
  if (clinics.length > 1) console.error('WARN multiple clinics:', clinics.map((c) => c.name));

  // 1) 풋화장품 service_id 집합 (SalesStaffTab 라인 336)
  const { data: svcRows } = await sb
    .from('services')
    .select('id')
    .eq('clinic_id', clinic.id)
    .or('category.eq.풋화장품,category_label.eq.풋화장품');
  const cosmeticIds = (svcRows ?? []).map((s) => s.id);
  if (cosmeticIds.length === 0) {
    console.log('__NO_COSMETIC_SERVICE__');
    return;
  }

  // 2) check_in_services 화장품 라인 + check_ins 귀속 (라인 341-354)
  const { data, error } = await sb
    .from('check_in_services')
    .select(
      `price, seller_staff_id, service_id, service_name,
       check_ins!inner(therapist_id, clinic_id, checked_in_at, customer_id,
         customers(name, chart_number))`,
    )
    .in('service_id', cosmeticIds)
    .eq('check_ins.clinic_id', clinic.id)
    .gte('check_ins.checked_in_at', `${from}T00:00:00+09:00`)
    .lte('check_ins.checked_in_at', `${to}T23:59:59+09:00`)
    .gt('price', 0);
  if (error) throw error;

  // sim 고객 제외 (라인 357-363)
  const simIds = await getSimIds(clinic.id);
  let rows = data ?? [];
  if (simIds.size > 0) rows = rows.filter((r) => !r.check_ins?.customer_id || !simIds.has(r.check_ins.customer_id));

  // 버킷 = COALESCE(seller_staff_id, therapist_id), NULL 제외 (라인 367-406)
  const bySeller = new Map(); // bucket -> {amount, count, items:[]}
  rows.forEach((r) => {
    const bucket = r.seller_staff_id ?? r.check_ins?.therapist_id ?? null;
    if (!bucket) return;
    const e = bySeller.get(bucket) ?? { amount: 0, count: 0, items: [] };
    e.amount += r.price ?? 0;
    e.count += 1;
    e.items.push({
      customerName: r.check_ins?.customers?.name ?? '(비회원/워크인)',
      productName: r.service_name ?? '(제품명 없음)',
      amount: r.price ?? 0,
      saleDate: r.check_ins?.checked_in_at ? r.check_ins.checked_in_at.slice(0, 10) : null,
    });
    bySeller.set(bucket, e);
  });

  // staff 이름
  const staffIds = [...bySeller.keys()];
  const { data: staffRows } = staffIds.length
    ? await sb.from('staff').select('id, name').in('id', staffIds)
    : { data: [] };
  const nameOf = new Map((staffRows ?? []).map((s) => [s.id, s.name]));

  // 정렬: 판매일 desc, 금액 desc (라인 402-403)
  for (const e of bySeller.values())
    e.items.sort((a, b) => (b.saleDate ?? '').localeCompare(a.saleDate ?? '') || b.amount - a.amount);

  const groups = [...bySeller.entries()]
    .map(([id, e]) => ({ id, name: nameOf.get(id) ?? '(미상 staff)', ...e }))
    .sort((a, b) => b.amount - a.amount);

  const grand = groups.reduce((s, g) => s + g.amount, 0);
  const out = { from, to, clinic: clinic.name, groups, grand, groupCount: groups.length, lineCount: rows.length };
  console.log('__JSON__' + JSON.stringify(out));
}
main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});

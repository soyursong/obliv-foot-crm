// T-20260801-foot-CUST-F4741-COSMETIC-SALE-0725-REMOVE — READ-ONLY 판정근거 스냅샷.
// F-4741(김병완) 화장품 판매 레코드 전건 나열 + 7/25 중복/오기재 실증 + 매칭 수납 + 8/1 미수정산 인과 판정.
// ★prod mutation 절대 없음(SELECT only). DA CONSULT GO 前 실행 안전.
// 실행: node scripts/T-20260801-foot-CUST-F4741-COSMETIC-SALE-0725-REMOVE_investigate.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY; // read-only 사용
if (!URL_ || !KEY) throw new Error('env missing');
if (!URL_.includes('rxlomoozakkjesdqjtvd')) throw new Error('NOT prod DB: ' + URL_);
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

const won = (n) => (n ?? 0).toLocaleString('ko-KR') + '원';
const line = (s='') => console.log(s);

async function main() {
  // 0) 고객 확정 — chart_number F-4741 또는 이름 김병완
  const { data: custs, error: cErr } = await sb
    .from('customers')
    .select('id, name, chart_number, phone, clinic_id, is_simulation, created_at')
    .or('chart_number.eq.F-4741,chart_number.eq.4741,name.eq.김병완');
  if (cErr) throw cErr;
  line('=== [0] 고객 매칭 ===');
  (custs ?? []).forEach((c) => line(`  ${c.chart_number} | ${c.name} | phone=${c.phone} | id=${c.id} | sim=${c.is_simulation} | created=${c.created_at?.slice(0,10)}`));
  if (!custs?.length) { line('__NO_CUSTOMER__ F-4741/김병완 매칭 0건'); return; }
  // F-4741 우선, 없으면 김병완
  const target = custs.find((c) => c.chart_number === 'F-4741') ?? custs.find((c) => c.name === '김병완') ?? custs[0];
  line(`  → target: ${target.chart_number} ${target.name} (id=${target.id})`);
  const clinicId = target.clinic_id;

  // 1) 풋화장품 service_id 집합
  const { data: svcRows } = await sb
    .from('services').select('id, name, category, category_label, price')
    .eq('clinic_id', clinicId)
    .or('category.eq.풋화장품,category_label.eq.풋화장품');
  const cosmeticIds = new Set((svcRows ?? []).map((s) => s.id));
  line(`\n=== [1] 풋화장품 service ${cosmeticIds.size}종 ===`);

  // 2) target 고객의 모든 check_ins (전 기간)
  const { data: cis, error: ciErr } = await sb
    .from('check_ins')
    .select('id, checked_in_at, status, visit_type, therapist_id, created_at')
    .eq('customer_id', target.id)
    .order('checked_in_at', { ascending: true });
  if (ciErr) throw ciErr;
  const ciIds = (cis ?? []).map((c) => c.id);
  line(`\n=== [2] check_ins 전건 ${ciIds.length}건 ===`);
  (cis ?? []).forEach((c) => line(`  ci=${c.id} | ${c.checked_in_at} | status=${c.status} | visit=${c.visit_type}`));

  // 3) 이 고객의 화장품 판매 라인 전건 (check_in_services)
  let cosLines = [];
  if (ciIds.length) {
    const { data: cisvc, error: sErr } = await sb
      .from('check_in_services')
      .select('id, check_in_id, price, seller_staff_id, service_id, service_name, created_at')
      .in('check_in_id', ciIds);
    if (sErr) throw sErr;
    cosLines = (cisvc ?? []).filter((r) => cosmeticIds.has(r.service_id) && (r.price ?? 0) > 0);
  }
  const ciById = new Map((cis ?? []).map((c) => [c.id, c]));
  line(`\n=== [3] ★화장품 판매 레코드 전건 ${cosLines.length}건 (전 기간) ===`);
  cosLines
    .map((r) => ({ ...r, saleDate: ciById.get(r.check_in_id)?.checked_in_at?.slice(0,10) }))
    .sort((a, b) => (a.saleDate ?? '').localeCompare(b.saleDate ?? ''))
    .forEach((r) => line(`  [${r.saleDate}] ${r.service_name} | ${won(r.price)} | cis_id=${r.id} | ci=${r.check_in_id} | seller=${r.seller_staff_id ?? '(null)'} | created=${r.created_at?.slice(0,19)}`));

  // 3b) 7/25 판매건 중복 판정 (동일 제품/금액 2건+?)
  const d0725 = cosLines.filter((r) => ciById.get(r.check_in_id)?.checked_in_at?.slice(0,10) === '2026-07-25');
  line(`\n=== [3b] 7/25 화장품 판매 ${d0725.length}건 ===`);
  d0725.forEach((r) => line(`  ${r.service_name} | ${won(r.price)} | cis_id=${r.id} | ci=${r.check_in_id} | created=${r.created_at?.slice(0,19)}`));
  // 중복 지문: 동일 (service_id, price) 조합 카운트 (전 기간)
  const fp = new Map();
  cosLines.forEach((r) => { const k = `${r.service_id}|${r.price}`; fp.set(k, (fp.get(k) ?? 0) + 1); });
  line('  [중복지문] 동일(service_id|price) 카운트:');
  [...fp.entries()].forEach(([k, n]) => line(`    ${k} → ${n}건${n >= 2 ? '  ⚠중복후보' : ''}`));

  // 4) 이 고객의 모든 payments (전 기간) — check_in_id 기준
  let pays = [];
  if (ciIds.length) {
    const { data: pRows, error: pErr } = await sb
      .from('payments')
      .select('id, check_in_id, amount, method, payment_type, status, tax_type, created_at, paid_at')
      .in('check_in_id', ciIds)
      .order('created_at', { ascending: true });
    if (pErr) { line('  payments select err(일부컬럼 부재 재시도): ' + pErr.message);
      const { data: p2 } = await sb.from('payments').select('id, check_in_id, amount, method, payment_type, status, created_at').in('check_in_id', ciIds).order('created_at', { ascending: true });
      pays = p2 ?? [];
    } else pays = pRows ?? [];
  }
  line(`\n=== [4] payments 전건 ${pays.length}건 (check_in 귀속) ===`);
  pays.forEach((p) => line(`  pay=${p.id} | ci=${p.check_in_id} | ${won(p.amount)} | method=${p.method} | type=${p.payment_type} | tax=${p.tax_type ?? '-'} | status=${p.status} | created=${p.created_at?.slice(0,19)} | paid=${p.paid_at?.slice(0,19) ?? '-'}`));

  // 4b) 7/25 판매건 매칭 수납 유무
  const ci0725 = new Set(d0725.map((r) => r.check_in_id));
  const pay0725 = pays.filter((p) => ci0725.has(p.check_in_id));
  line(`\n=== [4b] ★7/25 판매건(ci=${[...ci0725].join(',')}) 매칭 수납 ${pay0725.length}건 ===`);
  pay0725.forEach((p) => line(`  pay=${p.id} | ${won(p.amount)} | ${p.method} | status=${p.status} | created=${p.created_at?.slice(0,19)} | paid=${p.paid_at?.slice(0,19) ?? '-'}`));

  // 4c) 8/1 수납 레코드 (미수정산 후보)
  const pay0801 = pays.filter((p) => (p.paid_at ?? p.created_at ?? '').slice(0,10) === '2026-08-01' || (p.created_at ?? '').slice(0,10) === '2026-08-01');
  line(`\n=== [4c] ★8/1 수납 레코드 ${pay0801.length}건 ===`);
  pay0801.forEach((p) => line(`  pay=${p.id} | ci=${p.check_in_id} | ${won(p.amount)} | ${p.method} | status=${p.status} | created=${p.created_at?.slice(0,19)} | paid=${p.paid_at?.slice(0,19) ?? '-'} | ci-of-pay는 7/25판매건인가? ${ci0725.has(p.check_in_id) ? 'YES(=7/25판매 지연수납)' : 'NO(별건)'}`));

  // 5) 자동 판정 요약
  line('\n=== [5] ★자동 판정 요약 ===');
  const uniqueCosmeticSales = cosLines.length;
  const has0725Dup = d0725.length >= 2;
  const pay0801LinkedTo0725 = pay0801.some((p) => ci0725.has(p.check_in_id));
  line(`  화장품 판매 총 ${uniqueCosmeticSales}건 / 7/25 판매 ${d0725.length}건 (중복=${has0725Dup ? 'YES' : 'NO'})`);
  line(`  7/25 매칭수납 ${pay0725.length}건 / 8/1 수납 ${pay0801.length}건`);
  line(`  8/1 수납이 7/25 판매건 지연수납인가? ${pay0801LinkedTo0725 ? 'YES' : 'NO'}`);
  line('');
  if (d0725.length === 1 && pay0801LinkedTo0725) {
    line('  ▶ 판정: 7/25가 유일 판매기록 + 8/1이 그 지연수납 → 【정당 판매】 오기재 아님.');
    line('    → 삭제 금지. planner escalate(총괄 재확인) 필요.');
  } else if (has0725Dup) {
    line('  ▶ 판정: 7/25 동일제품/금액 2건+ 중복 실증 → 【중복 오기재】 후보. DA GO 후 1건 archive-first 제거 가능.');
    line('    ※ 단, 8/1 수납이 남은 1건과 정합하는지 재확인 필수(무접점 대상 식별).');
  } else {
    line('  ▶ 판정: 자동판정 불확정 → 위 [3b][4b][4c] 원자료로 수기 판정 + planner 협의.');
  }
  line('\n__DONE__ (read-only, no mutation)');
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });

/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — 인벤토리/해석 (READ-ONLY, WRITE 0)
 *
 * 목적: prod 백필(check_in_services 화장품 8건) 전 안전 게이트 —
 *   1) chart_number(F-XXXX) → customer UUID 전건 resolve (미해결 시 abort 근거)
 *   2) 판매치료사명 → staff_id resolve
 *   3) 풋화장품 service_id (CTB / 풋샴푸) resolve
 *   4) 대상 customer 의 해당일자 check_ins 존재 여부 (parent 필요성 판정)
 *   5) 멱등성: 기존재 화장품 라인(동일 고객+제품+일자) 사전조회 → 중복 INSERT 방지
 *
 * *** SELECT 만. WRITE 0. ***
 */
import { writeFileSync } from 'node:fs';
import { q } from './dryrun_lib.mjs';

const OUT = new URL('./T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL_inventory.json', import.meta.url);
const esc = (s) => String(s).replace(/'/g, "''");

// SSOT (이미지 검증본): 채취날짜=판매일, chart F-XXXX, 제품, 금액, 판매치료사
const TARGETS = [
  { n: 1, sale_date: '2026-07-21', name: '하유희', chart: 'F-4696', product: 'CTB',      amount: 15000, seller: '조선미' },
  { n: 2, sale_date: '2026-07-15', name: '황보경시', chart: 'F-4582', product: 'CTB',    amount: 15000, seller: '임별' },
  { n: 3, sale_date: '2026-07-18', name: '김정숙', chart: 'F-4872', product: 'SHAMPOO',   amount: 42000, seller: '임별' },
  { n: 4, sale_date: '2026-07-21', name: '이동권', chart: 'F-4923', product: 'CTB',      amount: 15000, seller: '조선미' },
  { n: 5, sale_date: '2026-07-18', name: '이영수', chart: 'F-4550', product: 'CTB',      amount: 15000, seller: '김규리' },
  { n: 6, sale_date: '2026-07-22', name: '김미성', chart: 'F-5016', product: 'CTB',      amount: 15000, seller: '김규리' },
  { n: 7, sale_date: '2026-07-22', name: '백연재', chart: 'F-4906', product: 'CTB',      amount: 15000, seller: '김규리' },
  { n: 8, sale_date: '2026-07-23', name: '김현수', chart: 'F-4789', product: 'CTB',      amount: 15000, seller: '김규리' },
];

async function main() {
  console.log('===== BACKFILL 인벤토리 (READ-ONLY, WRITE 0) =====\n');

  // clinic 확인 (foot 단일지점)
  const clinics = await q(`SELECT id, name, slug FROM clinics ORDER BY created_at LIMIT 5;`);
  console.log('[clinics]', JSON.stringify(clinics));

  // 1) chart_number resolve — F-XXXX 및 XXXX 양형 매칭
  const chartVariants = TARGETS.flatMap((t) => {
    const digits = t.chart.replace(/^F-?/i, '');
    return [t.chart, `F-${digits}`, `F${digits}`, digits];
  });
  const inList = [...new Set(chartVariants)].map((c) => `'${esc(c)}'`).join(',');
  const custRows = await q(`
    SELECT id, chart_number, name, phone, clinic_id, is_simulation
    FROM customers
    WHERE chart_number IN (${inList})
    ORDER BY chart_number;
  `);
  console.log(`\n[customers matched] ${custRows.length} rows`);
  for (const c of custRows) {
    console.log(`  chart=${c.chart_number} name=${c.name} id=${String(c.id).slice(0,8)} sim=${c.is_simulation}`);
  }

  // 2) staff resolve
  const sellers = [...new Set(TARGETS.map((t) => t.seller))];
  const sList = sellers.map((s) => `'${esc(s)}'`).join(',');
  const staffRows = await q(`SELECT id, name, role, active, clinic_id FROM staff WHERE name IN (${sList}) ORDER BY name;`);
  console.log(`\n[staff matched] ${staffRows.length} rows`);
  for (const s of staffRows) console.log(`  name=${s.name} id=${String(s.id).slice(0,8)} role=${s.role} active=${s.active}`);

  // 3) 풋화장품 서비스 목록
  const svcRows = await q(`
    SELECT id, name, category, category_label, price, service_code, active
    FROM services
    WHERE category = '풋화장품' OR category_label = '풋화장품'
    ORDER BY name;
  `);
  console.log(`\n[풋화장품 services] ${svcRows.length} rows`);
  for (const s of svcRows) console.log(`  name="${s.name}" price=${s.price} code=${s.service_code} id=${String(s.id).slice(0,8)} active=${s.active}`);

  // 4) 대상 customer 의 해당 일자 check_ins 존재 여부
  const custByChart = {};
  for (const c of custRows) {
    const d = String(c.chart_number).replace(/^F-?/i, '');
    custByChart[d] = c;
  }
  console.log(`\n[대상 customer 해당일 check_ins 존재 여부]`);
  const checkinFindings = [];
  for (const t of TARGETS) {
    const digits = t.chart.replace(/^F-?/i, '');
    const c = custByChart[digits];
    if (!c) { console.log(`  #${t.n} chart=${t.chart} → ★ customer 미해결`); checkinFindings.push({ ...t, resolved: false }); continue; }
    const cis = await q(`
      SELECT id, checked_in_at, visit_type, status, therapist_id, technician_id
      FROM check_ins
      WHERE customer_id = '${esc(c.id)}'
        AND checked_in_at >= '${t.sale_date}T00:00:00+09:00'
        AND checked_in_at <= '${t.sale_date}T23:59:59+09:00'
      ORDER BY checked_in_at;
    `);
    console.log(`  #${t.n} ${t.name}(${t.chart}) ${t.sale_date}: check_ins ${cis.length}건` +
      (cis.length ? ` → ${cis.map((x)=>String(x.id).slice(0,8)+'/'+x.visit_type+'/ther='+String(x.therapist_id||'-').slice(0,8)).join(', ')}` : ' → ★ 당일 check_in 없음'));
    checkinFindings.push({ ...t, resolved: true, customer_id: c.id, checkins_on_date: cis.length, checkin_ids: cis.map((x)=>x.id) });
  }

  // 5) 멱등성 — 기존재 화장품 라인 (해당 고객 check_ins 에 걸린 화장품 서비스 라인)
  const cosmeticIds = svcRows.map((s) => s.id);
  console.log(`\n[멱등성 — 기존재 화장품 라인 조회]`);
  const idempotency = [];
  if (cosmeticIds.length) {
    const svcIn = cosmeticIds.map((id) => `'${esc(id)}'`).join(',');
    for (const t of TARGETS) {
      const digits = t.chart.replace(/^F-?/i, '');
      const c = custByChart[digits];
      if (!c) continue;
      const existing = await q(`
        SELECT cis.id, cis.service_name, cis.price, cis.seller_staff_id, ci.checked_in_at
        FROM check_in_services cis
        JOIN check_ins ci ON ci.id = cis.check_in_id
        WHERE ci.customer_id = '${esc(c.id)}'
          AND cis.service_id IN (${svcIn})
          AND ci.checked_in_at >= '${t.sale_date}T00:00:00+09:00'
          AND ci.checked_in_at <= '${t.sale_date}T23:59:59+09:00';
      `);
      if (existing.length) {
        console.log(`  #${t.n} ${t.name}(${t.chart}) ${t.sale_date}: ★ 기존재 ${existing.length}건 → 백필 대상 제외 후보`);
        for (const e of existing) console.log(`      "${e.service_name}" ${e.price}원 seller=${String(e.seller_staff_id||'-').slice(0,8)}`);
      } else {
        console.log(`  #${t.n} ${t.name}(${t.chart}) ${t.sale_date}: 기존재 0건 → 백필 대상`);
      }
      idempotency.push({ n: t.n, chart: t.chart, existing_count: existing.length });
    }
  }

  const out = {
    ticket: 'T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL',
    captured_by: 'agent-fdd-dev-foot',
    write: 0,
    clinics,
    customers_matched: custRows,
    staff_matched: staffRows,
    cosmetic_services: svcRows,
    checkin_findings: checkinFindings,
    idempotency,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n[저장] ${OUT.pathname}`);
  console.log('\n===== 요약 =====');
  console.log(`customers resolved: ${custRows.length}/8`);
  console.log(`staff resolved: ${staffRows.length}/${sellers.length} (${sellers.join(',')})`);
  console.log(`풋화장품 services: ${svcRows.length}`);
  console.log('===== END (WRITE 0) =====');
}
main().catch((e) => { console.error(e); process.exit(1); });

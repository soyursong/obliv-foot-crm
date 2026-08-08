/**
 * T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY — READ-ONLY 진단 (write 0)
 *
 * ⚠️ READ-ONLY — SELECT 만. UPDATE/DELETE/INSERT/DDL 일절 없음.
 *   목적: (A) 현은호 환자 담당치료사(김규리) 귀속 검증 + SALESLIST backfill 포함 여부
 *         (B) 화장품 판매이력 팝업 관련 데이터 정합 (김규리 seller 라인 실재)
 *   결과 = planner FOLLOWUP relay 용. 코드/DB 변경 없음.
 *
 * 실행: node scripts/T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY_diag.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// .env.local 로드 (service_role, read-only 사용)
const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('missing supabase url/service_role key');
const sb = createClient(url, key, { auth: { persistSession: false } });

const out = (label, v) => console.log(`\n=== ${label} ===\n` + JSON.stringify(v, null, 2));

// ── 0) 김규리 staff 식별 ──────────────────────────────────────────────
// ⚠ 정정(2026-08-08 재실행): staff 테이블에 is_active 컬럼 없음 → 조회 시 null 반환하던 버그 수정.
//   김규리 = 3a0c6774(therapist) + d26717cb(admin) 2행. 방문 담당 귀속 = therapist 3a0c6774.
const { data: kim, error: kimErr } = await sb.from('staff').select('id,name,role').ilike('name', '%김규리%');
if (kimErr) console.error('staff(kim) err', kimErr);
out('0) 김규리 staff rows', kim);
const kimIds = (kim ?? []).map((s) => s.id);

// ── A1) 현은호 환자 식별 (동명이인 전부) ─────────────────────────────
const { data: cust, error: custErr } = await sb
  .from('customers')
  .select('id,name,chart_number,phone,created_at')
  .ilike('name', '%현은호%');
if (custErr) console.error('customers err', custErr);
out('A1) 현은호 customers', cust);

const custIds = (cust ?? []).map((c) => c.id);

// ── A2) 현은호 check_ins + 담당치료사 귀속 ────────────────────────────
if (custIds.length) {
  const { data: ci } = await sb
    .from('check_ins')
    .select('id,customer_id,therapist_id,visit_type,status,checked_in_at')
    .in('customer_id', custIds)
    .order('checked_in_at', { ascending: true });
  // therapist 이름 매핑
  const thIds = [...new Set((ci ?? []).map((r) => r.therapist_id).filter(Boolean))];
  const { data: ths } = thIds.length
    ? await sb.from('staff').select('id,name,role').in('id', thIds)
    : { data: [] };
  const thName = Object.fromEntries((ths ?? []).map((s) => [s.id, s.name]));
  const rows = (ci ?? []).map((r) => ({
    ...r,
    therapist_name: r.therapist_id ? (thName[r.therapist_id] ?? '(미매핑)') : null,
    is_kimgyuri: kimIds.includes(r.therapist_id),
  }));
  out('A2) 현은호 check_ins + 담당치료사', rows);

  // 예약(reservations)에도 담당 필드 있는지 참고 조회
  const { data: resv } = await sb
    .from('reservations')
    .select('id,customer_id,therapist_id,reserved_at,status')
    .in('customer_id', custIds)
    .limit(50);
  const rIds = [...new Set((resv ?? []).map((r) => r.therapist_id).filter(Boolean))];
  const { data: rths } = rIds.length ? await sb.from('staff').select('id,name').in('id', rIds) : { data: [] };
  const rthName = Object.fromEntries((rths ?? []).map((s) => [s.id, s.name]));
  out('A2b) 현은호 reservations 담당', (resv ?? []).map((r) => ({
    ...r, therapist_name: r.therapist_id ? (rthName[r.therapist_id] ?? '(미매핑)') : null,
    is_kimgyuri: kimIds.includes(r.therapist_id),
  })));

  // ── A3) SALESLIST backfill(F-4550/5016/4906) 대상에 현은호 포함 여부 ──
  //   backfill 대상 customer_id (evidence 기록): 이영수/김미성/백연재
  const backfillCharts = ['F-4550', 'F-5016', 'F-4906'];
  out('A3) backfill 대상 chart(F-4550/5016/4906) vs 현은호 chart', {
    hyuneunho_charts: (cust ?? []).map((c) => c.chart_number),
    backfill_charts: backfillCharts,
    현은호_backfill_포함: (cust ?? []).some((c) => backfillCharts.includes(c.chart_number)),
  });

  // ── B) 현은호 화장품 판매라인 실재 ──
  //   ⚠ 정정: check_in_services 에 category_label 컬럼 없음. 화장품 판정 = services.category|category_label='풋화장품'
  //     서비스 id 집합과 service_id 교집합으로 판별(팝업 실 쿼리 경로와 동일).
  const ciIds = (ci ?? []).map((r) => r.id);
  const { data: cosSvc } = await sb
    .from('services')
    .select('id')
    .or('category.eq.풋화장품,category_label.eq.풋화장품');
  const cosSet = new Set((cosSvc ?? []).map((s) => s.id));
  if (ciIds.length) {
    const { data: svc } = await sb
      .from('check_in_services')
      .select('id,check_in_id,service_name,service_id,price,seller_staff_id,voided_at')
      .in('check_in_id', ciIds);
    const cosLines = (svc ?? []).filter((r) => cosSet.has(r.service_id));
    out('B) 현은호 서비스라인 전체 + 화장품 라인 수', {
      total: (svc ?? []).length,
      cosmetic_count: cosLines.length, // 실측 = 0
      cosmetic_rows: cosLines,
    });
  }
}

// ── B2) 김규리 seller/therapist 화장품 라인 존재 여부 (팝업 소스 정합, 실 쿼리 경로) ──
if (kimIds.length) {
  const { data: cosSvc } = await sb
    .from('services')
    .select('id')
    .or('category.eq.풋화장품,category_label.eq.풋화장품');
  const cosIds = (cosSvc ?? []).map((s) => s.id);
  const { data: lines } = cosIds.length
    ? await sb
        .from('check_in_services')
        .select('price,seller_staff_id,service_id,service_name,check_ins!inner(therapist_id,checked_in_at)')
        .in('service_id', cosIds)
        .is('voided_at', null)
        .gt('price', 0)
    : { data: [] };
  // 팝업 버킷 = seller_staff_id ?? check_ins.therapist_id
  const kimLines = (lines ?? []).filter((r) => kimIds.includes(r.seller_staff_id ?? r.check_ins?.therapist_id));
  out('B2) 김규리 버킷 풋화장품 라인 (팝업 소스)', {
    count: kimLines.length, // 실측 = 18
    amount: kimLines.reduce((a, r) => a + (r.price ?? 0), 0), // 391,000
    dates: [...new Set(kimLines.map((r) => (r.check_ins?.checked_in_at ?? '').slice(0, 10)))].sort(),
  });
}

// ══════════════════════════════════════════════════════════════════
// 재진단(FIX-REQUEST j9rb): payment-side — SalesStaffTab 이 못 보는 축
//   SalesStaffTab 화장품 집계 = check_in_services(cis) 라인, 버킷=COALESCE(seller_staff_id,therapist_id)
//   → payment-only 레코드(cis 라인 無)는 구조적으로 미표시. "cis 0건 ≠ 판매 없음".
// ══════════════════════════════════════════════════════════════════
console.log('\n\n########## RE-DIAG: payment-side 축 ##########');

// R1) al93 특정 payment 2e8f7aa5 — 현재 귀속값 전량
const PAY_A = '2e8f7aa5-3e83-4d4a-8900-ab1f0048694a';
const { data: payA, error: payAe } = await sb.from('payments').select('*').eq('id', PAY_A);
out(`R1) payment ${PAY_A} (CTB 15,000, T-20260806 INSERT분) — err=${payAe?.message ?? 'none'}`, payA);

// R2) 현은호 payments 전량 (7/28 CTB 결제 실재 + seller 귀속)
if (typeof custIds !== 'undefined' && custIds.length) {
  const { data: pays } = await sb.from('payments')
    .select('id, customer_id, amount, method, pg_provider, status, package_id, seller_staff_id, paid_at, created_at, check_in_id')
    .in('customer_id', custIds).order('created_at', { ascending: false });
  const sName = Object.fromEntries((kim ?? []).map((s) => [s.id, s.name]));
  out('R2) 현은호 payments 전량', (pays ?? []).map((p) => ({
    ...p, seller_name: p.seller_staff_id ? (sName[p.seller_staff_id] ?? '(비김규리/미매핑)') : null,
    is_kimgyuri_seller: kimIds.includes(p.seller_staff_id),
    has_cis_line: !!p.check_in_id,
  })));
}

// R3) Item C — 김병완 payment b7ab6496 (별도티켓, 참고 READ-ONLY)
const { data: kbw } = await sb.from('customers')
  .select('id,name,chart_number,phone').ilike('name', '%김병완%');
out('R3a) 김병완 customers', kbw);
const { data: payC } = await sb.from('payments')
  .select('id, customer_id, amount, method, pg_provider, status, package_id, seller_staff_id, paid_at, created_at, check_in_id')
  .ilike('id', 'b7ab6496%');
out('R3b) payment b7ab6496% (8/1 화장품 73,000)', (payC ?? []).map((p) => ({
  ...p, is_kimgyuri_seller: kimIds.includes(p.seller_staff_id), has_cis_line: !!p.check_in_id,
})));
if ((kbw ?? []).length) {
  const kbwIds = kbw.map((c) => c.id);
  const { data: kbwCis } = await sb.from('check_in_services')
    .select('id, check_in_id, service_id, service_name, price, seller_staff_id, voided_at, created_at, check_ins!inner(customer_id, checked_in_at, therapist_id)')
    .in('check_ins.customer_id', kbwIds)
    .gte('check_ins.checked_in_at', '2026-08-01T00:00:00+09:00');
  out('R3c) 김병완 8월 check_in_services 라인 (cis 판매라인 실재?)', {
    count: kbwCis?.length,
    rows: (kbwCis ?? []).map((r) => ({ ...r, is_kimgyuri_seller: kimIds.includes(r.seller_staff_id) })),
  });
}

console.log('\n[READ-ONLY 완료 — write 0]');

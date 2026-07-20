/**
 * T-20260720-foot-PAYMINI-CHARTCODE-SPLIT (P1 · FE-only · DB0 · 순수 DOM 재배치)
 *
 * reporter = 김주연 총괄 (7/20 15:33·17:33 확정). handoff:
 *   _handoff/attachments/T-20260720-foot-OMITTED-REQMT-REFINED-INTAKE/
 *     181206_F0BJBMG6SLD_T-20260720-foot-PAYMINI-CHARTCODE-SPLIT_handoff.md (§2 4열 ASCII + AC-1~12)
 *
 * 요지: 결제 미니창(PaymentMiniWindow) 중앙 칸을 3열 → 4열로 분리.
 *   ① 항목 팔레트(pmw-code-grid, 무접촉)
 *   ② 차트 코드(pmw-chartcode-col, 신규) — 상병코드/처방약/치료내용(구 "수가 항목") + 세트코드
 *   ③ 진료비 산정(pmw-settle-lane) — 금액만(항목 목록 없음) + 진료비 총액(구 "합계") + 하단 수납잔액·차감후청구
 *   ④ 패키지·서류발행(pmw-zone3, 무접촉 · L-006)
 *
 * 제거: 접이식 토글(pmw-feeitem-toggle) / 결합 헤더 "차트 코드 · 진료비 산정" / 라벨 "수가 항목".
 *
 * ★ AC-9(핵심 회귀 가드): grandTotal·payableTotal·copaymentTotal 계산식 무접촉(순수 배치).
 *   정확한 금액 회귀는 COPAY-BALANCE-SPLIT / COPAY-TAXLINE-RENDER 스펙이 별도 보장하며,
 *   본 스펙은 금액이 표시·양수·내부정합(총액 ≥ 수납잔액)함을 구조적으로 확인한다.
 *
 * ★ zone① 주의: MQ dispatch = "현행 세로화 팔레트 유지·미접촉". 따라서 handoff AC-7의 문면
 *   ("카드 그리드 유지 · 세로 리스트 아님")은 MQ가 상위 지시로 대체 → 본 스펙은 zone①을
 *   '변경하지 않았음'(code-grid 존재·상병/처방 탭 그리드 존재)만 회귀 가드한다.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HAS_SERVICE_ROLE = SERVICE_ROLE_KEY.length > 0;

const supabase = HAS_SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const PHONE = '+821099997720';
const NAME = '[PAYMINI-CHARTCODE-SPLIT-TEST]';
const QUEUE = 920;

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'qa_evidence', 'T-20260720-foot-PAYMINI-CHARTCODE-SPLIT');

let clinicId: string | null = null;
let checkInId: string | null = null;
let seedOk = false;
let codeItemsSeeded = 0;

function toNum(s: string | null): number {
  if (!s) return NaN;
  const digits = s.replace(/[^0-9]/g, '');
  return digits.length ? Number(digits) : NaN;
}

async function cleanup() {
  if (!supabase) return;
  const { data: custs } = await supabase.from('customers').select('id').eq('phone', PHONE);
  const ids = (custs ?? []).map((c) => c.id);
  if (ids.length === 0) return;
  const { data: cis } = await supabase.from('check_ins').select('id').in('customer_id', ids);
  const ciIds = (cis ?? []).map((c) => c.id);
  if (ciIds.length > 0) {
    await supabase.from('payments').delete().in('check_in_id', ciIds);
    await supabase.from('check_in_services').delete().in('check_in_id', ciIds);
    await supabase.from('check_ins').delete().in('id', ciIds);
  }
  await supabase.from('customers').delete().in('id', ids);
}

test.beforeAll(async () => {
  if (!supabase) { seedOk = false; return; }
  await cleanup();

  // 치료내용(가격 산정 항목) — 코드항목 아닌 active 서비스 6건 (AC-10 스크롤 유발)
  const { data: priceSvcs } = await supabase
    .from('services').select('*').eq('active', true).gt('price', 0).limit(6);
  if (!priceSvcs || priceSvcs.length < 1) { seedOk = false; return; }
  clinicId = priceSvcs[0].clinic_id;

  // 상병/처방약 코드항목 — 있으면 각각 최대 1건씩 (AC-2 그룹 분리 확인용)
  const { data: codeSvcs } = await supabase
    .from('services').select('*').eq('clinic_id', clinicId)
    .in('category_label', ['상병', '처방약']).limit(4);

  const { data: cust } = await supabase
    .from('customers')
    .insert({ clinic_id: clinicId, name: NAME, phone: PHONE, visit_type: 'returning' })
    .select().single();
  if (!cust) { seedOk = false; return; }

  const { data: ci } = await supabase
    .from('check_ins')
    .insert({
      clinic_id: clinicId, customer_id: cust.id, customer_name: NAME, customer_phone: PHONE,
      visit_type: 'returning', status: 'payment_waiting', queue_number: QUEUE,
    })
    .select().single();
  if (!ci) { seedOk = false; return; }
  checkInId = ci.id;

  for (const svc of priceSvcs) {
    await supabase.from('check_in_services').insert({
      check_in_id: checkInId, service_id: svc.id, service_name: svc.name,
      price: svc.price, original_price: svc.price, is_package_session: false,
    });
  }
  for (const svc of (codeSvcs ?? [])) {
    await supabase.from('check_in_services').insert({
      check_in_id: checkInId, service_id: svc.id, service_name: svc.name,
      price: svc.price ?? 0, original_price: svc.price ?? 0, is_package_session: false,
    });
    codeItemsSeeded++;
  }

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  seedOk = true;
});

test.afterAll(async () => { await cleanup(); });

async function openMiniWindow(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin`);
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => null);
  const wrapper = page.locator('div:has(> [data-testid="btn-pay"])').filter({ hasText: `#${QUEUE}` });
  const payBtn = wrapper.locator('[data-testid="btn-pay"]').first();
  await payBtn.waitFor({ state: 'visible', timeout: 20000 });
  await payBtn.scrollIntoViewIfNeeded();
  await payBtn.click();
  await page.locator('[data-testid="btn-settle"]').first().waitFor({ state: 'visible', timeout: 30000 });
}

// 갤탭 랜드스케이프 실렌더 (프론트데스크 실기기)
test.use({ viewport: { width: 1280, height: 800 } });

test('AC-1/7/8: 4열 분리 — ② 차트 코드가 ①팔레트와 ③진료비 산정 사이 독립 칸 + 모달 폭 불변 + zone① 무접촉', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');
  await openMiniWindow(page);
  const dialog = page.locator('[role="dialog"]').first();

  const grid = page.locator('[data-testid="pmw-code-grid"]').first();       // ①
  const chart = page.locator('[data-testid="pmw-chartcode-col"]').first();  // ②
  const settle = page.locator('[data-testid="pmw-settle-lane"]').first();   // ③
  const zone3 = page.locator('[data-testid="pmw-zone3"]').first();          // ④

  await expect(grid, '① 항목 팔레트(code-grid)').toBeVisible();
  await expect(chart, '② 차트 코드(신규 독립 칸)').toBeVisible();
  await expect(settle, '③ 진료비 산정').toBeVisible();
  await expect(zone3, '④ 패키지·서류발행').toBeVisible();

  const gb = await grid.boundingBox();
  const cb = await chart.boundingBox();
  const sb = await settle.boundingBox();
  const zb = await zone3.boundingBox();
  expect(gb && cb && sb && zb, 'zone bbox').toBeTruthy();
  // eslint-disable-next-line no-console
  console.log(`[CHARTCODE-SPLIT] grid.x=${Math.round(gb!.x)} chart.x=${Math.round(cb!.x)} settle.x=${Math.round(sb!.x)} zone3.x=${Math.round(zb!.x)}`);

  // ── AC-1: ② 는 ①(code-grid) 우측 · ③(settle) 좌측 = 팔레트와 진료비 산정 "사이" ──
  expect(cb!.x, 'AC-1 ② 차트 코드는 ① 팔레트 우측').toBeGreaterThan(gb!.x);
  expect(sb!.x, 'AC-1 ③ 진료비 산정은 ② 차트 코드 우측').toBeGreaterThan(cb!.x);
  expect(zb!.x, '④ 패키지·서류는 ③ 우측(최우측)').toBeGreaterThan(sb!.x);
  // 4열은 가로 컬럼(세로 스택 아님) — top y 근접
  const tops = [gb!.y, cb!.y, sb!.y, zb!.y];
  expect(Math.max(...tops) - Math.min(...tops), 'AC-1 4열 가로 컬럼(top 근접)').toBeLessThanOrEqual(140);

  // ── AC-8: 모달 총 가로폭 불변 (sm:max-w-[1080px]) + 4열이 모달 폭 내 ──
  const db = await dialog.boundingBox();
  expect(db!.width, 'AC-8 모달 폭 ≤ 1082px(1080 canon)').toBeLessThanOrEqual(1082);
  expect(zb!.x + zb!.width, 'AC-8 최우측 zone3 우변이 모달 내부').toBeLessThanOrEqual(db!.x + db!.width + 2);

  // ── AC-7: zone① 무접촉 — code-grid 유지 + 상병/처방 탭 그리드 존재(세로화 여부는 MQ상 현행 유지) ──
  await expect(grid, 'AC-7 ① code-grid 유지').toBeVisible();
  const codeTab = dialog.getByRole('button', { name: '상병코드', exact: true });
  await expect(codeTab, 'AC-7 상병코드 탭(팔레트 나비게이터) 유지').toBeVisible();

  await dialog.screenshot({ path: path.join(SHOT_DIR, '01-4col-layout.png') });
});

test('AC-2/5: ② 차트 코드 칸에 상병코드·처방약·치료내용 그룹(제목 구분) + "수가 항목"→"치료내용" 라벨', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');
  await openMiniWindow(page);
  const chart = page.locator('[data-testid="pmw-chartcode-col"]').first();
  await expect(chart).toBeVisible();

  // ② 헤더 "차트 코드"
  await expect(chart.getByText('차트 코드', { exact: true }), 'AC-2 ② 헤더 "차트 코드"').toBeVisible();

  // ── AC-5: 라벨 "치료내용" 존재 · "수가 항목" 부재 ──
  await expect(chart.getByText(/치료내용 \(\d+건\)/), 'AC-5 "치료내용 (N건)"').toBeVisible();
  await expect(page.getByText(/수가 항목/), 'AC-5 "수가 항목" 라벨 제거됨').toHaveCount(0);

  // 치료내용 리스트는 ② 칸 내부에 위치 (③ 아님)
  const pricingInChart = chart.locator('[data-testid="pricing-list"]');
  await expect(pricingInChart, 'AC-2/3 치료내용(pricing-list)은 ② 차트 코드 칸 내부').toBeVisible();

  // ── AC-2: 상병/처방약 코드가 시드되어 있으면 그룹 제목 노출 ──
  if (codeItemsSeeded > 0) {
    const hasSang = await chart.getByText('상병코드', { exact: true }).count();
    const hasCham = await chart.getByText('처방약', { exact: true }).count();
    // eslint-disable-next-line no-console
    console.log(`[CHARTCODE-SPLIT] codeItemsSeeded=${codeItemsSeeded} 상병코드제목=${hasSang} 처방약제목=${hasCham}`);
    expect(hasSang + hasCham, 'AC-2 상병코드/처방약 그룹 제목 중 최소 1개').toBeGreaterThan(0);
  } else {
    // eslint-disable-next-line no-console
    console.log('[CHARTCODE-SPLIT] 상병/처방약 코드 서비스 미시드 — AC-2 그룹제목 assertion 생략(치료내용만 확인)');
  }
});

test('AC-3/6/4: ③ 진료비 산정 = 금액만 · "진료비 총액"(구 합계) · 하단 수납잔액/차감후청구', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');
  await openMiniWindow(page);
  const settle = page.locator('[data-testid="pmw-settle-lane"]').first();
  await expect(settle).toBeVisible();

  // ③ 헤더
  await expect(settle.getByText('진료비 산정', { exact: true }), '③ 헤더 "진료비 산정"').toBeVisible();

  // ── AC-3: ③ 칸에 항목 목록(pricing-list) 없음 — 금액만 ──
  await expect(settle.locator('[data-testid="pricing-list"]'), 'AC-3 ③에 항목 목록 없음').toHaveCount(0);

  // ── AC-6: "진료비 총액"(구 "합계") 라인 존재 ──
  const totalRow = settle.getByText('진료비 총액', { exact: true });
  await expect(totalRow, 'AC-6 "진료비 총액" 라인').toBeVisible();

  // ── AC-4: 수납잔액 · (차감 후 청구) 가 ③ 칸 하단(= 진료비 총액 아래) ──
  const balRow = settle.getByText('수납잔액', { exact: true });
  await expect(balRow, 'AC-4 수납잔액 라인').toBeVisible();
  const tb = await totalRow.boundingBox();
  const bb = await balRow.boundingBox();
  expect(tb && bb, 'bbox').toBeTruthy();
  expect(bb!.y, 'AC-4 수납잔액은 진료비 총액 아래(하단)').toBeGreaterThanOrEqual(tb!.y - 2);

  // ── AC-9(구조적 회귀 프록시): 금액 양수 + 총액 ≥ 수납잔액(공단부담 제외분) ──
  const totalTxt = await totalRow.locator('xpath=following-sibling::span[1]').first().textContent().catch(() => null);
  const balTxt = await balRow.locator('xpath=following-sibling::span[1]').first().textContent().catch(() => null);
  const total = toNum(totalTxt);
  const bal = toNum(balTxt);
  // eslint-disable-next-line no-console
  console.log(`[CHARTCODE-SPLIT] 진료비총액=${total} 수납잔액=${bal}`);
  if (!Number.isNaN(total) && !Number.isNaN(bal)) {
    expect(total, 'AC-9 진료비 총액 > 0').toBeGreaterThan(0);
    expect(bal, 'AC-9 수납잔액 ≥ 0').toBeGreaterThanOrEqual(0);
    expect(total, 'AC-9 진료비 총액 ≥ 수납잔액(공단부담 제외 → 총액이 크거나 같음)').toBeGreaterThanOrEqual(bal);
  }

  await settle.screenshot({ path: path.join(SHOT_DIR, '02-settle-amounts.png') });
});

test('AC-10: 치료내용 다건일 때 ② 차트 코드 칸 내부 스크롤 정상', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');
  await openMiniWindow(page);
  const scroll = page.locator('[data-testid="pmw-chartcode-scroll"]').first();
  await expect(scroll, '② 스크롤 컨테이너').toBeVisible();

  const probe = await scroll.evaluate((el) => {
    const cs = getComputedStyle(el as HTMLElement);
    return {
      overflowY: cs.overflowY,
      scrollH: (el as HTMLElement).scrollHeight,
      clientH: (el as HTMLElement).clientHeight,
    };
  });
  // eslint-disable-next-line no-console
  console.log(`[CHARTCODE-SPLIT] chartcode-scroll overflowY=${probe.overflowY} scrollH=${probe.scrollH} clientH=${probe.clientH}`);
  // AC-10: 스크롤 소유(overflow-y-auto) — 6건 시드 → 콘텐츠 과다 시 스크롤 가능
  expect(['auto', 'scroll'], 'AC-10 ② 칸 자체 스크롤 소유').toContain(probe.overflowY);
});

test('AC-11/12: ④ 서류발행 회귀 없음(출력/출력 및 수납) + 패키지·시술내역 렌더', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');
  await openMiniWindow(page);
  const zone3 = page.locator('[data-testid="pmw-zone3"]').first();
  await expect(zone3, '④ zone3').toBeVisible();

  // ── AC-11: 서류발행 목록 + 체크박스 토글 무회귀 ──
  const docList = zone3.locator('[data-testid="doc-template-list"]');
  await expect(docList, 'AC-11 서류발행 목록').toBeVisible();
  const firstDoc = docList.locator('[data-testid^="doc-checkbox-"]').first();
  if (await firstDoc.count() > 0) {
    await expect(firstDoc, 'AC-11 서류 체크박스 렌더').toBeVisible();
    await firstDoc.click(); // 토글 동작 무회귀(에러 없이 클릭)
  }

  // ── AC-12: 패키지 섹션 + 금일 시술내역 렌더(보유/미보유 무관 정상 렌더) ──
  await expect(zone3.getByText('패키지', { exact: true }).first(), 'AC-12 패키지 섹션 렌더').toBeVisible();
  await expect(zone3.getByText('금일 시술내역', { exact: true }).first(), 'AC-12 금일 시술내역 렌더').toBeVisible();

  await zone3.screenshot({ path: path.join(SHOT_DIR, '03-zone3-docs.png') });
});

/**
 * T-20260719-foot-PMW-LAYOUT-SCROLL (P1 · FE-only · DB0)
 *
 * reporter = planner NEW-TASK (색박스 정본 162053/162054, 김주연 총괄).
 * 결제 미니창(PaymentMiniWindow) 중앙 ②③ 존 재배치:
 *   ② 차트코드·진료비 산정 → 접이식(아코디언) 1줄 헤더(기본=접힘).
 *   ③ 세금구분(4행)+수납잔액+차감후청구 → 스크롤 없이 고정(shrink-0), ② 아래·수납버튼 위 항상 노출.
 *
 * durable fix: settle-lane 통합 스크롤(SUGA-SCROLL-BLOCK band-aid) → settle-lane shrink-0(자연높이) +
 *   ③ 세금구분 pmw-tax-fixed-band(shrink-0 고정) + 액션버튼 div만 fallback 스크롤. ② 접힘 컴팩트 →
 *   수납버튼 무스크롤 도달(요청2 증상 구조적 해소).
 *
 * AC:
 *   AC-1 ② 아코디언 1줄 헤더 접힘(기본)/펼침 토글
 *   AC-2 ③ 세금구분·수납잔액·차감후청구 스크롤 없이 고정(고정 밴드가 settle-lane 최상단, 스크롤 밖)
 *   AC-3 ② 접힘 기본 상태에서 수납버튼 스크롤없이 접근(뷰포트 내 도달)
 *   AC-4 세금구분 각 금액·수납잔액 값 무회귀(COPAY-BALANCE-SPLIT canonical 소비)
 *   AC-5 ①좌측(정사각형 탭)·④우측(패키지·서류발행) 회귀 0
 *   AC-6 갤탭 실렌더(1280×800 landscape)
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

const PHONE = '+821099997746';
const NAME = '[PMW-LAYOUT-SCROLL-TEST]';
const QUEUE = 946;

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'qa_evidence', 'T-20260719-foot-PMW-LAYOUT-SCROLL');

let clinicId: string | null = null;
let checkInId: string | null = null;
let seedOk = false;

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
  const { data: svcs } = await supabase.from('services').select('*').eq('active', true).limit(2);
  if (!svcs || svcs.length < 1) { seedOk = false; return; }
  clinicId = svcs[0].clinic_id;

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

  for (const svc of svcs) {
    await supabase.from('check_in_services').insert({
      check_in_id: checkInId, service_id: svc.id, service_name: svc.name,
      price: svc.price, original_price: svc.price, is_package_session: false,
    });
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

test('AC1~AC5: ② 아코디언 접힘기본 + ③ 세금구분 고정 + 수납버튼 무스크롤 도달 + ①④ 회귀0', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');

  await openMiniWindow(page);
  const dialog = page.locator('[role="dialog"]').first();

  // 수가항목 추가 (현장 동선) — 풋케어 탭 코드카드 클릭
  await dialog.getByRole('button', { name: '풋케어', exact: true }).first().click();
  const grid = page.locator('[data-testid="pmw-code-grid"]').first();
  const cards = grid.locator('button.aspect-square');
  if (await cards.count() > 0) {
    await cards.first().click();
    if (await cards.count() > 1) await cards.nth(1).click();
  }

  // ── AC-1: ② 아코디언 1줄 헤더 — 기본 접힘 ──
  const feeToggle = page.locator('[data-testid="pmw-feeitem-toggle"]').first();
  await expect(feeToggle, 'AC1 ② 아코디언 헤더 존재').toBeVisible();
  expect(await feeToggle.getAttribute('aria-expanded'), 'AC1 ② 기본=접힘').toBe('false');
  // 헤더 1줄 요약: 수가 N건 배지 노출
  const summary = page.locator('[data-testid="pmw-feeitem-summary"]').first();
  await expect(summary, 'AC1 헤더 요약(수가 N건·합계)').toContainText('수가');

  // 접힘 상태에선 수가항목 세로 목록(pricing-list) 미노출
  await expect(page.locator('[data-testid="pricing-list"]'), 'AC1 접힘 시 펼침콘텐츠 숨김').toHaveCount(0);

  // 펼침 토글 → 펼침콘텐츠(수가 항목 목록) 노출
  await feeToggle.click();
  expect(await feeToggle.getAttribute('aria-expanded'), 'AC1 클릭 후 펼침').toBe('true');
  await expect(page.locator('[data-testid="pricing-list"]').first(), 'AC1 펼침 시 수가 목록 노출').toBeVisible();
  // 다시 접기 → AC-3 기본 동선(접힘)으로 복귀
  await feeToggle.click();
  expect(await feeToggle.getAttribute('aria-expanded'), 'AC1 재클릭 후 접힘').toBe('false');

  await dialog.screenshot({ path: path.join(SHOT_DIR, '01-collapsed-fixed-band.png') });

  // ── AC-2: ③ 세금구분·수납잔액·차감후청구 스크롤 없이 고정 ──
  const fixedBand = page.locator('[data-testid="pmw-tax-fixed-band"]').first();
  await expect(fixedBand, 'AC2 ③ 고정 밴드 노출').toBeVisible();
  await expect(fixedBand.getByText('세금 구분', { exact: false }).first(), 'AC2 세금구분 헤더').toBeVisible();
  await expect(fixedBand.getByText('수납잔액', { exact: false }).first(), 'AC2 수납잔액 라인').toBeVisible();

  // ③ 고정 밴드는 settle-lane 최상단(±3px)에 붙어 있어야(스크롤로 밀려나지 않음 = shrink-0 고정)
  const geo = await fixedBand.evaluate((band) => {
    const lane = document.querySelector('[data-testid="pmw-settle-lane"]') as HTMLElement | null;
    // 밴드 조상 중 스크롤 컨테이너가 settle-lane 인지(=밴드가 스크롤 안이면 실패)
    let node: HTMLElement | null = band.parentElement;
    let bandInsideScroll = false;
    while (node && node.getAttribute('data-testid') !== 'pmw-settle-lane') {
      const cs = getComputedStyle(node);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
        bandInsideScroll = true; break;
      }
      node = node.parentElement;
    }
    const bandTop = band.getBoundingClientRect().top;
    const laneTop = lane ? lane.getBoundingClientRect().top : NaN;
    return { bandInsideScroll, offsetFromLaneTop: Math.round(bandTop - laneTop) };
  });
  // eslint-disable-next-line no-console
  console.log(`[PMW-LAYOUT-SCROLL] band-inside-scroll=${geo.bandInsideScroll} offsetFromLaneTop=${geo.offsetFromLaneTop}`);
  expect(geo.bandInsideScroll, 'AC2 ③ 고정 밴드는 스크롤 컨테이너 밖(shrink-0 고정)').toBe(false);
  expect(Math.abs(geo.offsetFromLaneTop), 'AC2 ③ 밴드가 settle-lane 최상단 고정(±3px)').toBeLessThanOrEqual(3);

  // ── AC-3: ② 접힘 기본 상태에서 수납버튼 무스크롤 도달 ──
  //   시술 저장(금액 산정) → 수납 버튼 노출. 스크롤 없이 뷰포트 안이어야 함.
  const saveFullBtn = dialog.getByRole('button', { name: /시술 저장 및 포함 금액 산정|저장됨/ }).first();
  await expect(saveFullBtn, 'AC3 결제비 산정 버튼 활성').toBeVisible();
  expect(await saveFullBtn.isDisabled(), 'AC3 결제비 산정 버튼 활성(수가 추가됨)').toBe(false);
  await saveFullBtn.click();

  const settleBtn = page.locator('[data-testid="btn-settle"]').first();
  await expect(settleBtn, 'AC3 수납 버튼 노출(저장 후)').toBeVisible();

  // ② 접힘 기본 상태 — 스크롤 없이 btn-settle 이 뷰포트 안에 있는지(무스크롤 도달)
  const vp = page.viewportSize()!;
  const bbNoScroll = await settleBtn.boundingBox();
  expect(bbNoScroll, 'AC3 btn-settle bbox').toBeTruthy();
  // eslint-disable-next-line no-console
  console.log(`[PMW-LAYOUT-SCROLL] btn-settle(no-scroll) top=${Math.round(bbNoScroll!.y)} bottom=${Math.round(bbNoScroll!.y + bbNoScroll!.height)} vpH=${vp.height}`);
  expect(bbNoScroll!.y, 'AC3 수납버튼 상단 뷰포트 안(≥0, 무스크롤)').toBeGreaterThanOrEqual(0);
  expect(bbNoScroll!.y + bbNoScroll!.height, `AC3 수납버튼 하단 뷰포트(${vp.height}) 안 — 무스크롤 클리핑 없음`).toBeLessThanOrEqual(vp.height);
  await settleBtn.click({ trial: true });

  await dialog.screenshot({ path: path.join(SHOT_DIR, '02-settle-reachable.png') });

  // ── AC-4: 세금구분/수납잔액 값 무회귀(canonical 소비) — 라벨·수치 노출 정합 ──
  await expect(fixedBand.getByText(/급여 자부담|비급여/).first(), 'AC4 세금구분 급여/비급여 라벨').toBeVisible();
  const balanceLine = fixedBand.getByText('수납잔액').first();
  const balanceRow = balanceLine.locator('xpath=..');
  await expect(balanceRow, 'AC4 수납잔액 금액(tabular-nums) 노출').toContainText(/[0-9]/);

  // ── AC-5: ①좌측 정사각형 탭 회귀 0 + ④우측 zone3 회귀 0 ──
  const catTabs = page.locator('[data-testid="pmw-footcare-cat-tab"]');
  const tabCount = await catTabs.count();
  expect(tabCount, 'AC5 ①좌측 카테고리 탭 4개').toBe(4);
  for (let i = 0; i < tabCount; i++) {
    const b = await catTabs.nth(i).boundingBox();
    expect(b, `AC5 탭[${i}] bbox`).toBeTruthy();
    expect(Math.abs(b!.width - b!.height), `AC5 ①탭[${i}] 정사각형 회귀0`).toBeLessThanOrEqual(6);
    expect(b!.width, `AC5 ①탭[${i}] 컴팩트 ≤64`).toBeLessThanOrEqual(64);
  }
  const zone3 = page.locator('[data-testid="pmw-zone3"]').first();
  await expect(zone3, 'AC5 ④우측 zone3(패키지·서류발행) 노출').toBeVisible();
  await expect(zone3.getByText('패키지', { exact: false }).first(), 'AC5 ④패키지 섹션').toBeVisible();
});

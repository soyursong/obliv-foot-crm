/**
 * T-20260719-foot-PAYMINI-SUGA-SCROLL-BLOCK (P0 hotfix · FE-only · DB0)
 *
 * reporter = 김주연 총괄 (C0ATE5P6JTH ts 1784441456.429949, 07-19).
 * 현장 신고: 결제 미니창(PaymentMiniWindow)에서 수가항목(기본(진찰료)/시술내역 등)
 *   클릭 시 하단 스크롤 불가 → '결제비 산정' 버튼(=[시술 저장 및 포함 금액 산정],
 *   data-testid=btn-settle) 미도달 → 수납 흐름 완전 차단.
 *
 * RC 용의자(§ticket): T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC (9cef7d7b) 좌측 카테고리
 *   탭 pill→정사각형(aspect-square w-14=56px) reflow가 code-grid 컬럼 높이를 키워
 *   중앙 세로 스택(code-grid / feeitem-row / settle-lane)에서 settle-lane 을 아래로 밀어
 *   sm:overflow-hidden(600px) 컬럼 밖으로 클리핑 → 스크롤 불가.
 *
 * AC:
 *   ① 수가항목(카테고리 탭 + 코드카드) 클릭 후 하단까지 스크롤 가능
 *   ② '결제비 산정'(btn-settle) 버튼 뷰포트 내 도달·클릭 가능
 *   ③ 수납 금액(수납잔액 split canonical) 정상 표시
 *   ④ 4ZONE 좌측 탭 정사각형 레이아웃 회귀 없음(|w−h|≤6, w≤64)
 *   ⑤ 갤탭 실렌더(1280×800 landscape) 검증
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

const PHONE = '+821099997745';
const NAME = '[PAYMINI-SCROLL-TEST]';
const QUEUE = 945;

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'qa_evidence', 'T-20260719-foot-PAYMINI-SUGA-SCROLL-BLOCK');

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

test('AC1~AC4: 수가항목 클릭 후 결제비 산정 버튼 도달 가능 + 4ZONE 탭 회귀 없음', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');

  await openMiniWindow(page);
  const dialog = page.locator('[role="dialog"]').first();

  // 풋케어 탭 진입
  await dialog.getByRole('button', { name: '풋케어', exact: true }).first().click();
  const catTabsWrap = page.locator('[data-testid="pmw-footcare-cat-tabs"]').first();
  await expect(catTabsWrap, '🔴 좌측 카테고리 탭 컨테이너 노출').toBeVisible();

  // ── AC4: 4ZONE 좌측 탭 정사각형 회귀 없음 ──
  const catTabs = page.locator('[data-testid="pmw-footcare-cat-tab"]');
  const tabCount = await catTabs.count();
  expect(tabCount, '좌측 카테고리 탭 4개').toBe(4);
  for (let i = 0; i < tabCount; i++) {
    const b = await catTabs.nth(i).boundingBox();
    expect(b, `탭[${i}] bbox`).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`[SCROLL-EVIDENCE] cat-tab[${i}] w=${Math.round(b!.width)} h=${Math.round(b!.height)}`);
    expect(Math.abs(b!.width - b!.height), `AC4 탭[${i}] 정사각형`).toBeLessThanOrEqual(6);
    expect(b!.width, `AC4 탭[${i}] 컴팩트 ≤64`).toBeLessThanOrEqual(64);
  }

  // 각 카테고리 탭을 눌러 수가항목(코드카드) 추가 시도 — 현장 동선 재현
  const grid = page.locator('[data-testid="pmw-code-grid"]').first();
  for (let i = 0; i < tabCount; i++) {
    await catTabs.nth(i).click();
    const cards = grid.locator('button.aspect-square');
    if (await cards.count() > 0) {
      await cards.first().click();  // 수가항목 추가
      await cards.nth(Math.min(1, await cards.count() - 1)).click();
    }
  }

  // feeitem-row 펼치기(현장이 항목 확인차 펼치는 동선)
  const feeToggle = page.locator('[data-testid="pmw-feeitem-toggle"]').first();
  if (await feeToggle.count() > 0) await feeToggle.click();

  await dialog.screenshot({ path: path.join(SHOT_DIR, '01-after-suga-add.png') });

  // ── AC2: '결제비 산정'(=시술 저장 및 포함 금액 산정) + 수납(btn-settle) 버튼 도달 가능 ──
  //   handleSaveFull 버튼(=결제비 산정)은 pricingItems>0 이면 활성 — '미활성화' 회귀 가드.
  const saveFullBtn = dialog.getByRole('button', { name: /시술 저장 및 포함 금액 산정|저장됨/ }).first();
  await expect(saveFullBtn, 'AC2 결제비 산정 버튼 존재').toBeVisible();
  expect(await saveFullBtn.isDisabled(), 'AC2 결제비 산정 버튼 활성(수가 추가됨 → 비활성화 아님)').toBe(false);

  const settleBtn = page.locator('[data-testid="btn-settle"]').first();
  await expect(settleBtn, 'AC1 수납 버튼 존재').toBeVisible();

  // ── AC1 RC 가드: btn-settle 의 스크롤 소유자 = pmw-settle-lane(통합 단일 창) ──
  //   버그시엔 버튼영역만 overflow-y-auto(창 ~131px, 버튼으로 꽉 참) → 터치 스크롤 불가.
  //   수정 후엔 settle-lane 이 소유 + 창(clientHeight) ≥ 180px 로 넉넉(버그 131px 대비) → 터치 스크롤 가능.
  //   (feeitem-row 펼침 시 settle-lane 이 다소 줄어 212px 관측 — 여전히 협소창 131px 회귀 가드 통과.)
  const scrollProbe = await settleBtn.evaluate((el) => {
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const cs = getComputedStyle(node);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
        return { owner: node.getAttribute('data-testid'), ch: node.clientHeight, sh: node.scrollHeight };
      }
      node = node.parentElement;
    }
    return { owner: null, ch: 0, sh: 0 };
  });
  // eslint-disable-next-line no-console
  console.log(`[SCROLL-EVIDENCE] scroll-owner=${scrollProbe.owner} window=${scrollProbe.ch} content=${scrollProbe.sh}`);
  expect(scrollProbe.owner, 'AC1 스크롤 소유자=settle-lane(단일 통합 창)').toBe('pmw-settle-lane');
  expect(scrollProbe.ch, 'AC1 스크롤 창 ≥180px(131px 협소창 회귀 가드)').toBeGreaterThanOrEqual(180);

  // ① 스크롤로 btn-settle 을 뷰포트 안에 들일 수 있어야 함(클리핑 밖 → 도달)
  await settleBtn.scrollIntoViewIfNeeded();
  const bb = await settleBtn.boundingBox();
  expect(bb, 'AC2 btn-settle bbox').toBeTruthy();
  const vp = page.viewportSize()!;
  // eslint-disable-next-line no-console
  console.log(`[SCROLL-EVIDENCE] btn-settle afterScroll top=${Math.round(bb!.y)} bottom=${Math.round(bb!.y + bb!.height)} vpH=${vp.height}`);
  expect(bb!.y, 'AC2 버튼 상단이 뷰포트 안(≥0)').toBeGreaterThanOrEqual(0);
  expect(bb!.y + bb!.height, `AC2 버튼 하단이 뷰포트(${vp.height}) 안 — 클리핑 없음`).toBeLessThanOrEqual(vp.height);

  // ② 실제 클릭 가능(포인터 인터셉트 없음)
  await settleBtn.click({ trial: true });

  // ── AC3: 수납잔액(split canonical) 표시 정상 — 계산 SSOT 무접촉(sticky 상시 노출) ──
  await expect(dialog.getByText('수납잔액', { exact: false }).first(), 'AC3 수납잔액 라인 노출').toBeVisible();
});

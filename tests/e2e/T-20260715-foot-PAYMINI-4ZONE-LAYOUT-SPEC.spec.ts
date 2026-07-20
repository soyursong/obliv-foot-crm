/**
 * T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC (P0 · 색박스 스샷 F0BJ87C400G 좌표 근거)
 *
 * reporter = 김주연 총괄 / planner NEW-TASK (MSG-20260715-124403-szex).
 * 좌표 정본 = 색박스 주석 스샷:
 *   ~/file_inbox/20260715/122218_F0BJ87C400G_20260715_122002.png
 *   🔴 좌측 항목메뉴(=code-grid: 사이드메뉴 + 카테고리 탭 + 코드 카드)
 *   🟢 차트코드·진료비산정(=feeitem-row, 위임 T-20260715-CHARTFEE-ROW-RESTORE)
 *   🔵 세금구분·수납잔액(=settle-lane, 위임 T-20260714-COPAY-BALANCE-SPLIT)
 *   🟣 우측 유지(=zone3, 무작업)
 *
 * ═══ 2026-07-19 REWRITE (FIX MSG-3cwy · 4차 좀비 종식) ═══
 * 총괄 김주연 직접확정(ts 1784447309.406059): "웅 보라색 영역처럼 항목들 세로로 배치!"
 *   = pending_question(b) CONFIRMED. ①좌측 항목 팔레트 = ④우측 보라영역(pmw-zone3)식 세로 섹션 리스트.
 * 4차 좀비 RC = 이전 구현이 ①좌측을 '정사각형 탭 가로 wrap'(aspect-square, 팔레트=grid grid-cols)으로 두고,
 *   self-E2E 가 정사각형·좌표만 assert(=flex-direction blind)해 divergence 은폐(CHART-ORDER 좀비 동일구조).
 * ⇒ 본 REWRITE 는 팔레트 컨테이너의 computed flex-direction 을 직접 assert(축 명시) + ④ zone3 구조 복제 정합 확인.
 *   좌표/정사각형 blind 금지. self==canon 인데 field 어긋남 재발 차단.
 *
 * 본 티켓 실 구현 = ① 좌측 항목 팔레트 = ④식 세로 full-width 행 리스트 (②③ 위임 / ④ 무작업).
 *
 * ── 검증 대상 ──
 *   AC1(세로 팔레트 · anti-zombie 핵심): 🔴 항목 팔레트(data-testid=pmw-palette-list)
 *        · computed display = 'flex' (grid 아님 — 가로 다열 그리드 종식)
 *        · computed flex-direction = 'column' (④식 위→아래 stack — flex-direction blind 종식)
 *        · 각 항목(pmw-palette-item) = full-width 행(width > 2·height = 정사각형 카드 아님), 리스트 폭 대부분 점유(단일 열)
 *        · 2개↑ 항목: item[1].top ≥ item[0].bottom(위→아래 stack) + 좌단 정렬(동일 열)
 *        · ④ 코히런스 앵커: pmw-zone3 도 flex-direction=column (① = ④ DOM 구조 복제 정합)
 *   AC1b(탭 슬림): 🔴 카테고리 탭(pmw-footcare-cat-tab) = 슬림 텍스트 탭(width > height = 정사각형 artifact 종식, height ≤ 36).
 *   AC2: 🔴 좌측 사이드 메뉴(상병코드/처방약/풋케어 세로 나열) = 무변경 → 3개 탭 존재.
 *   AC3(회귀 가드 · T-20260720-foot-PAYMINI-CHARTCODE-SPLIT 반영): ① 변경이 ②③④ zone reflow 에 영향 0.
 *        중앙 컬럼이 세로 스택→4-컬럼 가로 행(sm:flex-row, 좌→우)으로 재설계됨.
 *        · canonical 유지: ① pmw-code-grid → ② pmw-chartcode-col(신규 "차트 코드", 구 feeitem-row 대체)
 *          → ③ pmw-settle-lane("진료비 산정") → ④ pmw-zone3 순으로 x 좌단 엄격 증가(가로 컬럼).
 *        · 4개 zone 대략 동일 top y (세로 스택 아님) / 4개 zone 존재·가시.
 *        · REMOVED: pmw-feeitem-row·pmw-feeitem-toggle·컴팩트 한 줄(≤52px)·fold 토글.
 *   AC4: 4구역 전체가 스샷과 시각 일치 (스크린샷 evidence).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
// service_role = 비커밋 시크릿(.env.local, gitignored). git 커밋 = P0 보안 위반이라 QA
// 워크트리엔 부재. 이전엔 여기서 module-eval throw → test *collection* 단계가 통째 crash
// (FIX-REQUEST MSG-20260715-132543-1zku, 관측: spec:36 'SUPABASE_SERVICE_ROLE_KEY env required').
// → 부재 시 throw 하지 말고 seedOk=false 로 graceful skip. (DOCPRINT-GONGDAN 5152455c 선례 동형.)
//   · .env.local 주입된 dev/QA 머신(macstudio) = 실 seed → 풀 E2E 검증.
//   · 시크릿 없는 QA 워크트리 = collection OK · test.skip(0 crash).
//   · 실기기 렌더/현장 confirm = supervisor 갤탭 field-soak.
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HAS_SERVICE_ROLE = SERVICE_ROLE_KEY.length > 0;

const supabase = HAS_SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const PHONE = '+821099997744';
const NAME = '[PAYMINI-4ZONE-TEST]';
const QUEUE = 944;

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'qa_evidence', 'T-20260715-foot-PAYMINI-4ZONE-LAYOUT-SPEC');

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
  if (!supabase) { seedOk = false; return; }   // service_role 부재 = graceful skip (collection crash 방지)
  await cleanup();
  const { data: svcs } = await supabase
    .from('services').select('*').eq('active', true).limit(2);
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

test('AC1(세로 팔레트·flex-direction)+AC1b(탭 슬림)+AC2+AC3+AC4', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');

  await openMiniWindow(page);

  const dialog = page.locator('[role="dialog"]').first();

  // ── AC2: 🔴 좌측 사이드 메뉴(상병코드/처방약/풋케어 세로 나열) 무변경 ──
  for (const label of ['상병코드', '처방약', '풋케어']) {
    await expect(
      dialog.getByRole('button', { name: label, exact: true }).first(),
      `AC2 좌측 사이드 메뉴 '${label}' 존재(무변경)`,
    ).toBeVisible();
  }

  // 풋케어 탭 진입 → 🔴 좌측 카테고리 탭(기본(진찰료)/시술내역(풋케어)/수액/화장품) 노출
  await dialog.getByRole('button', { name: '풋케어', exact: true }).first().click();
  const catTabsWrap = page.locator('[data-testid="pmw-footcare-cat-tabs"]').first();
  await expect(catTabsWrap, '🔴 좌측 카테고리 탭 컨테이너 노출').toBeVisible();

  const catTabs = page.locator('[data-testid="pmw-footcare-cat-tab"]');
  const tabCount = await catTabs.count();
  expect(tabCount, '좌측 카테고리 탭 4개(기본/시술내역/수액/화장품)').toBe(4);

  // ── AC1b: 카테고리 탭 = 슬림 텍스트 탭(정사각형 artifact 종식 — width > height) ──
  for (let i = 0; i < tabCount; i++) {
    const b = await catTabs.nth(i).boundingBox();
    expect(b, `탭[${i}] boundingBox 확보`).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`[4ZONE-EVIDENCE] cat-tab[${i}] w=${Math.round(b!.width)} h=${Math.round(b!.height)}`);
    expect(
      b!.width,
      `AC1b 탭[${i}] 슬림 가로 탭(w=${Math.round(b!.width)} > h=${Math.round(b!.height)} — 정사각형 artifact 종식)`,
    ).toBeGreaterThan(b!.height);
    expect(
      b!.height,
      `AC1b 탭[${i}] 슬림(h=${Math.round(b!.height)}≤36px)`,
    ).toBeLessThanOrEqual(36);
  }

  // ── AC1(anti-zombie 핵심): 🔴 항목 팔레트 = ④식 세로 stack(flex-direction=column) ──
  //   flex-direction 을 직접 assert (좌표/정사각형 blind 금지 = 4차 좀비 RC 차단).
  const paletteList = page.locator('[data-testid="pmw-palette-list"]').first();
  const paletteItems = page.locator('[data-testid="pmw-palette-item"]');
  // 항목이 있는 카테고리를 찾아 진입(카테고리별 시드 유무 무관하게 팔레트 노출 보장)
  let itemCount = 0;
  for (let i = 0; i < tabCount; i++) {
    await catTabs.nth(i).click();
    if (await paletteList.isVisible().catch(() => false)) {
      itemCount = await paletteItems.count();
      if (itemCount > 0) break;
    }
  }
  expect(itemCount, 'AC1 팔레트 항목 ≥1 (세로 stack 검증 대상 존재)').toBeGreaterThan(0);

  // 핵심 축 assert: display=flex + flex-direction=column (grid/가로 다열 종식)
  const paletteStyle = await paletteList.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { display: cs.display, flexDirection: cs.flexDirection };
  });
  // eslint-disable-next-line no-console
  console.log(`[4ZONE-EVIDENCE] palette display=${paletteStyle.display} flex-direction=${paletteStyle.flexDirection}`);
  expect(paletteStyle.display, 'AC1 팔레트 display=flex (grid 아님 — 가로 다열 그리드 종식)').toBe('flex');
  expect(paletteStyle.flexDirection, 'AC1 팔레트 flex-direction=column (④식 위→아래 stack — flex-direction blind 종식)').toBe('column');

  // 각 항목 = full-width 행(정사각형 아님) + 리스트 폭 대부분 점유(단일 열)
  const listBox = await paletteList.boundingBox();
  const item0 = await paletteItems.nth(0).boundingBox();
  expect(item0 && listBox, '팔레트/항목 boundingBox 확보').toBeTruthy();
  // eslint-disable-next-line no-console
  console.log(`[4ZONE-EVIDENCE] palette-item[0] w=${Math.round(item0!.width)} h=${Math.round(item0!.height)} / list w=${Math.round(listBox!.width)}`);
  expect(item0!.width, `AC1 항목[0] full-width 행(w=${Math.round(item0!.width)} > 2·h=${Math.round(item0!.height)} — 정사각형 카드 종식)`).toBeGreaterThan(item0!.height * 2);
  expect(item0!.width, `AC1 항목[0] 리스트 폭 대부분 점유(단일 열, w≥list·0.8)`).toBeGreaterThan(listBox!.width * 0.8);

  // 2개↑ 항목: 위→아래 stack + 좌단 정렬(동일 열)
  if (itemCount >= 2) {
    const item1 = await paletteItems.nth(1).boundingBox();
    expect(item1!.y, `AC1 항목[1].top(${Math.round(item1!.y)}) ≥ 항목[0].bottom(${Math.round(item0!.y + item0!.height)}) — 위→아래 stack`).toBeGreaterThanOrEqual(item0!.y + item0!.height - 4);
    expect(Math.abs(item1!.x - item0!.x), `AC1 항목 좌단 정렬(동일 열, |Δx|≤6)`).toBeLessThanOrEqual(6);
  }

  // ── AC3(회귀 가드): T-20260720-foot-PAYMINI-CHARTCODE-SPLIT 후 4-컬럼 가로 레이아웃 정합 ──
  //   중앙 컬럼이 세로 스택에서 4개 zone 가로 행(sm:flex-row, 좌→우)으로 재설계됨.
  //   ① code-grid → ② chartcode-col(신규, 구 feeitem-row 대체) → ③ settle-lane → ④ zone3.
  //   ①탭 변경이 이 4-컬럼 가로 x-순서를 흐트러뜨리면 reflow 회귀로 감지.
  const grid = page.locator('[data-testid="pmw-code-grid"]').first();       // ① code-grid(팔레트 그리드)
  const chartcode = page.locator('[data-testid="pmw-chartcode-col"]').first(); // ② 차트 코드(신규 컬럼)
  const settle = page.locator('[data-testid="pmw-settle-lane"]').first();   // ③ 진료비 산정
  const zone3 = page.locator('[data-testid="pmw-zone3"]').first();          // ④ 우측 유지

  await expect(grid, '① code-grid 존재').toBeVisible();
  await expect(chartcode, '② chartcode-col(차트 코드) 존재').toBeVisible();
  await expect(settle, '③ settle-lane(진료비 산정) 존재').toBeVisible();
  await expect(zone3, '④ zone3(우측) 존재').toBeVisible();

  // AC1 ④ 코히런스 앵커: ①팔레트가 복제한 ④ zone3 도 flex-direction=column 이어야 정합(DOM 구조 동형).
  const zone3Flex = await zone3.evaluate((el) => getComputedStyle(el).flexDirection);
  // eslint-disable-next-line no-console
  console.log(`[4ZONE-EVIDENCE] zone3(④) flex-direction=${zone3Flex}`);
  expect(zone3Flex, 'AC1 ④ zone3 flex-direction=column (① 팔레트 = ④ 세로 섹션 복제 앵커 정합)').toBe('column');

  const gb = await grid.boundingBox();
  const cb = await chartcode.boundingBox();
  const sb = await settle.boundingBox();
  const zb = await zone3.boundingBox();
  expect(gb && cb && sb && zb, 'zone boundingBox 확보').toBeTruthy();

  // eslint-disable-next-line no-console
  console.log(`[4ZONE-EVIDENCE] grid(x=${Math.round(gb!.x)},y=${Math.round(gb!.y)},w=${Math.round(gb!.width)}) chartcode(x=${Math.round(cb!.x)},y=${Math.round(cb!.y)}) settle(x=${Math.round(sb!.x)},y=${Math.round(sb!.y)}) zone3(x=${Math.round(zb!.x)},y=${Math.round(zb!.y)})`);

  // AC3-①: 4-컬럼 가로 순서 (T-20260720-foot-PAYMINI-CHARTCODE-SPLIT 착지 구조).
  //   sm:flex-row 로 좌→우 4개 zone: ① code-grid → ② chartcode-col → ③ settle-lane → ④ zone3.
  //   각 zone 의 좌단 x 가 엄격히 증가해야 함(가로 컬럼 배치, 세로 스택 아님).
  //   (①탭 변경이 이 가로 x-순서를 흐트러뜨리면 reflow 회귀로 감지.)
  expect(cb!.x, `AC3 ② chartcode(x=${Math.round(cb!.x)})는 ① code-grid(x=${Math.round(gb!.x)}) 우측`).toBeGreaterThan(gb!.x);
  expect(sb!.x, `AC3 ③ settle(x=${Math.round(sb!.x)})는 ② chartcode(x=${Math.round(cb!.x)}) 우측`).toBeGreaterThan(cb!.x);
  expect(zb!.x, `AC3 ④ zone3(x=${Math.round(zb!.x)})는 ③ settle(x=${Math.round(sb!.x)}) 우측(최우단)`).toBeGreaterThan(sb!.x);

  // AC3-②: 4개 zone 이 대략 동일 top y (세로 스택이 아니라 가로 컬럼 — 관대한 tolerance).
  const tops = [gb!.y, cb!.y, sb!.y, zb!.y];
  const topSpread = Math.max(...tops) - Math.min(...tops);
  expect(topSpread, `AC3 4개 zone 대략 동일 top(spread=${Math.round(topSpread)}≤120px — 가로 컬럼, 세로 스택 아님)`).toBeLessThanOrEqual(120);

  // ── AC4: 4구역 시각 evidence ──
  await dialog.screenshot({ path: path.join(SHOT_DIR, '01-4zone-footcare-tabs.png') });
  await page.screenshot({ path: path.join(SHOT_DIR, '01-4zone-full.png') });
});

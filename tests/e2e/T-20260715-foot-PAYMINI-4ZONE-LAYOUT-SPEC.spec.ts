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
 * 본 티켓 실 구현 = ① 좌측 탭 컴팩트/정사각형뿐 (②③ 위임 / ④ 무작업).
 *
 * ── 검증 대상 ──
 *   AC1: 🔴 좌측 탭(기본(진찰료)/시술내역(풋케어)/수액/화장품, data-testid=pmw-footcare-cat-tab)
 *        = 공간 최소(컴팩트) + 정사각형 형태.
 *        · 정사각형: |width − height| ≤ 6px (aspect-square)
 *        · 컴팩트: 가로 pill(텍스트폭 가변, 이전 min-h-44 + px-2 py-1) 아님 = 소형 정사각형(≤64px)
 *   AC2: 🔴 좌측 사이드 메뉴(상병코드/처방약/풋케어 세로 나열) = 무변경 → 3개 탭 존재.
 *   AC3(회귀 가드): ① 변경이 ②차트코드행·③세금/수납잔액·④우측 zone reflow 에 영향 0.
 *        · canonical(508893fa) 유지: 중앙 컬럼(x≈213) = [🟢 code-grid]→[② feeitem-row]→[🔵 settle-lane]
 *          세로 스택 / 🟣 zone3 = 우측 별도 컬럼(x≫중앙). (실측: grid/fee/settle x=213, zone3 x=923)
 *        · ② feeitem-row = 여전히 code-grid 아래 동일 컬럼 컴팩트 한 줄(≤52px)
 *        · ③ settle-lane(grid 아래 동일 x) / ④ zone3(우측 컬럼) 존재·가시
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

test('AC1+AC2+AC3+AC4: 좌측 탭 정사각형·컴팩트 + 사이드메뉴 무변경 + ②③④ zone reflow 0', async ({ page }) => {
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

  // ── AC1: 각 탭 = 정사각형(aspect-square) + 컴팩트(소형 ≤64px) ──
  for (let i = 0; i < tabCount; i++) {
    const b = await catTabs.nth(i).boundingBox();
    expect(b, `탭[${i}] boundingBox 확보`).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`[4ZONE-EVIDENCE] cat-tab[${i}] w=${Math.round(b!.width)} h=${Math.round(b!.height)}`);
    // 정사각형: 가로≈세로
    expect(
      Math.abs(b!.width - b!.height),
      `AC1 탭[${i}] 정사각형(w=${Math.round(b!.width)},h=${Math.round(b!.height)}, |w−h|≤6)`,
    ).toBeLessThanOrEqual(6);
    // 컴팩트: 소형(≤64px) — 기존 가로 pill(텍스트폭 가변, 넓은 폭) 아님
    expect(
      b!.width,
      `AC1 탭[${i}] 컴팩트 소형(w=${Math.round(b!.width)}≤64px)`,
    ).toBeLessThanOrEqual(64);
    // 터치 타깃 하한(갤탭): 정사각형이어도 눌리는 크기
    expect(
      b!.width,
      `AC1 탭[${i}] 터치 가능 크기(w=${Math.round(b!.width)}≥40px)`,
    ).toBeGreaterThanOrEqual(40);
  }

  // ── AC3(회귀 가드): ②③④ zone reflow 0 ──
  const grid = page.locator('[data-testid="pmw-code-grid"]').first();   // 🔴/🟢 좌측 code-grid
  const feeRow = page.locator('[data-testid="pmw-feeitem-row"]').first(); // 🟢 ② 차트코드·진료비
  const settle = page.locator('[data-testid="pmw-settle-lane"]').first(); // 🔵 ③ 세금구분·수납잔액
  const zone3 = page.locator('[data-testid="pmw-zone3"]').first();       // 🟣 ④ 우측 유지

  await expect(grid, 'code-grid(좌측) 존재').toBeVisible();
  await expect(feeRow, '② feeitem-row 존재').toBeVisible();
  await expect(settle, '③ settle-lane 존재').toBeVisible();
  await expect(zone3, '④ zone3(우측) 존재').toBeVisible();

  const gb = await grid.boundingBox();
  const fb = await feeRow.boundingBox();
  const sb = await settle.boundingBox();
  const zb = await zone3.boundingBox();
  expect(gb && fb && sb && zb, 'zone boundingBox 확보').toBeTruthy();

  // eslint-disable-next-line no-console
  console.log(`[4ZONE-EVIDENCE] grid(x=${Math.round(gb!.x)},w=${Math.round(gb!.width)}) fee(x=${Math.round(fb!.x)},y=${Math.round(fb!.y)},w=${Math.round(fb!.width)},h=${Math.round(fb!.height)}) settle(x=${Math.round(sb!.x)}) zone3(x=${Math.round(zb!.x)})`);

  // AC3-①: canonical 레이아웃 유지 (CHARTFEE-ROW-RESTORE 508893fa 착지 구조).
  //   중앙 컬럼(x≈213, w≈710) = [🟢 code-grid] → [② feeitem-row] → [🔵 settle-lane] 세로 스택.
  //   🟣 zone3 = 별도 우측 컬럼(x≫중앙). 즉 settle 는 grid "아래"(동일 x), zone3 만 "우측".
  //   (①탭 변경이 이 세로 스택·우측 컬럼 경계를 흐트러뜨리면 reflow 회귀로 감지.)
  expect(Math.abs(sb!.x - gb!.x), `AC3 🔵 settle(x=${Math.round(sb!.x)})는 중앙 컬럼(code-grid x=${Math.round(gb!.x)}) 동일 세로 스택(±24)`).toBeLessThanOrEqual(24);
  expect(sb!.y, `AC3 🔵 settle(top=${Math.round(sb!.y)})는 code-grid(top=${Math.round(gb!.y)}) 아래 = 세로 스택 유지`).toBeGreaterThan(gb!.y);
  expect(zb!.x, `AC3 🟣 zone3(x=${Math.round(zb!.x)})는 중앙 컬럼(x=${Math.round(gb!.x)}) 우측 별도 컬럼`).toBeGreaterThan(gb!.x + gb!.width - 24);

  // AC3-②: ② feeitem-row = 여전히 code-grid "아래" 동일 컬럼 컴팩트 한 줄(reflow 없음)
  expect(fb!.y, `AC3 ② fee-row(top=${Math.round(fb!.y)})는 code-grid(bottom=${Math.round(gb!.y + gb!.height)}) 아래`).toBeGreaterThanOrEqual(gb!.y + gb!.height - 12);
  expect(fb!.height, `AC3 ② fee-row 컴팩트 한 줄(h=${Math.round(fb!.height)}≤52px)`).toBeLessThanOrEqual(52);
  expect(Math.abs(fb!.x - gb!.x), `AC3 ② fee-row 좌단(x=${Math.round(fb!.x)})=code-grid 좌단(x=${Math.round(gb!.x)}) 동일 컬럼(±24)`).toBeLessThanOrEqual(24);

  // ── AC4: 4구역 시각 evidence ──
  await dialog.screenshot({ path: path.join(SHOT_DIR, '01-4zone-footcare-tabs.png') });
  await page.screenshot({ path: path.join(SHOT_DIR, '01-4zone-full.png') });
});

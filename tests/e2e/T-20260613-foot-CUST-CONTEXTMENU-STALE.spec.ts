/**
 * T-20260613-foot-CUST-CONTEXTMENU-STALE
 * 고객관리 — 고객 정보 수정·저장 후 같은 행 우클릭 시 컨텍스트 메뉴가 수정 전(stale) 데이터를
 *           표시하던 버그 수정 검증. 김주연 총괄 요청.
 *
 * 근본 원인: ctxMenu 가 우클릭 시점의 customer 스냅샷을 통째로 보관(클로저 캡처) →
 *   수정·저장으로 results 가 리페치돼도 메뉴는 옛 스냅샷을 계속 표시.
 * 수정: ctxMenu 는 customerId 만 보관하고, 메뉴 표시 데이터는 render 시점에 최신 results 에서
 *   id 로 라이브 조회(ctxCustomer)하도록 바인딩 교체 → 항상 최신값 반영.
 *
 * 시나리오(티켓 §):
 *  S1(바인딩 정합성, read-only): 우클릭 메뉴 헤더 이름 == 해당 행 이름(라이브 results 바인딩).
 *  S2(수정 후 우클릭, AC-1): 이름 수정→저장→같은 고객 우클릭→메뉴 헤더가 수정 후 이름 표시. (테스트 후 원복)
 *  S3(연속 수정, AC-2): 한 번 더 수정→우클릭→두 번째 수정값 반영. (테스트 후 원복)
 *  S4(회귀, AC-3): 컨텍스트 메뉴 기존 항목(고객차트/진료차트/예약하기/수납) 유지.
 *
 * 데이터 의존 단계는 환경에 따라 skip-tolerant. 이름 수정 테스트는 try/finally 로 항상 원복.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'test-admin@obliv-foot.com';
const ADMIN_PW = process.env.TEST_ADMIN_PW ?? 'testpassword';

/**
 * storageState(auth.setup) 인증을 기본으로 사용. 이미 인증돼 있으면 폼 로그인 생략,
 * /login 으로 리다이렉트된 경우에만 폼 로그인 fallback.
 */
async function login(page: import('@playwright/test').Page, email = ADMIN_EMAIL, pw = ADMIN_PW) {
  await page.goto(`${BASE}/admin/customers`);
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.fill(email);
    await page.fill('input[type="password"]', pw);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin**', { timeout: 10000 });
  }
}

/** 고객관리 진입 + 첫 페이지 로드(debounce + stats/RPC) 대기 */
async function gotoCustomers(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin/customers`);
  await page.waitForTimeout(1300);
}

/** 컨텍스트 메뉴 locator (고객관리 우클릭 메뉴 — '고객차트' 항목 보유로 식별) */
function ctxMenu(page: import('@playwright/test').Page) {
  return page
    .locator('div.fixed.z-\\[60\\], div[class*="shadow-xl"]')
    .filter({ hasText: '고객차트' })
    .first();
}

/** n번째 행 우클릭 → 메뉴 표시 대기. 메뉴 헤더(고객명) 텍스트 반환 */
async function openRowMenu(page: import('@playwright/test').Page, row: import('@playwright/test').Locator) {
  await row.click({ button: 'right' });
  const menu = ctxMenu(page);
  await menu.waitFor({ timeout: 5000 });
  // 헤더 = 메뉴 최상단 truncate 라벨(고객명)
  const header = menu.locator('div.truncate').first();
  await expect(header).toBeVisible();
  return { menu, header };
}

async function closeMenu(page: import('@playwright/test').Page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

// ── S1: 메뉴 헤더 이름 == 행 이름(라이브 results 바인딩, read-only) ─────────────
test('S1: 우클릭 메뉴 헤더 이름이 해당 행 이름과 일치(라이브 results 바인딩)', async ({ page }) => {
  await login(page);
  await gotoCustomers(page);

  const rows = page.locator('tbody tr');
  if ((await rows.count()) === 0) { test.skip(true, '고객 행 없음 — 데이터 의존 스킵'); return; }

  const row = rows.first();
  // 행 이름 셀(첫 번째 td 내 이름 span)
  const rowName = (await row.locator('td').first().innerText()).trim().replace(/\s*PKG\s*$/, '').trim();

  const { header } = await openRowMenu(page, row);
  const menuName = (await header.innerText()).trim();
  expect(menuName).toBe(rowName);
  await closeMenu(page);
  console.log(`✅ S1: 메뉴 헤더='${menuName}' == 행='${rowName}'`);
});

// ── S2/S3: 이름 수정 후 우클릭 메뉴가 최신값 표시 + 연속 수정 반영 ──────────────
test('S2/S3: 이름 수정→저장 후 우클릭 메뉴가 최신 이름 표시(연속 수정 포함)', async ({ page }) => {
  test.setTimeout(60000);
  await login(page);
  await gotoCustomers(page);

  const rows = page.locator('tbody tr');
  if ((await rows.count()) === 0) { test.skip(true, '고객 행 없음 — 데이터 의존 스킵'); return; }

  const firstRow = rows.first();
  const originalName = (await firstRow.locator('td').first().innerText())
    .trim().replace(/\s*PKG\s*$/, '').trim();
  if (!originalName) { test.skip(true, '대상 고객명 비어있음 — 스킵'); return; }

  const marker1 = `${originalName}·검수A`;
  const marker2 = `${originalName}·검수B`;
  let mutated = false;

  // 수정 다이얼로그 열기 헬퍼: 메뉴 '정보 수정' → 이름 변경 → 저장
  const editNameTo = async (targetRow: import('@playwright/test').Locator, newName: string) => {
    const { menu } = await openRowMenu(page, targetRow);
    const editBtn = menu.getByRole('button', { name: '정보 수정' });
    if (!(await editBtn.isVisible({ timeout: 2000 }).catch(() => false))) return false; // 권한 게이트
    await editBtn.click();
    const dialog = page.locator('[role="dialog"]').filter({ hasText: '고객 정보 수정' }).first();
    await dialog.waitFor({ timeout: 5000 });
    const nameInput = dialog.getByLabel('이름');
    await nameInput.fill(newName);
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog).toBeHidden({ timeout: 8000 });
    await page.waitForTimeout(1300); // runSearch 리페치 (이름 변경 → updated_at desc 재정렬)
    return true;
  };

  try {
    // ── S2: 1차 수정 ──
    const ok = await editNameTo(firstRow, marker1);
    if (!ok) { test.skip(true, '정보 수정 항목 미표시(권한) — 스킵'); return; }
    mutated = true;

    // 수정 후 이름은 updated_at desc 로 보통 최상단. marker1 행 탐색 후 우클릭.
    const row1 = page.locator('tbody tr').filter({ hasText: marker1 }).first();
    await expect(row1).toBeVisible({ timeout: 5000 });
    const { header: h1 } = await openRowMenu(page, row1);
    expect((await h1.innerText()).trim()).toBe(marker1); // 최신값 — stale 아님
    await closeMenu(page);
    console.log('✅ S2: 수정 직후 우클릭 메뉴가 최신 이름 표시');

    // ── S3: 2차(연속) 수정 ──
    const row1again = page.locator('tbody tr').filter({ hasText: marker1 }).first();
    await editNameTo(row1again, marker2);
    const row2 = page.locator('tbody tr').filter({ hasText: marker2 }).first();
    await expect(row2).toBeVisible({ timeout: 5000 });
    const { header: h2 } = await openRowMenu(page, row2);
    const finalName = (await h2.innerText()).trim();
    expect(finalName).toBe(marker2);
    expect(finalName).not.toBe(marker1); // 직전(구버전) 값 잔존 X
    await closeMenu(page);
    console.log('✅ S3: 연속 수정 시 마지막 저장값 반영');
  } finally {
    // 원복 — 어떤 단계에서 실패해도 원래 이름으로 복구 시도
    if (mutated) {
      const restoreRow = page
        .locator('tbody tr')
        .filter({ hasText: /검수[AB]/ })
        .first();
      if (await restoreRow.count()) {
        await editNameTo(restoreRow, originalName).catch(() => { /* best-effort */ });
      }
    }
  }
});

// ── S4: 회귀 — 기존 메뉴 항목 유지 ────────────────────────────────────────────
test('S4 회귀: 컨텍스트 메뉴 기존 항목(고객차트/진료차트/예약하기/수납) 유지', async ({ page }) => {
  await login(page);
  await gotoCustomers(page);

  const rows = page.locator('tbody tr');
  if ((await rows.count()) === 0) { test.skip(true, '고객 행 없음 — 데이터 의존 스킵'); return; }

  const { menu } = await openRowMenu(page, rows.first());
  for (const label of ['고객차트', '진료차트', '예약하기', '수납']) {
    await expect(menu.getByRole('button', { name: label })).toBeVisible();
  }
  await closeMenu(page);
  console.log('✅ S4: 기존 메뉴 4항목 유지');
});

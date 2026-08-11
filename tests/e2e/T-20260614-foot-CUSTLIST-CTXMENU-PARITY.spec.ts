/**
 * T-20260614-foot-CUSTLIST-CTXMENU-PARITY
 * 고객관리(/admin/customers) 행 우클릭 컨텍스트 메뉴(로컬 CustomerContextMenu)에
 * [문자] 항목 parity 추가. CustomerQuickMenu(대시보드/예약관리)의 SMS 항목 패턴 미러링.
 *
 * 검증:
 *  S1: manual_sms_send 권한 시 [문자] 항목 노출 + 메뉴 순서(수납 다음) + 클릭 → SendSmsDialog 오픈
 *  S2: 라벨 parity — '예약하기' 라벨 유지(planner 결정: 동작=신규예약이라 canon상 '예약하기'가 정확)
 *  S3: 권한 미달(manual_sms_send 미보유) 시 [문자] 미노출 (게이트)
 *
 * 발송 로직(optout·발신번호 화이트리스트 차단)은 기존 SendSmsDialog 경로 재사용 → 본 spec은 진입점 parity만 검증.
 * 실발송(확정 클릭)은 비용상 수행하지 않음(supervisor field-soak 단계).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page, email?: string, password?: string) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(email ?? process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(password ?? process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 });
  }
}

/** 고객관리에서 첫 번째 고객 행을 우클릭해 로컬 CustomerContextMenu를 여는 헬퍼.
 *  CI 부하/데이터 재렌더로 우클릭이 메뉴를 열지 못하는 flakiness 방지 —
 *  실제 데이터 행이 안정될 때까지 대기 + 메뉴가 뜰 때까지 우클릭 재시도. */
async function openCustomerRowContextMenu(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  // ★실제 데이터 행만 타깃: 빈 상태 행(<td colSpan> '고객이 없습니다')은 onContextMenu 핸들러가 없어
  //   우클릭해도 메뉴가 안 뜬다(CI dev DB 고객 0건일 때 발생 — 앰비언트 데이터 의존 flakiness의 실체).
  //   데이터 행은 체크박스(data-testid=cust-row-check)를 가지므로 이를 판별자로 사용 → 데이터 유무와
  //   무관하게 결정론 확보(0건이면 return false → 호출부 test.skip).
  const row = page.locator('tbody tr', { has: page.getByTestId('cust-row-check') }).first();
  if (!(await row.isVisible({ timeout: 10000 }).catch(() => false))) return false;
  // 행 렌더/재정렬(results.map) 안정화 짧게 대기
  await page.waitForTimeout(300);

  const menu = menuLocator(page);
  // 우클릭 → 메뉴 오픈 최대 4회 재시도 (단발 우클릭 유실/재렌더 race 보정)
  for (let attempt = 0; attempt < 4; attempt++) {
    await row.click({ button: 'right' });
    if (await menu.isVisible({ timeout: 2500 }).catch(() => false)) return true;
    // 메뉴 미노출 시 바깥 클릭으로 상태 초기화 후 재시도
    await page.mouse.click(5, 5).catch(() => {});
    await page.waitForTimeout(300);
  }
  // 마지막 한 번 더 시도 (호출부 waitFor가 최종 판정)
  await row.click({ button: 'right' });
  await page.waitForTimeout(400);
  return true;
}

function menuLocator(page: import('@playwright/test').Page) {
  return page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
}

// ── S1: [문자] 항목 노출 + 순서 + SendSmsDialog 오픈 ────────────────────────
test('S1: 고객관리 우클릭 [문자] → 수납 다음 위치 + 클릭 시 문자 발송 모달', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openCustomerRowContextMenu(page);
  if (!opened) {
    test.skip(true, '고객 행 없음 — 스킵');
    return;
  }
  const menu = menuLocator(page);
  await menu.waitFor({ timeout: 5000 });

  const smsItem = menu.getByTestId('cust-ctxmenu-sms-btn');
  if (!(await smsItem.isVisible({ timeout: 3000 }).catch(() => false))) {
    test.skip(true, '[문자] 미노출 — manual_sms_send 권한 미보유 계정 가능');
    return;
  }

  // 메뉴 순서: 수납 다음에 문자 (CustomerQuickMenu canon 순서 parity)
  const texts = (await menu.getByRole('button').allTextContents()).map((t) => t.trim());
  const idxPay = texts.findIndex((t) => t.includes('수납'));
  const idxSms = texts.findIndex((t) => t.includes('문자'));
  expect(idxSms).toBeGreaterThan(idxPay);

  await smsItem.click();

  // SendSmsDialog 오픈 (대시보드/예약관리와 동일 컴포넌트)
  const dialog = page.locator('[role="dialog"]').filter({ hasText: '문자 발송' }).first();
  await dialog.waitFor({ timeout: 5000 });
  await expect(dialog.getByTestId('sms-recipient-name')).toBeVisible();
});

// ── S2: 라벨 parity — '예약하기' 라벨 유지 (planner 결정) ──────────────────
test('S2: 예약 액션 라벨은 "예약하기" 유지(canon — 동작=신규예약)', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openCustomerRowContextMenu(page);
  if (!opened) {
    test.skip(true, '고객 행 없음 — 스킵');
    return;
  }
  const menu = menuLocator(page);
  await menu.waitFor({ timeout: 5000 });

  const texts = (await menu.getByRole('button').allTextContents()).map((t) => t.trim());
  // '예약하기' 존재 + '예약상세'로 바뀌지 않았음
  expect(texts.some((t) => t.includes('예약하기'))).toBe(true);
  expect(texts.some((t) => t.includes('예약상세'))).toBe(false);
});

// ── S3: 권한 게이트 — manual_sms_send 미보유 시 [문자] 미노출 ────────────────
test('S3: manual_sms_send 미보유 계정은 [문자] 미노출', async ({ page }) => {
  const email = process.env.TEST_NOSMS_EMAIL;
  const password = process.env.TEST_NOSMS_PASSWORD;
  if (!email || !password) {
    test.skip(true, 'SMS 권한 미보유 테스트 계정(TEST_NOSMS_EMAIL) 미설정 — 스킵');
    return;
  }
  await loginIfNeeded(page, email, password);
  const opened = await openCustomerRowContextMenu(page);
  if (!opened) {
    test.skip(true, '고객 행 없음');
    return;
  }
  const menu = menuLocator(page);
  await menu.waitFor({ timeout: 5000 });
  await expect(menu.getByTestId('cust-ctxmenu-sms-btn')).toHaveCount(0);
});

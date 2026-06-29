/**
 * T-20260606-foot-CTXMENU-SMS-SEND
 * 대시보드 고객 우클릭 메뉴 [문자] → 템플릿 선택·간략수정 후 수동 1:1 발송
 *
 * 티켓 §5 현장 클릭 시나리오 2종 변환:
 *  시나리오 1: 정상 발송 동선 — 우클릭 → [문자] → 템플릿 선택 → 본문 렌더+자유편집 →
 *              수신번호 자동표기 → 발송(확인 단계) → 발송 처리
 *  시나리오 2: 엣지 — phone 미등록 시 발송 비활성 / 템플릿 0개 안내 / 권한 게이트(admin/manager)
 *
 * 주의: 실제 SMS 비용 발생 회피를 위해 "확정 발송" 클릭(실발송)은 마지막 확인 단계까지만 검증하고
 *       기본적으로 실제 EF 호출은 수행하지 않는다(가드 UI 검증 위주). 실발송 검증은 supervisor field-soak 단계.
 *
 * AC-1 메뉴 [문자] 항목 / AC-2 템플릿 선택 / AC-3 본문 렌더+자유편집 /
 * AC-4 대상 고정+phone 표기 / AC-5 발송 / AC-6 오발송 가드(확인 단계) / AC-7 이력(EF)
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
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

/** 대시보드에서 첫 번째 체크인 카드를 우클릭해 CustomerQuickMenu를 여는 헬퍼 */
async function openDashboardContextMenu(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  const checkInCard = page.locator('[data-checkin-id]').first();
  if ((await checkInCard.count()) === 0) return false;
  await checkInCard.click({ button: 'right' });
  await page.waitForTimeout(400);
  return true;
}

// ── 시나리오 1: 정상 발송 동선 (AC-1~6) ─────────────────────────────────────
test('S1: 우클릭 [문자] → 템플릿 선택 → 본문 렌더+편집 → 수신번호 표기 → 확인 단계까지', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openDashboardContextMenu(page);
  if (!opened) {
    test.skip(true, '대시보드 체크인 카드 없음 — 스킵');
    return;
  }

  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await menu.waitFor({ timeout: 5000 });

  // AC-1: [문자] 항목 노출(admin/manager). 미노출이면 권한 미달 계정 → 스킵
  const smsItem = menu.getByTestId('quick-menu-sms-btn');
  if (!(await smsItem.isVisible({ timeout: 3000 }).catch(() => false))) {
    test.skip(true, '[문자] 항목 미표시 — admin/manager 계정 아님(권한 게이트) 가능');
    return;
  }

  // 메뉴 순서: 수납 다음에 문자 (수납 idx < 문자 idx)
  const texts = (await menu.getByRole('button').allTextContents()).map((t) => t.trim());
  const idxPay = texts.findIndex((t) => t.includes('수납'));
  const idxSms = texts.findIndex((t) => t.includes('문자'));
  expect(idxSms).toBeGreaterThan(idxPay);

  await smsItem.click();

  // AC-2: 모달 오픈 + 대상 고객 박스(성함+전화)
  const dialog = page.locator('[role="dialog"]').filter({ hasText: '문자 발송' }).first();
  await dialog.waitFor({ timeout: 5000 });
  await expect(dialog.getByTestId('sms-recipient-name')).toBeVisible();

  // 템플릿 0개 지점이면 안내 노출 검증 후 종료(엣지)
  if (await dialog.getByTestId('sms-no-template').isVisible({ timeout: 1500 }).catch(() => false)) {
    await expect(dialog.getByTestId('sms-send-btn')).toBeDisabled();
    return;
  }

  // AC-2: 템플릿 선택
  const select = dialog.getByTestId('sms-template-select');
  await select.waitFor({ timeout: 3000 });
  const optionValues = await select.locator('option').evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''),
  );
  if (optionValues.length === 0) {
    test.skip(true, '선택 가능한 템플릿 없음');
    return;
  }
  await select.selectOption(optionValues[0]);

  // AC-3: 본문 textarea 렌더 + 자유 편집
  const textarea = dialog.getByTestId('sms-body-textarea');
  await expect(textarea).toBeVisible({ timeout: 3000 });
  const before = await textarea.inputValue();
  expect(before.length).toBeGreaterThan(0);
  // {고객명} 미치환 토큰이 남아있지 않아야 함(자동 치환 검증)
  expect(before).not.toContain('{고객명}');
  await textarea.fill(before + ' 감사합니다');
  await expect(textarea).toHaveValue(/감사합니다/);

  // AC-4: 수신번호 표기 — phone 있으면 발송 가능, 없으면 비활성
  const hasPhone = await dialog.getByTestId('sms-recipient-phone').isVisible({ timeout: 1500 }).catch(() => false);
  const sendBtn = dialog.getByTestId('sms-send-btn');
  if (!hasPhone) {
    await expect(dialog.getByTestId('sms-recipient-nophone')).toBeVisible();
    await expect(sendBtn).toBeDisabled();
    return;
  }

  // AC-6: 발송 클릭 → 확인 단계(오발송 가드) 노출. 실발송(확정)은 비용상 클릭하지 않음.
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();
  await expect(dialog.getByTestId('sms-confirm-banner')).toBeVisible({ timeout: 3000 });
  await expect(dialog.getByTestId('sms-send-confirm-btn')).toBeVisible();
  // 취소로 종료 (실발송 회피)
  await dialog.getByRole('button', { name: '취소' }).click();
});

// ── 시나리오 2: 권한 게이트 ─────────────────────────────────────────────────
// ⚠️ T-20260608-foot-SMS-CTXMENU-ALLROLE 로 supersede: §6 admin/manager 한정 →
//    김주연 총괄 re-scope("전직원 권한 풀어줘") 전직원 확대. consultant 도 이제 [문자] 노출.
//    상세 패리티·전직원 노출 검증은 T-20260608-foot-SMS-CTXMENU-ALLROLE.spec.ts 로 이관.
test('S2: 전직원 확대(supersede) — consultant 계정도 [문자] 항목 노출', async ({ page }) => {
  const email = process.env.TEST_CONSULTANT_EMAIL;
  const password = process.env.TEST_CONSULTANT_PASSWORD;
  if (!email || !password) {
    test.skip(true, 'consultant 테스트 계정(TEST_CONSULTANT_EMAIL) 미설정 — 스킵');
    return;
  }
  await loginIfNeeded(page, email, password);
  const opened = await openDashboardContextMenu(page);
  if (!opened) {
    test.skip(true, '체크인 카드 없음');
    return;
  }
  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await menu.waitFor({ timeout: 5000 });
  // ALLROLE 이후: consultant 도 [문자] 노출 (이전 미노출 단언에서 반전)
  await expect(menu.getByTestId('quick-menu-sms-btn')).toBeVisible({ timeout: 3000 });
});

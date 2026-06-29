/**
 * T-20260609-foot-SMS-CTXMENU-VAR-SUBST
 * 수동 SMS 발송 모달(우클릭 → [문자])에서 템플릿 괄호 변수 5종 전부 자동 치환.
 *
 * 부모 T-20260606-foot-CTXMENU-SMS-SEND 는 {고객명}만 치환했고, 본 건은 나머지 4개를 확장:
 *   {고객명} {지점명} {지점전화번호} {날짜} {시간}  → 모달 렌더 단계에서 전부 실제 값으로 치환.
 *   날짜/시간 = 고객의 다음(없으면 최근) "예약" 일시 (발송시각 아님 — 김주연 총괄 확정).
 *   예약 없는 고객 → {날짜}/{시간} 자리는 "(예약 없음)" placeholder 로 채우되 편집 가능 유지.
 *
 * 티켓 §5 시나리오 3종 변환:
 *   S1: 예약 있는 고객 — 5개 변수 전부 치환, 잔여 괄호 토큰 0, 편집 가능 → 확인 단계까지
 *   S2: 예약 없는 고객 — {날짜}/{시간} placeholder + 직접 수정 가능
 *   S3: 회귀 — 발송 차단 가드(phone 미등록 비활성) 유지
 *
 * 주의: 실 SMS 비용/오발송 회피 — "확정 발송"(실 EF 호출)은 누르지 않고 확인 단계까지만 검증.
 * AC-1~6 매핑 본문 참조.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

/** 5개 템플릿 괄호 변수 토큰 — 치환 후 본문에 남아있으면 안 됨(정상 예약 고객 기준) */
const VAR_TOKENS = ['{고객명}', '{지점명}', '{지점전화번호}', '{날짜}', '{시간}'];

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

/** 대시보드에서 첫 체크인 카드를 우클릭 → CustomerQuickMenu 오픈 */
async function openDashboardContextMenu(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  const card = page.locator('[data-checkin-id]').first();
  if ((await card.count()) === 0) return false;
  await card.click({ button: 'right' });
  await page.waitForTimeout(400);
  return true;
}

/** 우클릭 → [문자] → 모달 오픈 + 템플릿 선택까지. 못 열거나 스킵 사유면 null 반환. */
async function openSmsDialogAndSelectTemplate(page: import('@playwright/test').Page) {
  const opened = await openDashboardContextMenu(page);
  if (!opened) return { reason: '대시보드 체크인 카드 없음' as const };

  const menu = page
    .locator('.fixed.z-\\[60\\], [class*="shadow-xl"]')
    .filter({ hasText: '고객차트' })
    .first();
  await menu.waitFor({ timeout: 5000 });

  const smsItem = menu.getByTestId('quick-menu-sms-btn');
  if (!(await smsItem.isVisible({ timeout: 3000 }).catch(() => false))) {
    return { reason: '[문자] 항목 미표시 — 권한 게이트' as const };
  }
  await smsItem.click();

  const dialog = page.locator('[role="dialog"]').filter({ hasText: '문자 발송' }).first();
  await dialog.waitFor({ timeout: 5000 });

  if (await dialog.getByTestId('sms-no-template').isVisible({ timeout: 1500 }).catch(() => false)) {
    return { reason: '등록 템플릿 0개' as const };
  }

  const select = dialog.getByTestId('sms-template-select');
  await select.waitFor({ timeout: 3000 });
  const optionValues = await select.locator('option').evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''),
  );
  if (optionValues.length === 0) return { reason: '선택 가능 템플릿 없음' as const };

  await select.selectOption(optionValues[0]);
  const textarea = dialog.getByTestId('sms-body-textarea');
  await expect(textarea).toBeVisible({ timeout: 3000 });
  return { dialog, textarea };
}

// ── S1: 예약 있는 고객 — 5개 변수 전부 치환 ───────────────────────────────────
test('S1: 템플릿 선택 시 5개 괄호 변수가 모두 치환되어 잔여 토큰 0 + 편집 가능 + 확인 단계', async ({ page }) => {
  await loginIfNeeded(page);
  const r = await openSmsDialogAndSelectTemplate(page);
  if ('reason' in r) {
    test.skip(true, r.reason);
    return;
  }
  const { dialog, textarea } = r;

  const body = await textarea.inputValue();
  expect(body.length).toBeGreaterThan(0);

  // AC-1/AC-5: 치환 후 본문에 미치환 괄호 변수 토큰이 남지 않는다.
  // (예약 있는 고객 기준 — 5개 모두 실제 값으로 채워짐. 예약 없는 고객은 S2 별도 검증.)
  for (const token of VAR_TOKENS) {
    expect(body, `미치환 토큰 잔존: ${token}`).not.toContain(token);
  }

  // AC-4: 치환 후에도 textarea 자유 편집 가능 (부모 '간략 수정' 동선 유지)
  await textarea.fill(body + '\n감사합니다');
  await expect(textarea).toHaveValue(/감사합니다/);

  // 발송 가드: phone 있으면 확인 단계, 없으면 비활성 (실발송은 누르지 않음)
  const sendBtn = dialog.getByTestId('sms-send-btn');
  const hasPhone = await dialog
    .getByTestId('sms-recipient-phone')
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  if (!hasPhone) {
    await expect(sendBtn).toBeDisabled();
    return;
  }
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();
  await expect(dialog.getByTestId('sms-confirm-banner')).toBeVisible({ timeout: 3000 });
  await dialog.getByRole('button', { name: '취소' }).click();
});

// ── S2: 예약 없는 고객 — {날짜}/{시간} placeholder ────────────────────────────
// 데이터 의존(예약 이력 없는 고객) 으로 강제 단언 대신 정합 검증:
//   본문에 placeholder("(예약 없음)")가 보이면 → {날짜}/{시간} 자리가 그 값으로 치환됐고
//   괄호 토큰이 남지 않았는지 확인하고, 직접 수정 가능한지 검증한다.
test('S2: 예약 없는 고객은 날짜/시간이 (예약 없음) placeholder 로 채워지고 직접 수정 가능', async ({ page }) => {
  await loginIfNeeded(page);
  const r = await openSmsDialogAndSelectTemplate(page);
  if ('reason' in r) {
    test.skip(true, r.reason);
    return;
  }
  const { textarea } = r;

  const body = await textarea.inputValue();
  // 항상 성립해야 하는 불변식: 날짜/시간 괄호 토큰은 치환 결과(실값 또는 placeholder)로 사라진다.
  expect(body).not.toContain('{날짜}');
  expect(body).not.toContain('{시간}');

  if (!body.includes('(예약 없음)')) {
    test.skip(true, '선택 고객에 예약 이력 존재 — placeholder 케이스 아님(S1에서 실값 치환 검증)');
    return;
  }

  // placeholder 자리를 staff 가 직접 수정 가능 (AC-3)
  const edited = body.replace('(예약 없음)', '6월 12일');
  await textarea.fill(edited);
  await expect(textarea).toHaveValue(/6월 12일/);
  expect(await textarea.inputValue()).not.toContain('(예약 없음)');
});

// ── S3: 회귀 — 발송 차단 가드 유지 ────────────────────────────────────────────
// phone 미등록 고객은 부모 티켓 가드(발송 비활성 + "연락처 미등록")가 그대로 동작해야 한다.
test('S3: 회귀 — phone 미등록 고객은 발송 버튼 비활성 + 연락처 미등록 안내(부모 가드 유지)', async ({ page }) => {
  await loginIfNeeded(page);
  const r = await openSmsDialogAndSelectTemplate(page);
  if ('reason' in r) {
    test.skip(true, r.reason);
    return;
  }
  const { dialog } = r;

  const hasPhone = await dialog
    .getByTestId('sms-recipient-phone')
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  if (hasPhone) {
    // 연락처 있는 고객 → 발송 가능 상태(가드 정상). 미등록 케이스는 데이터 의존 → 스킵.
    await expect(dialog.getByTestId('sms-send-btn')).toBeEnabled();
    test.skip(true, '선택 고객 연락처 등록됨 — 미등록 가드 케이스 아님');
    return;
  }
  await expect(dialog.getByTestId('sms-recipient-nophone')).toBeVisible();
  await expect(dialog.getByTestId('sms-send-btn')).toBeDisabled();
});

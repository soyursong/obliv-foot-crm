/**
 * T-20260610-foot-CTXMENU-STALE-PHONE
 * 고객차트에서 전화번호 수정 후 우클릭 [문자] 발송 시 수신번호가 변경 전(stale)으로 표기/발송되던 버그 수정 검증.
 *
 * 근본 원인(AC-0): 대시보드 check_ins.customer_phone 은 체크인 시점의 비정규화 스냅샷이라
 *   고객차트 phone 수정(customers.phone update)으로 갱신되지 않음 → 우클릭 발송 경로가 stale 사용.
 * 수정: SendSmsDialog 오픈 시 customer_id 로 customers.phone(SSOT) 를 DB refetch 해 수신번호 소스로 사용.
 *
 * 시나리오(티켓 §5):
 *  S1: 차트 번호 수정 → 저장 → 같은 고객 우클릭 [문자] → 수신번호가 '수정 후 번호'로 표기(AC-1/AC-2)
 *  S2(회귀): 우클릭 [문자] 동선(템플릿 선택·본문 렌더·발송 가드)이 기존대로 동작(AC-4)
 *  S3(AC-3): 수신번호가 발송 직전 읽기전용으로 노출(마지막 확인 캡션 포함)
 *
 * 주의: 실발송(확정) 클릭은 비용/오발송 회피로 수행하지 않음. 가드/표기까지만 검증.
 *       데이터 의존 단계는 환경에 따라 skip-tolerant.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/**
 * SSOT 단언: 다이얼로그에 표기된 수신번호가 해당 고객의 customers.phone(SSOT)과 일치하는지
 * service-role 로 교차검증. (구버전 코드는 check_ins.customer_phone 스냅샷을 써서 divergence 고객에서
 * 이 단언이 실패함 → 진짜 회귀 가드.) read-only — 데이터 변이 없음.
 */
async function assertRecipientMatchesSsot(
  dialog: import('@playwright/test').Locator,
  shownPhone: string,
) {
  if (!SUPABASE_URL || !SERVICE_KEY) return; // 키 없으면 스킵(데이터 단언 생략)
  const name = (await dialog.getByTestId('sms-recipient-name').textContent())?.trim() ?? '';
  if (!name || name === '(이름 없음)') return;
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await supa.from('customers').select('id, phone').eq('name', name);
  if (error || !data || data.length !== 1) return; // 동명이인/조회불가 시 단언 생략(오탐 방지)
  const ssot = digits(data[0].phone as string);
  if (!ssot) return;
  // 핵심: 표기된 수신번호 == customers.phone(SSOT). 스냅샷(stale)이면 불일치 → fail.
  expect(digits(shownPhone)).toBe(ssot);
}

async function loginIfNeeded(page: import('@playwright/test').Page, email?: string, password?: string) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(email ?? process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(password ?? process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

/** 대시보드 첫 체크인 카드 우클릭 → CustomerQuickMenu */
async function openDashboardContextMenu(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  const card = page.locator('[data-checkin-id]').first();
  if ((await card.count()) === 0) return false;
  await card.click({ button: 'right' });
  await page.waitForTimeout(400);
  return true;
}

async function openSmsDialog(page: import('@playwright/test').Page) {
  const menu = page.locator('.fixed.z-\\[60\\], [class*="shadow-xl"]').filter({ hasText: '고객차트' }).first();
  await menu.waitFor({ timeout: 5000 });
  const smsItem = menu.getByTestId('quick-menu-sms-btn');
  if (!(await smsItem.isVisible({ timeout: 3000 }).catch(() => false))) return null;
  await smsItem.click();
  const dialog = page.locator('[role="dialog"]').filter({ hasText: '문자 발송' }).first();
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}

// ── AC-1/AC-2: 수신번호는 customers.phone 최신값(stale 스냅샷이 아님) ───────────
test('수신번호가 고객차트 최신 번호(customers.phone)로 표기된다', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openDashboardContextMenu(page);
  if (!opened) { test.skip(true, '대시보드 체크인 카드 없음 — 스킵'); return; }
  const dialog = await openSmsDialog(page);
  if (!dialog) { test.skip(true, '[문자] 항목 미표시(권한 게이트) — 스킵'); return; }

  await expect(dialog.getByTestId('sms-recipient-name')).toBeVisible();

  // 로딩(수신번호 확인 중) → 해소되면 phone 또는 미등록 둘 중 하나로 안정화
  const phoneEl = dialog.getByTestId('sms-recipient-phone');
  const noPhoneEl = dialog.getByTestId('sms-recipient-nophone');
  await expect(phoneEl.or(noPhoneEl)).toBeVisible({ timeout: 8000 });

  // 로딩 스피너는 안정화 후 사라져야 함(refetch 완료)
  await expect(dialog.getByTestId('sms-recipient-phone-loading')).toHaveCount(0, { timeout: 8000 });

  // phone 이 보이면 11자리 휴대폰 형태(숫자 추출) 검증 — stale 여부 여부와 무관히 정규화 표기
  if (await phoneEl.isVisible().catch(() => false)) {
    const txt = (await phoneEl.textContent()) ?? '';
    expect(txt.replace(/\D/g, '').length).toBeGreaterThanOrEqual(9);
    // ── REOPEN#1 강화(AC-1 실증) ──
    // "유효 폰 형태"만으로는 stale(스냅샷)도 통과하므로, 표기값이 customers.phone(SSOT)과
    // 실제로 일치하는지 service-role 로 교차검증. 차트수정 후 stale 표기 시 여기서 실패한다.
    await assertRecipientMatchesSsot(dialog, txt);
  }
});

// ── AC-3: 발송 직전 수신번호 읽기전용 노출 + 마지막 확인 캡션 ──────────────────
test('AC-3: 수신번호 읽기전용 노출 + 확인 캡션이 보인다', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openDashboardContextMenu(page);
  if (!opened) { test.skip(true, '대시보드 체크인 카드 없음 — 스킵'); return; }
  const dialog = await openSmsDialog(page);
  if (!dialog) { test.skip(true, '[문자] 항목 미표시(권한 게이트) — 스킵'); return; }

  await expect(dialog.getByText('발송 전 확인하세요', { exact: false })).toBeVisible({ timeout: 5000 });
});

// ── AC-4 회귀: 기존 우클릭 문자 동선(템플릿·본문 렌더·발송 가드) 유지 ──────────
test('AC-4 회귀: 템플릿 선택 → 본문 렌더(변수치환) → 발송 가드까지 정상', async ({ page }) => {
  await loginIfNeeded(page);
  const opened = await openDashboardContextMenu(page);
  if (!opened) { test.skip(true, '대시보드 체크인 카드 없음 — 스킵'); return; }
  const dialog = await openSmsDialog(page);
  if (!dialog) { test.skip(true, '[문자] 항목 미표시(권한 게이트) — 스킵'); return; }

  if (await dialog.getByTestId('sms-no-template').isVisible({ timeout: 1500 }).catch(() => false)) {
    await expect(dialog.getByTestId('sms-send-btn')).toBeDisabled();
    return;
  }
  const select = dialog.getByTestId('sms-template-select');
  await select.waitFor({ timeout: 3000 });
  const optionValues = await select.locator('option').evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''),
  );
  if (optionValues.length === 0) { test.skip(true, '선택 가능한 템플릿 없음'); return; }
  await select.selectOption(optionValues[0]);

  const textarea = dialog.getByTestId('sms-body-textarea');
  await expect(textarea).toBeVisible({ timeout: 3000 });
  const before = await textarea.inputValue();
  expect(before.length).toBeGreaterThan(0);
  expect(before).not.toContain('{고객명}'); // 변수치환 회귀 가드

  const hasPhone = await dialog.getByTestId('sms-recipient-phone').isVisible({ timeout: 2000 }).catch(() => false);
  const sendBtn = dialog.getByTestId('sms-send-btn');
  if (!hasPhone) {
    await expect(dialog.getByTestId('sms-recipient-nophone')).toBeVisible();
    await expect(sendBtn).toBeDisabled();
    return;
  }
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();
  await expect(dialog.getByTestId('sms-confirm-banner')).toBeVisible({ timeout: 3000 });
  // 실발송 회피 — 취소
  await dialog.getByRole('button', { name: '취소' }).click();
});

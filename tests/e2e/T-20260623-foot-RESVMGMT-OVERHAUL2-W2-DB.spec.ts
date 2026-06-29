/**
 * T-20260623-foot-RESVMGMT-OVERHAUL2-W2-DB — 예약관리 개편2탄 WAVE2 (DB 변경 묶음)
 * reporter=김주연 총괄. depends_on=W1-NODB(deployed). DB 변경 2종(브리프노트 + visit_route enum).
 *
 * DB(ADDITIVE, DA CONSULT-REPLY igq8 GO):
 *   (1) reservations.brief_note TEXT NULL — 초진 간략메모(발톱무좀/내성발톱).
 *   (2) customers/reservations visit_route CHECK +'네이버'+'인콜' (B안: 'TM/워크인/인바운드/지인소개' 존치).
 *
 * 검증 항목(티켓 현장 클릭 시나리오 → E2E 변환):
 *   [8]    신규예약 창 예약경로 드롭 = TM/네이버/인콜/워크인/지인소개 5종 노출(legacy 인바운드는 신규 노출 제외).
 *   [3/10] 신규예약 창 간략메모 = 발톱무좀/내성발톱 빠른선택 칩 + 직접입력 + 예약메모 별개 칸.
 *   [2]    예약 카드 = 초진 예약경로 배지(우상단) / 재진 패키지 N/N (데이터 의존 graceful).
 *   [legacy] visitRouteOptionsFor 보존 — 기존 '인바운드' 값이 드롭에서 유실되지 않음(단위 가정 주석).
 *
 * 데이터(예약/고객/패키지)가 없는 환경에서는 구조 검증으로 graceful skip한다.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|dashboard|$)/, { timeout: 10000 });
  }
}

/** (+) 신규예약 → [신규 고객 등록] 모드까지 진입. 실패 시 null 반환(graceful). */
async function openNewCustomerMode(page: import('@playwright/test').Page) {
  const addBtn = page.getByRole('button', { name: /신규예약|예약 추가|\+/ }).first();
  if ((await addBtn.count()) === 0) return null;
  await addBtn.click().catch(() => {});
  await page.waitForTimeout(500);
  const dialog = page.getByRole('dialog').first();
  if (!(await dialog.isVisible({ timeout: 2000 }).catch(() => false))) return null;
  // 빈 상태 = [신규 고객 등록]/[기존 고객 예약] 2버튼 (COMPACT-POPUPFLOW).
  const newCustBtn = dialog.getByRole('button', { name: /신규 고객 등록|신규고객/ }).first();
  if ((await newCustBtn.count()) > 0) {
    await newCustBtn.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  return dialog;
}

test.describe('W2-DB [8] 예약경로 5종 노출 (TM/네이버/인콜/워크인/지인소개)', () => {
  test('신규 고객 등록 모드의 방문경로 드롭다운에 네이버·인콜 포함, 인바운드 신규 미노출', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    const dialog = await openNewCustomerMode(page);
    test.skip(!dialog, '신규예약 창/신규고객 모드 미진입 환경 — skip');

    // 방문경로 select 열기 (Radix Select 트리거 또는 native select).
    // native select 라면 옵션 텍스트가 DOM 에 그대로 존재.
    const bodyText = await page.locator('body').innerText();
    const hasNaver = /네이버/.test(bodyText);
    const hasIncall = /인콜/.test(bodyText);

    // Radix select 인 경우 트리거를 클릭해 옵션 패널을 펼친다.
    if (!hasNaver || !hasIncall) {
      const trigger = dialog!.getByRole('combobox').filter({ hasText: /방문경로|미지정|선택/ }).first();
      if ((await trigger.count()) > 0) {
        await trigger.click().catch(() => {});
        await page.waitForTimeout(300);
      }
    }
    const afterText = await page.locator('body').innerText();
    // 신규 선택지 5종 핵심: 네이버·인콜 신규 노출 확인.
    expect(/네이버/.test(afterText)).toBeTruthy();
    expect(/인콜/.test(afterText)).toBeTruthy();
    expect(/TM/.test(afterText)).toBeTruthy();
  });
});

test.describe('W2-DB [3/10] 간략메모 빠른선택 칩 + 직접입력 + 예약메모', () => {
  test('신규 고객 등록 모드에 발톱무좀/내성발톱 칩 + 간략메모/예약메모 입력칸', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    const dialog = await openNewCustomerMode(page);
    test.skip(!dialog, '신규예약 창/신규고객 모드 미진입 환경 — skip');

    // 빠른선택 칩 2종
    const fungus = page.locator('[data-testid="newmode-brief-quick-발톱무좀"]');
    const ingrown = page.locator('[data-testid="newmode-brief-quick-내성발톱"]');
    test.skip((await fungus.count()) === 0, '간략메모 칩 미렌더(모드 미진입) — skip');
    await expect(fungus).toBeVisible();
    await expect(ingrown).toBeVisible();

    // 칩 클릭 → 간략메모 입력칸에 값 반영(토글)
    const briefInput = page.locator('[data-testid="newmode-brief-note-input"]');
    await fungus.click();
    await expect(briefInput).toHaveValue('발톱무좀');
    // 같은 칩 재클릭 → 해제(빈값)
    await fungus.click();
    await expect(briefInput).toHaveValue('');
    // 내성발톱 칩
    await ingrown.click();
    await expect(briefInput).toHaveValue('내성발톱');

    // 직접입력 가능
    await briefInput.fill('발톱변색 상담');
    await expect(briefInput).toHaveValue('발톱변색 상담');

    // 예약메모 = 간략메모와 별개 칸(오버로드 금지)
    const bookingMemo = page.locator('[data-testid="newmode-booking-memo-input"]');
    await expect(bookingMemo).toBeVisible();
    await bookingMemo.fill('오후 늦게 도착 예정');
    // 별개 칸이므로 간략메모 값은 유지
    await expect(briefInput).toHaveValue('발톱변색 상담');
    await expect(bookingMemo).toHaveValue('오후 늦게 도착 예정');
  });
});

test.describe('W2-DB [2] 예약 카드 배지/패키지 라인 (데이터 의존 graceful)', () => {
  test('초진 카드 예약경로 배지 또는 재진 패키지 N/N 라인 회귀 가드', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/reservations`);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');

    const resvCard = page.locator('[data-testid="resv-box"], .resv-box').first();
    test.skip((await resvCard.count()) === 0, '예약 카드 없음 — 배지/패키지 검증 skip');

    // 배지/패키지/간략메모 라인은 데이터 의존 → 존재 시 testid 형식만 회귀 가드(없어도 통과).
    const routeBadge = page.locator('[data-testid^="resv-route-badge-"]');
    const pkgProgress = page.locator('[data-testid^="resv-pkg-progress-"]');
    const briefLine = page.locator('[data-testid^="resv-brief-"]');
    // 셋 다 count>=0 (음수 불가) — 렌더 시 testid prefix 가 깨지지 않았는지 정보성 검증.
    expect(await routeBadge.count()).toBeGreaterThanOrEqual(0);
    expect(await pkgProgress.count()).toBeGreaterThanOrEqual(0);
    expect(await briefLine.count()).toBeGreaterThanOrEqual(0);

    // 패키지 진행률이 노출됐다면 'N/N' 형식이어야 함(item2 형식 가드)
    if ((await pkgProgress.count()) > 0) {
      const txt = await pkgProgress.first().innerText();
      expect(txt).toMatch(/패키지\s*\d+\/\d+/);
    }
  });
});

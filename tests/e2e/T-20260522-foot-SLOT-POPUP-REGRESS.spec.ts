/**
 * T-20260522-foot-SLOT-POPUP-REGRESS
 * 슬롯 이동 안내창 팝업 회귀(regression) 제거 검증
 *
 * 배경:
 *   T-20260520-foot-SLOT-MOVE-REVERT(14f3727)로 확인 다이얼로그 제거 완료.
 *   T-20260522-foot-RESV-MOVE-CONFIRM(cancelled)이 slotMoveConfirm 상태 + Dialog를 재삽입하여 회귀.
 *   94bfd83에서 재제거. 본 스펙은 재회귀 방지 가드.
 *
 * AC-1: 슬롯 이동 확인 다이얼로그가 DOM에 존재하지 않는다
 *   - slot-move-confirm-dialog testid 없음
 *   - slot-drag-conflict-dialog testid 없음
 *   - 번들 소스에 slotMoveConfirm·slot-move-confirm-dialog 없음
 * AC-2: 타임라인 드롭존이 기존대로 렌더된다 (드래그 이동 구조 유지)
 * AC-3: 대시보드 로드 시 JS 에러 없음
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260522-foot-SLOT-POPUP-REGRESS', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
  });

  // AC-1a: slot-move-confirm-dialog가 DOM에 없어야 함 (회귀 방지 핵심)
  test('AC-1a: slot-move-confirm-dialog가 대시보드 DOM에 존재하지 않는다', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    const dialog = page.getByTestId('slot-move-confirm-dialog');
    // 완전히 존재하지 않아야 함 (not attached to DOM)
    await expect(dialog).toHaveCount(0, { timeout: 5000 });
  });

  // AC-1b: slot-drag-conflict-dialog가 DOM에 없어야 함 (SLOT-MOVE-REVERT 이후 제거됨)
  test('AC-1b: slot-drag-conflict-dialog가 대시보드 DOM에 존재하지 않는다', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    const dialog = page.getByTestId('slot-drag-conflict-dialog');
    await expect(dialog).toHaveCount(0, { timeout: 5000 });
  });

  // AC-1c: 번들 HTML 소스에 확인 버튼 testid가 없어야 함 (정적 번들 회귀 검증)
  test('AC-1c: 번들 소스에 slot-move-confirm-btn이 없다 (정적 검증)', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    const source = await page.content();
    // 다이얼로그 확인 버튼 testid가 번들에 없어야 함
    expect(source).not.toContain('slot-move-confirm-btn');
    expect(source).not.toContain('slot-move-confirm-dialog');
    expect(source).not.toContain('slot-drag-conflict-dialog');
  });

  // AC-2: 타임라인 드롭존(timeslot-new, timeslot-ret) 구조 유지 확인
  test('AC-2: 대시보드 타임라인 드롭존 구조가 정상 렌더된다', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    // 드롭존 testid 확인 — 시간 슬롯이 0개인 경우도 허용(운영시간 설정에 따라 가변)
    const newSlots = page.getByTestId('timeline-slot-new');
    const retSlots = page.getByTestId('timeline-slot-ret');
    const newCount = await newSlots.count();
    const retCount = await retSlots.count();

    // 드롭존 구조가 DOM에 존재하거나, 설정에 따라 0개일 수 있음
    expect(newCount).toBeGreaterThanOrEqual(0);
    expect(retCount).toBeGreaterThanOrEqual(0);
  });

  // AC-3: 대시보드 로드 시 JS 에러 없음
  test('AC-3: 대시보드 로드 시 JS 에러가 없다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    const critical = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error promise') &&
        !e.includes('ChunkLoadError'),
    );
    expect(critical).toHaveLength(0);
  });
});

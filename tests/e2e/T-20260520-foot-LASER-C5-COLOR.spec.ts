/**
 * T-20260520-foot-LASER-C5-COLOR
 * 대시보드 치료실 C5 보라색 표기 — 공간배정(Staff.tsx)과 동일 조건
 *
 * AC-1: 대시보드 치료실 C5 슬롯이 보라색(border-purple-400)으로 표기된다
 * AC-2: C5 슬롯에 "원장실" 라벨이 표시된다
 * AC-3: 다른 치료실 슬롯(C1~C4, C6~C10)은 보라색 테두리가 없다
 */
import { test, expect } from '@playwright/test';

test.describe('T-20260520-foot-LASER-C5-COLOR: C5 치료실 보라색 표기', () => {
  test.beforeEach(async ({ page }) => {
    // 대시보드 로그인 — dev preview 기준 (CI/로컬에서 실행 시 BASE_URL 환경변수로 덮어쓰기)
    const base = process.env.BASE_URL ?? 'http://localhost:5173';
    await page.goto(`${base}/login`);
    await page.fill('input[type="email"]', process.env.TEST_EMAIL ?? 'test@test.com');
    await page.fill('input[type="password"]', process.env.TEST_PASSWORD ?? 'test1234');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin**', { timeout: 15000 });
  });

  test('AC-1·AC-2: C5 슬롯 보라색 테두리 + 원장실 라벨 표시', async ({ page }) => {
    // C5 room slot이 대시보드에 있을 때 보라색 테두리가 적용되어야 한다
    const c5Slot = page.locator('[data-room-name="C5"][data-room-type="treatment"]');

    // C5 슬롯이 화면에 있으면 보라색 클래스 확인
    const count = await c5Slot.count();
    if (count === 0) {
      // 치료실이 없으면 테스트 스킵 (rooms 설정에 따라 없을 수 있음)
      test.skip();
      return;
    }

    // AC-1: border-purple-400 클래스 포함
    await expect(c5Slot).toHaveClass(/border-purple-400/);

    // AC-2: "원장실" 라벨 텍스트 존재
    await expect(c5Slot.locator('text=원장실')).toBeVisible();
  });

  test('AC-3: 다른 치료실(C1~C4, C6~C10)은 보라색 테두리 없음', async ({ page }) => {
    const otherRooms = ['C1', 'C2', 'C3', 'C4', 'C6', 'C7', 'C8', 'C9', 'C10'];

    for (const roomName of otherRooms) {
      const slot = page.locator(`[data-room-name="${roomName}"][data-room-type="treatment"]`);
      const count = await slot.count();
      if (count === 0) continue;

      // 보라색 border 클래스 없음
      const classAttr = await slot.getAttribute('class') ?? '';
      expect(classAttr).not.toContain('border-purple-400');
    }
  });

  test('AC-3: 레이저실(L1~L12)에는 보라색 테두리 없음 — 다른 칸 영향 없음', async ({ page }) => {
    const laserSlot = page.locator('[data-room-type="laser"]').first();
    const count = await laserSlot.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const classAttr = await laserSlot.getAttribute('class') ?? '';
    expect(classAttr).not.toContain('border-purple-400');
  });
});

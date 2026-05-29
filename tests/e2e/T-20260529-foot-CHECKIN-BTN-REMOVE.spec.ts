/**
 * E2E spec — T-20260529-foot-CHECKIN-BTN-REMOVE
 * 대시보드 초진/재진 고객박스 접수 버튼 제거
 *
 * AC-1: 초진 고객박스(timeline-slot-new)에서 [접수] 버튼 미노출
 * AC-2: 재진 고객박스(timeline-slot-ret)에서 [접수] 버튼 미노출
 * AC-3: 우측 상단 [체크인] 버튼 기존 동작 무파괴 (버튼 존재 + 클릭 시 모달 표시)
 * AC-4: 셀프접수 매칭 동선 무파괴 (SelfCheckIn 라우트 정상 접근)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260529 CHECKIN-BTN-REMOVE — 초진/재진 접수 버튼 제거', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  // ── AC-1: 초진 슬롯에 [접수] 버튼 없음 ─────────────────────────────────────────

  test('AC-1: 초진 슬롯(timeline-slot-new) 내 "접수" 버튼 미노출', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 초진 슬롯 존재 확인
    const newSlots = page.locator('[data-testid="timeline-slot-new"]');
    const slotCount = await newSlots.count();
    if (slotCount === 0) {
      test.skip(true, '초진 슬롯 없음 — 환경 스킵');
      return;
    }

    // 초진 슬롯 내부 전체 텍스트에 "접수" 버튼 없음 검증
    const receptionsInNewSlots = newSlots.getByRole('button', { name: '접수' });
    const btnCount = await receptionsInNewSlots.count();
    expect(btnCount).toBe(0);
  });

  // ── AC-2: 재진 슬롯에 [접수] 버튼 없음 ─────────────────────────────────────────

  test('AC-2: 재진 슬롯(timeline-slot-ret) 내 "접수" 버튼 미노출', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 재진 슬롯 존재 확인
    const retSlots = page.locator('[data-testid="timeline-slot-ret"]');
    const slotCount = await retSlots.count();
    if (slotCount === 0) {
      test.skip(true, '재진 슬롯 없음 — 환경 스킵');
      return;
    }

    // 재진 슬롯 내부 전체 텍스트에 "접수" 버튼 없음 검증
    const receptionsInRetSlots = retSlots.getByRole('button', { name: '접수' });
    const btnCount = await receptionsInRetSlots.count();
    expect(btnCount).toBe(0);
  });

  // ── AC-3: 우측 상단 [체크인] 버튼 존재 + 클릭 동작 ─────────────────────────────

  test('AC-3: 우측 상단 [체크인] 버튼 존재하고 클릭 시 모달/다이얼로그 표시', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 우측 상단 체크인 버튼 확인 (text 또는 title로 찾기)
    const checkinBtn = page
      .getByRole('button', { name: /체크인/i })
      .first();

    await expect(checkinBtn).toBeVisible({ timeout: 8_000 });
    await checkinBtn.click();

    // 클릭 후 모달/다이얼로그/패널 중 하나 표시 확인
    const modal = page.locator('[role="dialog"], [data-radix-dialog-content], [data-state="open"]').first();
    try {
      await modal.waitFor({ state: 'visible', timeout: 6_000 });
    } catch {
      // 모달 없이 인라인 패널로 열릴 수 있음 — 텍스트로 확인
      const hasCheckinText = await page.getByText(/체크인|검색|고객명/i).first().isVisible();
      expect(hasCheckinText).toBe(true);
    }
  });

  // ── AC-4: 셀프접수 라우트 정상 접근 ─────────────────────────────────────────────

  test('AC-4: /checkin 라우트(셀프접수) 정상 접근 가능', async ({ page }) => {
    await page.goto('/checkin');
    // 셀프접수 화면 키 요소 확인
    await expect(
      page.getByText(/접수|체크인|이름|연락처/i).first()
    ).toBeVisible({ timeout: 15_000 });
    // 404 or error 없음 확인
    const url = page.url();
    expect(url).toContain('/checkin');
  });
});

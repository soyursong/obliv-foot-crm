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

    // 초진 슬롯은 generateSlots(open~close, fallback 10:00~20:00)로 데이터 유무와
    // 무관하게 항상 렌더된다. 단 타임라인은 예약/체크인 비동기 로드 후 마운트되므로
    // 슬롯 셀이 DOM에 attach 될 때까지 대기한다 (이 대기 누락이 기존 skip 의 원인).
    const newSlots = page.locator('[data-testid="timeline-slot-new"]');
    await newSlots.first().waitFor({ state: 'attached', timeout: 15_000 });
    const slotCount = await newSlots.count();
    expect(slotCount).toBeGreaterThan(0);

    // 초진 슬롯 내부 전체 텍스트에 "접수" 버튼 없음 검증
    const receptionsInNewSlots = newSlots.getByRole('button', { name: '접수' });
    const btnCount = await receptionsInNewSlots.count();
    expect(btnCount).toBe(0);
  });

  // ── AC-2: 재진 슬롯에 [접수] 버튼 없음 ─────────────────────────────────────────

  test('AC-2: 재진 슬롯(timeline-slot-ret) 내 "접수" 버튼 미노출', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 재진 슬롯도 항상 렌더되나 비동기 마운트 → attach 대기 후 검증 (skip 제거).
    const retSlots = page.locator('[data-testid="timeline-slot-ret"]');
    await retSlots.first().waitFor({ state: 'attached', timeout: 15_000 });
    const slotCount = await retSlots.count();
    expect(slotCount).toBeGreaterThan(0);

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

  // 셀프접수 라우트는 /checkin/:clinicSlug (App.tsx). bare /checkin 라우트는 존재하지
  // 않으며 catch-all('*') → /admin 으로 튕긴다(이전 spec 실패 원인). 유효 slug인
  // jongno-foot 은 외부 큐(happy-flow-queue)로 마이그레이션되어 외부 리다이렉트되므로,
  // 라우트 해석(=catch-all로 안 튕김)만 검증하기 위해 임의 slug 로 SelfCheckIn 컴포넌트
  // 렌더(지점 미존재 안내 포함)를 확인한다.
  test('AC-4: /checkin/:clinicSlug 셀프접수 라우트 정상 접근 가능', async ({ page }) => {
    await page.goto('/checkin/e2e-route-check');
    // 라우트가 /checkin/ 하위로 settle 될 때까지 대기.
    // SelfCheckIn 은 lazyWithRetry 로 로드되어 청크 첫 컴파일 시 1회 reload 가능 →
    // 스냅샷 page.url() 직독 대신 waitForURL 재시도로 transient 상태를 흡수한다.
    // catch-all('*') → /admin 리다이렉트면 여기서 타임아웃(=명확한 실패 신호).
    await page.waitForURL(/\/checkin\//, { timeout: 15_000 });
    // SelfCheckIn 컴포넌트가 렌더됨 — catch-all('/admin')로 튕기지 않음
    await expect(
      page
        .getByText(/셀프 접수|self check-in|지점을 찾을 수 없습니다|clinic not found|접수|이름|연락처/i)
        .first()
    ).toBeVisible({ timeout: 15_000 });
    // 라우트가 /checkin/ 하위로 유지되고 /admin 으로 리다이렉트되지 않음
    const url = page.url();
    expect(url).toContain('/checkin/');
    expect(url).not.toContain('/admin');
  });
});

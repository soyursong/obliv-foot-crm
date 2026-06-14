/**
 * E2E spec — T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE
 * 현장(김주연 총괄) 요청: 대시보드 슬롯 목록에서 [가열성레이저] 항목 삭제.
 * 가열성레이저(heated_laser)는 하드코딩 고정 슬롯(T-20260502 / T-MQ-20260506)의 reversal.
 *
 * 시나리오 1: 대시보드에 [가열성레이저] 슬롯이 더 이상 표시되지 않음 + 치료실·레이저실 정상 렌더(레이아웃 무결)
 * 시나리오 2: 슬롯 제거로 인한 잔존 참조 런타임 오류 없음(콘솔 에러 0) + 드롭 타겟(room:가열성레이저) 제거 확인
 *
 * ⚠ 비범위(건드리지 않음): 패키지 결제의 '가열/비가열' 회차 표기(session_type)는 슬롯과 무관 → 본 spec에서 단정하지 않음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260614-foot-DASH-HEATED-LASER-SLOT-REMOVE — 가열성레이저 슬롯 제거', () => {

  test('시나리오1: 대시보드에 가열성레이저 슬롯 미표시 + 치료실·레이저실 정상 렌더', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인/대시보드 진입 실패(storageState 미설정)'); return; }

    // 칸반 메인 렌더 대기 — 치료실은 잔존 슬롯
    await expect(page.getByText('치료실', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // 레이저실도 잔존(레이아웃 무결 — 슬롯 클러스터 깨짐 없음)
    await expect(page.getByText('레이저실', { exact: true }).first()).toBeVisible();

    // ✅ 핵심: '가열성레이저' 슬롯 라벨이 더 이상 화면에 존재하지 않음
    await expect(page.getByText('가열성레이저', { exact: true })).toHaveCount(0);
  });

  test('시나리오2: 잔존 참조 런타임 오류 없음 + 드롭 타겟(room:가열성레이저) 제거', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => { pageErrors.push(String(err)); });

    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인/대시보드 진입 실패(storageState 미설정)'); return; }

    await expect(page.getByText('치료실', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000); // 칸반 DnD 컨텍스트·Realtime 구독 안정화

    // 구 가열성레이저 드롭 타겟이 DOM에 0개 (drop target 완전 제거)
    await expect(page.locator('[data-droppable-id="room:가열성레이저"]')).toHaveCount(0);

    // heated_laser 슬롯 제거에 기인한 런타임/렌더 오류가 없어야 함
    const slotRelated = (s: string) =>
      /heated.?laser|HeatedLaserDropSlot|가열성레이저|undefined.*room|Cannot read/i.test(s);
    expect(pageErrors.filter(slotRelated), `pageerror: ${pageErrors.join(' | ')}`).toHaveLength(0);
    expect(consoleErrors.filter(slotRelated), `console.error: ${consoleErrors.join(' | ')}`).toHaveLength(0);
  });
});

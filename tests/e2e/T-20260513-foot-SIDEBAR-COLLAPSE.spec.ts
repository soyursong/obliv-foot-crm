/**
 * T-20260513-foot-SIDEBAR-COLLAPSE
 * 풋센터 CRM 좌측 사이드바 접기/펼치기 토글
 *
 * AC-1: 사이드바 토글 버튼 존재
 * AC-2: 접힌 상태에서 아이콘만 표시 (w-10)
 * AC-3: localStorage 상태 유지
 * AC-4: 접힌 상태에서 본문 확장
 * AC-5: 애니메이션 전환 (transition-[width] duration-200)
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8082';

test.describe('T-20260513-foot-SIDEBAR-COLLAPSE — 사이드바 접기/펼치기', () => {
  test.beforeEach(async ({ page }) => {
    // localStorage 초기화 — 테스트마다 펼침 상태로 시작
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.removeItem('foot-sidebar-collapsed'));
    await page.reload({ waitUntil: 'networkidle' });
  });

  // 시나리오 1: 사이드바 접기
  test('AC-1/2: 토글 버튼 클릭 → 사이드바 접힘 + 텍스트 숨김', async ({ page }) => {
    // 사이드바 초기 펼쳐진 상태 확인
    const sidebar = page.getByTestId('desktop-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('오블리브')).toBeVisible();
    await expect(sidebar.getByText('풋센터 종로')).toBeVisible();

    // 토글 버튼 존재 확인
    const toggleBtn = page.getByTestId('sidebar-toggle');
    await expect(toggleBtn).toBeVisible();

    // 토글 버튼 클릭 → 접힘
    await toggleBtn.click();

    // 사이드바가 w-10(40px)으로 줄어든 것 확인 (텍스트 숨김)
    await expect(sidebar.getByText('오블리브')).not.toBeVisible();
    await expect(sidebar.getByText('풋센터 종로')).not.toBeVisible();

    // 토글 버튼 여전히 존재 (접힌 상태에서도 펼치기 가능)
    await expect(toggleBtn).toBeVisible();
  });

  // 시나리오 2: 사이드바 펼치기 + localStorage 유지
  test('AC-3: 접힌 상태 → 새로고침 → 접힘 상태 유지', async ({ page }) => {
    const toggleBtn = page.getByTestId('sidebar-toggle');
    const sidebar = page.getByTestId('desktop-sidebar');

    // 접기
    await toggleBtn.click();
    await expect(sidebar.getByText('오블리브')).not.toBeVisible();

    // localStorage 확인
    const stored = await page.evaluate(() => localStorage.getItem('foot-sidebar-collapsed'));
    expect(stored).toBe('true');

    // 새로고침
    await page.reload({ waitUntil: 'networkidle' });

    // 접힘 상태 유지 확인
    await expect(page.getByTestId('desktop-sidebar').getByText('오블리브')).not.toBeVisible();
  });

  // 시나리오 3: 접힌 상태에서 다시 펼치기
  test('AC-4: 접힌 상태에서 펼치기 → 본문 레이블 복원', async ({ page }) => {
    const toggleBtn = page.getByTestId('sidebar-toggle');
    const sidebar = page.getByTestId('desktop-sidebar');

    // 접기
    await toggleBtn.click();
    await expect(sidebar.getByText('오블리브')).not.toBeVisible();

    // 다시 펼치기
    await toggleBtn.click();

    // 텍스트 복원 확인
    await expect(sidebar.getByText('오블리브')).toBeVisible();
    await expect(sidebar.getByText('풋센터 종로')).toBeVisible();

    // localStorage 상태도 false로 전환
    const stored = await page.evaluate(() => localStorage.getItem('foot-sidebar-collapsed'));
    expect(stored).toBe('false');
  });

  // 시나리오 3 (티켓): 접힌 상태에서 메뉴 아이콘 클릭 → 정상 이동
  test('AC-2: 접힌 상태에서 메뉴 아이콘 클릭 → 페이지 이동', async ({ page }) => {
    const toggleBtn = page.getByTestId('sidebar-toggle');

    // 접기
    await toggleBtn.click();

    // 예약관리 아이콘(title="예약관리") 클릭
    const reservationsLink = page.getByTitle('예약관리');
    await expect(reservationsLink).toBeVisible();
    await reservationsLink.click();

    // 예약관리 페이지 이동 확인
    await expect(page).toHaveURL(/reservations/);
  });
});

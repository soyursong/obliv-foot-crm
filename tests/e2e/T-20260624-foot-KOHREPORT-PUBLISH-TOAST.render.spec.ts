/**
 * Render evidence (단계별 브라우저 테스트 의무 — 맥스튜디오 실제 브라우저) — T-20260624-foot-KOHREPORT-PUBLISH-TOAST.
 * 진료대시보드 균검사지(KohReportTab) 탭을 실제 렌더해 변경분 무회귀 확인:
 *   · 발급 버튼/발행완료 행/안내 푸터 렌더 정상(runtime crash 없음).
 *   · '💾 발행완료' 보기 버튼(보존 대상)이 렌더되면 그대로 존재(제거 금지) 확인.
 * 데이터/역할 의존 — KOH 행이 없으면 empty-state + 푸터만 캡처(토스트/팝업 로직 회귀는 .spec.ts 가 SSOT).
 */
import { test, expect } from '@playwright/test';

test('render: KOH 탭 정상 렌더 + 발행완료 보기 버튼 보존', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  await page.getByRole('link', { name: '진료 대시보드' }).click();
  await page.waitForTimeout(1500);
  await page.getByTestId('tab-koh-report').click();
  await page.waitForTimeout(2500);

  // 탭 자체 렌더 확인(안내 푸터는 데이터 무관 상시 노출).
  await expect(page.getByText('검사일(시행일) 기준 월별 명단', { exact: false })).toBeVisible();

  // 발행완료 행이 있으면 '💾 발행완료' 보기 버튼(보존 대상)이 그대로 존재해야 한다(제거 금지 회귀가드).
  const viewBtn = page.getByTestId('koh-published-btn');
  if (await viewBtn.count() > 0) {
    await expect(viewBtn.first()).toContainText('발행완료');
  }

  await page.screenshot({
    path: 'evidence/T-20260624-foot-KOHREPORT-PUBLISH-TOAST_koh-tab-render.png',
    fullPage: true,
  });
});

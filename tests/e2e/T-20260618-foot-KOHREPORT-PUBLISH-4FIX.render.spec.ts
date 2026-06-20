/**
 * Render evidence (단계별 브라우저 테스트 의무) — T-20260618-foot-KOHREPORT-PUBLISH-4FIX.
 * 균검사지 탭을 실제 렌더해 4FIX UI 변경을 스크린샷으로 확인:
 *   이슈1: 생년 NULL 행 '미입력' 배지(koh-birth-missing). 이슈2: 발행완료 행 '💾 발행완료' 단일 버튼(koh-published-btn).
 *   이슈3: 생년/조갑부위 누락 행의 발급요청 버튼 data-publishable=false. 이슈4: 버튼 라벨 '발급요청'.
 * AC-0 선조사상 prod birth_date NULL 다수 → '미입력' 배지가 대부분 행에 노출될 것으로 기대.
 * 데이터 없으면 empty-state 만 캡처 — 로직 회귀는 .spec.ts 가 담당.
 */
import { test, expect } from '@playwright/test';

test('render: 4FIX 발급요청 라벨 + 생년 미입력 배지 + 발행완료 단일버튼', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  await page.getByRole('link', { name: '진료 대시보드' }).click();
  await page.waitForTimeout(1500);
  await page.getByTestId('tab-koh-report').click();
  await page.waitForTimeout(2500);

  const rows = page.getByTestId('koh-row');
  const rowCount = await rows.count();

  if (rowCount > 0) {
    // 이슈4: 미발행 행 발급 버튼 라벨 확인(있으면).
    //   ※ T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE: 라벨분기 제거 → 전직군 단일 '발급하기'(旣 '발급요청' superseded).
    const publishBtn = page.getByTestId('koh-publish-btn').first();
    if (await publishBtn.count() > 0) {
      await expect(publishBtn).toHaveText(/발급하기/);
    }
    // 이슈1: 생년 미입력 배지(prod NULL 다수 예상) — 존재 시 텍스트 확인.
    const missing = page.getByTestId('koh-birth-missing').first();
    if (await missing.count() > 0) {
      await expect(missing).toHaveText('미입력');
    }
    // 이슈2: 발행완료 단일버튼(있으면) — '💾 발행완료' 텍스트 + 별도 '보기' 버튼 부재.
    const publishedBtn = page.getByTestId('koh-published-btn').first();
    if (await publishedBtn.count() > 0) {
      await expect(publishedBtn).toContainText('발행완료');
      expect(await page.getByTestId('koh-print-published').count()).toBe(0); // 旣 보기 버튼 제거됨
    }
  }

  await page.screenshot({
    path: 'evidence/T-20260618-foot-KOHREPORT-PUBLISH-4FIX_koh-tab-render.png',
    fullPage: true,
  });
});

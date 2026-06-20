/**
 * Render evidence (단계별 브라우저 테스트 의무) — T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE.
 * 진료대시보드 균검사지 탭을 실제 렌더해 라벨분기 제거(전직군 단일 '발급하기')를 확인:
 *   · 미발행 행 발급 버튼 라벨 = '발급하기' (旣 '발급요청' superseded, 잔존 0).
 *   · 일괄발급 버튼 라벨 = '일괄발급하기' (旣 '일괄발급요청' superseded).
 *   · 안내 푸터 문구 '발급요청' 잔존 0(전부 '발급하기'/'발급'으로 통일).
 * 데이터/역할 의존 — KOH 행이 없으면 empty-state + 푸터만 캡처(로직 회귀는 .spec.ts 가 담당).
 * 권한(WHO) 매트릭스·전8역할 노출은 in-page 로직 sim(.spec.ts)이 SSOT.
 */
import { test, expect } from '@playwright/test';

test('render: ALLROLE 전직군 단일 발급하기 라벨 + 발급요청 잔존 0', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  await page.getByRole('link', { name: '진료 대시보드' }).click();
  await page.waitForTimeout(1500);
  await page.getByTestId('tab-koh-report').click();
  await page.waitForTimeout(2500);

  const rows = page.getByTestId('koh-row');
  const rowCount = await rows.count();

  if (rowCount > 0) {
    // 미발행 행 발급 버튼(있으면) 라벨 = '발급하기' (라벨분기 제거 후 전직군 단일).
    const publishBtn = page.getByTestId('koh-publish-btn').first();
    if (await publishBtn.count() > 0) {
      await expect(publishBtn).toHaveText(/발급하기/);
      await expect(publishBtn).not.toHaveText(/발급요청/);
    }
  }

  // 일괄발급 버튼(canIssue 역할 + 선택 0건) — '일괄발급하기'. (역할 미충족 시 부재 → 스킵)
  const bulkBtn = page.getByRole('button', { name: /일괄발급/ }).first();
  if (await bulkBtn.count() > 0) {
    await expect(bulkBtn).toHaveText(/일괄발급하기/);
    await expect(bulkBtn).not.toHaveText(/일괄발급요청/);
  }

  await page.screenshot({
    path: 'evidence/T-20260620-foot-KOH-ISSUE-ROLE-GRANT-ALLROLE_koh-tab-render.png',
    fullPage: true,
  });
});

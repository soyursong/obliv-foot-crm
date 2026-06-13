/**
 * Render evidence (단계별 브라우저 테스트 의무) — T-20260614-foot-KOHSHEET-RENEWAL-PLISTMIRROR.
 * 균검사지 탭을 실제 렌더해 §B 6컬럼 헤더 + §C 조갑부위 multi-select 위젯을 스크린샷으로 확인.
 * 데이터 없으면 empty-state(헤더/안내문)만 캡처 — 로직 회귀는 별도 .spec.ts 가 담당.
 */
import { test, expect } from '@playwright/test';

test('render: 균검사지 6컬럼 + 조갑부위 멀티토글 위젯', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  // 사이드바 '진료 대시보드' 진입(직접 goto 는 dashboard 로 리다이렉트됨).
  await page.getByRole('link', { name: '진료 대시보드' }).click();
  await page.waitForTimeout(1500);
  await page.getByTestId('tab-koh-report').click();
  // 탭 콘텐츠 마운트 대기
  await page.waitForTimeout(2500);

  // 조갑부위 입력 위젯이 렌더된 행이 있으면(=eligible KOH row) 멀티토글 동작 확인.
  const editor = page.getByTestId('nail-site-editor').first();
  if (await editor.count() > 0) {
    // 좌발 L1, L3 + 우발 R2 다중 선택
    await editor.getByTestId('nail-L1').click();
    await page.waitForTimeout(400);
    await editor.getByTestId('nail-L3').click();
    await page.waitForTimeout(400);
    await editor.getByTestId('nail-R2').click();
    await page.waitForTimeout(600);
    // 선택 강조(aria-pressed) 확인
    await expect(editor.getByTestId('nail-L1')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.getByTestId('nail-L3')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.getByTestId('nail-R2')).toHaveAttribute('aria-pressed', 'true');
  }

  await page.screenshot({
    path: 'evidence/T-20260614-foot-KOHSHEET-RENEWAL-PLISTMIRROR_koh-tab-render.png',
    fullPage: true,
  });
});

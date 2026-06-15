/**
 * E2E spec — T-20260615-foot-TOEILLUST-NAIL-FOCUS-RESIZE
 * 양발가락 일러스트(FootToeIllustration) 발톱 중점 리사이즈(공간 축소).
 *
 * reporter(김주연 총괄): "귀엽긴 한데 공간을 너무 많이 차지" → 발톱 중점 + 컴팩트 구도.
 * 시각 표현(크기·구도)만 변경. 선택 모델/바인딩/저장키/data-testid 불변.
 *
 * AC1 (공간 축소): SVG 일러스트 세로 면적 축소(발측면 전체 → 앞발 크롭). 렌더 높이가 컴팩트.
 * AC2 (발톱 중점): 발톱(toenail) 시각 주체 — 본 spec은 구조 보존 + 렌더로 확인(이미지 자가검증).
 * AC3 (선택 기능 불변 + hit-area): L1~L5/R1~R5 클릭/다중선택/토글 그대로 + toe별 투명 hit-rect 존재.
 * AC4 (반응형): 모바일 폭에서 좌/우 발 모두 표시·겹침 없음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260615-TOEILLUST-NAIL-FOCUS-RESIZE — 발톱 중점 컴팩트 일러스트', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 실패(storageState/env 미설정)');
    await page.goto('/admin/packages');
  });

  test('AC1: 일러스트가 컴팩트하게 표시(세로 면적 축소)', async ({ page }) => {
    const illust = page.getByTestId('foot-toe-illustration');
    await expect(illust).toBeVisible();
    // 발측면 전체(이전 176px 높이) → 앞발 크롭(viewBox 114, 폭<120). 좌측 발 SVG 박스 높이 컴팩트.
    const svgBox = await page.getByTestId('foot-L').locator('svg').boundingBox();
    expect(svgBox).not.toBeNull();
    // 이전 풀풋(측면) 구도는 ~176px 높이. 발톱중점 크롭은 폭(<=120) 이하 높이로 컴팩트.
    expect(svgBox!.height).toBeLessThan(150);
  });

  test('AC3: 발톱 10개 클릭/다중선택/토글 불변 + hit-area 확보', async ({ page }) => {
    const picker = page.getByTestId('packages-foot-toe-picker');
    // 10개 발톱 전부 + 각 hit-rect 존재
    for (const side of ['L', 'R'] as const) {
      for (let toe = 1; toe <= 5; toe++) {
        await expect(picker.getByTestId(`toe-${side}-${toe}`)).toBeVisible();
        await expect(picker.getByTestId(`toe-${side}-${toe}-hit`)).toHaveCount(1);
      }
    }
    const r1 = picker.getByTestId('toe-R-1');
    const l5 = picker.getByTestId('toe-L-5');
    await expect(r1).toHaveAttribute('data-selected', 'false');
    await r1.click();
    await expect(r1).toHaveAttribute('data-selected', 'true');
    await expect(picker.getByTestId('foot-toe-preview')).toContainText('R1');
    // 다중선택(작은 새끼발톱 L5도 정확히 토글 — hit-area)
    await l5.click();
    await expect(l5).toHaveAttribute('data-selected', 'true');
    await expect(r1).toHaveAttribute('data-selected', 'true');
    // 토글 해제
    await r1.click();
    await expect(r1).toHaveAttribute('data-selected', 'false');
  });

  test('AC4: 모바일 폭에서 좌/우 발 모두 표시', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const picker = page.getByTestId('packages-foot-toe-picker');
    await expect(picker.getByTestId('foot-L')).toBeVisible();
    await expect(picker.getByTestId('foot-R')).toBeVisible();
    // 작은 발톱(새끼)도 모바일에서 클릭 토글 정상
    const r5 = picker.getByTestId('toe-R-5');
    await r5.click();
    await expect(r5).toHaveAttribute('data-selected', 'true');
  });
});

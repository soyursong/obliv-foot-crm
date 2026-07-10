/**
 * T-20260710-foot-EXAM-TARGET-TABLE-TODAY-EXPAND — 라이브 브라우저 재현 spec
 *
 * ▶ FIX-REQUEST 배경 (MSG-20260710-125529-5v71, qa_fail_phase=phase2 browser_diag_fail):
 *   supervisor browser_qa 가 /admin/treatment-table 진입 직후 [data-testid="exam-targets-section"]
 *   count>=1 을 검사 → found 0 으로 실패.
 *
 * ▶ 근본 원인(코드 확정, 버그 아님·재현 경로 누락):
 *   치료테이블은 4개 탭(진료 환자 이력 / 균검사 & 피검사 대상자 / 경과분석 / 경과분석 플랜) 구조.
 *   ExamTargetsSection 은 2번째 탭 <TabsContent value="exam"> 안에 있고, 기본 탭은 'history'.
 *   Radix Tabs 는 비활성 탭 콘텐츠를 DOM 에 마운트하지 않으므로(lazy),
 *   페이지 진입만으로는 exam-targets-section 이 DOM 에 없다.
 *   → QA 재현 경로: 반드시 [data-testid="tab-exam-targets"] 탭을 먼저 클릭해야 섹션이 렌더된다.
 *
 * ▶ 이 spec 이 곧 QA 재현 경로: 로그인 → /admin/treatment-table → exam 탭 클릭 →
 *   exam-targets-section 가시화 단언. (기능 자체 AC1~AC5 는 자매 정적 spec
 *   T-20260710-foot-EXAM-TARGET-TABLE-TODAY-EXPAND.spec.ts 에서 검증.)
 *
 * 주: 테스트 DB 에 당일 대상자가 없을 수 있어 '섹션 컨테이너 가시화'까지만 단언(방어적).
 *     당일 대상자 유무와 무관하게 섹션 프레임(빈 상태 포함)은 항상 렌더된다.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ??
        (() => {
          throw new Error('TEST_PASSWORD env required (no plaintext fallback)');
        })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|admin|$)/, { timeout: 10000 }).catch(() => {});
  }
}

test.describe('T-20260710-foot-EXAM-TARGET-TABLE-TODAY-EXPAND (browser 재현 경로)', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('재현: 치료테이블 → [균검사 & 피검사 대상자] 탭 클릭 시 exam-targets-section 렌더', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');

    // 탭 컨테이너(치료테이블 진입 확인) — 4탭 TabsList
    const tabs = page.getByTestId('treatment-section-tabs');
    await expect(tabs).toBeVisible({ timeout: 10000 });

    // 기본 탭('history')에서는 exam 섹션이 아직 마운트 안 됨 — 재현 경로의 핵심.
    // (QA 실패 원인: 이 시점에 exam-targets-section 을 찾아 count 0)

    // ▶ 재현 경로: exam 탭 클릭
    const examTab = page.getByTestId('tab-exam-targets');
    await expect(examTab).toBeVisible();
    await examTab.click();

    // 탭 클릭 후 → exam-targets-section 가시화 (당일 대상자 유무와 무관하게 섹션 프레임 렌더)
    const section = page.getByTestId('exam-targets-section');
    await expect(section).toBeVisible({ timeout: 10000 });
  });
});

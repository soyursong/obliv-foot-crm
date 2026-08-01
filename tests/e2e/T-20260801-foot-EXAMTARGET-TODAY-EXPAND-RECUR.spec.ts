/**
 * E2E Spec — T-20260801-foot-EXAMTARGET-TODAY-EXPAND-RECUR (P1, 재발 / 김주연 총괄 U0ATDB587PV)
 *
 * ▶ 현장 재제보(8/1): 치료테이블 > [균검사(&피검사)] 대상자 탭 진입 시 오늘 날짜 섹션이
 *   '펼쳐진(expanded)' 상태여야 하는데 '접혀있음(collapsed)' 재발.
 *
 * ▶ dual-hypothesis 판별 결론(코드/번들 증거 기반, 추정 금지):
 *   (1) 코드 회귀 아님: 원 fix 06ea9224(WINDOW_DAYS 14→1) + 재발 self-heal d9f96f54
 *       (expandedDates 초기값=오늘 + day-aware 롤오버) 모두 origin/main 조상 = 생존.
 *   (2) 배포 미반영 아님: prod version.json commit == origin/main HEAD(efb778c1,
 *       built 2026-08-01T22:14Z). day-aware 펼침 코드가 실배포 번들에 실재.
 *   (3) 재발 RC = 세션 오버나이트/tz off-by-one 동결. 태블릿 24h 상시전원 → 세션이 자정을
 *       넘기면 expandedDates 가 마운트일(어제)에 고정, 부모(local-tz)·자식(KST) '오늘' 불일치로
 *       today 그룹이 접힘 렌더됐다. 이미 d9f96f54(자식 day-aware self-heal) +
 *       TREATTABLE-PARENT-DATE-TZ-RECONCILE(부모 tz 통일 todaySeoulISODate + day-aware)로
 *       근원 제거, 08-01 22:14Z 배포 완료. (본 재제보는 그 배포 이전 08:10 캡처분)
 *
 * ▶ 이 spec 의 역할 = 재발 방지 라이브 브라우저 가드:
 *   자매 spec T-20260801-foot-GUNBLOOD-DEFAULTEXPAND-RECUR.spec.ts 는 순수 로직 + 정적 소스 가드다.
 *   본 spec 은 그 위에 '실 브라우저 렌더' 불변식을 얹는다 — 로그인 → /admin/treatment-table →
 *   [tab-exam-targets] 클릭 → exam-targets-section 가시화 → 오늘 그룹이 data-state="expanded" 로 렌더.
 *   Radix Tabs lazy-mount(비활성 탭 미마운트) 재현 경로 계승: 탭 클릭 전에는 섹션이 DOM 에 없다.
 *
 * AC (본 티켓):
 *   AC-1: 탭 진입 시 오늘(KST) 날짜 그룹이 기본 펼침(data-state="expanded")으로 렌더.
 *   AC-2: 이전 날짜 그룹은 기본 접힘(data-state="collapsed") 유지(비파괴).
 *   AC-3(엣지): 오늘 대상자 0명이어도 섹션 프레임(빈 상태 포함)은 렌더 — 접힘으로 오인되지 않음.
 *
 * 주: 테스트 DB 에 당일/과거 대상자가 없을 수 있어 각 단언은 '해당 그룹이 존재할 때'만 강제(방어적).
 *     당일 대상자 유무와 무관하게 섹션 컨테이너는 항상 렌더된다(AC-3).
 *
 * 실행: npx playwright test T-20260801-foot-EXAMTARGET-TODAY-EXPAND-RECUR.spec.ts --project=desktop-chrome
 */
import { test, expect } from '@playwright/test';
import { seoulISODate } from '../../src/lib/format';

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

test.describe('T-20260801-foot-EXAMTARGET-TODAY-EXPAND-RECUR — 오늘 그룹 기본 펼침(라이브 브라우저 가드)', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('탭 클릭 → exam-targets-section 렌더 + 오늘 그룹 expanded / 과거 그룹 collapsed', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/treatment-table`);
    await page.waitForLoadState('networkidle');

    // 치료테이블 진입 확인(4탭 TabsList)
    const tabs = page.getByTestId('treatment-section-tabs');
    await expect(tabs).toBeVisible({ timeout: 10000 });

    // Radix Tabs lazy-mount: 탭 클릭 전에는 exam-targets-section 이 DOM 에 없다(재현 경로 핵심).
    // ▶ exam 탭 클릭
    const examTab = page.getByTestId('tab-exam-targets');
    await expect(examTab).toBeVisible();
    await examTab.click();

    // AC-3: 탭 클릭 후 섹션 컨테이너 가시화(당일 대상자 유무 무관, 빈 상태 포함)
    const section = page.getByTestId('exam-targets-section');
    await expect(section).toBeVisible({ timeout: 10000 });

    const today = seoulISODate(new Date());

    // AC-1: 오늘 날짜 그룹이 존재하면 반드시 펼침(data-state="expanded").
    const todayGroup = page.locator(`[data-testid="exam-date-group"][data-date="${today}"]`);
    if ((await todayGroup.count()) > 0) {
      await expect(todayGroup.first()).toHaveAttribute('data-state', 'expanded');
      // 펼침 근거: 오늘 그룹 헤더 chevron 이 open(▼), aria-expanded=true.
      const header = todayGroup.first().getByTestId('exam-date-group-header');
      await expect(header).toHaveAttribute('aria-expanded', 'true');
      // 펼침 시 명단 테이블(빈 그룹은 애초에 렌더되지 않으므로 존재 시 가시).
      await expect(todayGroup.first().getByTestId('exam-targets-table')).toBeVisible();
    } else {
      // 오늘 대상자 0명 — 섹션 프레임/빈 상태가 렌더되어 '접힘'으로 오인되지 않음(AC-3).
      const anyGroup = page.getByTestId('exam-date-group');
      const emptyState = page.getByTestId('exam-targets-empty');
      const hasGroups = (await anyGroup.count()) > 0;
      const hasEmpty = await emptyState.isVisible().catch(() => false);
      expect(hasGroups || hasEmpty).toBeTruthy();
    }

    // AC-2: 오늘이 아닌(과거) 날짜 그룹은 접힘(collapsed) 유지 — 존재하는 것만 강제.
    const otherGroups = page.locator(`[data-testid="exam-date-group"]:not([data-date="${today}"])`);
    const otherCount = await otherGroups.count();
    for (let i = 0; i < otherCount; i++) {
      await expect(otherGroups.nth(i)).toHaveAttribute('data-state', 'collapsed');
    }
  });
});

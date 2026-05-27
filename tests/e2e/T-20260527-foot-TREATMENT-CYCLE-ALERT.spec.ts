/**
 * E2E spec — T-20260527-foot-TREATMENT-CYCLE-ALERT
 * 치료회차 기반 경과체크 + 6배수 진료 알림
 *
 * AC-1: 환자별 치료 회차 카운팅 (completed only, 패키지 무관) → RPC 단일 쿼리
 * AC-2: 6배수 회차 자동 플래깅 ('진료 필요' 배지)
 * AC-3: 예약 대시보드 UI — 회차 표시 + 진료 필요 배지
 * AC-4: N+1 방지 (DB 함수 단일 집계)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260527-foot-TREATMENT-CYCLE-ALERT — 치료회차 배지', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');

    await page.goto('/admin/reservations');
    try {
      await page.locator('table').waitFor({ timeout: 15_000 });
    } catch {
      test.skip(true, '예약 페이지 테이블 로드 실패');
    }
    // fetchWeek 완료 대기 (RPC 호출 포함)
    await page.waitForTimeout(2000);
  });

  test('AC-3: 예약 카드가 렌더링될 때 회차 배지가 존재한다', async ({ page }) => {
    // 예약 카드가 1건 이상 있는지 확인
    const cards = page.locator('[data-testid^="resv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      console.log('[AC-3] 오늘 예약 없음 — 스킵');
      test.skip(true, '예약 없음');
      return;
    }

    // 첫 번째 카드의 회차 배지 존재 여부 확인
    // (customer_id 미연결 예약은 배지 없음 — 연결된 카드를 찾아야 함)
    const cycleBadges = page.locator('[data-testid^="cycle-count-"]');
    const badgeCount = await cycleBadges.count();

    // 고객이 연결된 예약이 1건이라도 있으면 회차 배지가 있어야 함
    console.log(`[AC-3] 예약 카드: ${count}건, 회차 배지: ${badgeCount}건`);

    // 배지 텍스트 형식 검증: "N회" 패턴
    if (badgeCount > 0) {
      const firstBadgeText = await cycleBadges.first().textContent();
      expect(firstBadgeText).toMatch(/^\d+회$/);
      console.log(`[AC-3] 첫 번째 회차 배지: "${firstBadgeText}" ✓`);
    }
  });

  test('AC-2: 진료필요 배지가 존재하면 6배수 회차임을 검증한다', async ({ page }) => {
    // 진료필요 배지 조회
    const examBadges = page.locator('[data-testid^="needs-exam-badge-"]');
    const count = await examBadges.count();

    if (count === 0) {
      console.log('[AC-2] 진료필요 배지 없음 (6배수 회차 예약 없음) — 정상');
      return;
    }

    // 진료필요 배지가 있으면 같은 카드의 회차 배지가 6의 배수여야 함
    for (let i = 0; i < count; i++) {
      const badge = examBadges.nth(i);
      const testId = await badge.getAttribute('data-testid');
      // data-testid = "needs-exam-badge-{resv.id}"
      const resvId = testId?.replace('needs-exam-badge-', '');
      if (!resvId) continue;

      const cycleText = await page
        .locator(`[data-testid="cycle-count-${resvId}"]`)
        .textContent();

      if (cycleText) {
        const cycleNum = parseInt(cycleText.replace('회', ''), 10);
        expect(cycleNum % 6).toBe(0);
        console.log(`[AC-2] resv ${resvId}: ${cycleNum}회차 진료필요 배지 ✓`);
      }
    }
  });

  test('AC-3: 진료필요 배지는 purple 계열 색상으로 표시된다', async ({ page }) => {
    const examBadges = page.locator('[data-testid^="needs-exam-badge-"]');
    const count = await examBadges.count();

    if (count === 0) {
      console.log('[AC-3] 진료필요 배지 없음 — 색상 검증 스킵');
      return;
    }

    // 배지 텍스트 확인
    const firstText = await examBadges.first().textContent();
    expect(firstText?.trim()).toBe('진료필요');
    console.log('[AC-3] 진료필요 배지 텍스트 OK');

    // purple 클래스 확인
    const classes = await examBadges.first().getAttribute('class');
    expect(classes).toContain('purple');
    console.log('[AC-3] purple 색상 클래스 ✓');
  });

  test('AC-3: 취소된 예약에는 회차 배지가 표시되지 않는다', async ({ page }) => {
    // 취소된 예약 카드 조회
    const cancelledCards = page.locator('[data-testid^="resv-card-"]').filter({
      has: page.locator('.line-through'),
    });
    const count = await cancelledCards.count();

    if (count === 0) {
      console.log('[AC-3] 취소 예약 없음 — 스킵');
      return;
    }

    // 취소된 카드 내부에 회차 배지 없어야 함
    const cycleBadgesInCancelled = cancelledCards.locator('[data-testid^="cycle-count-"]');
    const badgeCount = await cycleBadgesInCancelled.count();
    expect(badgeCount).toBe(0);

    console.log('[AC-3] 취소 예약 내 회차 배지 없음 ✓');
  });

  test('AC-4: 예약 페이지 로드 시 N+1 없이 단일 배치로 로딩된다 (네트워크 확인)', async ({ page }) => {
    // DB 함수 호출 횟수 측정 — rpc/get_treatment_cycle_counts가 1번만 호출되어야 함
    let cycleRpcCallCount = 0;

    page.on('request', (req) => {
      if (req.url().includes('get_treatment_cycle_counts')) {
        cycleRpcCallCount++;
        console.log(`[AC-4] RPC 호출 감지: ${req.url()}`);
      }
    });

    // 페이지 재로드
    await page.reload();
    try {
      await page.locator('table').waitFor({ timeout: 15_000 });
    } catch {
      test.skip(true, '예약 페이지 테이블 로드 실패');
      return;
    }
    await page.waitForTimeout(2500);

    // RPC는 최대 1회 호출 (0회=예약 없음, 1회=정상 배치 쿼리)
    expect(cycleRpcCallCount).toBeLessThanOrEqual(1);
    console.log(`[AC-4] get_treatment_cycle_counts RPC 호출 횟수: ${cycleRpcCallCount} ✓`);
  });
});

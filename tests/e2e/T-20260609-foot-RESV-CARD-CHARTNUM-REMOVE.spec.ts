/**
 * T-20260609-foot-RESV-CARD-CHARTNUM-REMOVE
 * 재진 예약 카드 차트번호 뱃지 제거 — 식별자는 핸드폰 뒷4자리만
 *
 * 배경 (김주연 총괄):
 *   직전 T-20260609-foot-RESV-PATIENT-PHONE-SUFFIX(afa639e)가 재진 예약 카드
 *   (DraggableBox2ResvCard)에 핸드폰 뒷4자리 suffix를 추가했으나 #차트번호 뱃지도
 *   유지(AC-4) → 한 카드에 두 식별자 동시 표출. reporter가 차트번호 제거 명시 지시.
 *   → 직전 AC-4(차트번호 회귀금지)는 본 surface 한정 superseded.
 *
 * 변경 (presentation only, DB/API 무변경 — src/pages/Dashboard.tsx DraggableBox2ResvCard):
 *   - resvChartMap/resvChartNum 선언 제거 (unused).
 *   - #차트번호 뱃지 렌더 블록 제거.
 *   - 식별자는 핸드폰 뒷4자리(resv-phone-suffix) 만.
 *   - fallback: phone 결측 시 suffix 미렌더 + 차트번호 fallback 없음 → 성함만.
 *     (직전 측정 재진 결측 0.4% / 4자리미만 0건)
 *
 * 시나리오:
 *   S1 (AC-1): 재진 예약 카드에 #차트번호 뱃지가 더 이상 없다.
 *   S2 (AC-2): 재진 예약 카드 식별자는 핸드폰 뒷4자리(\d{4})만 — 있으면 정확히 4자리.
 *   S3 (AC-3 회귀): 초진 예약 카드(DraggableBox1Card) 핸드폰 뒷4자리 표기 유지.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260609-foot-RESV-CARD-CHARTNUM-REMOVE', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndWaitForDashboard(page);
  });

  // ── S1: 재진 예약 카드 — #차트번호 뱃지 제거됨 ──
  test('S1: 재진 예약 카드에 #차트번호 뱃지가 없다(AC-1)', async ({ page }) => {
    await page.waitForTimeout(1500);
    const cards = page.locator('[data-testid="box2-resv-card"]');
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 미내원 재진 예약 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }

    for (let i = 0; i < Math.min(count, 8); i++) {
      const card = cards.nth(i);
      // #로 시작하는 font-mono 차트번호 뱃지가 존재하면 안 됨
      const chartBadge = card.locator('span.font-mono').filter({ hasText: /^#/ });
      expect(await chartBadge.count()).toBe(0);
    }
  });

  // ── S2: 재진 예약 카드 — 핸드폰 뒷4자리만 식별자 ──
  test('S2: 재진 예약 카드 식별자는 핸드폰 뒷4자리만(AC-2)', async ({ page }) => {
    await page.waitForTimeout(1500);
    const cards = page.locator('[data-testid="box2-resv-card"]');
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 미내원 재진 예약 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }

    for (let i = 0; i < Math.min(count, 8); i++) {
      const card = cards.nth(i);
      const phoneSuffix = card.locator('[data-testid="resv-phone-suffix"]');
      const hasPhone = (await phoneSuffix.count()) > 0;
      // 핸드폰 suffix가 있으면 정확히 숫자 4자리
      if (hasPhone) {
        const text = (await phoneSuffix.first().textContent())?.trim() ?? '';
        expect(text).toMatch(/^\d{4}$/);
      }
      // 핸드폰이 없어도(결측) 차트번호 fallback 뱃지는 없어야 함 — 성함만 표기 허용
      const chartBadge = card.locator('span.font-mono').filter({ hasText: /^#/ });
      expect(await chartBadge.count()).toBe(0);
    }
  });

  // ── S3: 초진 예약 카드 — 핸드폰 뒷4자리 유지 (회귀 없음) ──
  test('S3: 초진 예약 카드 핸드폰 뒷4자리 표기 유지(AC-3 회귀 없음)', async ({ page }) => {
    await page.waitForTimeout(1500);
    const cards = page.locator('[data-testid="box1-resv-card"]');
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 미내원 초진 예약 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    const first = cards.first();
    const monoSpan = first.locator('span.font-mono');
    expect(await monoSpan.count()).toBeGreaterThan(0);
    const text = (await monoSpan.first().textContent())?.trim() ?? '';
    expect(text.length).toBeGreaterThan(0);
  });
});

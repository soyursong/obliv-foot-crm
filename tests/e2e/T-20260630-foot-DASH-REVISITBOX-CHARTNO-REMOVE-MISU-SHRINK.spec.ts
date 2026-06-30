/**
 * T-20260630-foot-DASH-REVISITBOX-CHARTNO-REMOVE-MISU-SHRINK
 * 대시보드 통합 시간표 '재진 고객박스' — 초진 박스 구성(성함+폰뒷자리+미수유무) 정합 재확인
 *   + 미수 딱지(배지) 사이즈 더 작게.
 *
 * 배경 (현장 재확인, "차트번호 아직 표시됨 / 미수 딱지 더 작게"):
 *   - 차트번호 제거는 6/30 REVISIT-CUSTBOX-CHARTNO-REMOVE-MATCH-INTAKE 에서 활성 재진 박스
 *     (체크인 카드 returning / 재진 예약 카드 box2-resv-card) 전부 적용 완료 → 본 티켓은 회귀 보증.
 *   - 미수 배지를 한 단계 더 축소: text-[8px] px-0.5 → REVISIT_MISU_BADGE_CLS(text-[7px] px-px py-0
 *     leading-none whitespace-nowrap). whitespace-nowrap = clip 가드("미수" 줄바꿈/잘림 방지).
 *
 * 변경 (presentation only / DB·RPC 무변경 — src/pages/Dashboard.tsx):
 *   - REVISIT_MISU_BADGE_CLS 상수 신설 → 재진 체크인 카드·재진 예약 카드 두 곳 공통 적용(divergence 방지).
 *   - 초진(new) 카드 미수 배지·#차트번호 표기 무수정 = 색컨벤션·레이아웃 무변경(AC-4, T-20260625 field-lock).
 *
 * 현장 클릭 시나리오 → E2E:
 *   AC1: 재진 고객박스(체크인·예약)에 #차트번호/시리얼이 없다.
 *   AC2: 재진 고객박스 식별자 = 폰 뒷4자리(초진 박스와 동일 구성).
 *   AC3: 재진 미수 배지가 더 작은 className(text-[7px], whitespace-nowrap clip 가드)으로 렌더된다.
 *   AC4(회귀): 초진 체크인 카드의 #차트번호 표기는 유지된다(색컨벤션·레이아웃 무변경).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const RETURNING_CARD = '[data-testid="timeline-checkin-card"][data-visittype="returning"]';
const NEW_CARD = '[data-testid="timeline-checkin-card"][data-visittype="new"]';
const RESV_CARD = '[data-testid="box2-resv-card"]';

test.describe('T-20260630-foot-DASH-REVISITBOX-CHARTNO-REMOVE-MISU-SHRINK', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
  });

  // ── AC1: 재진 고객박스(체크인+예약) — #차트번호/시리얼 없음 ──
  test('AC1: 재진 고객박스(체크인·예약)에 #차트번호/시리얼이 없다', async ({ page }) => {
    const cards = page.locator(RETURNING_CARD).or(page.locator(RESV_CARD));
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 재진 고객박스 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 10); i++) {
      const card = cards.nth(i);
      const chartBadge = card.locator('span').filter({ hasText: /^#/ });
      expect(await chartBadge.count()).toBe(0);
      const txt = (await card.textContent()) ?? '';
      expect(txt).not.toMatch(/#\s*F-/i);
    }
  });

  // ── AC2: 재진 식별자 = 폰 뒷4자리 (초진 박스와 동일 구성) ──
  test('AC2: 재진 고객박스 식별자는 폰 뒷4자리(\\d{4})만', async ({ page }) => {
    const checkinSuffix = page.locator(`${RETURNING_CARD} [data-testid="timeline-phone-suffix"]`);
    const resvSuffix = page.locator(`${RESV_CARD} [data-testid="resv-phone-suffix"]`);
    const suffixes = checkinSuffix.or(resvSuffix);
    const count = await suffixes.count();
    if (count === 0) {
      test.skip(true, '오늘 폰 뒷자리 표기된 재진 박스 없음 — 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 10); i++) {
      const text = (await suffixes.nth(i).textContent())?.trim() ?? '';
      expect(text).toMatch(/^\d{4}$/);
    }
  });

  // ── AC3: 재진 미수 배지 더 축소(text-[7px]) + clip 가드(whitespace-nowrap) ──
  test('AC3: 재진 미수 배지가 더 작은 className(text-[7px]·whitespace-nowrap)으로 렌더된다', async ({ page }) => {
    const badges = page.locator(`${RETURNING_CARD} [data-testid="outstanding-due-badge"]`)
      .or(page.locator(`${RESV_CARD} [data-testid="outstanding-due-badge"]`));
    const count = await badges.count();
    if (count === 0) {
      test.skip(true, '오늘 미수 있는 재진 고객박스 없음 — 배지 축소 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const badge = badges.nth(i);
      const cls = (await badge.getAttribute('class')) ?? '';
      // AC3: 더 축소 — 7px, 8px/9px 아님
      expect(cls).toContain('text-[7px]');
      expect(cls).not.toContain('text-[8px]');
      expect(cls).not.toContain('text-[9px]');
      // clip 가드: 줄바꿈 금지 → 텍스트는 항상 '미수' 그대로
      expect(cls).toContain('whitespace-nowrap');
      expect((await badge.textContent())?.trim()).toBe('미수');
    }
  });

  // ── AC4(회귀): 초진 체크인 카드 #차트번호 표기 유지 ──
  test('AC4: 초진 체크인 고객박스 #차트번호 표기는 유지된다(색컨벤션·레이아웃 무변경)', async ({ page }) => {
    const cards = page.locator(NEW_CARD);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 초진 체크인 카드 없음 — 회귀 검증 스킵(데이터 의존)');
      return;
    }
    let anyChart = false;
    for (let i = 0; i < Math.min(count, 12); i++) {
      const mono = cards.nth(i).locator('span.font-mono.text-teal-600').filter({ hasText: /^#/ });
      if ((await mono.count()) > 0) {
        const text = (await mono.first().textContent())?.trim() ?? '';
        expect(text.startsWith('#')).toBeTruthy();
        anyChart = true;
      }
    }
    if (!anyChart) {
      test.skip(true, '초진 체크인 카드에 차트번호 발번 고객 없음 — 회귀 표본 부족');
    }
  });
});

/**
 * T-20260701-foot-TIMETABLE-NEW-PHONE-UNIFY
 * 대시보드 통합시간표 '초진' 체크인 카드 — 차트번호(#RF-…) 제거 + 폰번호 뒷4자리로 통일 (재진 카드와 동일 포맷)
 *
 * 배경 (김주연 총괄, 스크린샷 20260701_191428.png):
 *   T-20260630-REVISIT-CUSTBOX-CHARTNO-REMOVE-MATCH-INTAKE 로 재진 체크인 카드를 폰 뒷4자리로 통일했으나,
 *   초진(new) 체크인 카드는 T-20260514-CHART-NO-VISIBLE 이후 차트번호(#RF-…/#0042)를 계속 표기 중.
 *   → 초진도 재진과 동일하게 폰번호 뒷4자리로 통일. (통일 마무리 건)
 *
 * 변경 (presentation only / DB·RPC 무변경 — src/pages/Dashboard.tsx):
 *   - TimelineCheckInCard: visitType 분기 제거 → 초진/재진 모두 폰 뒷4자리(timeline-phone-suffix) 표기로 통일.
 *     초진 #차트번호(font-mono text-teal-600) span 제거. ChartNumberMapCtx 소비 종료(본 컴포넌트 한정).
 *   - Box1Card(셀프접수 대기) / 재진 카드 표시 무수정 (회귀 금지).
 *   - 차트번호 표시는 예약관리/칸반 등 타 surface 유지(격리) — CHART-NO-VISIBLE AC-1/AC-2 영향 없음.
 *
 * 현장 클릭 시나리오 → E2E (티켓 §현장 클릭 시나리오 1·2):
 *   S1 (AC-1): 초진 체크인 카드에 #RF-…/#차트번호가 없다.
 *   S2 (AC-2): 초진 체크인 카드 식별자는 폰 뒷4자리(timeline-phone-suffix, \d{4})다.
 *   S3 (AC-4 회귀): 재진 체크인 카드도 폰 뒷4자리 유지 + 차트번호 없음 (변화 없음).
 *   S4 (AC-3 회귀): Box1Card(셀프접수 대기) 폰 뒷4자리 표시 유지 (변화 없음).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const NEW_CARD = '[data-testid="timeline-checkin-card"][data-visittype="new"]';
const RETURNING_CARD = '[data-testid="timeline-checkin-card"][data-visittype="returning"]';

test.describe('T-20260701-foot-TIMETABLE-NEW-PHONE-UNIFY', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.waitForTimeout(1500);
  });

  // ── S1: 초진 체크인 카드 — #차트번호(#RF-…) 제거 (AC-1) ──
  test('S1: 초진 체크인 카드에 #차트번호(#RF-…)가 없다(AC-1)', async ({ page }) => {
    const cards = page.locator(NEW_CARD);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 초진 체크인 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 12); i++) {
      const card = cards.nth(i);
      // #로 시작하는 차트번호/시리얼(#RF-…, #0042 등) span 이 존재하면 안 됨
      const chartBadge = card.locator('span').filter({ hasText: /^#/ });
      expect(await chartBadge.count()).toBe(0);
      // teal 차트번호 span(구 표기)도 제거되어야 함
      expect(await card.locator('span.font-mono.text-teal-600').count()).toBe(0);
      // 텍스트 전체에도 차트 시리얼 패턴(#RF-…)이 없어야 함
      const txt = (await card.textContent()) ?? '';
      expect(txt).not.toMatch(/#\s*R?F-/i);
    }
  });

  // ── S2: 초진 체크인 식별자 = 폰 뒷4자리 (AC-2, 재진과 동일 포맷) ──
  test('S2: 초진 체크인 카드 식별자는 폰 뒷4자리(timeline-phone-suffix)다(AC-2)', async ({ page }) => {
    const cards = page.locator(NEW_CARD);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 초진 체크인 카드 없음 — DOM 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 12); i++) {
      const card = cards.nth(i);
      const phoneSuffix = card.locator('[data-testid="timeline-phone-suffix"]');
      if ((await phoneSuffix.count()) > 0) {
        const text = (await phoneSuffix.first().textContent())?.trim() ?? '';
        expect(text).toMatch(/^\d{4}$/);
      }
      // 폰 결측이어도 차트번호 fallback 은 없어야 함 — 성함만 허용
      const chartBadge = card.locator('span').filter({ hasText: /^#/ });
      expect(await chartBadge.count()).toBe(0);
    }
  });

  // ── S3: 재진 체크인 카드 — 폰 뒷4자리 유지 + 차트번호 없음 (AC-4 회귀) ──
  test('S3: 재진 체크인 카드 폰 뒷4자리 표시 유지·차트번호 없음(AC-4 회귀)', async ({ page }) => {
    const cards = page.locator(RETURNING_CARD);
    const count = await cards.count();
    if (count === 0) {
      test.skip(true, '오늘 재진 체크인 카드 없음 — 회귀 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const card = cards.nth(i);
      const phoneSuffix = card.locator('[data-testid="timeline-phone-suffix"]');
      if ((await phoneSuffix.count()) > 0) {
        const text = (await phoneSuffix.first().textContent())?.trim() ?? '';
        expect(text).toMatch(/^\d{4}$/);
      }
      const chartBadge = card.locator('span').filter({ hasText: /^#/ });
      expect(await chartBadge.count()).toBe(0);
    }
  });

  // ── S4: Box1(셀프접수 대기, DraggableBox1Card) 폰 뒷4자리 표시 유지 (AC-3 회귀) ──
  test('S4: 초진 셀프접수 대기 카드(미내원)의 폰 뒷4자리 표시는 유지된다(AC-3 회귀)', async ({ page }) => {
    // DraggableBox1Card(box1-resv-card) = 미내원(예약만) 셀프접수 대기. 체크인 카드가 아니므로 timeline-checkin-card 아님.
    // 초진 미내원 카드는 성함 + 폰 뒷4자리(font-mono \d{4}) 구성 — 본 티켓 무수정.
    const box1 = page.locator('[data-testid="box1-resv-card"]');
    const count = await box1.count();
    if (count === 0) {
      test.skip(true, '오늘 초진 셀프접수 대기(미내원) 카드 없음 — 회귀 검증 스킵(데이터 의존)');
      return;
    }
    for (let i = 0; i < Math.min(count, 8); i++) {
      const tail = box1.nth(i).locator('span.font-mono');
      if ((await tail.count()) > 0) {
        const text = (await tail.first().textContent())?.trim() ?? '';
        // 폰 뒷4자리(\d{4}) 또는 결측 placeholder(????)
        expect(text).toMatch(/^(\d{4}|\?{4})$/);
      }
    }
  });
});
